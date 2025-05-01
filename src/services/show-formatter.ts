import type { Show, ShowFormatter, FormattedMessage } from '../types.js';

export class DefaultShowFormatter implements ShowFormatter {
  format(show: Show): FormattedMessage {
    const dates = show.dates.map((date) => `🗓 ${date}`).join('\n');
    const soldOutText = show.soldOut ? '\n🔴 КВИТКИ ПРОДАНО' : '\n🟢 Квитки в продажу';
    
    return {
      text: `[${show.title}](${show.url})\n${dates}${soldOutText}`,
      ticketUrl: !show.soldOut ? show.ticketUrl : undefined,
      imageUrl: show.imageUrl
    };
  }
} 