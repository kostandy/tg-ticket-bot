// This file provides backward compatibility with existing code
// It re-exports the scraping functionality from the new modular structure

import { scrapeShows as scrapeShowsImpl } from './scrapers/main-scraper.js';
import type { Show } from './types.js';

export const scrapeShows = async (): Promise<Show[]> => {
  return await scrapeShowsImpl();
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