// Constants and configuration settings for the application

// Scraper settings
export const SCRAPER_CONFIG = {
  // Enable detailed logging only in development
  IS_DEV: false, // Set to false in production
  STORAGE_MODE: process.env.STORAGE_MODE === 'file',
  MAX_RETRIES: 1, // Reduced to minimum to save execution time
  RATE_LIMIT_DELAY: 100, // Reduced delay to save CPU time
  MAX_CONCURRENT_JOBS: 1, // Limited to 1 concurrent job to stay within Cloudflare's CPU limits
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  BASE_URL: 'https://molodyytheatre.com',
  // Cloudflare Worker limits
  MAX_SUBREQUESTS: 50, // Reduced to 10 (from 20) to process fewer requests per execution
  CHUNK_SIZE: 1, // Process just 1 date per execution cycle
  MAX_CACHE_ENTRIES: 5, // Reduced to 5 to lower memory usage
  MAX_WAIT_TIME: 10, // Further reduced to 5ms to stay under 10ms CPU time limit
  MINIMAL_HTML_PARSING: true // New flag to enable minimal HTML parsing
};

// Ukrainian month mapping
export const UKRAINIAN_MONTHS: Record<string, number> = {
  'січня': 0,     // January
  'лютого': 1,    // February
  'березня': 2,   // March
  'квітня': 3,    // April
  'травня': 4,    // May
  'червня': 5,    // June
  'липня': 6,     // July
  'серпня': 7,    // August
  'вересня': 8,   // September
  'жовтня': 9,    // October
  'листопада': 10, // November
  'грудня': 11     // December
};

// Logging
export const logDebug = (message: string, ...args: unknown[]) => {
  if (SCRAPER_CONFIG.IS_DEV) {
    console.log(message, ...args);
  }
}; 