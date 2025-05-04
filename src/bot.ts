import type { TelegramMessage, TelegramCallbackQuery, Show } from './types.js';
import { TelegramService } from './services/telegram.js';
import { SupabaseShowRepository } from './repositories/show.repository.js';
import { scrapeShows } from './scraper.js';
import { getSupabase } from './db.js';

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

// Admin user ID from environment
let adminUserId: number | null = null;
if (process.env.TELEGRAM_BOT_ADMIN_USER_ID) {
  adminUserId = parseInt(process.env.TELEGRAM_BOT_ADMIN_USER_ID, 10);
  if (isNaN(adminUserId)) {
    console.error('Invalid TELEGRAM_BOT_ADMIN_USER_ID, admin features will be disabled');
    adminUserId = null;
  }
}

// Check if a user is an admin
const isAdmin = (userId: number): boolean => {
  return adminUserId !== null && userId === adminUserId;
};

export const handleStart = async (msg: TelegramMessage) => {
  await telegram.sendMessage(msg.chat.id, {
    text: 'Привіт! Я допоможу тобі слідкувати за квитками в Молодий театр.'
  });
};

// Admin commands
export const handleAdmin = async (msg: TelegramMessage, command: string) => {
  if (!msg.from || !isAdmin(msg.from.id)) {
    // Only send a response to the actual admin user (to avoid revealing the bot has admin features)
    if (adminUserId !== null && msg.from && msg.from.id === adminUserId) {
      await telegram.sendMessage(msg.chat.id, { 
        text: 'Недостатньо прав для виконання цієї команди.' 
      });
    }
    return;
  }

  switch (command) {
    case '/admin_stats':
      await handleAdminStats(msg);
      break;
    case '/admin_scrape':
      await handleAdminScrape(msg);
      break;
    case '/admin_clearold':
      await handleAdminClearOld(msg);
      break;
    case '/admin_help':
      await handleAdminHelp(msg);
      break;
    default:
      await telegram.sendMessage(msg.chat.id, { 
        text: 'Невідома адмін команда. Використовуйте /admin_help для списку доступних команд.' 
      });
  }
};

// Show admin stats
const handleAdminStats = async (msg: TelegramMessage) => {
  try {
    const supabase = getSupabase();
    
    // Get total shows count
    const { count: totalShows, error: countError } = await supabase
      .from('shows')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      throw new Error(`Error getting show count: ${countError.message}`);
    }
    
    // Get available shows count
    const { count: availableShows, error: availableError } = await supabase
      .from('shows')
      .select('*', { count: 'exact', head: true })
      .eq('soldOut', false);
    
    if (availableError) {
      throw new Error(`Error getting available show count: ${availableError.message}`);
    }
    
    // Get upcoming shows (future dates)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const { count: upcomingShows, error: upcomingError } = await supabase
      .from('shows')
      .select('*', { count: 'exact', head: true })
      .eq('soldOut', false)
      .gt('datetime', todayStr);
    
    if (upcomingError) {
      throw new Error(`Error getting upcoming show count: ${upcomingError.message}`);
    }
    
    // Format stats message
    const statsMessage = '📊 *Статистика*\n\n' +
      `Всього вистав: ${totalShows}\n` +
      `Доступні вистави: ${availableShows}\n` +
      `Майбутні вистави: ${upcomingShows}\n` +
      `Активних сесій: ${userPages.size}\n\n` +
      `Останнє оновлення: ${new Date().toLocaleString('uk-UA')}`;
    
    await telegram.sendMessage(msg.chat.id, {
      text: statsMessage,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error getting admin stats:', error);
    await telegram.sendMessage(msg.chat.id, {
      text: `Помилка при отриманні статистики: ${error instanceof Error ? error.message : 'Невідома помилка'}`
    });
  }
};

// Manually trigger scraping
const handleAdminScrape = async (msg: TelegramMessage) => {
  try {
    // Send initial message
    await telegram.sendMessage(msg.chat.id, {
      text: '🔄 Запуск оновлення даних...'
    });
    
    // Do the scraping
    const startTime = Date.now();
    const shows = await scrapeShows();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Report results
    await telegram.sendMessage(msg.chat.id, {
      text: `✅ Оновлення завершено за ${duration}с.\nЗнайдено ${shows.length} вистав.`,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error during admin scrape:', error);
    await telegram.sendMessage(msg.chat.id, {
      text: `❌ Помилка під час оновлення: ${error instanceof Error ? error.message : 'Невідома помилка'}`
    });
  }
};

// Clear old shows
const handleAdminClearOld = async (msg: TelegramMessage) => {
  try {
    const supabase = getSupabase();
    
    // Get today's date
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Delete shows with dates in the past
    const { error, count } = await supabase
      .from('shows')
      .delete({ count: 'exact' })
      .lt('datetime', todayStr)
      .select();
    
    if (error) {
      throw new Error(`Error deleting old shows: ${error.message}`);
    }
    
    await telegram.sendMessage(msg.chat.id, {
      text: `✅ Видалено ${count} старих вистав.`,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error clearing old shows:', error);
    await telegram.sendMessage(msg.chat.id, {
      text: `❌ Помилка при видаленні старих вистав: ${error instanceof Error ? error.message : 'Невідома помилка'}`
    });
  }
};

// Show admin help
const handleAdminHelp = async (msg: TelegramMessage) => {
  const helpText = '🔐 *Адмін команди*\n\n' +
    '*/admin_stats* - Показати статистику\n' +
    '*/admin_scrape* - Запустити оновлення даних\n' +
    '*/admin_clearold* - Видалити старі вистави\n' +
    '*/admin_help* - Показати цю довідку';
  
  await telegram.sendMessage(msg.chat.id, {
    text: helpText,
    parse_mode: 'Markdown'
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
      return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
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
    const formattedDate = show.datetime instanceof Date 
      ? show.datetime.toLocaleDateString('uk-UA')
      : typeof show.datetime === 'string' 
        ? show.datetime 
        : new Date(show.datetime).toLocaleDateString('uk-UA');
    
    const dateDisplay = show.soldOut ? `${formattedDate} (Sold Out)` : formattedDate;
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
    const formattedDate = show.datetime instanceof Date 
      ? show.datetime.toLocaleDateString('uk-UA')
      : typeof show.datetime === 'string' 
        ? show.datetime 
        : new Date(show.datetime).toLocaleDateString('uk-UA');
        
    const dateDisplay = show.soldOut ? `${formattedDate} (Sold Out)` : formattedDate;
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
      new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
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