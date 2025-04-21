import { getSupabase } from './db';
import type { Show, TelegramMessage } from './types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing Telegram bot token');
}

const sendMessage = async (chatId: number, text: string, ticketUrl?: string) => {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...(ticketUrl && {
        reply_markup: {
          inline_keyboard: [[
            { text: '🎫 Купити квитки', url: `${process.env.TARGET_WEBSITE}${ticketUrl}` }
          ]]
        }
      })
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Failed to send message:', error);
    throw new Error(`Failed to send message: ${error}`);
  }
};

const formatShow = (show: Show): { text: string; ticketUrl?: string } => {
  const dates = show.dates.map((date) => `🗓 ${date}`).join('\n');
  const soldOutText = show.soldOut ? '\n🔴 КВИТКИ ПРОДАНО' : '\n🟢 Квитки в продажу';
  return {
    text: `[${show.title}](${show.url})\n${dates}${soldOutText}`,
    ticketUrl: !show.soldOut ? show.ticketUrl : undefined
  };
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
      await sendMessage(subscription.chat_id, message.text, message.ticketUrl);
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

export const handlePosters = async (msg: TelegramMessage) => {
  const supabase = getSupabase();
  const { data: shows, error } = await supabase.from('shows').select();
  
  if (error) {
    console.error('Failed to fetch shows:', error);
    await sendMessage(msg.chat.id, 'Не вдалося отримати список вистав');
    return;
  }

  if (!shows?.length) {
    await sendMessage(msg.chat.id, 'Наразі немає доступних вистав');
    return;
  }

  const messages = shows.map(formatShow);
  for (const message of messages) {
    await sendMessage(msg.chat.id, message.text, message.ticketUrl);
  }
};

export const handleUnsubscribe = async (msg: TelegramMessage, match: RegExpExecArray | null) => {
  if (!match) {
    await sendMessage(msg.chat.id, 'Будь ласка, вкажи ID вистави');
    return;
  }

  const showId = parseInt(match[1], 10);
  const supabase = getSupabase();
  const { error } = await supabase
    .from('subscriptions')
    .delete()
    .eq('chat_id', msg.chat.id)
    .eq('show_id', showId);

  if (error) {
    console.error('Failed to delete subscription:', error);
    await sendMessage(msg.chat.id, 'Не вдалося відписатися від сповіщень');
    return;
  }

  await sendMessage(msg.chat.id, 'Відписано від сповіщень про квитки');
};

export const handleUpcoming = async (msg: TelegramMessage) => {
  const supabase = getSupabase();
  const { data: shows, error } = await supabase
    .from('shows')
    .select()
    .eq('soldOut', false)
    .order('dates', { ascending: true });
  
  if (error) {
    console.error('Failed to fetch upcoming shows:', error);
    await sendMessage(msg.chat.id, 'Не вдалося отримати список вистав');
    return;
  }

  if (!shows?.length) {
    await sendMessage(msg.chat.id, 'Наразі немає доступних вистав');
    return;
  }

  const messages = shows.map(formatShow);
  for (const message of messages) {
    await sendMessage(msg.chat.id, message.text, message.ticketUrl);
  }
}; 