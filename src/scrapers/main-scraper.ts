import * as cheerio from 'cheerio';
import { fetchWithRetry, getSubrequestCount, resetSubrequestCount, setSubrequestCount } from '../http/fetch-client.js';
import { JobQueue } from '../queues/job-queue.js';
import { findDatesWithEvents } from './date-finder.js';
import { parseShowsFromHtml, hasNoEvents } from './html-parser.js';
import { getCurrentDateString } from '../utils/date-utils.js';
import { SCRAPER_CONFIG, logDebug } from '../config.js';
import type { Show, Env } from '../types.js';
import { initSupabase } from '../db.js';
import { KVStorage, type ScrapingState } from '../storage/kv-storage.js';

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
export const scrapeShows = async (env?: Env): Promise<Show[]> => {
  // Get KV storage if available
  let kvStorage: KVStorage | null = null;
  if (env?.SCRAPER_KV) {
    kvStorage = new KVStorage(env.SCRAPER_KV);
    logDebug('KV storage initialized');
  } else {
    logDebug('KV storage not available, running without state persistence');
  }
  
  // Try to load previous state first
  let previousState: ScrapingState | null = null;
  if (kvStorage) {
    previousState = await kvStorage.loadScraperState();
  }
  
  // If resuming from previous state, restore the context
  if (previousState) {
    logDebug('Resuming from previous scraping state');
    setSubrequestCount(previousState.subrequestCount);
    logDebug(`Restored subrequest count: ${getSubrequestCount()}`);
    
    // If we already have some data, we can return it immediately if we're at subrequest limit
    if (previousState.completedShows.length > 0 && getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
      console.log(`Returning ${previousState.completedShows.length} shows from previous state without additional scraping (subrequest limit reached)`);
      return previousState.completedShows;
    }
  } else {
    // Reset subrequest count for a fresh start
    resetSubrequestCount();
  }
  
  // Log the current subrequest count for debugging
  logDebug('Starting/resuming scrape with subrequest count:', getSubrequestCount());
  
  const today = getCurrentDateString();
  logDebug('Starting/resuming scrape from date:', today);
  
  try {
    // Initialize Supabase if needed
    if (!SCRAPER_CONFIG.STORAGE_MODE) {
      const supabaseUrl = env?.SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = env?.SUPABASE_KEY || process.env.SUPABASE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase credentials');
      }
      
      initSupabase({ SUPABASE_URL: supabaseUrl, SUPABASE_KEY: supabaseKey });
    }
    
    // Use dates from previous state or find new ones
    let allDatesToScrape: string[];
    if (previousState?.allDatesToScrape && previousState.allDatesToScrape.length > 0) {
      allDatesToScrape = previousState.allDatesToScrape;
      logDebug(`Using ${allDatesToScrape.length} dates from previous state`);
    } else {
      // Phase 1: Find dates with events in current month only
      allDatesToScrape = await findDatesWithEvents(today);
      logDebug(`Found ${allDatesToScrape.length} dates with events`);
    }
    
    if (allDatesToScrape.length === 0) {
      logDebug('No dates with events found');
      return previousState?.completedShows || [];
    }

    // Filter out already processed dates if resuming
    let datesToProcess = allDatesToScrape;
    if (previousState?.processedDates) {
      datesToProcess = allDatesToScrape.filter(date => !previousState.processedDates.includes(date));
      logDebug(`Filtered to ${datesToProcess.length} unprocessed dates (${previousState.processedDates.length} already processed)`);
    }
    
    // Phase 2: Process only a chunk of dates to respect subrequest limits
    // Further limit the chunk size for Cloudflare Workers
    const datesToScrape = datesToProcess.slice(0, SCRAPER_CONFIG.CHUNK_SIZE);
    logDebug(`Processing ${datesToScrape.length} dates out of ${datesToProcess.length} remaining (${allDatesToScrape.length} total)`);

    // Phase 3: Process shows using job queue with timeouts
    const jobQueue = new JobQueue(SCRAPER_CONFIG.MAX_CONCURRENT_JOBS);
    
    // Add pending jobs from previous state first
    if (previousState?.pendingJobs && previousState.pendingJobs.length > 0) {
      logDebug(`Adding ${previousState.pendingJobs.length} pending jobs from previous state`);
      previousState.pendingJobs.forEach(job => {
        if (getSubrequestCount() < SCRAPER_CONFIG.MAX_SUBREQUESTS) {
          jobQueue.add(job);
        }
      });
    } else {
      // Add priority to closer dates (process today and tomorrow first)
      const priorityDays = datesToScrape.slice(0, 2); // Today and tomorrow
      const regularDays = datesToScrape.slice(2);
      
      for (const day of priorityDays) {
        if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
          console.log('Stopping adding priority jobs due to subrequest limit');
          break;
        }
        
        const currentUrl = `${SCRAPER_CONFIG.BASE_URL}/afisha/${day}`;
        jobQueue.add({ url: currentUrl, day });
      }
      
      // Then add regular days
      for (const day of regularDays) {
        if (getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
          console.log('Subrequest limit reached while adding regular jobs. Halting further additions.');
          break;
        }
        
        const currentUrl = `${SCRAPER_CONFIG.BASE_URL}/afisha/${day}`;
        jobQueue.add({ url: currentUrl, day });
      }
    }

    // Set a timeout to avoid hanging the worker
    let timeoutReached = false;
    
    // Track processed dates
    const processedDates = previousState?.processedDates || [];

    const timeoutPromise = new Promise<Show[]>((resolve) => {
      // Give the scraper a reasonable time to complete within the worker's CPU time
      setTimeout(() => {
        timeoutReached = true;
        console.log('Scraper timeout reached, saving state and returning partial results');
        
        // Save state to KV if timeout reached
        if (kvStorage) {
          // Get the remaining jobs from the queue
          const pendingJobs = jobQueue.getPendingJobs();
          const partialResults = jobQueue.getResults();
          
          // Combine completed shows from previous state with new ones
          const allCompletedShows = [...(previousState?.completedShows || []), ...partialResults];
          
          // Create state to save
          const state: ScrapingState = {
            lastUpdated: Date.now(),
            allDatesToScrape,
            processedDates,
            pendingJobs,
            completedShows: allCompletedShows,
            subrequestCount: getSubrequestCount()
          };
          
          // Save state asynchronously (don't await to avoid blocking)
          kvStorage.saveScraperState(state)
            .then(() => logDebug('Successfully saved interrupted state to KV'))
            .catch(err => console.error('Failed to save state on timeout:', err));
        }
        
        resolve([]);
      }, SCRAPER_CONFIG.MAX_WAIT_TIME);
    });

    // Wait for job completion or timeout
    const newCompletedShows = await Promise.race([
      jobQueue.waitForCompletion(),
      timeoutPromise
    ]);
    
    // Track which days were successfully processed
    jobQueue.getCompletedJobs().forEach(job => {
      if (!processedDates.includes(job.day)) {
        processedDates.push(job.day);
      }
    });

    // If timeout was reached, merge partial results with completed jobs
    const allNewShows = timeoutReached
      ? [...newCompletedShows, ...jobQueue.getResults()]
      : newCompletedShows;
      
    // Combine with previous results if available
    const allShows = [...(previousState?.completedShows || []), ...allNewShows];
    
    // Check if we reached the end of the current scraping cycle successfully
    const isComplete = !timeoutReached && 
                      getSubrequestCount() < SCRAPER_CONFIG.MAX_SUBREQUESTS &&
                      jobQueue.getPendingJobs().length === 0;
                      
    // Save or clear state based on completion status
    if (kvStorage) {
      if (isComplete) {
        // If scraping completed successfully, clear the state
        logDebug('Scraping completed successfully, clearing saved state');
        await kvStorage.clearScraperState();
      } else if (timeoutReached || getSubrequestCount() >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
        // Save current state if we hit timeout or subrequest limit
        logDebug('Saving state for future resumption');
        const state: ScrapingState = {
          lastUpdated: Date.now(),
          allDatesToScrape,
          processedDates,
          pendingJobs: jobQueue.getPendingJobs(),
          completedShows: allShows,
          subrequestCount: getSubrequestCount()
        };
        await kvStorage.saveScraperState(state);
      }
    }
    
    logDebug(`Found ${allShows.length} shows in total. Subrequests: ${getSubrequestCount()}`);
    return allShows;
  } catch (error) {
    console.error('Error during scraping:', error);
    // Return partial results from previous state if available
    return previousState?.completedShows || [];
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