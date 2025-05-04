import type { TelegramMessage } from './types.js';
import { TelegramService } from './services/telegram.js';
import { DefaultShowFormatter } from './services/show-formatter.js';
import { SupabaseShowRepository } from './repositories/show.repository.js';

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing Telegram bot token');
}

const telegram = new TelegramService(process.env.TELEGRAM_BOT_TOKEN);
const showFormatter = new DefaultShowFormatter();
const showRepository = new SupabaseShowRepository();

export const handleStart = async (msg: TelegramMessage) => {
  await telegram.sendMessage(msg.chat.id, {
    text: 'Привіт! Я допоможу тобі слідкувати за квитками в Молодий театр.'
  });
};

export const handlePosters = async (msg: TelegramMessage) => {
  try {
    const shows = await showRepository.findAll();
    if (!shows.length) {
      await telegram.sendMessage(msg.chat.id, { text: 'Наразі немає доступних вистав' });
      return;
    }

    const messages = shows.map(show => showFormatter.format(show));
    for (const message of messages) {
      await telegram.sendMessage(msg.chat.id, message);
    }
  } catch (error) {
    console.error('Failed to handle posters:', error);
    await telegram.sendMessage(msg.chat.id, { text: 'Не вдалося отримати список вистав' });
  }
};

export const handleUpcoming = async (msg: TelegramMessage) => {
  try {
    const shows = await showRepository.findAvailable();
    if (!shows.length) {
      await telegram.sendMessage(msg.chat.id, { text: 'Наразі немає доступних вистав' });
      return;
    }

    const messages = shows.map(show => showFormatter.format(show));
    for (const message of messages) {
      await telegram.sendMessage(msg.chat.id, message);
    }
  } catch (error) {
    console.error('Failed to handle upcoming:', error);
    await telegram.sendMessage(msg.chat.id, { text: 'Не вдалося отримати список вистав' });
  }
};