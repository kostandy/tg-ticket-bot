import { getSupabase } from './db';
import type { Show, TelegramMessage } from './types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing Telegram bot token');
}

const sendMessage = async (chatId: number, text: string) => {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Failed to send message:', error);
    throw new Error(`Failed to send message: ${error}`);
  }
};

const sendPhoto = async (chatId: number, photo: string, caption?: string, parseMode = 'Markdown') => {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
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
  await sendMessage(
    msg.chat.id,
    'Привіт! Я допоможу тобі слідкувати за квитками в Молодий театр.\n\nЩоб підписатися на сповіщення про нові квитки, використовуй команду /subscribe',
  );
};

export const handleSubscribe = async (msg: TelegramMessage, match: RegExpExecArray | null) => {
  if (!match) {
    await sendMessage(msg.chat.id, 'Будь ласка, вкажи ID вистави');
    return;
  }

  const showId = parseInt(match[1], 10);
  console.log('Subscribing to show:', { chatId: msg.chat.id, showId });

  const subscription = {
    chat_id: msg.chat.id,
    show_id: showId,
  };

  const supabase = getSupabase();
  const { error: insertError } = await supabase.from('subscriptions').insert(subscription);
  if (insertError) {
    console.error('Failed to save subscription:', {
      error: insertError,
      code: insertError.code,
      message: insertError.message,
      details: insertError.details,
      hint: insertError.hint,
      subscription
    });
    await sendMessage(msg.chat.id, 'Не вдалося підписатися на сповіщення');
    return;
  }

  console.log('Successfully subscribed:', subscription);
  await sendMessage(msg.chat.id, 'Ти підписався на сповіщення про нові квитки');
};

export const notifySubscribers = async (show: Show) => {
  console.log('Notifying subscribers for show:', JSON.stringify(show, null, 2));

  const supabase = getSupabase();
  const { data: subscriptions, error: selectError } = await supabase
    .from('subscriptions')
    .select()
    .eq('show_id', show.id);

  if (selectError) {
    console.error('Failed to fetch subscriptions:', {
      error: selectError,
      code: selectError.code,
      message: selectError.message,
      details: selectError.details,
      hint: selectError.hint,
      showId: show.id
    });
    return;
  }

  console.log('Found subscriptions:', subscriptions);

  if (!subscriptions?.length) {
    console.log('No subscribers found for show:', show.id);
    return;
  }

  const message = formatShow(show);
  for (const subscription of subscriptions) {
    try {
      await sendMessage(subscription.chat_id, message);
      console.log('Notification sent:', { chatId: subscription.chat_id, showId: show.id });
    } catch (error) {
      console.error('Failed to send notification:', {
        error,
        chatId: subscription.chat_id,
        showId: show.id
      });
    }
  }
}; 