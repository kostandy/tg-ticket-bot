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
  TARGET_WEBSITE: string;
  CHECK_INTERVAL: string;
}

export interface TelegramUpdate {
  message: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  date: number;
  text?: string;
} 