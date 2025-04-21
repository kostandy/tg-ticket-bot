import * as cheerio from 'cheerio';
import type { Show } from './types';

const targetWebsite = process.env.TARGET_WEBSITE;

if (!targetWebsite) {
  throw new Error('Missing TARGET_WEBSITE environment variable');
}

interface DrupalAjaxCommand {
  command: string;
  method: string;
  selector: string;
  data: string;
  settings: null;
}

const parseShowsFromHtml = ($: cheerio.CheerioAPI): Show[] => {
  const shows: Show[] = [];
  
  $('.views-row').each((_, element) => {
    const $el = $(element);
    const title = $el.find('.views-field-field-event-title .field-content a').text().trim();
    const url = $el.find('.views-field-field-event-title .field-content a').attr('href') || '';
    const dates = $el.find('.views-field-field-time .field-content').map((_, dateEl) => {
      const day = $(dateEl).find('.t1').text().trim();
      const month = $(dateEl).find('.t2').text().trim();
      const time = $(dateEl).find('.t3').text().trim();
      return [day, month, time].filter(Boolean).join(' ');
    }).get();
    const imageUrl = $el.find('.views-field-field-images img').attr('src') || '';
    const ticketUrl = $el.find('.views-field-nothing a').attr('href') || '';
    const soldOut = $el.find('.views-field-field-label .field-content').text().trim().toLowerCase() === 'квитки продано';
    
    if (title && url) {
      shows.push({
        id: url,
        title,
        url,
        dates,
        imageUrl,
        ticketUrl,
        soldOut
      });
    }
  });
  
  return shows;
};

const fetchPage = async (page: number): Promise<Show[]> => {
  if (page === 0) {
    const response = await fetch(targetWebsite);
    const html = await response.text();
    return parseShowsFromHtml(cheerio.load(html));
  }

  const payload = new URLSearchParams({
    page: page.toString(),
    view_name: 'afisha',
    view_display_id: 'page',
    view_args: '',
    view_path: 'afisha',
    view_base_path: 'afisha',
    view_dom_id: Date.now().toString(36),
    pager_element: '0'
  });

  const response = await fetch('https://molodyytheatre.com/views/ajax', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: payload.toString()
  });

  const data = await response.json() as DrupalAjaxCommand[];
  const html = data.find(item => item.command === 'insert')?.data || '';
  return parseShowsFromHtml(cheerio.load(html));
};

export const scrapeShows = async (): Promise<Show[]> => {
  console.info('Scraping shows from', targetWebsite);
  const allShows: Show[] = [];
  let page = 0;
  
  while (true) {
    console.log(`Fetching page ${page}...`);
    const shows = await fetchPage(page);
    
    if (!shows.length) {
      break;
    }
    
    allShows.push(...shows);
    page++;
    
    // Add a small delay between requests to be nice to the server
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`Found ${allShows.length} shows in total`);
  return allShows;
}; 