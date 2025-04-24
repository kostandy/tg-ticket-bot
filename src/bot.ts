import type { Show, TelegramMessage } from './types';
import { TelegramService } from './services/telegram';
import { DefaultShowFormatter } from './services/show-formatter';
import { SupabaseShowRepository } from './repositories/show.repository';
import { SupabaseSubscriptionRepository } from './repositories/subscription.repository';

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing Telegram bot token');
}

const telegram = new TelegramService(process.env.TELEGRAM_BOT_TOKEN);
const showFormatter = new DefaultShowFormatter();
const showRepository = new SupabaseShowRepository();
const subscriptionRepository = new SupabaseSubscriptionRepository();

export const handleStart = async (msg: TelegramMessage) => {
  await telegram.sendMessage(msg.chat.id, {
    text: 'Привіт! Я допоможу тобі слідкувати за квитками в Молодий театр.\n\nЩоб підписатися на сповіщення про нові квитки, використовуй команду /subscribe'
  });
};

export const handleSubscribe = async (msg: TelegramMessage, match: RegExpExecArray | null) => {
  if (!match) {
    await telegram.sendMessage(msg.chat.id, { text: 'Будь ласка, вкажи ID вистави' });
    return;
  }

  const showId = parseInt(match[1], 10);
  console.log('Subscribing to show:', { chatId: msg.chat.id, showId });

  try {
    await subscriptionRepository.subscribe(msg.chat.id, showId.toString());
    await telegram.sendMessage(msg.chat.id, { text: 'Ти підписався на сповіщення про нові квитки' });
  } catch (error) {
    console.error('Subscription failed:', error);
    await telegram.sendMessage(msg.chat.id, { text: 'Не вдалося підписатися на сповіщення' });
  }
};

export const notifySubscribers = async (show: Show) => {
  console.log('Notifying subscribers for show:', JSON.stringify(show, null, 2));

  try {
    const subscribers = await subscriptionRepository.findByShowId(show.id);
    if (!subscribers.length) {
      console.log('No subscribers found for show:', show.id);
      return;
    }

    const message = showFormatter.format(show);
    for (const { chatId } of subscribers) {
      try {
        await telegram.sendMessage(chatId, message);
        console.log('Notification sent:', { chatId, showId: show.id });
      } catch (error) {
        console.error('Failed to send notification:', { error, chatId, showId: show.id });
      }
    }
  } catch (error) {
    console.error('Failed to process notifications:', error);
  }
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

export const handleUnsubscribe = async (msg: TelegramMessage, match: RegExpExecArray | null) => {
  if (!match) {
    await telegram.sendMessage(msg.chat.id, { text: 'Будь ласка, вкажи ID вистави' });
    return;
  }

  const showId = parseInt(match[1], 10);
  try {
    await subscriptionRepository.unsubscribe(msg.chat.id, showId.toString());
    await telegram.sendMessage(msg.chat.id, { text: 'Відписано від сповіщень про квитки' });
  } catch (error) {
    console.error('Failed to unsubscribe:', error);
    await telegram.sendMessage(msg.chat.id, { text: 'Не вдалося відписатися від сповіщень' });
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