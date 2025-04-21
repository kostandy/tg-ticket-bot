import * as cheerio from 'cheerio';
import type { Show } from './types';

const targetWebsite = process.env.TARGET_WEBSITE;

if (!targetWebsite) {
  throw new Error('Missing TARGET_WEBSITE environment variable');
}

export const scrapeShows = async (): Promise<Show[]> => {
  console.info('Scraping shows from', targetWebsite);
  const response = await fetch(targetWebsite);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const shows: Show[] = [];
  
  /**
   * Example of a raw show item:
   * 
   * <div class="views-row views-row-1 views-row-odd">
   * 
   * <div class="views-field views-field-field-time">        <div class="field-content"><span class="t1">22</span><span class="t2">квітня, вівторок</span><span class="t3">18:00</span></div>  </div>  
  <div class="views-field views-field-field-label">        <div class="field-content">квитки продано</div>  </div>  
  <div class="views-field views-field-nothing">        <span class="field-content"><a href="/tickets/4315/2025-04-22%2018%3A00%3A00"> <button class="btn btn-danger" type="button">Купити квитки</button></a></span>  </div>  
  <div class="views-field views-field-field-images">        <div class="field-content"><a href="/repertoire/zamah-na-samotnist"><img class="img-responsive" src="https://molodyytheatre.com/sites/default/files/styles/slider/public/repertoire/1_223.jpg?itok=_v_LLPQv" width="1140" height="568" alt="Замах на самотність" title="Замах на самотність"></a></div>  </div>  
  <div class="views-field views-field-field-age">        <div class="field-content">16+</div>  </div>  
  <div class="views-field views-field-field-category">        <div class="field-content">Мікросцена</div>  </div>  
  <div class="views-field views-field-field-event-title">        <div class="field-content"><a href="/repertoire/zamah-na-samotnist">Замах на самотність</a></div>  </div>  
  <div class="views-field views-field-field-author">    <span class="views-label views-label-field-author">Автор</span>    <div class="field-content">Ханох Левін</div>  </div>  
  <div class="views-field views-field-field-director2">    <span class="views-label views-label-field-director2">Режисерка</span>    <div class="field-content">Дарія Назаренко</div>  </div>  
  <div class="views-field views-field-field-genre">    <span class="views-label views-label-field-genre">Жанр</span>    <div class="field-content">Непристойна комедія без антракту</div>  </div>  
  <div class="views-field views-field-nid">        <span class="field-content"><a href="/repertoire/zamah-na-samotnist">&nbsp;</a></span>  </div>  </div>
   */

  $('.views-row').each((_, element) => {
    const $el = $(element);
    const title = $el.find('.views-field-field-event-title .field-content a').text().trim();
    const url = $el.find('.views-field-field-event-title .field-content a').attr('href') || '';
    const dates = $el.find('.views-field-field-time .field-content').map((_, date) => $(date).text().trim()).get();
    const imageUrl = $el.find('.views-field-field-images img').attr('src') || '';
    const ticketUrl = $el.find('.views-field-nothing a').attr('href') || '';
    const soldOut = $el.find('.views-field-field-label .field-content').text().trim().toLowerCase() === 'квитки продано';
    
    if (title && url) {
      shows.push({
        id: url,
        title,
        url,
        dates,
        imageUrl,
        ticketUrl,
        soldOut
      });
    }
  });
  
  return shows;
}; 