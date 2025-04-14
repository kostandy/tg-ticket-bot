import { handleStart, handleSubscribe, notifySubscribers } from './bot';
import { scrapeShows } from './scraper';
import { supabase } from './db';
import type { Env, TelegramUpdate } from './types';

const checkInterval = Number.parseInt(process.env.CHECK_INTERVAL || '3600', 10);
const subscribeRegex = /\/subscribe (\d+)/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
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
  
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const shows = await scrapeShows();
    const { data: existingShows } = await supabase.from('shows').select();
    
    if (!existingShows) return;
    
    for (const show of shows) {
      const existing = existingShows.find(s => s.id === show.id);
      
      if (!existing) {
        await supabase.from('shows').insert(show);
        continue;
      }
      
      const newDates = show.dates.filter(d => !existing.dates.includes(d));
      
      if (newDates.length > 0) {
        await supabase.from('shows').update({ dates: show.dates }).eq('id', show.id);
        await notifySubscribers(show);
      }
    }
  }
}; 