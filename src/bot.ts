import TelegramBot from 'node-telegram-bot-api';
import { supabase } from './db';
import { scrapeShows } from './scraper';
import type { Show, UserSubscription } from './types';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN environment variable');
}

const bot = new TelegramBot(token, { polling: true });

const formatShow = (show: Show): string => {
  const dates = show.dates.map((date) => `🗓 ${date}`).join('\n');
  const soldOutText = show.soldOut ? '\n🔴 КВИТКИ ПРОДАНО' : '\n🟢 Квитки в продажу';
  const ticketLink = show.ticketUrl ? `\n🎫 [Купити квитки](${show.ticketUrl})` : '';
  return `[${show.title}](${show.url})\n${dates}${soldOutText}${ticketLink}`;
};

export const handleStart = async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  const shows = await scrapeShows();
  
  for (const show of shows) {
    if (show.imageUrl) {
      await bot.sendPhoto(chatId, show.imageUrl, {
        caption: formatShow(show),
        parse_mode: 'Markdown'
      });
    } else {
      await bot.sendMessage(chatId, formatShow(show), {
        parse_mode: 'Markdown'
      });
    }
  }
  
  await bot.sendMessage(chatId, 'Use /subscribe <number> to track a show');
};

export const handleSubscribe = async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!match) return;
  
  const chatId = msg.chat.id;
  const shows = await scrapeShows();
  const showIndex = Number.parseInt(match[1], 10) - 1;
  
  if (showIndex < 0 || showIndex >= shows.length) {
    await bot.sendMessage(chatId, 'Invalid show number');
    return;
  }
  
  const show = shows[showIndex];
  const subscription: Omit<UserSubscription, 'id'> = {
    userId: msg.from?.id || 0,
    showId: show.id,
    chatId
  };
  
  await supabase.from('subscriptions').insert(subscription);
  
  if (show.imageUrl) {
    await bot.sendPhoto(chatId, show.imageUrl, {
      caption: `You are now tracking:\n${formatShow(show)}`,
      parse_mode: 'Markdown'
    });
  } else {
    await bot.sendMessage(chatId, `You are now tracking:\n${formatShow(show)}`, {
      parse_mode: 'Markdown'
    });
  }
};

export const notifySubscribers = async (show: Show) => {
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select()
    .eq('showId', show.id);
    
  if (!subscriptions) return;
  
  for (const sub of subscriptions) {
    if (show.imageUrl) {
      await bot.sendPhoto(sub.chatId, show.imageUrl, {
        caption: `New dates available for:\n${formatShow(show)}`,
        parse_mode: 'Markdown'
      });
    } else {
      await bot.sendMessage(sub.chatId, `New dates available for:\n${formatShow(show)}`, {
        parse_mode: 'Markdown'
      });
    }
  }
}; 