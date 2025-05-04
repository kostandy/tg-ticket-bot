import { SCRAPER_CONFIG, logDebug } from '../config.js';

// Track subrequest count to respect Cloudflare limits
let subrequestCount = 0;

// Cache for already fetched pages to avoid duplicate requests
// Use a simple object instead of Map to reduce memory overhead
const pageCache: Record<string, string> = {};
let cacheEntryCount = 0;

// Define Cloudflare-specific fetch options
export interface CloudflareFetchOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  cf?: {
    cacheTtl?: number;
    cacheEverything?: boolean;
  };
}

// Global rate-limiting mechanism
export const rateLimit = async (): Promise<void> => {
  if (subrequestCount >= SCRAPER_CONFIG.MAX_SUBREQUESTS) {
    throw new Error('Subrequest limit reached');
  }
  subrequestCount++;
};

export const fetchWithRetry = async (
  url: string, 
  options: Record<string, unknown> = {}
): Promise<Response> => {
  await rateLimit();
  
  // Check cache first
  if (url in pageCache) {
    logDebug(`Using cached response for ${url}`);
    const cachedResponse = new Response(pageCache[url], {
      headers: { 'Content-Type': 'text/html' },
      status: 200
    });
    return cachedResponse;
  }
  
  let lastError;
  for (let i = 0; i < SCRAPER_CONFIG.MAX_RETRIES; i++) {
    try {
      logDebug(`Fetching ${url} (subrequest ${subrequestCount}/${SCRAPER_CONFIG.MAX_SUBREQUESTS})`);
      subrequestCount++;
      
      const fetchOptions: CloudflareFetchOptions = {
        ...options,
        headers: { ...(options.headers || {}), 'User-Agent': SCRAPER_CONFIG.USER_AGENT },
        cf: { cacheTtl: 7200, cacheEverything: true } // Cache for 2 hours
      };
      
      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      // Cache the response, but manage cache size
      const text = await response.text();
      if (cacheEntryCount >= SCRAPER_CONFIG.MAX_CACHE_ENTRIES) {
        // Simple cache eviction - just clear everything if we reach the limit
        // In a production environment, use a proper LRU cache
        Object.keys(pageCache).forEach(key => delete pageCache[key]);
        cacheEntryCount = 0;
      }
      
      pageCache[url] = text;
      cacheEntryCount++;
      
      return new Response(text, {
        headers: response.headers,
        status: response.status
      });
    } catch (error: unknown) {
      if (i < SCRAPER_CONFIG.MAX_RETRIES - 1) {
        console.error(`Attempt ${i + 1} failed, retrying...`);
      } else {
        console.error(`All ${SCRAPER_CONFIG.MAX_RETRIES} attempts failed:`, error);
      }
      lastError = error;
      
      // If we hit the subrequest limit, don't retry
      if (error instanceof Error && 
         (error.message === 'Subrequest limit reached' || 
          error.message === 'Too many subrequests')) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, SCRAPER_CONFIG.RATE_LIMIT_DELAY));
    }
  }
  throw lastError;
};

// Get current subrequest count
export const getSubrequestCount = (): number => subrequestCount;

// Set subrequest count - useful for resuming from a saved state
export const setSubrequestCount = (count: number): void => {
  subrequestCount = count;
};

// Reset subrequest count (mostly for testing purposes)
export const resetSubrequestCount = (): void => {
  subrequestCount = 0;
}; 