import { handleStart, handleSubscribe } from './bot';
import { scrapeShows } from './scraper';
import { initSupabase, getSupabase } from './db';
import type { Env, TelegramUpdate } from './types';

const subscribeRegex = /\/subscribe (\d+)/;

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

      if (msg.text === '/start') {
        await handleStart(msg);
      } else if (msg.text?.startsWith('/subscribe')) {
        const match = subscribeRegex.exec(msg.text);
        await handleSubscribe(msg, match);
      }

      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async scheduled(_: any, env: Env) {
    console.log('Starting scheduled job');
    console.log('Supabase URL:', env.SUPABASE_URL);
    console.log('Supabase key length:', env.SUPABASE_KEY?.length);
    console.log('Env:', env);
    initSupabase(env);

    const shows = await scrapeShows();
    console.log('Scraped shows:', JSON.stringify(shows, null, 2));

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
      } else if (JSON.stringify(existingShow.dates) !== JSON.stringify(show.dates)) {
        console.log('Updating show dates:', {
          showId: existingShow.id,
          oldDates: existingShow.dates,
          newDates: show.dates
        });
        const { error: updateError, data: updateData } = await supabase
          .from('shows')
          .update({ dates: show.dates })
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