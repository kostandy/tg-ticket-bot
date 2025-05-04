import { handleStart, handlePosters, handleUpcoming, handlePaginationCallback, handleAdmin } from './bot.js';
import { scrapeShows } from './scraper.js';
import { initSupabase, getSupabase } from './db.js';
import type { Env, TelegramUpdate, Show } from './types.js';
import { TelegramService } from './services/telegram.js';
import { DefaultShowFormatter } from './services/show-formatter.js';

// Enable detailed logging only in development
const IS_DEV = false; // Set to false in production
const logDebug = (message: string, ...args: unknown[]) => {
  if (IS_DEV) {
    console.log(message, ...args);
  }
};

// Admin command prefix
const ADMIN_COMMANDS = ['/admin_stats', '/admin_scrape', '/admin_clearold', '/admin_help', '/admin_broadcast'];

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
        
        // Check for broadcast command
        if (msg.text && msg.text.startsWith('/broadcast ') && msg.from) {
          const isAdminUser = env.TELEGRAM_BOT_ADMIN_USER_ID && 
                             parseInt(env.TELEGRAM_BOT_ADMIN_USER_ID, 10) === msg.from.id;
                             
          if (isAdminUser) {
            const broadcastText = msg.text.substring('/broadcast '.length).trim();
            const notificationChannelId = env.TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID 
              ? parseInt(env.TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID, 10) 
              : null;
              
            if (notificationChannelId && broadcastText) {
              try {
                const telegramService = new TelegramService(env.TELEGRAM_BOT_TOKEN);
                await telegramService.sendMessage(notificationChannelId, {
                  text: `📢 *Оголошення*\n\n${broadcastText}`,
                  parse_mode: 'Markdown'
                });
                
                await telegramService.sendMessage(msg.chat.id, {
                  text: '✅ Повідомлення успішно відправлено в канал.'
                });
              } catch (error) {
                console.error('Error sending broadcast:', error);
                const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN);
                await telegram.sendMessage(msg.chat.id, {
                  text: `❌ Помилка при відправці повідомлення: ${error instanceof Error ? error.message : 'Невідома помилка'}`
                });
              }
            } else {
              const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN);
              if (!notificationChannelId) {
                await telegram.sendMessage(msg.chat.id, {
                  text: '❌ Помилка: ID каналу сповіщень не налаштовано.'
                });
              } else if (!broadcastText) {
                await telegram.sendMessage(msg.chat.id, {
                  text: '❌ Помилка: Текст повідомлення не може бути порожнім.'
                });
              }
            }
          }
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
      
      // Get notification channel ID from environment
      const notificationChannelId = env.TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID 
        ? parseInt(env.TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID, 10) 
        : null;
      
      if (!notificationChannelId) {
        console.error('Missing or invalid TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID, notifications will not be sent');
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
      
      // Scrape shows, passing env to access KV storage for state persistence
      const newShows: Show[] = [];
      const shows = await scrapeShows(env);
      
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
      if (newShows.length > 0 && telegram && notificationChannelId) {
        logDebug(`Sending notifications for ${newShows.length} new shows to channel ${notificationChannelId}`);
        
        try {
          // Send message to channel about new shows, but limit to 5 to avoid excessive API calls
          const maxNotifications = Math.min(newShows.length, 5);
          for (let i = 0; i < maxNotifications; i++) {
            try {
              const show = newShows[i];
              const message = showFormatter.format(show);
              message.text = `🔔 *Нова вистава додана!*\n\n${message.text}`;
              
              await telegram.sendMessage(notificationChannelId, message);
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
              await telegram.sendMessage(notificationChannelId, {
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
        if (!telegram) {
          logDebug('Found new shows but no Telegram token available for notifications');
        } else if (!notificationChannelId) {
          logDebug('Found new shows but no notification channel ID specified');
        }
      } else {
        logDebug('No new shows found');
      }
    } catch (error) {
      console.error('Error in scheduled job:', error);
    }
  }
}; 