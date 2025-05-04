// Constants and configuration settings for the application

// Scraper settings
export const SCRAPER_CONFIG = {
  // Enable detailed logging only in development
  IS_DEV: false, // Set to false in production
  STORAGE_MODE: process.env.STORAGE_MODE === 'file',
  MAX_RETRIES: 3,
  RATE_LIMIT_DELAY: 800, // Slightly reduced delay to save CPU time
  MAX_CONCURRENT_JOBS: 2, // Limited to 2 concurrent jobs to stay within Cloudflare's connection limits
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  BASE_URL: 'https://molodyytheatre.com',
  // Cloudflare Worker limits
  MAX_SUBREQUESTS: 35, // Keep further below the 50 limit to be safer
  CHUNK_SIZE: 4, // Reduced to improve completion chances
  MAX_CACHE_ENTRIES: 20,
  MAX_WAIT_TIME: 9000 // 9 seconds
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