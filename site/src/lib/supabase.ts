import { createClient } from '@supabase/supabase-js';

// Uygulamadaki src/features/auth/supabaseClient.ts ile aynı proje; publishable
// anahtar istemciye gömülmek için tasarlanmıştır, güvenlik RLS + RPC'lerde.
const SUPABASE_URL = 'https://frfbmutvkekctpacktlz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_81cO3RIzZWVQ1jsTZ2FLYA_1csYKTfM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
