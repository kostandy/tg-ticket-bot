import { handleStart, handlePosters, handleUpcoming, handlePaginationCallback, handleAdmin } from './bot.js';
import { scrapeShows } from './scraper.js';
import { initSupabase, getSupabase } from './db.js';
import type { Env, TelegramUpdate, Show } from './types.js';
import { TelegramService } from './services/telegram.js';
import { DefaultShowFormatter } from './services/show-formatter.js';

// Channel ID for notifications
const CHANNEL_ID = 2642067703;

// Enable detailed logging only in development
const IS_DEV = false; // Set to false in production
const logDebug = (message: string, ...args: unknown[]) => {
  if (IS_DEV) {
    console.log(message, ...args);
  }
};

// Admin command prefix
const ADMIN_COMMANDS = ['/admin_stats', '/admin_scrape', '/admin_clearold', '/admin_help'];

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Verify secret token (optional but recommended)
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_BOT_SECRET) return new Response('Unauthorized', { status: 403 });

    try {
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

        // Check for admin commands
        if (msg.text && ADMIN_COMMANDS.some(cmd => msg.text === cmd)) {
          await handleAdmin(msg, msg.text);
          return new Response('OK');
        }

        // Regular commands
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
    } catch (error) {
      console.error('Error in fetch handler:', error);
      return new Response('Internal server error', { status: 500 });
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async scheduled(_: any, env: Env) {
    try {
      logDebug('Starting scheduled job');
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
        .order('datetime', { ascending: false });
      
      if (selectError) {
        console.error('Failed to fetch existing show IDs:', selectError);
        return;
      }
      
      // Create map of existing IDs for fast lookup
      const existingIdMap = new Map<string, boolean>();
      existingShowIds?.forEach(item => existingIdMap.set(item.id, true));
      
      logDebug(`Loaded ${existingIdMap.size} existing show IDs`);
      
      // Scrape shows
      const newShows: Show[] = [];
      const shows = await scrapeShows();
      
      logDebug(`Scraped ${shows.length} total shows`);
      
      // Batch database operations to stay within subrequest limits
      const BATCH_SIZE = 10;
      const showsToInsert = [];
      
      for (const show of shows) {
        // Check if show already exists by ID
        if (!existingIdMap.has(show.id)) {
          logDebug(`New show detected: "${show.title}" on ${show.datetime}`);
          newShows.push(show);
          showsToInsert.push(show);
        }
      }
      
      // Insert shows in batches
      for (let i = 0; i < showsToInsert.length; i += BATCH_SIZE) {
        const batch = showsToInsert.slice(i, i + BATCH_SIZE);
        if (batch.length === 0) continue;
        
        try {
          const { error: insertError } = await supabase.from('shows').insert(batch);
          if (insertError) {
            console.error('Failed to insert shows batch:', insertError);
          } else {
            logDebug(`Successfully inserted ${batch.length} shows`);
          }
          
          // Avoid hitting rate limits
          if (i + BATCH_SIZE < showsToInsert.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error('Error inserting batch of shows:', error);
        }
      }
      
      // Send notifications for new shows
      if (newShows.length > 0 && telegram) {
        logDebug(`Sending notifications for ${newShows.length} new shows to channel ${CHANNEL_ID}`);
        
        try {
          // Send message to channel about new shows, but limit to 5 to avoid excessive API calls
          const maxNotifications = Math.min(newShows.length, 5);
          for (let i = 0; i < maxNotifications; i++) {
            try {
              const show = newShows[i];
              const message = showFormatter.format(show);
              message.text = `🔔 *Нова вистава додана!*\n\n${message.text}`;
              
              await telegram.sendMessage(CHANNEL_ID, message);
              logDebug(`Notification sent for show: "${show.title}"`);
              
              // Add delay between messages to avoid rate limits
              if (i < maxNotifications - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              console.error('Failed to send notification for show:', error);
            }
          }
          
          // If there are more shows than our limit, send a summary message
          if (newShows.length > maxNotifications) {
            try {
              await telegram.sendMessage(CHANNEL_ID, {
                text: `*Також додано ще ${newShows.length - maxNotifications} вистав(и). Використайте /posters щоб побачити всі.*`,
                parse_mode: 'Markdown'
              });
            } catch (error) {
              console.error('Failed to send summary notification:', error);
            }
          }
        } catch (error) {
          console.error('Failed to process notifications:', error);
        }
      } else if (newShows.length > 0) {
        logDebug(`Found ${newShows.length} new shows but no Telegram token available for notifications`);
      } else {
        logDebug('No new shows found');
      }
    } catch (error) {
      console.error('Error in scheduled job:', error);
    }
  }
}; 