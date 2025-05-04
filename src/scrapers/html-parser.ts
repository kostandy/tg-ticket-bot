import type * as cheerio from 'cheerio';
import type { Show } from '../types.js';
import { extractDateTime } from '../utils/date-utils.js';
import { stripQueryParams, createShowId, calculateShowContentHash } from '../utils/hash-utils.js';

// Check if a page has no events
export const hasNoEvents = ($: cheerio.CheerioAPI): boolean => {
  const emptyMessage = $('#block-system-main .view-empty p').text().trim();
  return emptyMessage === 'На обрану дату немає заходів.';
};

// Memory-efficient HTML parsing - use null selectors for unwanted elements
export const parseShowsFromHtml = ($: cheerio.CheerioAPI, date: string): Show[] => {
  const shows: Show[] = [];
  
  $('.views-row').each((_, element) => {
    const $el = $(element);
    const title = $el.find('.views-field-field-event-title .field-content a').text().trim();
    const url = $el.find('.views-field-field-event-title .field-content a').attr('href') || '';
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
      
      // Calculate and add content hash right away
      show.contentHash = calculateShowContentHash(show);
      shows.push(show);
    }
  });
  
  return shows;
}; 