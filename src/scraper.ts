import * as cheerio from 'cheerio';
import type { Show } from './types.js';
import { getSupabase, initSupabase } from './db.js';
import { getStoredShows, storeShows } from './storage/file.js';
import { createHash } from 'node:crypto';

const STORAGE_MODE = process.env.STORAGE_MODE === 'file';
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY = 2000;
const MAX_CONCURRENT_JOBS = 1;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE_URL = 'https://molodyytheatre.com';

console.log('STORAGE_MODE', STORAGE_MODE);

if (!STORAGE_MODE) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }
  
  initSupabase({ SUPABASE_URL: supabaseUrl, SUPABASE_KEY: supabaseKey });
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
        soldOut,
        soldOutByDate: {}
      });
    }
  });
  
  return shows;
};

const fetchWithRetry = async (url: string, options: Record<string, unknown> = {}): Promise<Response> => {
  let lastError;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), 'User-Agent': USER_AGENT },
      });
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

const hasNoEvents = ($: cheerio.CheerioAPI): boolean => {
  const emptyMessage = $('#block-system-main .view-empty p').text().trim();
  return emptyMessage === 'На обрану дату немає заходів.';
};

const scrapeDay = async (url: string): Promise<Show[]> => {
  console.log(`Scraping day from ${url}`);
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    return parseShowsFromHtml(cheerio.load(html));
  } catch (error) {
    console.error(`Error scraping day ${url}:`, error);
    return [];
  }
};

const getDayFromUrl = (url: string): string => {
  const match = url.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
};

const findDatesWithEvents = async (startDate: string): Promise<string[]> => {
  console.log(`Finding dates with events starting from ${startDate}`);
  const datesWithEvents: string[] = [];
  let currentDateUrl = `${BASE_URL}/afisha/${startDate}`;
  let hasMoreMonths = true;

  while (hasMoreMonths) {
    console.log(`Checking calendar at ${currentDateUrl}`);
    try {
      const response = await fetchWithRetry(currentDateUrl);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Find all dates with events in the current month
      let foundEventsInCurrentMonth = false;
      
      $('#afisha-date-list > li.future').each((_, element) => {
        const $el = $(element);
        const hasEvent = $el.find('a').length > 0;

        console.log('Found the following number of events', $el.find('a').length);

        if (hasEvent) {
          console.log('Found events in current month');
          foundEventsInCurrentMonth = true;
          const dateLink = $el.find('a').attr('href');
          if (dateLink) {
            const fullUrl = dateLink.startsWith('http') ? dateLink : `${BASE_URL}${dateLink}`;
            const day = getDayFromUrl(fullUrl);
            datesWithEvents.push(day);
          }
        }
      });
      
      // Check if there's a next month to check
      const nextMonthButton = $('#afisha-date-list li.next.last a');
      if (nextMonthButton.length > 0 && foundEventsInCurrentMonth) {
        const nextMonthUrl = nextMonthButton.attr('href');
        if (nextMonthUrl) {
          currentDateUrl = nextMonthUrl.startsWith('http') ? nextMonthUrl : `${BASE_URL}${nextMonthUrl}`;
        } else {
          hasMoreMonths = false;
        }
      } else {
        hasMoreMonths = false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (error) {
      console.error('Error finding dates with events:', error);
      hasMoreMonths = false;
    }
  }
  
  // Sort dates chronologically
  datesWithEvents.sort();
  console.log(`Found ${datesWithEvents.length} dates with events`);
  return datesWithEvents;
};

interface Job {
  url: string;
  day: string;
}

class JobQueue {
  private queue: Job[] = [];
  private running = 0;
  private results: Show[] = [];

  constructor(private maxConcurrent: number) {}

  add(job: Job) {
    this.queue.push(job);
    this.processNext();
  }

  private async processNext() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const job = this.queue[0];
    this.queue = this.queue.slice(1);
    
    try {
      const shows = await this.processJob(job);
      this.results.push(...shows);
    } catch (error) {
      console.error(`Error processing job for ${job.url}:`, error);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  private async processJob(job: Job): Promise<Show[]> {
    const response = await fetchWithRetry(job.url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    if (hasNoEvents($)) {
      return [];
    }
    
    const dayShows = await scrapeDay(job.url);
    const existingFileName = await this.findExistingFile(job.day);
    const storedShows = existingFileName ? await getStoredShows(existingFileName) : [];
    const posterMap = new Map<string, Show>();
    
    for (const show of storedShows) {
      posterMap.set(show.id, { ...show, soldOutByDate: show.soldOutByDate || {} });
    }
    
    for (const show of dayShows) {
      if (!posterMap.has(show.id)) {
        posterMap.set(show.id, {
          ...show,
          dates: [job.day],
          soldOutByDate: { [job.day]: !!show.soldOut }
        } as Show);
      } else {
        const poster = posterMap.get(show.id);
        if (poster) {
          if (!poster.dates.includes(job.day)) {
            poster.dates.push(job.day);
          }
          poster.soldOutByDate[job.day] = !!show.soldOut;
        }
      }
    }
    
    const mergedShows = Array.from(posterMap.values());
    
    if (STORAGE_MODE) {
      const contentHash = this.calculateHash(mergedShows).slice(0, 10);
      const newFileName = `posters-${job.day}-${contentHash}`;
      
      if (!existingFileName || existingFileName.split('-').pop()?.split('.')[0] !== contentHash) {
        if (existingFileName) {
          await this.deleteFile(existingFileName);
        }
        await storeShows(newFileName, mergedShows);
      } else {
        console.log(`Content unchanged for ${job.day}, skipping storage`);
      }
    } else {
      const supabase = getSupabase();
      const { data: existingShows, error: selectError } = await supabase.from('shows').select();
      
      if (selectError) {
        console.error('Failed to fetch existing shows:', selectError);
        return mergedShows;
      }
      
      for (const show of mergedShows) {
        const existingShow = existingShows?.find((s: { id: string }) => s.id === show.id);
        try {
          if (!existingShow) {
            const { error: insertError } = await supabase.from('shows').insert(show);
            if (insertError) throw insertError;
            console.log('Inserted show:', show.title);
          } else {
            const mergedDates = Array.from(new Set([...(existingShow.dates || []), ...(show.dates || [])]));
            const mergedSoldOutByDate = { ...(existingShow.soldOutByDate || {}), ...(show.soldOutByDate || {}) };
            const { error: updateError } = await supabase
              .from('shows')
              .update({ dates: mergedDates, soldOutByDate: mergedSoldOutByDate })
              .eq('id', show.id);
            if (updateError) throw updateError;
            console.log('Updated show:', show.title);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error saving show ${show.title}:`, error);
        }
      }
    }
    
    return mergedShows;
  }

  private calculateHash(data: Show[]): string {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  private async findExistingFile(day: string): Promise<string | null> {
    try {
      const response = await fetch(`data/posters/posters-${day}-*.json`);
      const files = await response.json() as string[];
      return files[0] || null;
    } catch {
      return null;
    }
  }

  private async deleteFile(fileName: string): Promise<void> {
    try {
      await fetch(`data/posters/${fileName}`, { method: 'DELETE' });
    } catch (error) {
      console.error(`Error deleting file ${fileName}:`, error);
    }
  }

  async waitForCompletion(): Promise<Show[]> {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return this.results;
  }
}

export const scrapeShows = async (): Promise<Show[]> => {
  const today = new Date().toISOString().slice(0, 10);
  console.log('today', today);
  
  // Phase 1: Find all dates with events
  const datesToScrape = await findDatesWithEvents(today);
  if (datesToScrape.length === 0) {
    console.log('No dates with events found');
    return [];
  }

  console.log('Building a scraping list is over. datesToScrape:', datesToScrape);

  // Phase 2: Process shows in parallel using job queue
  const jobQueue = new JobQueue(MAX_CONCURRENT_JOBS);
  
  for (const day of datesToScrape) {
    const currentUrl = `${BASE_URL}/afisha/${day}`;
    jobQueue.add({ url: currentUrl, day });
  }

  const allShows = await jobQueue.waitForCompletion();
  console.log(`Found ${allShows.length} shows in total`);
  return allShows;
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