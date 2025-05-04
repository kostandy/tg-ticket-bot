import { handleStart, handlePosters, handleUpcoming } from './bot.js';
import { scrapeShows } from './scraper.js';
import { initSupabase, getSupabase } from './db.js';
import type { Env, TelegramUpdate } from './types.js';

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

    const shows = await scrapeShows();
    const supabase = getSupabase();
    const { data: existingShows, error: selectError } = await supabase.from('shows').select();
    if (selectError) {
      console.error('Failed to fetch existing shows:', selectError);
      return;
    }
    console.log('Existing shows:', JSON.stringify(existingShows, null, 2));

    for (const show of shows) {
      const existingShow = existingShows?.find((s) => s.title === show.title);
      if (!existingShow) {
        console.log('Inserting new show:', JSON.stringify(show, null, 2));
        const { error: insertError, data: insertData } = await supabase.from('shows').insert(show);
        if (insertError) {
          console.error('Failed to insert show:', insertError);
          console.error('Insert error details:', {
            code: insertError.code,
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint
          });
        } else {
          console.log('Successfully inserted show:', insertData);
        }
      } else if (existingShow.date !== show.date) {
        console.log('Updating show date:', {
          showId: existingShow.id,
          oldDate: existingShow.date,
          newDate: show.date
        });
        const { error: updateError, data: updateData } = await supabase
          .from('shows')
          .update({ date: show.date })
          .eq('id', show.id);
        if (updateError) {
          console.error('Failed to update show:', updateError);
          console.error('Update error details:', {
            code: updateError.code,
            message: updateError.message,
            details: updateError.details,
            hint: updateError.hint
          });
        } else {
          console.log('Successfully updated show:', updateData);
        }
      }
    }
  }
}; 