import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';
import type { Database } from '@im/db';
import { env } from './env';
import { LargeSecureStore } from './large-secure-store';

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
  auth: { lock: processLock, storage: LargeSecureStore, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
