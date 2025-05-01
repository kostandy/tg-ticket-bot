export interface Show {
  id: string;
  title: string;
  url: string;
  dates: string[];
  soldOut?: boolean;
  ticketUrl?: string;
  imageUrl?: string;
}

export interface UserSubscription {
  id: string;
  userId: number;
  showId: string;
  chatId: number;
}

export interface Database {
  public: {
    Tables: {
      subscriptions: {
        Row: UserSubscription;
        Insert: Omit<UserSubscription, 'id'>;
        Update: Partial<UserSubscription>;
      };
      shows: {
        Row: Show;
        Insert: Omit<Show, 'id'>;
        Update: Partial<Show>;
      };
    };
  };
}

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot: boolean;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface MessageEntity {
  type: 'mention' | 'hashtag' | 'bot_command' | 'url' | 'bold' | 'italic' | 'code' | 'pre' | 'text_link';
  offset: number;
  length: number;
  url?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: MessageEntity[];
  photo?: {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
}

export interface ReplyMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface FormattedMessage {
  text: string;
  ticketUrl?: string;
  imageUrl?: string;
  parse_mode?: 'Markdown' | 'HTML';
  disable_notification?: boolean;
  reply_markup?: ReplyMarkup;
}

export interface ShowFormatter {
  format(show: Show): FormattedMessage;
}

export interface ShowRepository {
  findAll(): Promise<Show[]>;
  findAvailable(): Promise<Show[]>;
  save(show: Show): Promise<void>;
  update(show: Show): Promise<void>;
}

export interface SubscriptionRepository {
  subscribe(chatId: number, showId: string): Promise<void>;
  unsubscribe(chatId: number, showId: string): Promise<void>;
  findByShowId(showId: string): Promise<{ chatId: number }[]>;
} 