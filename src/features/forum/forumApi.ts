// FRAUDE forumu — Supabase veri katmanı.
//
// Şema: docs/supabase-forum.sql (forum_posts + forum_likes + forum_reports +
// forum_blocks + moderasyon RPC'leri).
// Yazar adı, sayaçlar, etiket normalleştirmesi ve hız sınırları sunucudaki
// tetikleyicilerde yapılır; buradan gönderilen `author_name`/`like_count` gibi
// alanlar zaten yok sayılır. Bu yüzden istemci yalnız gövde, etiket ve yanıt
// bağını yollar.
//
// Oturum bilgisi HER ZAMAN session.ts'teki yerel önbellekten okunur.
// `supabase.auth.getUser()` her çağrıda ağa çıkar; akış yüklemesi başına bir
// tur demekti, oysa kullanıcının kimliği zaten bellekte duruyor.

import { supabase } from '../auth/supabaseClient';
import { AUTH_EVENT, getSession } from '../auth/session';

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
  /** Oturumdaki kullanıcı bildirmiş mi (ayrı sorgudan birleştirilir). */
  reportedByMe: boolean;
  /** Dolu ise gönderi moderasyonda gizlendi; yalnız yazarı ve moderatör görür. */
  hiddenAt: string | null;
  reportCount: number;
  editedAt: string | null;
  createdAt: string;
}

/** Kullanıcıya farklı mesaj gösterilmesi gereken hata sınıfları. */
export type ForumError =
  | 'auth'
  | 'rate-limit'
  | 'daily-limit'
  | 'not-installed'
  | 'network'
  | 'unknown';

interface PostRow {
  id: string;
  user_id: string;
  author_name: string;
  parent_id: string | null;
  body: string;
  tickers: string[] | null;
  reply_count: number;
  like_count: number;
  hidden_at: string | null;
  report_count: number | null;
  edited_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, user_id, author_name, parent_id, body, tickers, reply_count, like_count, hidden_at, report_count, edited_at, created_at';

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

/**
 * Yazılmakta olan anma: imlecin hemen solundaki $/# ve arkasındaki harfler.
 * TICKER_MENTION'dan farkı, henüz geçerli bir kod olmayan yarım girdiyi de
 * (ve şirket adı aramak için Türkçe harfleri de) kabul etmesi — öneri listesi
 * bunun üzerinden süzülür. Sigil yalnız sözcük başında sayılır ki "3$" gibi
 * tutarlar ya da e-posta benzeri diziler listeyi açmasın.
 */
const MENTION_DRAFT = /(?:^|[\s([{<"'“‘])([$#])([\p{L}\p{N}^.=-]{0,15})$/u;

export interface MentionDraft {
  /** Sigil'in gövdedeki başlangıç dizini. */
  start: number;
  /** İmlecin konumu; anmanın bitişi. */
  end: number;
  /** Kullanıcının yazdığı sigil ($ ya da #); seçimde aynısı korunur. */
  sigil: string;
  /** Sigil'den sonra yazılan ham metin (boş olabilir). */
  query: string;
}

/** İmlecin solunda yazılmakta olan $KOD anmasını döndürür, yoksa null. */
export function findMentionDraft(body: string, caret: number): MentionDraft | null {
  const end = Math.max(0, Math.min(caret, body.length));
  const before = body.slice(0, end);
  const match = MENTION_DRAFT.exec(before);
  if (!match) return null;
  return { start: end - match[1].length - match[2].length, end, sigil: match[1], query: match[2] };
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

function toPost(row: PostRow, likedIds: Set<string>, reportedIds: Set<string>): ForumPost {
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
    reportedByMe: reportedIds.has(row.id),
    hiddenAt: row.hidden_at ?? null,
    reportCount: row.report_count ?? 0,
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
  // Dakikalık ve günlük tavan aynı hata kodunu (P0001) taşır; kullanıcıya
  // "biraz bekleyin" ile "bugünlük doldu" farklı şeyler söyler.
  if (message.includes('günlük')) return 'daily-limit';
  if (code === 'P0001' || message.includes('çok hızlı')) return 'rate-limit';
  if (message.includes('fetch') || message.includes('network')) return 'network';
  return 'unknown';
}

const ERROR_KEYS: Record<ForumError, string> = {
  auth: 'forumErrorAuth',
  'rate-limit': 'forumErrorRate',
  'daily-limit': 'forumErrorDaily',
  'not-installed': 'forumErrorSchema',
  network: 'forumErrorNetwork',
  unknown: 'forumErrorUnknown',
};

/** Yakalanan hatayı doğrudan i18n anahtarına çevirir. */
export function forumErrorKey(error: unknown): string {
  return ERROR_KEYS[classifyError(error as { code?: string; message?: string } | null)];
}

/** Oturum sahibinin kimliği — yerel önbellekten, ağa çıkmadan. */
export function currentUserId(): string | null {
  return getSession()?.id ?? null;
}

// ── Oturum başına önbellekler ───────────────────────────────────────────────
// Engel listesi ve moderatörlük her akış yüklemesinde değil, oturumda bir kez
// sorulur. Oturum değişince ikisi de düşer, yoksa çıkış yapan kullanıcının
// engelleri sonraki kullanıcıya uygulanırdı.
let blockedCache: Promise<Set<string>> | null = null;
let moderatorCache: Promise<boolean> | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_EVENT, () => {
    blockedCache = null;
    moderatorCache = null;
  });
}

/** Engellenen kullanıcı kimlikleri (okuyucunun kendi tercihi). */
export function blockedUserIds(): Promise<Set<string>> {
  if (blockedCache) return blockedCache;
  blockedCache = (async () => {
    if (!currentUserId()) return new Set<string>();
    const { data, error } = await supabase.from('forum_blocks').select('blocked_id');
    // Şema kurulmamışsa engel yok sayılır: akış yine çizilsin.
    if (error) return new Set<string>();
    return new Set((data ?? []).map((row) => (row as { blocked_id: string }).blocked_id));
  })();
  return blockedCache;
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.from('forum_blocks').insert({ blocked_id: userId });
  // Zaten engelliyse (birincil anahtar çakışması) istenen sonuç sağlanmıştır.
  if (error && error.code !== '23505') throw error;
  blockedCache = null;
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.from('forum_blocks').delete().eq('blocked_id', userId);
  if (error) throw error;
  blockedCache = null;
}

export interface BlockedUser {
  userId: string;
  name: string;
}

/**
 * Engellenenler listesi, gösterilecek adlarıyla. `forum_blocks` yalnız kimlik
 * tutar (ad kopyalamak engeli kalıcı bir profil kaydına çevirirdi); ad,
 * kişinin kendi gönderilerinden okunur.
 */
export async function listBlockedUsers(): Promise<BlockedUser[]> {
  const ids = Array.from(await blockedUserIds());
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('forum_posts')
    .select('user_id, author_name')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(500);
  const names = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ user_id: string; author_name: string }>) {
    if (!names.has(row.user_id)) names.set(row.user_id, row.author_name);
  }
  return ids.map((userId) => ({ userId, name: names.get(userId) ?? userId.slice(0, 8) }));
}

/** Oturum sahibi forum moderatörü mü (RPC sunucuda karar verir). */
export function isModerator(): Promise<boolean> {
  if (moderatorCache) return moderatorCache;
  moderatorCache = (async () => {
    if (!currentUserId()) return false;
    const { data, error } = await supabase.rpc('forum_is_moderator');
    if (error) return false;
    return data === true;
  })();
  return moderatorCache;
}

/** Verilen gönderilerden oturum sahibinin beğendiklerini ve bildirdiklerini işaretler. */
async function loadMarks(ids: string[]): Promise<{ liked: Set<string>; reported: Set<string> }> {
  const empty = { liked: new Set<string>(), reported: new Set<string>() };
  const userId = currentUserId();
  if (ids.length === 0 || !userId) return empty;
  const [likes, reports] = await Promise.all([
    supabase.from('forum_likes').select('post_id').eq('user_id', userId).in('post_id', ids),
    supabase.from('forum_reports').select('post_id').eq('reporter_id', userId).in('post_id', ids),
  ]);
  return {
    liked: new Set((likes.data ?? []).map((row) => (row as { post_id: string }).post_id)),
    // forum_reports v1 şemasında yoktur; hata gelirse yalnız işaret eksilir.
    reported: new Set((reports.data ?? []).map((row) => (row as { post_id: string }).post_id)),
  };
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

  const [{ data, error }, blocked] = await Promise.all([request, blockedUserIds()]);
  if (error) throw error;
  const all = (data ?? []) as PostRow[];
  // Engel sunucuda satırı silmez (gönderi başkaları için durur); okuyucunun
  // görünümünden burada düşer. `hasMore` süzme ÖNCESİ sayıya bakar, yoksa
  // engelli bir yazar akışın sonunu erken göstermiş olurdu.
  const rows = all.filter((row) => !blocked.has(row.user_id));
  const marks = await loadMarks(rows.map((row) => row.id));
  return {
    posts: rows.map((row) => toPost(row, marks.liked, marks.reported)),
    hasMore: all.length >= limit,
  };
}

/** Bir kök konunun yanıtları, eskiden yeniye. */
export async function listReplies(rootId: string): Promise<ForumPost[]> {
  const [{ data, error }, blocked] = await Promise.all([
    supabase
      .from('forum_posts')
      .select(COLUMNS)
      .eq('parent_id', rootId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200),
    blockedUserIds(),
  ]);
  if (error) throw error;
  const rows = ((data ?? []) as PostRow[]).filter((row) => !blocked.has(row.user_id));
  const marks = await loadMarks(rows.map((row) => row.id));
  return rows.map((row) => toPost(row, marks.liked, marks.reported));
}

export interface NewPost {
  body: string;
  /** Elle seçilen etiketler; gövdedeki $KOD anmaları ayrıca eklenir. */
  tickers?: string[];
  parentId?: string | null;
}

/** Elle seçilen etiketlerle gövdeden yakalananları birleştirir. */
function mergeTickers(body: string, manual?: string[]): string[] {
  return Array.from(new Set([
    ...(manual ?? []).map(normalizeTicker).filter(isValidTicker),
    ...extractTickers(body),
  ])).slice(0, MAX_TICKERS);
}

export async function createPost(input: NewPost): Promise<ForumPost> {
  const body = input.body.trim();
  const { data, error } = await supabase
    .from('forum_posts')
    .insert({ body, tickers: mergeTickers(body, input.tickers), parent_id: input.parentId ?? null })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toPost(data as PostRow, new Set(), new Set());
}

/** Kendi gönderisini düzenler; sunucu `edited_at` damgasını kendisi vurur. */
export async function updatePost(id: string, body: string, tickers?: string[]): Promise<ForumPost> {
  const trimmed = body.trim();
  const { data, error } = await supabase
    .from('forum_posts')
    .update({ body: trimmed, tickers: mergeTickers(trimmed, tickers) })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const marks = await loadMarks([id]);
  return toPost(data as PostRow, marks.liked, marks.reported);
}

/** Yumuşak silme: satır iş parçacığı için kalır, gövdeyi sunucu boşaltır. */
export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase
    .from('forum_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export type ReportReason = 'spam' | 'abuse' | 'misinfo' | 'other';
export const REPORT_REASONS: ReportReason[] = ['spam', 'abuse', 'misinfo', 'other'];

/** Gönderiyi moderasyona bildirir; aynı kişi aynı gönderiyi bir kez bildirir. */
export async function reportPost(postId: string, reason: ReportReason, note?: string): Promise<void> {
  const { error } = await supabase
    .from('forum_reports')
    .insert({ post_id: postId, reason, note: note?.trim() ? note.trim().slice(0, 500) : null });
  // Zaten bildirilmiş: kullanıcı açısından sonuç aynı.
  if (error && error.code !== '23505') throw error;
}

export async function setLike(postId: string, liked: boolean): Promise<void> {
  const userId = currentUserId();
  if (!userId) throw { code: '42501', message: 'oturum gerekli' };
  if (liked) {
    const { error } = await supabase.from('forum_likes').insert({ post_id: postId, user_id: userId });
    // Çift tık yarışında birincil anahtar çakışır; beğeni zaten duruyordur.
    if (error && error.code !== '23505') throw error;
    return;
  }
  const { error } = await supabase
    .from('forum_likes')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Moderasyon ──────────────────────────────────────────────────────────────

export interface ReportedPost {
  id: string;
  authorName: string;
  body: string;
  tickers: string[];
  reportCount: number;
  hiddenAt: string | null;
  createdAt: string;
  reasons: ReportReason[];
}

export type ModerationAction = 'hide' | 'restore' | 'dismiss';

/** Bildirilen gönderiler; yalnız moderatör için doludur. */
export async function reportQueue(limit = 50): Promise<ReportedPost[]> {
  const { data, error } = await supabase.rpc('forum_report_queue', { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string;
    author_name: string;
    body: string;
    tickers: string[] | null;
    report_count: number;
    hidden_at: string | null;
    created_at: string;
    reasons: string[] | null;
  }>).map((row) => ({
    id: row.id,
    authorName: row.author_name,
    body: row.body,
    tickers: row.tickers ?? [],
    reportCount: row.report_count,
    hiddenAt: row.hidden_at,
    createdAt: row.created_at,
    reasons: (row.reasons ?? []) as ReportReason[],
  }));
}

export async function moderatePost(postId: string, action: ModerationAction): Promise<void> {
  const { error } = await supabase.rpc('forum_moderate', { p_post_id: postId, p_action: action });
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

// ── Canlı yayın ─────────────────────────────────────────────────────────────

/** Yayından gelen tek satırlık değişiklik; akış ne yapacağına buna bakarak karar verir. */
export interface ForumChange {
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  /** INSERT/UPDATE'te satırın kendisi; DELETE'te yalnız kimlik gelir. */
  post: ForumPost | null;
  /**
   * Satır akıştan düşmeli mi. Yalnız silme sayılır: gizlemede satırı görme
   * hakkı olan (yazar, moderatör) rozetli hâlini görmeye devam eder, hakkı
   * olmayana zaten RLS gereği yayın da gelmez.
   */
  gone: boolean;
}

type Listener = (change: ForumChange) => void;

const listeners = new Set<Listener>();
let channel: ReturnType<typeof supabase.channel> | null = null;

interface RealtimeRow extends PostRow {
  deleted_at?: string | null;
}

function toChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}): ForumChange | null {
  const op = payload.eventType as ForumChange['op'];
  const row = (op === 'DELETE' ? payload.old : payload.new) as unknown as RealtimeRow | undefined;
  const id = row?.id;
  if (!id) return null;
  if (op === 'DELETE') return { op, id, post: null, gone: true };
  // Beğeni/bildirim işaretleri kullanıcıya özeldir, yayın satırında yoktur;
  // akış bu alanları ekrandaki kendi kopyasından taşır.
  const post = toPost(row as PostRow, new Set(), new Set());
  return { op, id, post, gone: Boolean(row?.deleted_at) };
}

/**
 * Başka kullanıcıların gönderileri açık ekrana düşsün diye canlı yayın.
 *
 * Tek kanal bütün akışlara hizmet eder: modül görünümü ile hisse sayfası aynı
 * anda açıkken ayrı ayrı abone olmak kanal sayısını (ve sunucudaki eşzamanlı
 * bağlantıyı) gereksiz katlıyordu. Yayın projede kapalıysa abonelik sessizce
 * başarısız olur — çağıran taraf ayrıca yoklama yaptığı için akış yine tazelenir.
 */
export function subscribeForum(onChange: Listener): () => void {
  listeners.add(onChange);
  if (!channel) {
    channel = supabase
      .channel('fraude-forum')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'forum_posts' },
        (payload) => {
          const change = toChange(payload as unknown as Parameters<typeof toChange>[0]);
          if (!change) return;
          for (const listener of listeners) listener(change);
        },
      )
      .subscribe();
  }
  return () => {
    listeners.delete(onChange);
    // Son dinleyici de gidince kanal kapanır; yeni akış açılınca yeniden kurulur.
    if (listeners.size === 0 && channel) {
      const closing = channel;
      channel = null;
      void supabase.removeChannel(closing);
    }
  };
}
