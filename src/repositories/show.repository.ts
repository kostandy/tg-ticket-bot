import type { Show, ShowRepository } from '../types.js';
import { getSupabase } from '../db.js';

export class SupabaseShowRepository implements ShowRepository {
  async findAll(): Promise<Show[]> {
    const { data, error } = await getSupabase().from('shows').select();
    if (error) {
      console.error('Failed to fetch shows:', error);
      throw new Error('Failed to fetch shows');
    }
    
    // Convert datetime strings to Date objects
    return (data || []).map(this.processShowDates);
  }

  async findAvailable(): Promise<Show[]> {
    const { data, error } = await getSupabase()
      .from('shows')
      .select()
      .eq('soldOut', false)
      .order('datetime', { ascending: true });

    if (error) {
      console.error('Failed to fetch available shows:', error);
      throw new Error('Failed to fetch available shows');
    }
    
    // Convert datetime strings to Date objects
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
  
  // Helper method to convert database datetime strings to Date objects
  private processShowDates(show: Omit<Show, 'datetime'> & { datetime: string | Date }): Show {
    return {
      ...show,
      datetime: show.datetime ? new Date(show.datetime) : new Date()
    };
  }
  
  // Helper method to prepare show for database storage
  private prepareShowForDb(show: Show): Omit<Show, 'datetime'> & { datetime: string } {
    // Create a copy of the show object
    const { datetime, ...rest } = show;
    
    // Convert Date to ISO string for database storage
    return {
      ...rest,
      datetime: datetime instanceof Date ? datetime.toISOString() : new Date(datetime).toISOString()
    };
  }
} 