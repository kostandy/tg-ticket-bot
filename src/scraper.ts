import * as cheerio from 'cheerio';
import type { Show } from './types.js';
import { getSupabase, initSupabase } from './db.js';
import { getStoredShows, storeShows } from './storage/file.js';
import { createHash } from 'node:crypto';

// Define Cloudflare-specific fetch options
interface CloudflareFetchOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  cf?: {
    cacheTtl?: number;
    cacheEverything?: boolean;
  };
}

// Enable detailed logging only in development
const IS_DEV = false; // Set to false in production
const logDebug = (message: string, ...args: unknown[]) => {
  if (IS_DEV) {
    console.log(message, ...args);
  }
};

const STORAGE_MODE = process.env.STORAGE_MODE === 'file';
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 1000; // Reduced delay to save CPU time
const MAX_CONCURRENT_JOBS = 1;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE_URL = 'https://molodyytheatre.com';
// Cloudflare Worker limits
const MAX_SUBREQUESTS = 40; // Keep well below the 50 limit to be safe
const CHUNK_SIZE = 5; // Reduced to save memory and CPU time

logDebug('STORAGE_MODE', STORAGE_MODE);

if (!STORAGE_MODE) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }
  
  initSupabase({ SUPABASE_URL: supabaseUrl, SUPABASE_KEY: supabaseKey });
}

// Keep track of subrequests to respect Cloudflare limits
let subrequestCount = 0;

// Create a hash ID from URL and date
const createShowId = (url: string, date: Date | string): string => {
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
  return createHash('sha256').update(`${url}_${dateStr}`).digest('hex').slice(0, 16);
};

// Calculate a content hash for a show to detect changes
const calculateShowContentHash = (show: Show): string => {
  // Create a hash based on the content that matters for change detection
  // Exclude the ID itself since it's derived from URL and date
  const contentToHash = {
    title: show.title,
    date: show.date,
    soldOut: show.soldOut,
    ticketUrl: show.ticketUrl
  };
  return createHash('sha256').update(JSON.stringify(contentToHash)).digest('hex').slice(0, 10);
};

// Helper function to strip query parameters from URLs
const stripQueryParams = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch {
    // If URL parsing fails, return the original URL
    return url;
  }
};

// Memory-efficient HTML parsing - use null selectors for unwanted elements
const parseShowsFromHtml = ($: cheerio.CheerioAPI, date: string): Show[] => {
  const shows: Show[] = [];
  
  $('.views-row').each((_, element) => {
    const $el = $(element);
    const title = $el.find('.views-field-field-event-title .field-content a').text().trim();
    const url = $el.find('.views-field-field-event-title .field-content a').attr('href') || '';
    const rawImageUrl = $el.find('.views-field-field-images img').attr('src') || '';
    const imageUrl = stripQueryParams(rawImageUrl);
    const ticketUrl = $el.find('.views-field-nothing a').attr('href') || '';
    const soldOut = $el.find('.views-field-field-label .field-content').text().trim().toLowerCase() === 'квитки продано';
    
    if (title && url) {
      // Parse date string to Date object
      const dateObj = new Date(date);
      const id = createShowId(url, dateObj);
      const show: Show = {
        id,
        title,
        url,
        date: dateObj,
        imageUrl,
        ticketUrl,
        soldOut
      };
      
      // Calculate and add content hash right away
      show.contentHash = calculateShowContentHash(show);
      shows.push(show);
    }
  });
  
  return shows;
};

// Cache for already fetched pages to avoid duplicate requests
// Use a simple object instead of Map to reduce memory overhead
const pageCache: Record<string, string> = {};

// Limit cache size to avoid memory issues
const MAX_CACHE_ENTRIES = 20;
let cacheEntryCount = 0;

const fetchWithRetry = async (url: string, options: Record<string, unknown> = {}): Promise<Response> => {
  // Check if we've hit the subrequest limit
  if (subrequestCount >= MAX_SUBREQUESTS) {
    throw new Error('Subrequest limit reached');
  }
  
  // Check cache first
  if (url in pageCache) {
    logDebug(`Using cached response for ${url}`);
    const cachedResponse = new Response(pageCache[url], {
      headers: { 'Content-Type': 'text/html' },
      status: 200
    });
    return cachedResponse;
  }
  
  let lastError;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      logDebug(`Fetching ${url} (subrequest ${subrequestCount + 1}/${MAX_SUBREQUESTS})`);
      subrequestCount++;
      
      const fetchOptions: CloudflareFetchOptions = {
        ...options,
        headers: { ...(options.headers || {}), 'User-Agent': USER_AGENT },
        cf: { cacheTtl: 7200, cacheEverything: true } // Cache for 2 hours
      };
      
      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      // Cache the response, but manage cache size
      const text = await response.text();
      if (cacheEntryCount >= MAX_CACHE_ENTRIES) {
        // Simple cache eviction - just clear everything if we reach the limit
        // In a production environment, use a proper LRU cache
        Object.keys(pageCache).forEach(key => delete pageCache[key]);
        cacheEntryCount = 0;
      }
      
      pageCache[url] = text;
      cacheEntryCount++;
      
      return new Response(text, {
        headers: response.headers,
        status: response.status
      });
    } catch (error: unknown) {
      if (i < MAX_RETRIES - 1) {
        console.error(`Attempt ${i + 1} failed, retrying...`);
      } else {
        console.error(`All ${MAX_RETRIES} attempts failed:`, error);
      }
      lastError = error;
      
      // If we hit the subrequest limit, don't retry
      if (error instanceof Error && 
         (error.message === 'Subrequest limit reached' || 
          error.message === 'Too many subrequests')) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }
  throw lastError;
};

const hasNoEvents = ($: cheerio.CheerioAPI): boolean => {
  const emptyMessage = $('#block-system-main .view-empty p').text().trim();
  return emptyMessage === 'На обрану дату немає заходів.';
};

const scrapeDay = async (url: string, day: string): Promise<Show[]> => {
  logDebug(`Scraping day from ${url}`);
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    return parseShowsFromHtml(cheerio.load(html), day);
  } catch (error) {
    console.error(`Error scraping day ${url}:`, error);
    return [];
  }
};

const getDayFromUrl = (url: string): string => {
  const match = url.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
};

const findDatesWithEvents = async (startDate: string): Promise<string[]> => {
  logDebug(`Finding dates with events starting from ${startDate}`);
  const datesWithEvents: string[] = [];
  const currentDateUrl = `${BASE_URL}/afisha/${startDate}`;

  try {
    // First request to get initial dates
    logDebug(`Checking calendar at ${currentDateUrl}`);
    const response = await fetchWithRetry(currentDateUrl);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Find all dates with events in the current month
    // Limit to first 10 events to save memory
    let count = 0;
    const MAX_EVENTS = 10;
    
    $('#afisha-date-list > li.future').each((_, element) => {
      if (count >= MAX_EVENTS) return false; // Break the loop if we hit the limit
      
      const $el = $(element);
      const hasEvent = $el.find('a').length > 0;
      
      if (hasEvent) {
        const dateLink = $el.find('a').attr('href');
        if (dateLink) {
          const fullUrl = dateLink.startsWith('http') ? dateLink : `${BASE_URL}${dateLink}`;
          const day = getDayFromUrl(fullUrl);
          datesWithEvents.push(day);
          count++;
        }
      }
    });
    
    // We don't need to navigate to next month to stay within limits
    logDebug(`Found ${datesWithEvents.length} dates with events in current month`);
    
  } catch (error) {
    console.error('Error finding dates with events:', error);
  }
  
  // Sort dates chronologically
  datesWithEvents.sort();
  logDebug(`Found ${datesWithEvents.length} dates with events in total`);
  return datesWithEvents;
};

interface Job {
  url: string;
  day: string;
}

class JobQueue {
  private queue: Job[] = [];
  private running = 0;
  private results: Show[] = [];

  constructor(private maxConcurrent: number) {}

  add(job: Job) {
    this.queue.push(job);
    this.processNext();
  }

  private async processNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
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
      
      const dayShows = await scrapeDay(job.url, job.day);
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
        // Add a content hash for change detection
        const contentHash = calculateShowContentHash(show);
        show.contentHash = contentHash;
        posterMap.set(show.id, show);
      }
      
      const mergedShows = Array.from(posterMap.values());
      
      if (STORAGE_MODE) {
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
        
        for (const show of mergedShows) {
          const existingShow = existingShowMap.get(show.id);
          
          try {
            if (!existingShow) {
              // This is a new show
              const { error: insertError } = await supabase.from('shows').insert(show);
              if (insertError) throw insertError;
              newCount++;
            } else if (existingShow.contentHash !== show.contentHash) {
              // Show exists but content has changed
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
            } else {
              // Show exists and hasn't changed - no update needed
              unchangedCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Error saving show ${show.id}:`, error);
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
      if (subrequestCount >= MAX_SUBREQUESTS) {
        console.log('Skipping file lookup due to subrequest limit');
        return null;
      }
      
      subrequestCount++;
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
      if (subrequestCount >= MAX_SUBREQUESTS) {
        console.log('Skipping file deletion due to subrequest limit');
        return;
      }
      
      subrequestCount++;
      await fetch(`data/posters/${fileName}`, { method: 'DELETE' });
    } catch (error) {
      console.error(`Error deleting file ${fileName}:`, error);
    }
  }

  async waitForCompletion(): Promise<Show[]> {
    const MAX_WAIT_TIME = 7000; // 7 seconds max wait time
    const startTime = Date.now();
    
    while (this.running > 0 || this.queue.length > 0) {
      // Check if we've been running too long
      if (Date.now() - startTime > MAX_WAIT_TIME) {
        console.error('JobQueue wait time exceeded, returning partial results');
        break;
      }
      
      // Check for subrequest limit
      if (subrequestCount >= MAX_SUBREQUESTS) {
        console.error('Stopping job queue due to subrequest limit');
        break;
      }
      
      // Wait a shorter time to be more responsive to limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return this.results;
  }
}

export const scrapeShows = async (): Promise<Show[]> => {
  // Reset subrequest count on each invocation
  subrequestCount = 0;
  
  const today = new Date().toISOString().slice(0, 10);
  logDebug('Starting scrape from date:', today);
  
  try {
    // Phase 1: Find dates with events in current month only
    const allDatesToScrape = await findDatesWithEvents(today);
    if (allDatesToScrape.length === 0) {
      logDebug('No dates with events found');
      return [];
    }

    // Phase 2: Process only a chunk of dates to respect subrequest limits
    // Further limit the chunk size for Cloudflare Workers
    const datesToScrape = allDatesToScrape.slice(0, CHUNK_SIZE);
    logDebug(`Processing ${datesToScrape.length} dates out of ${allDatesToScrape.length} total`);

    // Phase 3: Process shows using job queue with timeouts
    const jobQueue = new JobQueue(MAX_CONCURRENT_JOBS);
    
    for (const day of datesToScrape) {
      // Check if we've hit the subrequest limit
      if (subrequestCount >= MAX_SUBREQUESTS) {
        console.error('Stopping adding jobs due to subrequest limit');
        break;
      }
      
      const currentUrl = `${BASE_URL}/afisha/${day}`;
      jobQueue.add({ url: currentUrl, day });
    }

    // Set a timeout to avoid hanging the worker
    const timeoutPromise = new Promise<Show[]>((resolve) => {
      // Give the scraper a reasonable time to complete within the worker's CPU time
      setTimeout(() => {
        console.error('Scraper timeout reached, returning partial results');
        resolve([]);
      }, 8000); // 8 seconds timeout (close to the 10ms CPU limit)
    });

    // Race the job completion against the timeout
    const allShows = await Promise.race([
      jobQueue.waitForCompletion(),
      timeoutPromise
    ]);
    
    logDebug(`Found ${allShows.length} shows in ${datesToScrape.length} days. Total subrequests: ${subrequestCount}`);
    return allShows;
  } catch (error) {
    console.error('Error during scraping:', error);
    return [];
  }
};

// Direct execution support
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await scrapeShows();
    console.log('Scraping completed successfully');
  } catch (error) {
    console.error('Error during scraping:', error);
    process.exit(1);
  }
} 