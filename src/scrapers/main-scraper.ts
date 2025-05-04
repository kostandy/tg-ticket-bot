import * as cheerio from 'cheerio';
import { fetchWithRetry, getSubrequestCount, resetSubrequestCount } from '../http/fetch-client.js';
import { JobQueue } from '../queues/job-queue.js';
import { findDatesWithEvents } from './date-finder.js';
import { parseShowsFromHtml, hasNoEvents } from './html-parser.js';
import { getCurrentDateString } from '../utils/date-utils.js';
import { SCRAPER_CONFIG, logDebug } from '../config.js';
import type { Show } from '../types.js';
import { initSupabase } from '../db.js';

// Scrape a single day's shows
export const scrapeDay = async (url: string, day: string): Promise<Show[]> => {
  logDebug(`Scraping day from ${url}`);
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    if (hasNoEvents($)) {
      console.log(`No events found for ${day}`);
      return [];
    }
    
    return parseShowsFromHtml($, day);
  } catch (error) {
    console.error(`Error scraping day ${url}:`, error);
    return [];
  }
};

// Main scraper function
export const scrapeShows = async (): Promise<Show[]> => {
  // Reset subrequest count at the beginning of each scrape
  resetSubrequestCount();
  
  // Log the current subrequest count for debugging
  logDebug('Starting scrape with subrequest count:', getSubrequestCount());
  
  const today = getCurrentDateString();
  logDebug('Starting scrape from date:', today);
  
  try {
    // Initialize Supabase if needed
    if (!SCRAPER_CONFIG.STORAGE_MODE) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase credentials');
      }
      
      initSupabase({ SUPABASE_URL: supabaseUrl, SUPABASE_KEY: supabaseKey });
    }
    
    // Phase 1: Find dates with events in current month only
    const allDatesToScrape = await findDatesWithEvents(today);
    if (allDatesToScrape.length === 0) {
      logDebug('No dates with events found');
      return [];
    }

    // Phase 2: Process only a chunk of dates to respect subrequest limits
    // Further limit the chunk size for Cloudflare Workers
    const datesToScrape = allDatesToScrape.slice(0, SCRAPER_CONFIG.CHUNK_SIZE);
    logDebug(`Processing ${datesToScrape.length} dates out of ${allDatesToScrape.length} total`);

    // Phase 3: Process shows using job queue with timeouts
    const jobQueue = new JobQueue(SCRAPER_CONFIG.MAX_CONCURRENT_JOBS);
    
    // Add priority to closer dates (process today and tomorrow first)
    const priorityDays = datesToScrape.slice(0, 2); // Today and tomorrow
    const regularDays = datesToScrape.slice(2);
    
    for (const day of priorityDays) {
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.error('Stopping adding priority jobs due to subrequest limit');
        break;
      }
      
      const currentUrl = `${SCRAPER_CONFIG.BASE_URL}/afisha/${day}`;
      jobQueue.add({ url: currentUrl, day });
    }
    
    // Then add regular days
    for (const day of regularDays) {
      if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        console.error('Subrequest limit reached while adding regular jobs. Halting further additions.');
        break;
      }
      
      const currentUrl = `${SCRAPER_CONFIG.BASE_URL}/afisha/${day}`;
      jobQueue.add({ url: currentUrl, day });
    }

    // Set a timeout to avoid hanging the worker
    let timeoutReached = false;

    const timeoutPromise = new Promise<Show[]>((resolve) => {
      // Give the scraper a reasonable time to complete within the worker's CPU time
      setTimeout(() => {
        timeoutReached = true;
        console.error('Scraper timeout reached, returning partial results');
        resolve([]);
      }, SCRAPER_CONFIG.MAX_WAIT_TIME);
    });

    // Wait for job completion or timeout
    const completedShows = await Promise.race([
      jobQueue.waitForCompletion(),
      timeoutPromise
    ]);

    // If timeout was reached, merge partial results with completed jobs
    const allShows = timeoutReached
      ? [...completedShows, ...jobQueue.getResults()]
      : completedShows;
    
    logDebug(`Found ${allShows.length} shows in ${datesToScrape.length} days. Total subrequests: ${getSubrequestCount()}`);
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