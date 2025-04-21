import type { SubscriptionRepository } from '../types';
import { getSupabase } from '../db';

export class SupabaseSubscriptionRepository implements SubscriptionRepository {
  async subscribe(chatId: number, showId: string): Promise<void> {
    const subscription = {
      chat_id: chatId,
      show_id: showId,
    };

    const { error } = await getSupabase().from('subscriptions').insert(subscription);
    if (error) {
      console.error('Failed to save subscription:', error);
      throw new Error('Failed to save subscription');
    }
  }

  async unsubscribe(chatId: number, showId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('subscriptions')
      .delete()
      .eq('chat_id', chatId)
      .eq('show_id', showId);

    if (error) {
      console.error('Failed to delete subscription:', error);
      throw new Error('Failed to delete subscription');
    }
  }

  async findByShowId(showId: string): Promise<{ chatId: number }[]> {
    const { data, error } = await getSupabase()
      .from('subscriptions')
      .select('chat_id')
      .eq('show_id', showId);

    if (error) {
      console.error('Failed to fetch subscriptions:', error);
      throw new Error('Failed to fetch subscriptions');
    }

    return (data || []).map(sub => ({ chatId: sub.chat_id }));
  }
} 