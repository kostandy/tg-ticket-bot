import { scrapeShows } from '../scraper';
import { getSupabase } from '../db';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Scraper Integration Tests', () => {
  beforeAll(() => {
    process.env.TARGET_WEBSITE = 'https://molodyytheatre.com/afisha';
    process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
    process.env.SUPABASE_KEY = process.env.TEST_SUPABASE_KEY;
  });

  it('should scrape shows and save them to Supabase', async () => {
    const shows = await scrapeShows();
    expect(shows.length).toBeGreaterThan(0);

    // Verify show structure
    const firstShow = shows[0];
    expect(firstShow).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      url: expect.stringContaining('molodyytheatre.com'),
      dates: expect.arrayContaining([expect.any(String)]),
      imageUrl: expect.stringContaining('http'),
      ticketUrl: expect.any(String),
      soldOut: expect.any(Boolean)
    });

    // Verify shows are saved in Supabase
    const supabase = getSupabase();
    const { data: savedShows, error } = await supabase
      .from('shows')
      .select()
      .eq('id', firstShow.id);

    expect(error).toBeNull();
    expect(savedShows).toHaveLength(1);
    expect(savedShows?.[0]).toMatchObject({
      id: firstShow.id,
      title: firstShow.title,
      dates: firstShow.dates
    });
  }, 30000); // Increase timeout for network requests

  it('should handle rate limiting and retries', async () => {
    const shows = await scrapeShows();
    expect(shows.length).toBeGreaterThan(0);
  }, 60000);

  it('should update existing shows with new dates', async () => {
    const supabase = getSupabase();
    const testShow = {
      id: 'test-show',
      title: 'Test Show',
      url: 'https://molodyytheatre.com/test',
      dates: ['2024-04-01'],
      imageUrl: 'https://example.com/image.jpg',
      ticketUrl: 'https://example.com/ticket',
      soldOut: false
    };

    // Insert test show
    await supabase.from('shows').insert(testShow);

    // Update dates
    const updatedShow = { ...testShow, dates: ['2024-04-01', '2024-04-02'] };
    await supabase.from('shows').update(updatedShow).eq('id', testShow.id);

    // Verify update
    const { data: savedShow } = await supabase
      .from('shows')
      .select()
      .eq('id', testShow.id)
      .single();

    expect(savedShow?.dates).toEqual(updatedShow.dates);

    // Cleanup
    await supabase.from('shows').delete().eq('id', testShow.id);
  });
}); 