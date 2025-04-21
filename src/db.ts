/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

console.log('Initializing Supabase client with URL:', supabaseUrl);
export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
console.log('Supabase client initialized'); 