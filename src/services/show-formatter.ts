import type { Show, ShowFormatter, FormattedMessage } from '../types.js';

export class DefaultShowFormatter implements ShowFormatter {
  format(show: Show): FormattedMessage {
    const dateDisplay = show.soldOut ? `${show.date} (Розпродано)` : show.date;
    const text = `*${show.title}*\n\nДата: ${dateDisplay}`;

    return {
      text,
      ticketUrl: show.ticketUrl,
      imageUrl: show.imageUrl,
      parse_mode: 'Markdown'
    };
  }
}