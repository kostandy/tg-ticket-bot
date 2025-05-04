import { handleStart, handlePosters, handleUpcoming, handlePaginationCallback, handleAdmin } from './bot.js';
import { scrapeShows } from './scraper.js';
import { initSupabase, getSupabase } from './db.js';
import type { Env, TelegramUpdate, Show } from './types.js';
import { TelegramService } from './services/telegram.js';
import { DefaultShowFormatter } from './services/show-formatter.js';
import { logDebug } from './config.js';

// Make env available globally
declare global {
  var env: Env;
}

// Admin command prefix
const ADMIN_COMMANDS = ['/admin_stats', '/admin_scrape', '/admin_clearold', '/admin_help', '/admin_broadcast'];

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Verify secret token (optional but recommended)
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_BOT_SECRET) return new Response('Unauthorized', { status: 403 });

    try {
      // Make env available globally
      globalThis.env = env;
      
      // Initialize Supabase
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
      // Make env available globally
      globalThis.env = env;
      
      logDebug('Starting scheduled job');
      initSupabase(env);
      
      // Scrape shows incrementally, passing env to access KV storage
      const shows = await scrapeShows(env);
      
      // If we didn't get any shows, just exit early to save CPU time
      if (!shows.length) {
        logDebug('No shows retrieved in this execution, will try again next cron run');
        return;
      }
      
      logDebug(`Scraped ${shows.length} shows in this execution`);
      
      // Initialize Telegram service for notifications only if we have new shows
      const supabase = getSupabase();
      
      // First, fetch only IDs of existing shows to minimize payload
      const { data: existingShowIds, error: selectError } = await supabase
        .from('shows')
        .select('id');
      
      if (selectError) {
        console.error('Failed to fetch existing show IDs:', selectError);
        return;
      }
      
      // Create map of existing IDs for fast lookup
      const existingIdMap = new Map<string, boolean>();
      existingShowIds?.forEach(item => existingIdMap.set(item.id, true));
      
      // Identify new shows
      const newShows: Show[] = [];
      const showsToInsert = [];
      
      for (const show of shows) {
        // Check if show already exists by ID
        if (!existingIdMap.has(show.id)) {
          newShows.push(show);
          showsToInsert.push(show);
        }
      }
      
      // If we have new shows, insert them and send notifications
      if (showsToInsert.length > 0) {
        // Insert just one batch to stay within CPU time limits
        // The rest will be inserted on subsequent executions
        const BATCH_SIZE = 5; // Reduced batch size to stay within CPU limits
        const batchToInsert = showsToInsert.slice(0, BATCH_SIZE);
        
        try {
          const { error: insertError } = await supabase.from('shows').insert(batchToInsert);
          if (insertError) {
            console.error('Failed to insert shows batch:', insertError);
          } else {
            logDebug(`Successfully inserted ${batchToInsert.length} shows`);
          }
        } catch (error) {
          console.error('Error inserting batch of shows:', error);
        }
        
        // Send at most one notification to avoid excessive API calls
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID) {
          const notificationChannelId = parseInt(env.TELEGRAM_BOT_NOTIFICATION_CHANNEL_ID, 10);
          if (!isNaN(notificationChannelId)) {
            try {
              const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN);
              const showFormatter = new DefaultShowFormatter();
              
              // Send a notification for the first new show only
              if (newShows.length > 0) {
                const show = newShows[0];
                const message = showFormatter.format(show);
                message.text = `🔔 *Нові вистави додані!*\n\n${message.text}`;
                
                await telegram.sendMessage(notificationChannelId, message);
                
                // If there are more shows, send a summary
                if (newShows.length > 1) {
                  await telegram.sendMessage(notificationChannelId, {
                    text: `*Також додано ще ${newShows.length - 1} вистав(и). Використайте /posters щоб побачити всі.*`,
                    parse_mode: 'Markdown'
                  });
                }
              }
            } catch (error) {
              console.error('Failed to send notification:', error);
            }
          }
        }
      } else {
        logDebug('No new shows to insert in this execution');
      }
    } catch (error) {
      console.error('Error in scheduled job:', error);
    }
  }
}; 