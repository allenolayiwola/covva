import { z } from 'zod';

// Direct property access is required for Expo's public environment substitution.
export const env = z.object({
  supabaseUrl: z.url(),
  supabaseKey: z.string().min(1),
  apiBaseUrl: z.url(),
  siteUrl: z.url(),
}).parse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  siteUrl: process.env.EXPO_PUBLIC_SITE_URL,
});
