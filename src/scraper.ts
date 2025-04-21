import * as cheerio from 'cheerio';
import type { Show } from './types';
import { getSupabase } from './db';

const targetWebsite = process.env.TARGET_WEBSITE;
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 2000;

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

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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

const fetchWithRetry = async (url: string, options?: FetchOptions): Promise<Response> => {
  let lastError;
  
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }
  
  throw lastError;
};

const fetchPage = async (url: string, page: number): Promise<Show[]> => {
  if (page === 0) {
    const response = await fetch(url);
    const html = await response.text();
    return parseShowsFromHtml(cheerio.load(html));
  }

  const payload = new URLSearchParams({
    page: page.toString(),
    view_name: 'afisha',
    view_display_id: 'page',
    view_args: '',
    view_path: url.replace('https://molodyytheatre.com/', ''),
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

const getNextMonthUrl = ($: cheerio.CheerioAPI): string | null => {
  const nextMonthLink = $('#afisha-date-list .next.last a').attr('href');
  return nextMonthLink ? `https://molodyytheatre.com${nextMonthLink}` : null;
};

const hasNoEvents = ($: cheerio.CheerioAPI): boolean => {
  const emptyMessage = $('#block-system-main .view-empty p').text().trim();
  return emptyMessage === 'На обрану дату немає заходів.';
};

const scrapeMonth = async (url: string): Promise<Show[]> => {
  console.log(`Scraping month from ${url}`);
  const shows: Show[] = [];
  let page = 0;

  try {
    while (true) {
      console.log(`Fetching page ${page}...`);
      const monthShows = await fetchPage(url, page);
      
      if (!monthShows.length) {
        break;
      }
      
      shows.push(...monthShows);
      page++;
      
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  } catch (error) {
    console.error(`Error scraping month ${url}:`, error);
  }

  return shows;
};

const saveShowsToDb = async (shows: Show[]): Promise<void> => {
  const supabase = getSupabase();
  const { data: existingShows, error: selectError } = await supabase.from('shows').select();
  
  if (selectError) {
    console.error('Failed to fetch existing shows:', selectError);
    return;
  }

  for (const show of shows) {
    const existingShow = existingShows?.find((s) => s.title === show.title);
    
    try {
      if (!existingShow) {
        const { error: insertError } = await supabase.from('shows').insert(show);
        if (insertError) throw insertError;
        console.log('Inserted show:', show.title);
      } else if (JSON.stringify(existingShow.dates) !== JSON.stringify(show.dates)) {
        const { error: updateError } = await supabase
          .from('shows')
          .update({ dates: show.dates })
          .eq('id', show.id);
        if (updateError) throw updateError;
        console.log('Updated show:', show.title);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Error saving show ${show.title}:`, error);
    }
  }
};

export const scrapeShows = async (): Promise<Show[]> => {
  console.info('Scraping shows from', targetWebsite);
  const allShows: Show[] = [];
  let currentUrl = targetWebsite;
  
  while (currentUrl) {
    try {
      const response = await fetchWithRetry(currentUrl);
      const html = await response.text();
      const $ = cheerio.load(html);

      if (hasNoEvents($)) {
        break;
      }

      const monthShows = await scrapeMonth(currentUrl);
      if (monthShows.length) {
        await saveShowsToDb(monthShows);
        allShows.push(...monthShows);
      }

      currentUrl = getNextMonthUrl($) || '';
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    } catch (error) {
      console.error(`Error processing URL ${currentUrl}:`, error);
      break;
    }
  }
  
  console.log(`Found ${allShows.length} shows in total`);
  return allShows;
}; 