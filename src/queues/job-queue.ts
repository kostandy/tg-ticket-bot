import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { getStoredShows, storeShows } from '../storage/file.js';
import type { Show } from '../types.js';
import { getSupabase } from '../db.js';
import { SCRAPER_CONFIG } from '../config.js';
import { fetchWithRetry, getSubrequestCount } from '../http/fetch-client.js';
import { hasNoEvents, parseShowsFromHtml } from '../scrapers/html-parser.js';

export interface Job {
  url: string;
  day: string;
}

export class JobQueue {
  private queue: Job[] = [];
  private running = 0;
  private results: Show[] = [];

  constructor(private maxConcurrent: number) {}

  add(job: Job) {
    this.queue.push(job);
    this.processNext();
  }

  private async processNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0 || getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.error('Stopping job processing due to subrequest limit');
      }
      return;
    }

    this.running++;
    const job = this.queue[0];
    this.queue = this.queue.slice(1);
    
    try {
      const shows = await this.processJob(job);
      this.results.push(...shows);
    } catch (error: unknown) {
      console.error(`Error processing job for ${job.url}:`, error);
      
      // If we hit the subrequest limit, stop processing
      if (error instanceof Error && 
         (error.message === 'Subrequest limit reached' || 
          error.message === 'Too many subrequests')) {
        console.log('Stopping job processing due to subrequest limit');
        return;
      }
    } finally {
      this.running--;
      this.processNext();
    }
  }

  private async processJob(job: Job): Promise<Show[]> {
    try {
      const response = await fetchWithRetry(job.url);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      if (hasNoEvents($)) {
        console.log(`No events found for ${job.day}`);
        return [];
      }
      
      const dayShows = parseShowsFromHtml($, job.day);
      console.log(`Found ${dayShows.length} shows for ${job.day}`);
      
      const existingFileName = await this.findExistingFile(job.day);
      const storedShows = existingFileName ? await getStoredShows(existingFileName) : [];
      const posterMap = new Map<string, Show>();
      
      // Store shows by their new hash-based ID
      for (const show of storedShows) {
        posterMap.set(show.id, show);
      }
      
      // Add new shows from current scrape
      for (const show of dayShows) {
        posterMap.set(show.id, show);
      }
      
      const mergedShows = Array.from(posterMap.values());
      
      if (SCRAPER_CONFIG.STORAGE_MODE) {
        const contentHash = this.calculateHash(mergedShows).slice(0, 10);
        const newFileName = `posters-${job.day}-${contentHash}`;
        
        if (!existingFileName || existingFileName.split('-').pop()?.split('.')[0] !== contentHash) {
          if (existingFileName) {
            await this.deleteFile(existingFileName);
          }
          await storeShows(newFileName, mergedShows);
        } else {
          console.log(`Content unchanged for ${job.day}, skipping storage`);
        }
      } else {
        const supabase = getSupabase();
        
        // Fetch only IDs and content hashes to minimize payload
        const { data: existingShows, error: selectError } = await supabase
          .from('shows')
          .select('id, contentHash')
          .in('id', mergedShows.map(show => show.id));
        
        if (selectError) {
          console.error('Failed to fetch existing shows:', selectError);
          return mergedShows;
        }
        
        // Create a map for fast lookup
        const existingShowMap = new Map<string, { id: string; contentHash?: string }>();
        existingShows?.forEach(show => existingShowMap.set(show.id, show));
        
        let newCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        
        // Batch operations to reduce subrequests and timeouts
        const showsToInsert: Show[] = [];
        const showsToUpdate: Show[] = [];
        
        // First, separate shows into insertion and update batches
        for (const show of mergedShows) {
          const existingShow = existingShowMap.get(show.id);
          
          if (!existingShow) {
            // New show
            showsToInsert.push(show);
          } else if (existingShow.contentHash !== show.contentHash) {
            // Show exists but content has changed
            showsToUpdate.push(show);
          } else {
            // Show exists and hasn't changed - no update needed
            unchangedCount++;
          }
        }
        
        // Process insertions in batch (up to 10 at a time)
        for (let i = 0; i < showsToInsert.length; i += 10) {
          const batch = showsToInsert.slice(i, i + 10);
          if (batch.length > 0) {
            try {
              const { error } = await supabase.from('shows').insert(batch);
              if (error) throw error;
              newCount += batch.length;
            } catch (error) {
              console.error(`Error inserting batch of ${batch.length} shows:`, error);
            }
          }
          
          // Small delay between batches, but much less than before
          if (i + 10 < showsToInsert.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        // Process updates individually (since we need to filter by ID)
        for (const show of showsToUpdate) {
          try {
            const { error: updateError } = await supabase
              .from('shows')
              .update({ 
                title: show.title,
                url: show.url,
                imageUrl: show.imageUrl,
                ticketUrl: show.ticketUrl,
                soldOut: show.soldOut,
                contentHash: show.contentHash
              })
              .eq('id', show.id);
            
            if (updateError) throw updateError;
            updatedCount++;
            
            // Very small delay between operations
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            console.error(`Error updating show ${show.id}:`, error);
          }
        }
        
        console.log(`Day ${job.day} processed: ${newCount} new, ${updatedCount} updated, ${unchangedCount} unchanged shows`);
      }
      
      return mergedShows;
    } catch (error: unknown) {
      if (error instanceof Error && 
         (error.message === 'Subrequest limit reached' || 
          error.message === 'Too many subrequests')) {
        console.error(`Hit subrequest limit while processing ${job.url}`);
        throw error;
      }
      console.error(`Error in processJob for ${job.url}:`, error);
      return [];
    }
  }

  private calculateHash(data: Show[]): string {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  private async findExistingFile(day: string): Promise<string | null> {
    try {
      // Check if we've hit the subrequest limit
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.log('Skipping file lookup due to subrequest limit');
        return null;
      }
      
      const response = await fetch(`data/posters/posters-${day}-*.json`);
      const files = await response.json() as string[];
      return files[0] || null;
    } catch {
      return null;
    }
  }

  private async deleteFile(fileName: string): Promise<void> {
    try {
      // Check if we've hit the subrequest limit
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.log('Skipping file deletion due to subrequest limit');
        return;
      }
      
      await fetch(`data/posters/${fileName}`, { method: 'DELETE' });
    } catch (error) {
      console.error(`Error deleting file ${fileName}:`, error);
    }
  }

  async waitForCompletion(): Promise<Show[]> {
    const MAX_WAIT_TIME = SCRAPER_CONFIG.MAX_WAIT_TIME;
    const startTime = Date.now();
    const initialJobCount = this.queue.length + this.running;
    let lastStatusLog = 0;
    
    while (this.running > 0 || this.queue.length > 0) {
      // Check if we've been running too long
      if (Date.now() - startTime > MAX_WAIT_TIME) {
        const completedJobs = initialJobCount - (this.queue.length + this.running);
        const completionPercentage = Math.round((completedJobs / initialJobCount) * 100);
        console.error(`JobQueue wait time exceeded (${completionPercentage}% completed, ${this.results.length} shows found). Returning partial results.`);
        break;
      }
      
      // Log status periodically to help with debugging
      const now = Date.now();
      if (now - lastStatusLog > 2000) { // Log every 2 seconds
        lastStatusLog = now;
        const elapsed = ((now - startTime) / 1000).toFixed(1);
        const completedJobs = initialJobCount - (this.queue.length + this.running);
        console.log(`JobQueue status after ${elapsed}s: ${completedJobs}/${initialJobCount} jobs completed, ${this.results.length} shows found`);
      }
      
      // Check for subrequest limit
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.error('Stopping job queue due to subrequest limit');
        break;
      }
      
      // Wait a shorter time to be more responsive to limits
      await new Promise(resolve => setTimeout(resolve, 300)); // Reduced from 500ms to be more responsive
    }
    
    // Return collected results even if incomplete
    console.log(`JobQueue finished with ${this.results.length} shows from ${initialJobCount} jobs`);
    return this.results;
  }

  getResults(): Show[] {
    return this.results;
  }
} 