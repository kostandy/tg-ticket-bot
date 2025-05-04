import type { TelegramMessage, TelegramCallbackQuery, Show } from './types.js';
import { TelegramService } from './services/telegram.js';
import { SupabaseShowRepository } from './repositories/show.repository.js';

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('Missing Telegram bot token');
}

const telegram = new TelegramService(process.env.TELEGRAM_BOT_TOKEN);
const showRepository = new SupabaseShowRepository();

// Store user pagination state
const userPages = new Map<number, {
  shows: Show[];
  currentPage: number;
}>();

const SHOWS_PER_PAGE = 3;

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

    // Sort shows with upcoming (non-sold out) first, then by date
    const sortedShows = [...shows].sort((a, b) => {
      // Put non-sold out first
      if (a.soldOut !== b.soldOut) {
        return a.soldOut ? 1 : -1;
      }
      // Then sort by date
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    // Store the shows for this user
    userPages.set(msg.chat.id, {
      shows: sortedShows,
      currentPage: 0
    });

    // Send the first page
    await sendShowsPage(msg.chat.id, 0);
  } catch (error) {
    console.error('Failed to handle posters:', error);
    await telegram.sendMessage(msg.chat.id, { text: 'Не вдалося отримати список вистав' });
  }
};

export const handlePaginationCallback = async (query: TelegramCallbackQuery) => {
  if (!query.message || !query.data) return;
  
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const action = query.data;
  
  const userData = userPages.get(chatId);
  if (!userData) return;
  
  let { currentPage } = userData;
  const totalPages = Math.ceil(userData.shows.length / SHOWS_PER_PAGE);
  
  if (action === 'next' && currentPage < totalPages - 1) {
    currentPage++;
  } else if (action === 'prev' && currentPage > 0) {
    currentPage--;
  }
  
  // Update stored page
  userPages.set(chatId, {
    ...userData,
    currentPage
  });
  
  // Update the message with new page content
  await updateShowsPage(chatId, messageId, currentPage);
};

const sendShowsPage = async (chatId: number, page: number) => {
  const userData = userPages.get(chatId);
  if (!userData) return;
  
  const { shows } = userData;
  const totalPages = Math.ceil(shows.length / SHOWS_PER_PAGE);
  const startIdx = page * SHOWS_PER_PAGE;
  const endIdx = Math.min(startIdx + SHOWS_PER_PAGE, shows.length);
  const pageShows = shows.slice(startIdx, endIdx);
  
  const pageText = pageShows.map(show => {
    const dateDisplay = show.soldOut ? `${show.date} (Sold Out)` : show.date;
    return `*${show.title}*\nDate: ${dateDisplay}\n${show.soldOut ? '' : `🎫 [Купити квитки](https://molodyytheatre.com${show.ticketUrl})`}`;
  }).join('\n\n---\n\n');
  
  const finalText = `${pageText}\n\nСторінка ${page + 1}/${totalPages}`;
  
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '◀️ Назад', callback_data: 'prev', disabled: page === 0 },
        { text: '▶️ Вперед', callback_data: 'next', disabled: page === totalPages - 1 }
      ]
    ]
  };
  
  await telegram.sendMessage(chatId, {
    text: finalText,
    parse_mode: 'Markdown',
    reply_markup: replyMarkup
  });
};

const updateShowsPage = async (chatId: number, messageId: number, page: number) => {
  const userData = userPages.get(chatId);
  if (!userData) return;
  
  const { shows } = userData;
  const totalPages = Math.ceil(shows.length / SHOWS_PER_PAGE);
  const startIdx = page * SHOWS_PER_PAGE;
  const endIdx = Math.min(startIdx + SHOWS_PER_PAGE, shows.length);
  const pageShows = shows.slice(startIdx, endIdx);
  
  const pageText = pageShows.map(show => {
    const dateDisplay = show.soldOut ? `${show.date} (Sold Out)` : show.date;
    return `*${show.title}*\nDate: ${dateDisplay}\n${show.soldOut ? '' : `🎫 [Купити квитки](https://molodyytheatre.com${show.ticketUrl})`}`;
  }).join('\n\n---\n\n');
  
  const finalText = `${pageText}\n\nСторінка ${page + 1}/${totalPages}`;
  
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '◀️ Назад', callback_data: 'prev', disabled: page === 0 },
        { text: '▶️ Вперед', callback_data: 'next', disabled: page === totalPages - 1 }
      ]
    ]
  };
  
  await telegram.editMessageText(chatId, messageId, finalText, replyMarkup);
};

export const handleUpcoming = async (msg: TelegramMessage) => {
  try {
    const shows = await showRepository.findAvailable();
    if (!shows.length) {
      await telegram.sendMessage(msg.chat.id, { text: 'Наразі немає доступних вистав' });
      return;
    }

    // Sort by date
    const sortedShows = [...shows].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Store the shows for this user
    userPages.set(msg.chat.id, {
      shows: sortedShows,
      currentPage: 0
    });

    // Send the first page
    await sendShowsPage(msg.chat.id, 0);
  } catch (error) {
    console.error('Failed to handle upcoming:', error);
    await telegram.sendMessage(msg.chat.id, { text: 'Не вдалося отримати список вистав' });
  }
};