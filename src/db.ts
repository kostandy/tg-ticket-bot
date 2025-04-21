import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

let supabase: ReturnType<typeof createClient<Database>>;

export function initSupabase(env: { SUPABASE_URL: string; SUPABASE_KEY: string }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    throw new Error('Missing Supabase credentials');
  }

  console.log('Initializing Supabase client with URL:', env.SUPABASE_URL);
  supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY);
  console.log('Supabase client initialized');
  return supabase;
}

export function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Call initSupabase first.');
  }
  return supabase;
} 