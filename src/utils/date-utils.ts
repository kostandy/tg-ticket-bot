import type * as cheerio from 'cheerio';
import { UKRAINIAN_MONTHS } from '../config.js';

// Extract date from URL
export const getDayFromUrl = (url: string): string => {
  const match = url.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
};

// Extract date and time from the HTML structure and convert to Date object
// @ts-expect-error - Cheerio type definition issues
export const extractDateTime = ($el: cheerio.Cheerio, dateString: string): Date => {
  const timeElement = $el.find('.views-field-field-time .field-content');
  
  // Extract components from spans with classes t1, t2, and t3
  const day = timeElement.find('.t1').text().trim();
  const monthWeekday = timeElement.find('.t2').text().trim();
  const time = timeElement.find('.t3').text().trim();
  
  // Split the month and weekday if available (format: "червня, середа")
  const [monthName = ''] = monthWeekday.split(',').map((part: string) => part.trim());
  
  // Parse time (expected format: "18:00")
  const [hours = '0', minutes = '0'] = time.split(':').map((num: string) => parseInt(num, 10));
  
  // Get the current year from the dateString (which is in YYYY-MM-DD format)
  const year = parseInt(dateString.substring(0, 4), 10);
  
  // Get the month index (0-11) from the Ukrainian month name
  const monthIndex = UKRAINIAN_MONTHS[monthName.toLowerCase()] || 0;
  
  // Create a date object in local time
  const localDate = new Date(year, monthIndex, parseInt(day, 10), hours, minutes);
  
  // Convert to UTC
  return localDate;
};

// Get the current date in YYYY-MM-DD format
export const getCurrentDateString = (): string => {
  return new Date().toISOString().slice(0, 10);
}; 