import type * as cheerio from 'cheerio';
import type { Show } from '../types.js';
import { extractDateTime } from '../utils/date-utils.js';
import { stripQueryParams, createShowId, calculateShowContentHash } from '../utils/hash-utils.js';
import { SCRAPER_CONFIG } from '../config.js';

// Check if a page has no events
export const hasNoEvents = ($: cheerio.CheerioAPI): boolean => {
  const emptyMessage = $('#block-system-main .view-empty p').text().trim();
  return emptyMessage === 'На обрану дату немає заходів.';
};

// Even faster check before loading cheerio
export const hasNoEventsQuickCheck = (html: string): boolean => {
  return html.includes('На обрану дату немає заходів') || !html.includes('event-card');
};

// Ultra-lightweight show ID extractor to check against KV before full parsing
export const extractShowIdsFromHtml = (html: string): string[] => {
  const ids: string[] = [];
  const regex = /href="\/afisha\/shows\/([^"]+)"/g;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    if (match[1]) {
      ids.push(match[1]);
    }
  }
  
  return [...new Set(ids)]; // Remove duplicates
};

// Memory-efficient HTML parsing - use null selectors for unwanted elements
export const parseShowsFromHtml = ($: cheerio.CheerioAPI, date: string): Show[] => {
  const shows: Show[] = [];
  
  // Limit the number of shows processed in one execution to stay within CPU limits
  let count = 0;
  const maxShowsPerBatch = SCRAPER_CONFIG.MINIMAL_HTML_PARSING ? 5 : 10;
  
  $('.views-row').each((_, element) => {
    // Exit early if we've processed enough shows for this batch
    if (count >= maxShowsPerBatch) return false;
    
    const $el = $(element);
    const title = $el.find('.views-field-field-event-title .field-content a').text().trim();
    const url = $el.find('.views-field-field-event-title .field-content a').attr('href') || '';
    
    // Use a fast path if we're just getting basic data
    if (SCRAPER_CONFIG.MINIMAL_HTML_PARSING) {
      if (title && url) {
        const dateTime = new Date(); // Use current date as fallback
        const id = createShowId(url, dateTime);
        shows.push({
          id,
          title,
          url,
          datetime: dateTime,
          imageUrl: '',
          ticketUrl: '',
          soldOut: false
        });
        count++;
      }
      return; // Continue to next element
    }
    
    // Full parsing path for more detailed show data
    const rawImageUrl = $el.find('.views-field-field-images img').attr('src') || '';
    const imageUrl = stripQueryParams(rawImageUrl);
    const ticketUrl = $el.find('.views-field-nothing a').attr('href') || '';
    const soldOut = $el.find('.views-field-field-label .field-content').text().trim().toLowerCase() === 'квитки продано';
    
    // Extract date and time information and convert to Date object
    const dateTime = extractDateTime($el, date);
    
    if (title && url) {
      // Use the full datetime for ID creation
      const id = createShowId(url, dateTime);
      const show: Show = {
        id,
        title,
        url,
        datetime: dateTime,
        imageUrl,
        ticketUrl,
        soldOut
      };
      
      // Calculate content hash only when needed
      if (!SCRAPER_CONFIG.MINIMAL_HTML_PARSING) {
        show.contentHash = calculateShowContentHash(show);
      }
      
      shows.push(show);
      count++;
    }
  });
  
  return shows;
}; 