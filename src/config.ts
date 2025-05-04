// Constants and configuration settings for the application

// Scraper settings
export const SCRAPER_CONFIG = {
  // Enable detailed logging only in development
  IS_DEV: false, // Set to false in production
  STORAGE_MODE: process.env.STORAGE_MODE === 'file',
  MAX_RETRIES: 2, // Reduced from 3 to save execution time
  RATE_LIMIT_DELAY: 300, // Reduced delay to save CPU time
  MAX_CONCURRENT_JOBS: 1, // Limited to 1 concurrent job to stay within Cloudflare's CPU limits
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  BASE_URL: 'https://molodyytheatre.com',
  // Cloudflare Worker limits
  MAX_SUBREQUESTS: 20, // Reduced from 35 to stay well below the 50 limit
  CHUNK_SIZE: 3, // Reduced from 10 to process fewer dates per execution
  MAX_CACHE_ENTRIES: 10, // Reduced from 20 to lower memory usage
  MAX_WAIT_TIME: 8 // Reduced from 9000ms to 8ms to stay under 10ms CPU time limit
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