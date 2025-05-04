import { logDebug } from '../config.js';
import type { Job } from '../queues/job-queue.js';
import type { Show } from '../types.js';

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
  
  // TTL for state (24 hours)
  private readonly STATE_TTL = 86400;

  // Initialize with the KV namespace
  constructor(private kv: KVNamespace) {}

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
} 