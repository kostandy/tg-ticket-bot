import * as cheerio from 'cheerio';
import { SCRAPER_CONFIG, logDebug } from '../config.js';
import { fetchWithRetry } from '../http/fetch-client.js';
import { getDayFromUrl } from '../utils/date-utils.js';

// Find all dates with events starting from a given date
export const findDatesWithEvents = async (startDate: string): Promise<string[]> => {
  logDebug(`Finding dates with events starting from ${startDate}`);
  const datesWithEvents: string[] = [];
  const currentDateUrl = `${SCRAPER_CONFIG.BASE_URL}/afisha/${startDate}`;

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
          const fullUrl = dateLink.startsWith('http') ? dateLink : `${SCRAPER_CONFIG.BASE_URL}${dateLink}`;
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