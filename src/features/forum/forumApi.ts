// FRAUDE forumu — Supabase veri katmanı.
//
// Şema: docs/supabase-forum.sql (forum_posts + forum_likes + trending RPC).
// Yazar adı, sayaçlar ve etiket normalleştirmesi sunucudaki tetikleyicilerde
// yapılır; burada gönderilen `author_name`/`like_count` gibi alanlar zaten
// yok sayılır. Bu yüzden istemci yalnız gövde, etiket ve yanıt bağını yollar.

import { supabase } from '../auth/supabaseClient';

export interface ForumPost {
  id: string;
  userId: string;
  authorName: string;
  parentId: string | null;
  body: string;
  tickers: string[];
  replyCount: number;
  likeCount: number;
  /** Oturumdaki kullanıcı beğenmiş mi (ayrı sorgudan birleştirilir). */
  likedByMe: boolean;
  editedAt: string | null;
  createdAt: string;
}

/** Kullanıcıya farklı mesaj gösterilmesi gereken hata sınıfları. */
export type ForumError = 'auth' | 'rate-limit' | 'not-installed' | 'network' | 'unknown';

interface PostRow {
  id: string;
  user_id: string;
  author_name: string;
  parent_id: string | null;
  body: string;
  tickers: string[] | null;
  reply_count: number;
  like_count: number;
  edited_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, user_id, author_name, parent_id, body, tickers, reply_count, like_count, edited_at, created_at';

export const MAX_BODY_LENGTH = 4000;
export const MAX_TICKERS = 8;

// Sunucudaki forum_normalize_tickers ile aynı kabul aralığı: BIST kodları
// (THYAO), endeksler (XU100, ^GSPC), döviz/emtia kotasyonları (USDTRY=X, GC=F)
// ve kripto (BTC-USD). "En az bir harf" koşulu "$100" gibi tutarları eler.
const TICKER_SHAPE = /^[A-Z0-9^][A-Z0-9.=^-]{1,15}$/;
/** Metinde $KOD / #KOD biçiminde geçen etiketleri yakalar. */
const TICKER_MENTION = /[$#]([A-Za-z0-9^][A-Za-z0-9.=^-]{1,15})/g;

export function isValidTicker(value: string): boolean {
  const symbol = value.trim().toUpperCase();
  return TICKER_SHAPE.test(symbol) && /[A-Z]/.test(symbol);
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

/** Gövdedeki $KOD / #KOD anmalarını sırayı koruyarak tekilleştirir. */
export function extractTickers(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(TICKER_MENTION)) {
    const symbol = normalizeTicker(match[1]);
    if (isValidTicker(symbol) && !found.includes(symbol)) found.push(symbol);
  }
  return found;
}

export type BodyToken =
  | { kind: 'text'; value: string }
  | { kind: 'ticker'; value: string; symbol: string };

/**
 * Gövdeyi düz metin ve hisse anması parçalarına böler; kart bu parçalardan
 * tıklanabilir rozet çizer. Dizinler her zaman özgün metinden okunur —
 * büyük/küçük harfe çevrilmiş bir kopyadan alınan konum Türkçe 'İ'de bayt
 * uzunluğunu değiştirip kaymaya yol açar.
 */
export function splitBody(body: string): BodyToken[] {
  const tokens: BodyToken[] = [];
  let cursor = 0;
  for (const match of body.matchAll(TICKER_MENTION)) {
    const start = match.index ?? 0;
    const symbol = normalizeTicker(match[1]);
    if (!isValidTicker(symbol)) continue;
    if (start > cursor) tokens.push({ kind: 'text', value: body.slice(cursor, start) });
    tokens.push({ kind: 'ticker', value: match[0], symbol });
    cursor = start + match[0].length;
  }
  if (cursor < body.length) tokens.push({ kind: 'text', value: body.slice(cursor) });
  return tokens;
}

function toPost(row: PostRow, likedIds: Set<string>): ForumPost {
  return {
    id: row.id,
    userId: row.user_id,
    authorName: row.author_name,
    parentId: row.parent_id,
    body: row.body,
    tickers: row.tickers ?? [],
    replyCount: row.reply_count,
    likeCount: row.like_count,
    likedByMe: likedIds.has(row.id),
    editedAt: row.edited_at,
    createdAt: row.created_at,
  };
}

export function classifyError(error: { code?: string; message?: string } | null): ForumError {
  if (!error) return 'unknown';
  const code = error.code ?? '';
  const message = (error.message ?? '').toLowerCase();
  // Şema henüz yapıştırılmamış: PostgREST tabloyu/görünümü bulamaz.
  if (code === '42P01' || code === 'PGRST205' || message.includes('does not exist')) return 'not-installed';
  if (code === '42501' || message.includes('oturum gerekli') || message.includes('row-level security')) return 'auth';
  if (code === 'P0001' || message.includes('çok hızlı')) return 'rate-limit';
  if (message.includes('fetch') || message.includes('network')) return 'network';
  return 'unknown';
}

const ERROR_KEYS: Record<ForumError, string> = {
  auth: 'forumErrorAuth',
  'rate-limit': 'forumErrorRate',
  'not-installed': 'forumErrorSchema',
  network: 'forumErrorNetwork',
  unknown: 'forumErrorUnknown',
};

/** Yakalanan hatayı doğrudan i18n anahtarına çevirir. */
export function forumErrorKey(error: unknown): string {
  return ERROR_KEYS[classifyError(error as { code?: string; message?: string } | null)];
}

/** Verilen gönderilerden oturum sahibinin beğendiklerini işaretler. */
async function loadLikes(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return new Set();
  const { data } = await supabase
    .from('forum_likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', ids);
  return new Set((data ?? []).map((row) => (row as { post_id: string }).post_id));
}

export interface ForumQuery {
  /** Dolu ise yalnız bu hisseyi etiketleyen konular gelir. */
  ticker?: string | null;
  /** Gövde ve yazar adında arama. */
  search?: string | null;
  limit?: number;
  /** Sayfalama imleci: bu tarihten eskiler. */
  before?: string | null;
}

export interface ForumPage {
  posts: ForumPost[];
  /** Sunucu `limit` kadar satır döndürdüyse devamı olabilir. */
  hasMore: boolean;
}

/** Kök konular (yanıtlar hariç), yeniden eskiye. */
export async function listPosts(query: ForumQuery = {}): Promise<ForumPage> {
  const limit = query.limit ?? 25;
  let request = supabase
    .from('forum_posts')
    .select(COLUMNS)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (query.ticker) request = request.contains('tickers', [normalizeTicker(query.ticker)]);
  if (query.before) request = request.lt('created_at', query.before);
  if (query.search) {
    // PostgREST'in or() söz dizimi virgül ve parantezle ayrılır; arama metni
    // bunları taşıyorsa filtre bozulur, bu yüzden söz dizimi karakterleri düşer.
    const safe = query.search.replace(/[,()%*\\]/g, ' ').trim();
    if (safe) request = request.or(`body.ilike.%${safe}%,author_name.ilike.%${safe}%`);
  }

  const { data, error } = await request;
  if (error) throw error;
  const rows = (data ?? []) as PostRow[];
  const liked = await loadLikes(rows.map((row) => row.id));
  return { posts: rows.map((row) => toPost(row, liked)), hasMore: rows.length >= limit };
}

/** Bir kök konunun yanıtları, eskiden yeniye. */
export async function listReplies(rootId: string): Promise<ForumPost[]> {
  const { data, error } = await supabase
    .from('forum_posts')
    .select(COLUMNS)
    .eq('parent_id', rootId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as PostRow[];
  const liked = await loadLikes(rows.map((row) => row.id));
  return rows.map((row) => toPost(row, liked));
}

export interface NewPost {
  body: string;
  /** Elle seçilen etiketler; gövdedeki $KOD anmaları ayrıca eklenir. */
  tickers?: string[];
  parentId?: string | null;
}

export async function createPost(input: NewPost): Promise<ForumPost> {
  const body = input.body.trim();
  const tickers = Array.from(new Set([
    ...(input.tickers ?? []).map(normalizeTicker).filter(isValidTicker),
    ...extractTickers(body),
  ])).slice(0, MAX_TICKERS);

  const { data, error } = await supabase
    .from('forum_posts')
    .insert({ body, tickers, parent_id: input.parentId ?? null })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toPost(data as PostRow, new Set());
}

/** Yumuşak silme: satır iş parçacığı için kalır, gövdeyi sunucu boşaltır. */
export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase
    .from('forum_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function setLike(postId: string, liked: boolean): Promise<void> {
  if (liked) {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) throw { code: '42501', message: 'oturum gerekli' };
    const { error } = await supabase.from('forum_likes').insert({ post_id: postId, user_id: userId });
    // Çift tık yarışında birincil anahtar çakışır; beğeni zaten duruyordur.
    if (error && error.code !== '23505') throw error;
    return;
  }
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return;
  const { error } = await supabase
    .from('forum_likes')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) throw error;
}

export interface TrendingTicker {
  ticker: string;
  posts: number;
  lastAt: string;
}

export async function trendingTickers(hours = 168, limit = 10): Promise<TrendingTicker[]> {
  const { data, error } = await supabase.rpc('forum_trending_tickers', { p_hours: hours, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as Array<{ ticker: string; posts: number; last_at: string }>).map((row) => ({
    ticker: row.ticker,
    posts: Number(row.posts),
    lastAt: row.last_at,
  }));
}

/**
 * Başka kullanıcıların gönderileri açık ekrana düşsün diye canlı yayın.
 * Yayın projede kapalıysa abonelik sessizce başarısız olur — çağıran taraf
 * ayrıca yoklama yaptığı için akış yine tazelenir.
 */
export function subscribeForum(onChange: () => void): () => void {
  const channel = supabase
    .channel(`forum-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forum_posts' }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
