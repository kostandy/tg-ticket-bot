import type { Show, ShowRepository } from '../types';
import { getSupabase } from '../db';

export class SupabaseShowRepository implements ShowRepository {
  async findAll(): Promise<Show[]> {
    const { data, error } = await getSupabase().from('shows').select();
    if (error) {
      console.error('Failed to fetch shows:', error);
      throw new Error('Failed to fetch shows');
    }
    return data || [];
  }

  async findAvailable(): Promise<Show[]> {
    const { data, error } = await getSupabase()
      .from('shows')
      .select()
      .eq('soldOut', false)
      .order('dates', { ascending: true });

    if (error) {
      console.error('Failed to fetch available shows:', error);
      throw new Error('Failed to fetch available shows');
    }
    return data || [];
  }

  async save(show: Show): Promise<void> {
    const { error } = await getSupabase().from('shows').insert(show);
    if (error) {
      console.error('Failed to save show:', error);
      throw new Error('Failed to save show');
    }
  }

  async update(show: Show): Promise<void> {
    const { error } = await getSupabase()
      .from('shows')
      .update(show)
      .eq('id', show.id);

    if (error) {
      console.error('Failed to update show:', error);
      throw new Error('Failed to update show');
    }
  }
} 