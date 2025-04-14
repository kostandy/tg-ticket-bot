import * as cheerio from 'cheerio';
import type { Show } from './types';

const targetWebsite = process.env.TARGET_WEBSITE;

if (!targetWebsite) {
  throw new Error('Missing TARGET_WEBSITE environment variable');
}

export const scrapeShows = async (): Promise<Show[]> => {
  const response = await fetch(targetWebsite);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const shows: Show[] = [];
  
  // Note: This selector needs to be adjusted based on the actual website structure
  $('.show-item').each((_, element) => {
    const $el = $(element);
    const title = $el.find('.title').text().trim();
    const url = $el.find('a').attr('href') || '';
    const dates = $el.find('.dates').map((_, date) => $(date).text().trim()).get();
    
    if (title && url) {
      shows.push({
        id: url,
        title,
        url,
        dates
      });
    }
  });
  
  return shows;
}; 