// This file provides backward compatibility with existing code
// It re-exports the scraping functionality from the new modular structure

import { scrapeShows as mainScraper } from './scrapers/main-scraper.js';
import type { Show, Env } from './types.js';

// Re-export the scrapeShows function with support for env parameter
export const scrapeShows = async (env?: Env): Promise<Show[]> => {
  return mainScraper(env);
};

// Direct execution support
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await scrapeShows();
    console.log('Scraping completed successfully');
  } catch (error) {
    console.error('Error during scraping:', error);
    process.exit(1);
  }
} 