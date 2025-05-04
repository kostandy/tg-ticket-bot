import type { Show, ShowRepository } from '../types.js';
import { getSupabase } from '../db.js';

export class SupabaseShowRepository implements ShowRepository {
  async findAll(): Promise<Show[]> {
    const { data, error } = await getSupabase().from('shows').select();
    if (error) {
      console.error('Failed to fetch shows:', error);
      throw new Error('Failed to fetch shows');
    }
    
    // Convert date strings to Date objects
    return (data || []).map(this.processShowDates);
  }

  async findAvailable(): Promise<Show[]> {
    const { data, error } = await getSupabase()
      .from('shows')
      .select()
      .eq('soldOut', false)
      .order('date', { ascending: true });

    if (error) {
      console.error('Failed to fetch available shows:', error);
      throw new Error('Failed to fetch available shows');
    }
    
    // Convert date strings to Date objects
    return (data || []).map(this.processShowDates);
  }

  async save(show: Show): Promise<void> {
    // Convert Date to ISO string for database
    const processedShow = this.prepareShowForDb(show);
    
    const { error } = await getSupabase().from('shows').insert(processedShow);
    if (error) {
      console.error('Failed to save show:', error);
      throw new Error('Failed to save show');
    }
  }

  async update(show: Show): Promise<void> {
    // Convert Date to ISO string for database
    const processedShow = this.prepareShowForDb(show);
    
    const { error } = await getSupabase()
      .from('shows')
      .update(processedShow)
      .eq('id', show.id);

    if (error) {
      console.error('Failed to update show:', error);
      throw new Error('Failed to update show');
    }
  }
  
  // Helper method to convert database date strings to Date objects
  private processShowDates(show: Omit<Show, 'date'> & { date: string | Date }): Show {
    return {
      ...show,
      date: show.date ? new Date(show.date) : new Date()
    };
  }
  
  // Helper method to prepare show for database storage
  private prepareShowForDb(show: Show): Omit<Show, 'date'> & { date: string } {
    // Create a copy of the show object
    const { date, ...rest } = show;
    
    // Convert Date to ISO date string for database storage
    return {
      ...rest,
      date: date instanceof Date ? date.toISOString().split('T')[0] : new Date(date).toISOString().split('T')[0]
    };
  }
} 