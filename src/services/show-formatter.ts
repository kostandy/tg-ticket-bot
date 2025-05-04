import type { Show, ShowFormatter, FormattedMessage } from '../types.js';

export class DefaultShowFormatter implements ShowFormatter {
  format(show: Show): FormattedMessage {
    const formattedDate = show.datetime instanceof Date
      ? show.datetime.toLocaleDateString('uk-UA')
      : typeof show.datetime === 'string'
        ? show.datetime
        : new Date(show.datetime).toLocaleDateString('uk-UA');
        
    const dateDisplay = show.soldOut ? `${formattedDate} (Розпродано)` : formattedDate;
    const text = `*${show.title}*\n\nДата: ${dateDisplay}`;

    return {
      text,
      ticketUrl: show.ticketUrl,
      imageUrl: show.imageUrl,
      parse_mode: 'Markdown'
    };
  }
}