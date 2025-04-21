import { supabase } from './db';
import { scrapeShows } from './scraper';
import type { Show, UserSubscription, TelegramMessage } from './types';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN environment variable');
}

const API_URL = `https://api.telegram.org/bot${token}`;

const sendMessage = async (chatId: number, text: string, parseMode = 'Markdown') => {
  await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode })
  });
};

const sendPhoto = async (chatId: number, photo: string, caption?: string, parseMode = 'Markdown') => {
  await fetch(`${API_URL}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo, caption, parse_mode: parseMode })
  });
};

const formatShow = (show: Show): string => {
  const dates = show.dates.map((date) => `🗓 ${date}`).join('\n');
  const soldOutText = show.soldOut ? '\n🔴 КВИТКИ ПРОДАНО' : '\n🟢 Квитки в продажу';
  const ticketLink = show.ticketUrl ? `\n🎫 [Купити квитки](${show.ticketUrl})` : '';
  return `[${show.title}](${show.url})\n${dates}${soldOutText}${ticketLink}`;
};

export const handleStart = async (msg: TelegramMessage) => {
  const chatId = msg.chat.id;
  const shows = await scrapeShows();
  
  for (const show of shows) {
    if (show.imageUrl) {
      await sendPhoto(chatId, show.imageUrl, formatShow(show));
    } else {
      await sendMessage(chatId, formatShow(show));
    }
  }
  
  await sendMessage(chatId, 'Use /subscribe <number> to track a show');
};

export const handleSubscribe = async (msg: TelegramMessage, match: RegExpExecArray | null) => {
  if (!match) return;
  
  const chatId = msg.chat.id;
  const shows = await scrapeShows();
  const showIndex = Number.parseInt(match[1], 10) - 1;
  
  if (showIndex < 0 || showIndex >= shows.length) {
    await sendMessage(chatId, 'Invalid show number');
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
    await sendPhoto(chatId, show.imageUrl, `You are now tracking:\n${formatShow(show)}`);
  } else {
    await sendMessage(chatId, `You are now tracking:\n${formatShow(show)}`);
  }
};

export const notifySubscribers = async (show: Show) => {
  console.log('Notifying subscribers for', show);

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select()
    .eq('showId', show.id);
    
  if (!subscriptions) return;
  
  for (const sub of subscriptions) {
    if (show.imageUrl) {
      await sendPhoto(sub.chatId, show.imageUrl, `New dates available for:\n${formatShow(show)}`);
    } else {
      await sendMessage(sub.chatId, `New dates available for:\n${formatShow(show)}`);
    }
  }
}; 