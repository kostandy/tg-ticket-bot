import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

let supabase: ReturnType<typeof createClient<Database>>;

export function initSupabase(env: { SUPABASE_URL: string; SUPABASE_KEY: string }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    throw new Error('Missing Supabase credentials');
  }

  const url = env.SUPABASE_URL.replace(/\/$/, '');
  console.log('Initializing Supabase client with URL:', url);
  supabase = createClient<Database>(url, env.SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: { 'x-client-info': 'loop-tickets-bot' },
      fetch: (url, init) => {
        const modifiedInit = {
          ...init,
          cache: 'no-store',
          credentials: 'omit' as const
        };
        delete modifiedInit.keepalive;
        return fetch(url, modifiedInit);
      }
    },
    db: {
      schema: 'public'
    }
  });
  console.log('Supabase client initialized');
  return supabase;
}

export function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Call initSupabase first.');
  }
  return supabase;
} 