import type { Show, ShowFormatter, FormattedMessage } from '../types.js';

export class DefaultShowFormatter implements ShowFormatter {
  format(show: Show): FormattedMessage {
    const datesList = show.dates.map(date => {
      const soldOut = show.soldOutByDate[date] ? ' (Sold Out)' : '';
      return `- ${date}${soldOut}`;
    }).join('\n');

    const text = `*${show.title}*\n\nDates:\n${datesList}`;

    return {
      text,
      ticketUrl: show.ticketUrl,
      imageUrl: show.imageUrl,
      parse_mode: 'Markdown'
    };
  }
} 