import TelegramBot from 'node-telegram-bot-api';
import { supabase } from './db';
import { scrapeShows } from './scraper';
import type { Show, UserSubscription } from './types';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN environment variable');
}

const bot = new TelegramBot(token, { polling: true });

export const handleStart = async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  const shows = await scrapeShows();
  
  const message = `Available shows:

${shows.map((show, index) => `${index + 1}. ${show.title}`).join('\n')}

Use /subscribe <number> to track a show`;
    
  await bot.sendMessage(chatId, message);
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
  await bot.sendMessage(chatId, `You are now tracking: ${show.title}`);
};

export const notifySubscribers = async (show: Show) => {
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select()
    .eq('showId', show.id);
    
  if (!subscriptions) return;
  
  const message = `New dates available for ${show.title}!\n${show.url}`;
  
  for (const sub of subscriptions) {
    await bot.sendMessage(sub.chatId, message);
  }
}; 