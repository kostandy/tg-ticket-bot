import type { FormattedMessage, ReplyMarkup } from '../types';

export class TelegramService {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly defaultParseMode: 'Markdown' | 'HTML' = 'Markdown';

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private async makeRequest<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to call ${method}:`, error);
      throw new Error(`Telegram API error: ${error}`);
    }

    return response.json() as Promise<T>;
  }

  private createInlineKeyboard(ticketUrl: string): ReplyMarkup {
    return {
      inline_keyboard: [[
        { text: '🎫 Купити квитки', url: `https://molodyytheatre.com${ticketUrl}` }
      ]]
    };
  }

  async sendMessage(chatId: number, message: FormattedMessage): Promise<void> {
    if (message.imageUrl) {
      try {
        await this.makeRequest('sendPhoto', {
          chat_id: chatId,
          photo: message.imageUrl,
          caption: message.text,
          parse_mode: message.parse_mode || this.defaultParseMode,
          disable_notification: message.disable_notification,
          reply_markup: message.ticketUrl ? this.createInlineKeyboard(message.ticketUrl) : message.reply_markup
        });
        return;
      } catch (error) {
        console.error('Failed to send photo, falling back to text:', error);
      }
    }

    await this.makeRequest('sendMessage', {
      chat_id: chatId,
      text: message.text,
      parse_mode: message.parse_mode || this.defaultParseMode,
      disable_notification: message.disable_notification,
      reply_markup: message.ticketUrl ? this.createInlineKeyboard(message.ticketUrl) : message.reply_markup
    });
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.makeRequest('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
    });
  }

  async editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
    await this.makeRequest('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: this.defaultParseMode,
      reply_markup: replyMarkup
    });
  }
} 