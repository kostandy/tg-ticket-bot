import * as cheerio from 'cheerio';
import { fetchWithRetry, getSubrequestCount, resetSubrequestCount, setSubrequestCount } from '../http/fetch-client.js';
import { findDatesWithEvents } from './date-finder.js';
import { parseShowsFromHtml, hasNoEvents, hasNoEventsQuickCheck, extractShowIdsFromHtml } from './html-parser.js';
import { getCurrentDateString } from '../utils/date-utils.js';
import { SCRAPER_CONFIG, logDebug } from '../config.js';
import type { Show, Env } from '../types.js';
import { KVStorage, type ScrapingState } from '../storage/kv-storage.js';

// Scrape a single day's shows with optimized processing
export const scrapeDay = async (url: string, day: string, kvStorage?: KVStorage | null): Promise<Show[]> => {
  logDebug(`Scraping day from ${url}`);
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    
    // Use lightweight check before any further processing
    if (hasNoEventsQuickCheck(html)) {
      logDebug(`No events found for ${day} (quick check)`);
      return [];
    }
    
    // With KV storage and minimal HTML parsing enabled, just extract IDs first to check against KV
    if (kvStorage && SCRAPER_CONFIG.MINIMAL_HTML_PARSING) {
      const showIds = extractShowIdsFromHtml(html);
      logDebug(`Quick-parsed ${showIds.length} show IDs for ${day}`);
      
      // Check if we need to do full parsing based on the IDs we found
      const newShowIds = [];
      for (const id of showIds) {
        const exists = await kvStorage.showExists(id);
        if (!exists) {
          newShowIds.push(id);
        } else {
          logDebug(`Skipping already processed show ID: ${id}`);
        }
      }
      
      // If all shows are already in KV, return empty array to skip further processing
      if (newShowIds.length === 0) {
        logDebug(`All ${showIds.length} shows for ${day} already exist in KV, skipping full parse`);
        return [];
      }
      
      logDebug(`Found ${newShowIds.length} new shows to parse for ${day}`);
    }
    
    // Only do full parsing with cheerio if necessary
    const $ = cheerio.load(html);
    
    if (hasNoEvents($)) {
      logDebug(`No events found for ${day}`);
      return [];
    }
    
    // Parse with minimal DOM manipulation to save CPU time
    const parsedShows = parseShowsFromHtml($, day);
    
    // If KV storage is available, filter out already scraped shows
    if (kvStorage) {
      const showsToProcess = [];
      
      for (const show of parsedShows) {
        const exists = await kvStorage.showExists(show.id);
        if (!exists) {
          // Add to process list
          showsToProcess.push(show);
        } else {
          logDebug(`Skipping already processed show: ${show.id}`);
        }
      }
      
      // Save all new shows at once to reduce KV operations
      if (showsToProcess.length > 0) {
        await kvStorage.saveShows(showsToProcess);
      }
      
      logDebug(`Found ${parsedShows.length} shows, processed ${showsToProcess.length} new ones`);
      return showsToProcess;
    }
    
    return parsedShows;
  } catch (error) {
    console.error(`Error scraping day ${url}:`, error);
    return [];
  }
};

// Main scraper function
export const scrapeShows = async (env?: Env): Promise<Show[]> => {
  // Start measuring execution time
  const startTime = Date.now();
  
  // Get KV storage if available
  let kvStorage: KVStorage | null = null;
  if (env?.SCRAPER_KV) {
    kvStorage = new KVStorage(env.SCRAPER_KV);
    logDebug('KV storage initialized');
  } else {
    logDebug('KV storage not available, running without state persistence');
  }
  
  // Try to load previous state first - this is critical for incremental processing
  let previousState: ScrapingState | null = null;
  if (kvStorage) {
    previousState = await kvStorage.loadScraperState();
  }
  
  // If resuming from previous state, restore the context
  if (previousState) {
    logDebug('Resuming from previous scraping state');
    setSubrequestCount(previousState.subrequestCount);
    
    // Early return if we have shows and we're at the limit - this makes the function exit quickly
    if (previousState.completedShows.length > 0 && 
        Date.now() - startTime > SCRAPER_CONFIG.MAX_WAIT_TIME / 2) {
      console.log(`Returning ${previousState.completedShows.length} shows from previous state (CPU time limit approaching)`);
      return previousState.completedShows;
    }
  } else {
    // Reset subrequest count for a fresh start
    resetSubrequestCount();
  }
  
  const today = getCurrentDateString();
  logDebug('Starting/resuming scrape from date:', today);
  
  try {
    // Skip Supabase initialization in this cycle to save CPU time
    
    // Use dates from previous state or find new ones
    let allDatesToScrape: string[];
    if (previousState?.allDatesToScrape && previousState.allDatesToScrape.length > 0) {
      allDatesToScrape = previousState.allDatesToScrape;
      logDebug(`Using ${allDatesToScrape.length} dates from previous state`);
    } else {
      // Phase 1: Find dates with events
      allDatesToScrape = await findDatesWithEvents(today);
      logDebug(`Found ${allDatesToScrape.length} dates with events`);
      
      // Save state immediately after finding dates to preserve this work
      if (kvStorage && allDatesToScrape.length > 0) {
        const initialState: ScrapingState = {
          lastUpdated: Date.now(),
          allDatesToScrape,
          processedDates: [],
          pendingJobs: allDatesToScrape.map(day => ({ 
            url: `${SCRAPER_CONFIG.BASE_URL}/afisha/${day}`, 
            day 
          })),
          completedShows: [],
          subrequestCount: getSubrequestCount()
        };
        await kvStorage.saveScraperState(initialState);
        logDebug('Saved initial state with dates and pending jobs');
        
        // Return early after finding dates to avoid CPU timeout
        return [];
      }
    }
    
    if (allDatesToScrape.length === 0) {
      logDebug('No dates with events found');
      return previousState?.completedShows || [];
    }

    // Check if we're approaching CPU time limit
    if (Date.now() - startTime > SCRAPER_CONFIG.MAX_WAIT_TIME / 2) {
      logDebug('CPU time limit approaching, saving progress and exiting');
      return previousState?.completedShows || [];
    }

    // Filter out already processed dates if resuming
    let datesToProcess = allDatesToScrape;
    if (previousState?.processedDates) {
      datesToProcess = allDatesToScrape.filter(date => !previousState.processedDates.includes(date));
      logDebug(`Filtered to ${datesToProcess.length} unprocessed dates (${previousState.processedDates.length} already processed)`);
    }
    
    // Process only 1 date per execution to stay within CPU limits
    const datesToScrape = datesToProcess.slice(0, SCRAPER_CONFIG.CHUNK_SIZE);
    logDebug(`Processing ${datesToScrape.length} dates out of ${datesToProcess.length} remaining (${allDatesToScrape.length} total)`);

    if (datesToScrape.length === 0) {
      logDebug('No dates left to scrape');
      return previousState?.completedShows || [];
    }
    
    // Check if we're approaching CPU time limit again
    if (Date.now() - startTime > SCRAPER_CONFIG.MAX_WAIT_TIME * 0.75) {
      logDebug('CPU time limit approaching, saving progress and exiting');
      return previousState?.completedShows || [];
    }

    // Process a single date directly without using the job queue to reduce overhead
    const day = datesToScrape[0];
    const url = `${SCRAPER_CONFIG.BASE_URL}/afisha/${day}`;
    
    logDebug(`Directly processing date: ${day}`);
    const shows = await scrapeDay(url, day, kvStorage);
    logDebug(`Found ${shows.length} shows for ${day}`);
    
    // Mark the date as processed
    const processedDates = [...(previousState?.processedDates || []), day];
    
    // Update the pending jobs list for the next execution
    const pendingJobs = previousState?.pendingJobs || allDatesToScrape.map(d => ({ 
      url: `${SCRAPER_CONFIG.BASE_URL}/afisha/${d}`, 
      day: d 
    }));
    
    // Remove the job we just processed
    const updatedPendingJobs = pendingJobs.filter(job => job.day !== day);
    
    // Combine shows with previous results
    const allCompletedShows = [...(previousState?.completedShows || []), ...shows];
    
    // Check if we're done scraping all dates
    const isComplete = datesToProcess.length <= 1;
    
    // Always save state to continue progress incrementally
    if (kvStorage) {
      // Save state for incremental processing
      const state: ScrapingState = {
        lastUpdated: Date.now(),
        allDatesToScrape,
        processedDates,
        pendingJobs: updatedPendingJobs,
        completedShows: allCompletedShows,
        subrequestCount: getSubrequestCount()
      };
      
      await kvStorage.saveScraperState(state);
      logDebug('Saved state for future resumption');
      
      // Clean up if we're done
      if (isComplete && allCompletedShows.length > 0) {
        // Count shows in KV and compare with total scraped shows
        const kvShowCount = await kvStorage.getShowCount();
        const totalShowCount = allCompletedShows.length;
        
        logDebug(`Completion check: KV shows: ${kvShowCount}, Total scraped: ${totalShowCount}`);
        
        // If we have all shows, clean KV storage
        if (kvShowCount >= totalShowCount && totalShowCount > 0) {
          logDebug('All shows have been scraped successfully, clearing KV storage');
          await kvStorage.clearAllShows();
        }
        
        // Only clear the state if we actually have scraped data
        logDebug('Scraping completed successfully, clearing saved state');
        await kvStorage.clearScraperState();
      }
    }
    
    logDebug(`Execution took ${Date.now() - startTime}ms`);
    return allCompletedShows;
  } catch (error) {
    console.error('Error during scraping:', error);
    if (previousState?.completedShows) {
      return previousState.completedShows;
    }
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