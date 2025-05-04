import { logDebug } from '../config.js';
import type { Job } from '../queues/job-queue.js';
import type { Show, Env } from '../types.js';

// Define the structure of a saved scraping state
export interface ScrapingState {
  lastUpdated: number;
  allDatesToScrape: string[];
  processedDates: string[];
  pendingJobs: Job[];
  completedShows: Show[];
  subrequestCount: number;
}

export class KVStorage {
  // KV key for storing the scraping state
  private readonly SCRAPER_STATE_KEY = 'scraper:state';
  // Prefix for storing individual shows
  private readonly SHOW_KEY_PREFIX = 'show:';
  // Key for storing metadata about show count
  private readonly SHOW_COUNT_KEY = 'shows:count';
  
  // TTL for state (24 hours)
  private readonly STATE_TTL = 86400;
  
  // Cache show IDs in memory to reduce KV reads
  private cachedShowIds: Set<string> = new Set();
  private showCountCache: number | null = null;
  private stateCache: ScrapingState | null = null;

  // Initialize with the KV namespace
  constructor(private kv: Env['SCRAPER_KV']) {}

  // Save the current scraping state
  async saveScraperState(state: ScrapingState): Promise<void> {
    logDebug('Saving scraper state to KV');
    try {
      // Update the cache
      this.stateCache = state;
      
      await this.kv.put(
        this.SCRAPER_STATE_KEY,
        JSON.stringify(state),
        { expirationTtl: this.STATE_TTL }
      );
      logDebug(`Saved state with ${state.pendingJobs.length} pending jobs and ${state.completedShows.length} completed shows`);
    } catch (error) {
      console.error('Failed to save scraper state to KV:', error);
    }
  }

  // Load the previous scraping state
  async loadScraperState(): Promise<ScrapingState | null> {
    // Return cached state if available
    if (this.stateCache) {
      return this.stateCache;
    }
    
    logDebug('Attempting to load scraper state from KV');
    try {
      const stateJson = await this.kv.get(this.SCRAPER_STATE_KEY);
      if (!stateJson) {
        logDebug('No saved state found in KV');
        return null;
      }
      
      const state = JSON.parse(stateJson) as ScrapingState;
      
      // Check if state is too old (more than 4 hours)
      const ageInHours = (Date.now() - state.lastUpdated) / (1000 * 60 * 60);
      if (ageInHours > 4) {
        logDebug(`Found state but it's too old (${ageInHours.toFixed(1)} hours), ignoring`);
        return null;
      }
      
      // Cache the state
      this.stateCache = state;
      
      logDebug(`Loaded state with ${state.pendingJobs.length} pending jobs and ${state.completedShows.length} completed shows`);
      return state;
    } catch (error) {
      console.error('Failed to load scraper state from KV:', error);
      return null;
    }
  }

  // Clear the scraper state (e.g., after a successful complete run)
  async clearScraperState(): Promise<void> {
    logDebug('Clearing scraper state from KV');
    try {
      // Clear the cache
      this.stateCache = null;
      
      await this.kv.delete(this.SCRAPER_STATE_KEY);
    } catch (error) {
      console.error('Failed to clear scraper state from KV:', error);
    }
  }

  // Save a single show by its ID
  async saveShow(show: Show): Promise<void> {
    try {
      const key = `${this.SHOW_KEY_PREFIX}${show.id}`;
      
      // Add to in-memory cache
      this.cachedShowIds.add(show.id);
      
      await this.kv.put(key, JSON.stringify(show), { expirationTtl: this.STATE_TTL });
      logDebug(`Saved show: ${show.id}`);
    } catch (error) {
      console.error(`Failed to save show ${show.id} to KV:`, error);
    }
  }

  // Check if a show with the given ID exists
  async showExists(showId: string): Promise<boolean> {
    // Check in-memory cache first
    if (this.cachedShowIds.has(showId)) {
      return true;
    }
    
    try {
      const key = `${this.SHOW_KEY_PREFIX}${showId}`;
      const show = await this.kv.get(key);
      
      if (show !== null) {
        // Add to cache for future checks
        this.cachedShowIds.add(showId);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to check if show ${showId} exists in KV:`, error);
      return false;
    }
  }

  // Get a single show by its ID
  async getShow(showId: string): Promise<Show | null> {
    try {
      const key = `${this.SHOW_KEY_PREFIX}${showId}`;
      const showJson = await this.kv.get(key);
      if (!showJson) {
        return null;
      }
      
      // Add to cache
      this.cachedShowIds.add(showId);
      
      return JSON.parse(showJson) as Show;
    } catch (error) {
      console.error(`Failed to get show ${showId} from KV:`, error);
      return null;
    }
  }

  // Save multiple shows at once
  async saveShows(shows: Show[]): Promise<void> {
    if (shows.length === 0) return;
    
    try {
      // Use batch operations if supported, otherwise fall back to sequential
      // Since we only need to save a few shows per execution, sequential is fine
      for (const show of shows) {
        await this.saveShow(show);
      }
      
      // Update the show count in one operation
      await this.updateShowCount(shows.length);
      
      logDebug(`Saved ${shows.length} shows to KV`);
    } catch (error) {
      console.error('Failed to save shows to KV:', error);
    }
  }

  // Update the show count metadata
  private async updateShowCount(count: number): Promise<void> {
    try {
      // Use cached value if available
      const currentCount = this.showCountCache !== null 
        ? this.showCountCache 
        : await this.getShowCount();
      
      const newCount = currentCount + count;
      
      // Update cache
      this.showCountCache = newCount;
      
      await this.kv.put(this.SHOW_COUNT_KEY, newCount.toString());
    } catch (error) {
      console.error('Failed to update show count in KV:', error);
    }
  }

  // Get the current count of shows in KV
  async getShowCount(): Promise<number> {
    // Return cached value if available
    if (this.showCountCache !== null) {
      return this.showCountCache;
    }
    
    try {
      const countStr = await this.kv.get(this.SHOW_COUNT_KEY);
      const count = countStr ? parseInt(countStr, 10) : 0;
      
      // Cache the result
      this.showCountCache = count;
      
      return count;
    } catch (error) {
      console.error('Failed to get show count from KV:', error);
      return 0;
    }
  }

  // Clear all stored shows
  async clearAllShows(): Promise<void> {
    try {
      // Reset caches
      this.cachedShowIds.clear();
      this.showCountCache = 0;
      
      // Just reset the count, leave the shows
      await this.kv.put(this.SHOW_COUNT_KEY, '0');
      logDebug('Reset show count to 0');
    } catch (error) {
      console.error('Failed to clear shows from KV:', error);
    }
  }
} 