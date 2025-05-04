import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import type { Show } from '../types.js';
import { SCRAPER_CONFIG, logDebug } from '../config.js';
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
  private completedJobs: Job[] = [];

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
      // Track completed jobs
      this.completedJobs.push(job);
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
      // Check subrequest limit before processing
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.error('Subrequest limit reached before processing job');
        throw new Error('Subrequest limit reached');
      }

      const response = await fetchWithRetry(job.url);
      const html = await response.text();
      
      // Use a lightweight check before loading the full cheerio parser
      if (html.includes('Вибачте, наразі немає подій') || !html.includes('event-card')) {
        logDebug(`No events found for ${job.day} (quick check)`);
        return [];
      }
      
      // Only load cheerio if we have potential shows
      const $ = cheerio.load(html);
      
      if (hasNoEvents($)) {
        logDebug(`No events found for ${job.day}`);
        return [];
      }
      
      const dayShows = parseShowsFromHtml($, job.day);
      logDebug(`Found ${dayShows.length} shows for ${job.day}`);
      
      // With Cloudflare Worker constraints, we'll prioritize just returning the found shows
      // and handle persistence separately to avoid exceeding CPU time limits
      return dayShows;
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
    const initialJobCount = this.queue.length + this.running;
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      // Short timeout for Cloudflare Worker CPU limits
      const timeout = setTimeout(() => {
        const completedJobs = this.completedJobs.length;
        const completionPercentage = Math.round((completedJobs / initialJobCount) * 100);
        
        console.error(`CPU time limit reached (${completionPercentage}% completed, ${this.results.length} shows found). Returning partial results.`);
        resolve(this.results);
      }, MAX_WAIT_TIME);
      
      // Check queue status frequently
      const checkQueueStatus = () => {
        // Check if we need to stop due to CPU time limit approaching
        if (Date.now() - startTime >= MAX_WAIT_TIME - 2) { // Leave 2ms buffer
          clearTimeout(timeout);
          console.log(`CPU time limit approaching, stopping queue processing. Found ${this.results.length} shows.`);
          resolve(this.results);
          return;
        }
        
        // Return completed results if the queue is empty and nothing is running
        if (this.queue.length === 0 && this.running === 0) {
          clearTimeout(timeout);
          resolve(this.results);
          return;
        }
        
        // Check again quickly
        setTimeout(checkQueueStatus, 1); // Check every 1ms
      };
      
      checkQueueStatus();
    });
  }

  getResults(): Show[] {
    return this.results;
  }
  
  // Get pending jobs for state persistence
  getPendingJobs(): Job[] {
    // Return a copy of the current queue
    return [...this.queue];
  }
  
  // Get completed jobs for tracking processed dates
  getCompletedJobs(): Job[] {
    return this.completedJobs;
  }
} 