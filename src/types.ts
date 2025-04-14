import type { Message } from 'node-telegram-bot-api';

export interface Show {
  id: string;
  title: string;
  url: string;
  dates: string[];
}

export interface UserSubscription {
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
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  TARGET_WEBSITE: string;
  CHECK_INTERVAL: string;
}

export interface TelegramUpdate {
  message: Message;
} 