import { handleStart, handlePosters, handleUpcoming, handlePaginationCallback } from './bot.js';
import { scrapeShows } from './scraper.js';
import { initSupabase, getSupabase } from './db.js';
import type { Env, TelegramUpdate, Show } from './types.js';
import { TelegramService } from './services/telegram.js';
import { DefaultShowFormatter } from './services/show-formatter.js';

// Channel ID for notifications
const CHANNEL_ID = 2642067703;

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Verify secret token (optional but recommended)
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_BOT_SECRET) return new Response('Unauthorized', { status: 403 });

    initSupabase(env);

    const url = new URL(request.url);

    if (url.pathname === '/webhook') {
      const update = await request.json() as TelegramUpdate;
      
      // Handle callback queries for pagination
      if (update.callback_query) {
        await handlePaginationCallback(update.callback_query);
        return new Response('OK');
      }
      
      const msg = update.message;

      if (!msg) {
        return new Response('Invalid message', { status: 400 });
      }

      if (msg.text === '/start') {
        await handleStart(msg);
      } else if (msg.text === '/posters') {
        await handlePosters(msg);
      } else if (msg.text === '/upcoming') {
        await handleUpcoming(msg);
      }

      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async scheduled(_: any, env: Env) {
    console.log('Starting scheduled job');
    initSupabase(env);
    
    // Initialize Telegram service for notifications
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.error('Missing Telegram bot token, will not send notifications');
    }
    
    const telegram = env.TELEGRAM_BOT_TOKEN ? new TelegramService(env.TELEGRAM_BOT_TOKEN) : null;
    const showFormatter = new DefaultShowFormatter();

    // First, fetch only IDs of existing shows to minimize payload
    const supabase = getSupabase();
    const { data: existingShowIds, error: selectError } = await supabase
      .from('shows')
      .select('id')
      .order('date', { ascending: false });
    
    if (selectError) {
      console.error('Failed to fetch existing show IDs:', selectError);
      return;
    }
    
    // Create map of existing IDs for fast lookup
    const existingIdMap = new Map<string, boolean>();
    existingShowIds?.forEach(item => existingIdMap.set(item.id, true));
    
    console.log(`Loaded ${existingIdMap.size} existing show IDs`);
    
    // Scrape shows
    const newShows: Show[] = [];
    const shows = await scrapeShows();
    
    console.log(`Scraped ${shows.length} total shows`);
    
    for (const show of shows) {
      // Check if show already exists by ID
      if (!existingIdMap.has(show.id)) {
        console.log(`New show detected: "${show.title}" on ${show.date}`);
        newShows.push(show);
        
        // Insert into database
        const { error: insertError } = await supabase.from('shows').insert(show);
        if (insertError) {
          console.error('Failed to insert show:', insertError);
          console.error('Insert error details:', {
            code: insertError.code,
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint
          });
        } else {
          console.log('Successfully inserted new show:', show.title);
        }
      }
    }
    
    // Send notifications for new shows
    if (newShows.length > 0 && telegram) {
      console.log(`Sending notifications for ${newShows.length} new shows to channel ${CHANNEL_ID}`);
      
      try {
        // Send message to channel about new shows
        for (const show of newShows) {
          try {
            const message = showFormatter.format(show);
            message.text = `🔔 *New Show Added!*\n\n${message.text}`;
            
            await telegram.sendMessage(CHANNEL_ID, message);
            console.log(`Notification sent for show: "${show.title}"`);
            
            // Add delay between messages to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(`Failed to send notification for show "${show.title}":`, error);
            // Continue with other shows even if one fails
          }
        }
      } catch (error) {
        console.error('Failed to process notifications:', error);
      }
    } else if (newShows.length > 0) {
      console.log(`Found ${newShows.length} new shows but no Telegram token available for notifications`);
    } else {
      console.log('No new shows found');
    }
  }
}; 