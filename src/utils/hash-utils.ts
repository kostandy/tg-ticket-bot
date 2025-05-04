import { createHash } from 'node:crypto';
import type { Show } from '../types.js';

// Create a hash ID from URL and datetime
export const createShowId = (url: string, datetime: Date | string): string => {
  // Use full ISO string for Date objects, otherwise use the provided string
  const dateStr = datetime instanceof Date ? datetime.toISOString() : datetime;
  return createHash('sha256').update(`${url}_${dateStr}`).digest('hex').slice(0, 16);
};

// Calculate a content hash for a show to detect changes
export const calculateShowContentHash = (show: Show): string => {
  // Create a hash based on the content that matters for change detection
  // Exclude the ID itself since it's derived from URL and date
  const contentToHash = {
    title: show.title,
    datetime: show.datetime, // Use full ISO string with time information
    soldOut: show.soldOut,
    ticketUrl: show.ticketUrl
  };
  return createHash('sha256').update(JSON.stringify(contentToHash)).digest('hex').slice(0, 10);
};

// Helper function to strip query parameters from URLs
export const stripQueryParams = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch {
    // If URL parsing fails, return the original URL
    return url;
  }
};

// Generic hash calculator for any data
export const calculateHash = (data: unknown): string => {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}; 