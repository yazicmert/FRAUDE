import { createClient } from '@supabase/supabase-js';

// Publishable anahtar istemciye gömülmek için tasarlanmıştır; güvenlik RLS ve
// security-definer RPC'lerde. Service-role anahtarı ASLA buraya konmaz
// (repo public) — o yalnızca scripts/.env içinde yerelde durur.
const SUPABASE_URL = 'https://frfbmutvkekctpacktlz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_81cO3RIzZWVQ1jsTZ2FLYA_1csYKTfM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
