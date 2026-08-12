import { createClient } from '@supabase/supabase-js';

// Uygulamadaki src/features/auth/supabaseClient.ts ile aynı proje; publishable
// anahtar istemciye gömülmek için tasarlanmıştır, güvenlik RLS + RPC'lerde.
const SUPABASE_URL = 'https://emrusyelfekcfyisfzzl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtcnVzeWVsZmVrY2Z5aXNmenpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NzQwMzcsImV4cCI6MjEwMjA1MDAzN30.384frz30oK69aZO6rwLE8Cw50vHmnlxjxbtsOg0wI9M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
