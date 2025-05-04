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

  // Initialize with the KV namespace
  constructor(private kv: Env['SCRAPER_KV']) {}

  // Save the current scraping state
  async saveScraperState(state: ScrapingState): Promise<void> {
    logDebug('Saving scraper state to KV');
    try {
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
      await this.kv.delete(this.SCRAPER_STATE_KEY);
    } catch (error) {
      console.error('Failed to clear scraper state from KV:', error);
    }
  }

  // Save a single show by its ID
  async saveShow(show: Show): Promise<void> {
    try {
      const key = `${this.SHOW_KEY_PREFIX}${show.id}`;
      await this.kv.put(key, JSON.stringify(show), { expirationTtl: this.STATE_TTL });
      logDebug(`Saved show: ${show.id}`);
    } catch (error) {
      console.error(`Failed to save show ${show.id} to KV:`, error);
    }
  }

  // Check if a show with the given ID exists
  async showExists(showId: string): Promise<boolean> {
    try {
      const key = `${this.SHOW_KEY_PREFIX}${showId}`;
      const show = await this.kv.get(key);
      return show !== null;
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
      return JSON.parse(showJson) as Show;
    } catch (error) {
      console.error(`Failed to get show ${showId} from KV:`, error);
      return null;
    }
  }

  // Save multiple shows at once
  async saveShows(shows: Show[]): Promise<void> {
    try {
      const savePromises = shows.map(show => this.saveShow(show));
      await Promise.all(savePromises);
      logDebug(`Saved ${shows.length} shows to KV`);
      
      // Update the show count metadata
      await this.updateShowCount(shows.length);
    } catch (error) {
      console.error('Failed to save shows to KV:', error);
    }
  }

  // Update the show count metadata
  private async updateShowCount(count: number): Promise<void> {
    try {
      const currentCountStr = await this.kv.get(this.SHOW_COUNT_KEY);
      const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
      await this.kv.put(this.SHOW_COUNT_KEY, (currentCount + count).toString());
    } catch (error) {
      console.error('Failed to update show count in KV:', error);
    }
  }

  // Get the current count of shows in KV
  async getShowCount(): Promise<number> {
    try {
      const countStr = await this.kv.get(this.SHOW_COUNT_KEY);
      return countStr ? parseInt(countStr, 10) : 0;
    } catch (error) {
      console.error('Failed to get show count from KV:', error);
      return 0;
    }
  }

  // Clear all stored shows
  async clearAllShows(): Promise<void> {
    // This is a simplified approach that works for now
    // In a production system with many shows, we'd need to use list() and delete in batches
    try {
      // We'll reset the count to 0, but leave the actual show data
      // This allows the scraper to overwrite them in the next run
      await this.kv.put(this.SHOW_COUNT_KEY, '0');
      logDebug('Reset show count to 0');
    } catch (error) {
      console.error('Failed to clear shows from KV:', error);
    }
  }
} 