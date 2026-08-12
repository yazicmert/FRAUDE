-- FRAUDE forum şeması: topluluk gönderileri + hisse etiketleri
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırın.
-- Tekrar çalıştırmak güvenlidir; v1 kurulmuş bir veritabanında da çalışır
-- (yeni sütunlar `add column if not exists` ile gelir).
--
-- ÖNKOŞUL YOK. docs/supabase-site.sql çalıştırılmışsa (admins tablosu varsa)
-- oradaki yöneticiler forum moderatörü olarak kendiliğinden kopyalanır.
--
-- Model: her gönderi bir kök konu ya da bir kök konunun yanıtıdır (tek seviye).
-- Gövdede geçen hisse kodları `tickers` dizisine yazılır; hisse sayfasındaki
-- forum bölümü tam olarak bu diziyi sorgular (`tickers @> {THYAO}`).
--
-- Görünürlük üç ayrı durumdur ve karıştırılmamalıdır:
--   deleted_at → yazarın kendi silmesi (gövde boşaltılır, geri alınamaz)
--   hidden_at  → moderatörün gizlemesi (gövde durur, geri alınabilir)
--   forum_blocks → okuyucunun kendi engeli (yalnız o kullanıcının görünümü)

-- ── Gönderiler ──────────────────────────────────────────────────────────────
create table if not exists public.forum_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Görünen ad gönderi anında JWT'den kopyalanır: liste çizerken auth.users'a
  -- join gerekmez (istemcinin o tabloya erişimi de yoktur).
  author_name text not null,
  -- null = kök konu, dolu = o kök konunun yanıtı. Yanıta yanıt kök konuya
  -- düşürülür (before-insert tetikleyicisi), böylece iş parçacığı tek seviye kalır.
  parent_id   uuid references public.forum_posts (id) on delete cascade,
  body        text not null,
  -- Normalleştirilmiş hisse etiketleri (büyük harf, tekil, en çok 8 adet).
  tickers     text[] not null default '{}',
  reply_count int not null default 0,
  like_count  int not null default 0,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- Silinen gönderinin gövdesi boşaltılır (aşağıdaki tetikleyici), bu yüzden
  -- "en az 1 karakter" koşulu yalnız silinmemiş kayıtlar için geçerlidir.
  constraint forum_posts_body_len check (
    char_length(body) <= 4000
    and (deleted_at is not null or char_length(btrim(body)) >= 1)
  )
);

-- Moderatör gizlemesi: gövde silinmez, yalnız görünmez olur; geri alınabilir.
alter table public.forum_posts add column if not exists hidden_at     timestamptz;
alter table public.forum_posts add column if not exists hidden_by     uuid references auth.users (id) on delete set null;
alter table public.forum_posts add column if not exists hidden_reason text;
-- Açık bildirim sayısı (forum_reports tetikleyicisi tutar); eşiği aşınca
-- gönderi inceleme beklerken kendiliğinden gizlenir.
alter table public.forum_posts add column if not exists report_count  int not null default 0;

-- Kök akış: `parent_id is null` + tarihe göre sıralama tek indeksten okunur.
create index if not exists forum_posts_root_idx
  on public.forum_posts (created_at desc) where parent_id is null;
create index if not exists forum_posts_parent_idx
  on public.forum_posts (parent_id, created_at);
-- Hisse sayfasının sorgusu: tickers @> ARRAY['THYAO']
create index if not exists forum_posts_tickers_idx
  on public.forum_posts using gin (tickers);
create index if not exists forum_posts_user_idx
  on public.forum_posts (user_id, created_at desc);
-- Trend sorgusu bütün gönderileri tarih penceresiyle süzer; kısmi kök indeksi
-- (yalnız parent_id is null) buna yetmez.
create index if not exists forum_posts_created_idx
  on public.forum_posts (created_at desc);
-- Arama `body ilike '%…%'` ile çalışır; önek olmayan kalıp B-tree indeksini
-- kullanamaz, trigram indeksi kullanır.
create extension if not exists pg_trgm;
create index if not exists forum_posts_body_trgm_idx
  on public.forum_posts using gin (body gin_trgm_ops);
create index if not exists forum_posts_author_trgm_idx
  on public.forum_posts using gin (author_name gin_trgm_ops);
-- Moderasyon kuyruğu: bildirimi olan gönderiler azınlıktadır, kısmi indeks yeter.
create index if not exists forum_posts_reported_idx
  on public.forum_posts (report_count desc, created_at desc) where report_count > 0;

-- ── Beğeniler ───────────────────────────────────────────────────────────────
create table if not exists public.forum_likes (
  post_id    uuid not null references public.forum_posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists forum_likes_user_idx on public.forum_likes (user_id);

-- ── Moderatörler ────────────────────────────────────────────────────────────
-- Forumun kendi listesi: site şemasına bağımlı değildir. `admins` tablosu
-- varsa oradaki yöneticiler bir kez kopyalanır (aşağıda), sonrasında bu liste
-- SQL editöründen yönetilir.
create table if not exists public.forum_moderators (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.forum_moderators enable row level security;
-- Politika yok: tabloya yalnız SQL editor / service_role dokunur. Kullanıcı
-- kendi moderatörlüğünü `forum_is_moderator()` ile öğrenir.
grant select on public.forum_moderators to service_role;

create or replace function public.forum_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from forum_moderators where user_id = auth.uid());
$$;
revoke execute on function public.forum_is_moderator() from public, anon;
grant execute on function public.forum_is_moderator() to authenticated;

-- ── Bildirimler (kullanıcı şikâyeti) ────────────────────────────────────────
create table if not exists public.forum_reports (
  post_id     uuid not null references public.forum_posts (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason      text not null default 'other'
              check (reason in ('spam', 'abuse', 'misinfo', 'other')),
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  -- Aynı kişi aynı gönderiyi bir kez bildirir: sayaç kişi sayar, tık değil.
  primary key (post_id, reporter_id)
);
create index if not exists forum_reports_post_idx on public.forum_reports (post_id);

-- ── Engellemeler (okuyucu tercihi) ──────────────────────────────────────────
-- Engel sunucuda gönderiyi silmez, yalnız engelleyenin sorgusundan düşürülür;
-- listeyi istemci bir kez çekip filtreye çevirir.
create table if not exists public.forum_blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint forum_blocks_not_self check (blocker_id <> blocked_id)
);

-- ── Yardımcılar ─────────────────────────────────────────────────────────────

-- Hisse etiketi normalleştirme. Kabul edilen biçim FRAUDE'nin sembol
-- evrenidir: BIST kodları (THYAO), endeksler (XU100, ^GSPC), döviz/emtia
-- kotasyonları (USDTRY=X, GC=F) ve kripto (BTC-USD). En az bir harf şartı
-- "$100" gibi tutarların etiket sanılmasını engeller.
create or replace function public.forum_normalize_tickers(p_tickers text[])
returns text[]
language sql
-- upper() yereldeki harf eşlemesine bakar, yani immutable değil stable'dır;
-- bu işlev bir indekste değil yalnız tetikleyicide kullanılır.
stable
as $$
  select coalesce(
    (select array_agg(t order by t) from (
       select distinct upper(btrim(sym)) as t
       from unnest(coalesce(p_tickers, '{}'::text[])) as u(sym)
     ) s
     where t ~ '^[A-Z0-9^][A-Z0-9.=^-]{1,15}$' and t ~ '[A-Z]'
    )::text[],
    '{}'::text[]
  );
$$;

-- Görünen ad: e-posta kaydında `name`, GitHub'da `full_name`/`user_name`.
-- Sıralama src/features/auth/session.ts:toUser ile birebir aynıdır — iki taraf
-- birlikte değişmelidir, yoksa aynı kullanıcı iki farklı adla görünür.
create or replace function public.forum_author_name()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'user_name'), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'FRAUDE'
  );
$$;

-- Sayaç güncellemesi. security definer: beğeni başkasının gönderisindeki
-- like_count'u artırır, RLS bunu istemci adına yapmaya izin vermez. İşlem
-- boyunca bir bayrak açılır; before-update tetikleyicisi bayrağı görünce
-- sayaçları geri sabitlemeden geçer.
create or replace function public.forum_counter_bump(p_id uuid, p_likes int, p_replies int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('fraude.forum_counter', 'on', true);
  update forum_posts
     set like_count  = greatest(0, like_count + p_likes),
         reply_count = greatest(0, reply_count + p_replies)
   where id = p_id;
  perform set_config('fraude.forum_counter', 'off', true);
end;
$$;
revoke execute on function public.forum_counter_bump(uuid, int, int) from public, anon, authenticated;

-- ── Tetikleyiciler ──────────────────────────────────────────────────────────

create or replace function public.forum_posts_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_root   uuid;
  v_recent int;
begin
  if v_uid is null then
    raise exception 'forum: oturum gerekli' using errcode = '42501';
  end if;

  -- Kimlik ve sayaçlar istemciden gelmez: yazar adı taklit edilemez.
  new.user_id     := v_uid;
  new.author_name := left(public.forum_author_name(), 60);
  new.body        := btrim(new.body);
  -- Etiket sayısı sunucuda da sınırlanır: istemci dışından gelen bir istek
  -- gönderiyi yüzlerce hisseye iliştirmesin.
  new.tickers     := (public.forum_normalize_tickers(new.tickers))[1:8];
  new.like_count  := 0;
  new.reply_count := 0;
  new.deleted_at  := null;
  new.edited_at   := null;
  new.created_at  := now();

  if new.parent_id is not null then
    select coalesce(p.parent_id, p.id) into v_root
      from forum_posts p where p.id = new.parent_id;
    if v_root is null then
      raise exception 'forum: yanıtlanan gönderi bulunamadı' using errcode = '23503';
    end if;
    new.parent_id := v_root;
  end if;

  -- Kaba akış koruması: dakikada 8 gönderi.
  select count(*) into v_recent
    from forum_posts
   where user_id = v_uid and created_at > now() - interval '1 minute';
  if v_recent >= 8 then
    raise exception 'forum: çok hızlı gönderim, biraz bekleyin' using errcode = 'P0001';
  end if;

  -- Günlük tavan: dakikalık sınır tek başına 11 bin gönderi/güne izin verir,
  -- yani yavaş ama sürekli bir sel akışı yine boğabilir.
  select count(*) into v_recent
    from forum_posts
   where user_id = v_uid and created_at > now() - interval '24 hours';
  if v_recent >= 100 then
    raise exception 'forum: günlük gönderi sınırına ulaştınız' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.forum_posts_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Sayaç güncellemesi kendi tetikleyicisinden geliyor: dokunma.
  if coalesce(current_setting('fraude.forum_counter', true), 'off') = 'on' then
    return new;
  end if;

  -- Değişmez alanlar: istemci UPDATE ile sahiplik veya sayaç oynayamaz.
  new.id           := old.id;
  new.user_id      := old.user_id;
  new.author_name  := old.author_name;
  new.parent_id    := old.parent_id;
  new.created_at   := old.created_at;
  new.like_count   := old.like_count;
  new.reply_count  := old.reply_count;
  new.report_count := old.report_count;

  -- Gizleme/geri alma yalnız moderatörün işidir; yazar kendi gönderisini
  -- gizlemeyi kaldırarak moderasyonu boşa çıkaramaz.
  if new.hidden_at is distinct from old.hidden_at
     or new.hidden_by is distinct from old.hidden_by
     or new.hidden_reason is distinct from old.hidden_reason then
    if not public.forum_is_moderator() then
      new.hidden_at     := old.hidden_at;
      new.hidden_by     := old.hidden_by;
      new.hidden_reason := old.hidden_reason;
    end if;
  end if;

  -- Gizli gönderi yazarı tarafından düzenlenemez (silmesi serbesttir).
  if old.hidden_at is not null and new.deleted_at is null and not public.forum_is_moderator() then
    new.body    := old.body;
    new.tickers := old.tickers;
    return new;
  end if;

  if old.deleted_at is not null then
    -- Silinen gönderi geri getirilmez ve düzenlenmez.
    new.deleted_at := old.deleted_at;
    new.body       := old.body;
    new.tickers    := old.tickers;
  elsif new.deleted_at is not null then
    -- Silme = gövdeyi gerçekten boşalt. Satır iş parçacığı için kalır ama
    -- metin API'den de okunamaz.
    new.deleted_at := now();
    new.body       := '';
    new.tickers    := '{}';
  else
    new.body    := btrim(new.body);
    new.tickers := (public.forum_normalize_tickers(new.tickers))[1:8];
    if new.body is distinct from old.body or new.tickers is distinct from old.tickers then
      new.edited_at := now();
    end if;
  end if;

  return new;
end;
$$;

-- Yanıt sayacı. Sayaç güncellemesi aynı tabloyu güncellediği için bu
-- tetikleyici yeniden çalışır; iç çağrıda deleted_at değişmediğinden hiçbir
-- dal tutmaz ve özyineleme orada biter.
create or replace function public.forum_posts_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    perform forum_counter_bump(new.parent_id, 0, 1);
  elsif tg_op = 'UPDATE' and new.parent_id is not null
        and new.deleted_at is not null and old.deleted_at is null then
    perform forum_counter_bump(new.parent_id, 0, -1);
  elsif tg_op = 'DELETE' and old.parent_id is not null and old.deleted_at is null then
    perform forum_counter_bump(old.parent_id, 0, -1);
  end if;

  -- Kök konu silinince yanıtları da düşer. Aksi hâlde yanıtlar veritabanında
  -- okunur kalır ama hiçbir ekrandan erişilemez: kök akıştan süzülmüştür,
  -- yanıtlar ise yalnız kökün altında açılır. Her yanıtın kendi
  -- before-update'i gövdesini boşaltır, after-update'i de sayacı düşürür.
  if tg_op = 'UPDATE' and new.parent_id is null
     and new.deleted_at is not null and old.deleted_at is null then
    update forum_posts
       set deleted_at = now()
     where parent_id = new.id and deleted_at is null;
  end if;

  return null;
end;
$$;

-- Bildirim sayacı + otomatik gizleme. Eşiği aşan gönderi moderatör bakana
-- kadar görünmez olur; gövdesi durduğu için karar geri alınabilir.
create or replace function public.forum_reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count from forum_reports where post_id = new.post_id;
  perform set_config('fraude.forum_counter', 'on', true);
  update forum_posts
     set report_count = v_count,
         hidden_at    = case when v_count >= 3 and hidden_at is null then now() else hidden_at end,
         hidden_reason = case when v_count >= 3 and hidden_at is null then 'auto' else hidden_reason end
   where id = new.post_id;
  perform set_config('fraude.forum_counter', 'off', true);
  return null;
end;
$$;

create or replace function public.forum_likes_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform forum_counter_bump(new.post_id, 1, 0);
  else
    perform forum_counter_bump(old.post_id, -1, 0);
  end if;
  return null;
end;
$$;

drop trigger if exists forum_posts_before_insert on public.forum_posts;
create trigger forum_posts_before_insert
  before insert on public.forum_posts
  for each row execute function public.forum_posts_before_insert();

drop trigger if exists forum_posts_before_update on public.forum_posts;
create trigger forum_posts_before_update
  before update on public.forum_posts
  for each row execute function public.forum_posts_before_update();

drop trigger if exists forum_posts_after_change on public.forum_posts;
create trigger forum_posts_after_change
  after insert or update or delete on public.forum_posts
  for each row execute function public.forum_posts_after_change();

drop trigger if exists forum_likes_after_change on public.forum_likes;
create trigger forum_likes_after_change
  after insert or delete on public.forum_likes
  for each row execute function public.forum_likes_after_change();

drop trigger if exists forum_reports_after_insert on public.forum_reports;
create trigger forum_reports_after_insert
  after insert on public.forum_reports
  for each row execute function public.forum_reports_after_insert();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.forum_posts enable row level security;
alter table public.forum_likes enable row level security;
alter table public.forum_reports enable row level security;
alter table public.forum_blocks enable row level security;

-- Okuma herkese (giriş yapmış herkese) açık: forum ortak alandır. Gizlenen
-- gönderiyi yalnız yazarı ve moderatörler görür — süzme istemcide kalsaydı
-- gizleme yalnız arayüzde olurdu, veri yine API'den okunabilirdi.
drop policy if exists "forum-read" on public.forum_posts;
create policy "forum-read" on public.forum_posts
  for select to authenticated
  using (
    hidden_at is null
    or user_id = auth.uid()
    or public.forum_is_moderator()
  );

-- user_id'yi zaten before-insert tetikleyicisi auth.uid() yapar; koşul
-- tetikleyici düşerse yazma yolunun açık kalmaması içindir.
drop policy if exists "forum-insert" on public.forum_posts;
create policy "forum-insert" on public.forum_posts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "forum-update-own" on public.forum_posts;
create policy "forum-update-own" on public.forum_posts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "forum-delete-own" on public.forum_posts;
create policy "forum-delete-own" on public.forum_posts
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "forum-likes-read" on public.forum_likes;
create policy "forum-likes-read" on public.forum_likes
  for select to authenticated using (true);

drop policy if exists "forum-likes-insert" on public.forum_likes;
create policy "forum-likes-insert" on public.forum_likes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "forum-likes-delete" on public.forum_likes;
create policy "forum-likes-delete" on public.forum_likes
  for delete to authenticated using (user_id = auth.uid());

-- Moderatör gizleme/geri alma yapabilsin diye ayrı UPDATE politikası. Hangi
-- alanların değişebildiğini before-update tetikleyicisi belirler.
drop policy if exists "forum-moderate" on public.forum_posts;
create policy "forum-moderate" on public.forum_posts
  for update to authenticated
  using (public.forum_is_moderator()) with check (public.forum_is_moderator());

-- Bildirimler: kişi kendi bildirimini görür ve ekler, silemez (geri alınca
-- sayaç düşmez; bildirim bir olaydır, oy değil). Moderatör hepsini görür.
drop policy if exists "forum-reports-read" on public.forum_reports;
create policy "forum-reports-read" on public.forum_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.forum_is_moderator());

drop policy if exists "forum-reports-insert" on public.forum_reports;
create policy "forum-reports-insert" on public.forum_reports
  for insert to authenticated with check (reporter_id = auth.uid());

-- Engeller yalnız sahibinindir.
drop policy if exists "forum-blocks-own" on public.forum_blocks;
create policy "forum-blocks-own" on public.forum_blocks
  for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- Tablo düzeyi yetkiler: RLS tek başına yetmez, GRANT olmadan
-- "permission denied for table forum_posts" gelir.
grant select, insert, update, delete on public.forum_posts to authenticated;
grant select, insert, delete on public.forum_likes to authenticated;
grant select, insert on public.forum_reports to authenticated;
grant select, insert, delete on public.forum_blocks to authenticated;
grant select, insert, update, delete on public.forum_posts to service_role;
grant select, insert, update, delete on public.forum_likes to service_role;
grant select, insert, update, delete on public.forum_reports to service_role;
grant select, insert, update, delete on public.forum_blocks to service_role;

-- Site şemasındaki yöneticileri bir kez forum moderatörü yap (varsa).
do $$
begin
  if to_regclass('public.admins') is not null then
    insert into forum_moderators (user_id)
    select user_id from admins on conflict do nothing;
  end if;
end
$$;

-- ── Moderasyon ──────────────────────────────────────────────────────────────
-- Kuyruk: bildirilen gönderiler, en çok bildirilen başta.
create or replace function public.forum_report_queue(p_limit int default 50)
returns table (
  id uuid, author_name text, body text, tickers text[],
  report_count int, hidden_at timestamptz, created_at timestamptz,
  reasons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.author_name, p.body, p.tickers,
         p.report_count, p.hidden_at, p.created_at,
         array(select distinct r.reason from forum_reports r where r.post_id = p.id) as reasons
    from forum_posts p
   where p.report_count > 0 and p.deleted_at is null
     and public.forum_is_moderator()
   order by p.report_count desc, p.created_at desc
   limit greatest(1, least(p_limit, 200));
$$;
revoke execute on function public.forum_report_queue(int) from public, anon;
grant execute on function public.forum_report_queue(int) to authenticated;

-- Karar: gizle / geri al / bildirimleri temizle.
create or replace function public.forum_moderate(p_post_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.forum_is_moderator() then
    raise exception 'forum: moderatör değilsiniz' using errcode = '42501';
  end if;
  perform set_config('fraude.forum_counter', 'on', true);
  if p_action = 'hide' then
    update forum_posts
       set hidden_at = now(), hidden_by = auth.uid(), hidden_reason = 'moderator'
     where id = p_post_id;
  elsif p_action = 'restore' then
    -- Geri alırken bildirimler de temizlenir, yoksa eşik hâlâ aşılmış
    -- olduğundan bir sonraki bildirim gönderiyi anında yeniden gizlerdi.
    delete from forum_reports where post_id = p_post_id;
    update forum_posts
       set hidden_at = null, hidden_by = null, hidden_reason = null, report_count = 0
     where id = p_post_id;
  elsif p_action = 'dismiss' then
    delete from forum_reports where post_id = p_post_id;
    update forum_posts set report_count = 0 where id = p_post_id;
  else
    raise exception 'forum: bilinmeyen moderasyon işlemi %', p_action using errcode = 'P0001';
  end if;
  perform set_config('fraude.forum_counter', 'off', true);
end;
$$;
revoke execute on function public.forum_moderate(uuid, text) from public, anon;
grant execute on function public.forum_moderate(uuid, text) to authenticated;

-- ── En çok konuşulan hisseler ───────────────────────────────────────────────
create or replace function public.forum_trending_tickers(
  p_hours int default 168,
  p_limit int default 10
)
returns table (ticker text, posts bigint, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  select t as ticker, count(*) as posts, max(p.created_at) as last_at
    from forum_posts p, unnest(p.tickers) as t
   where p.deleted_at is null
     -- Gizli gönderi sayılmaz: moderatör RLS'i aştığı için aksi hâlde
     -- moderatörle diğer kullanıcılar farklı trend listesi görürdü.
     and p.hidden_at is null
     and p.created_at > now() - make_interval(hours => greatest(1, least(p_hours, 2160)))
   group by t
   order by count(*) desc, max(p.created_at) desc
   limit greatest(1, least(p_limit, 50));
$$;
revoke execute on function public.forum_trending_tickers(int, int) from public, anon;
grant execute on function public.forum_trending_tickers(int, int) to authenticated;

-- ── Canlı yayın ─────────────────────────────────────────────────────────────
-- Diğer kullanıcıların gönderileri açık ekrana kendiliğinden düşsün diye tablo
-- realtime yayınına eklenir. İstemci yayın kapalıysa da çalışır (yoklamaya
-- düşer), bu yüzden hata yutulur.
do $$
begin
  alter publication supabase_realtime add table public.forum_posts;
exception
  -- Tablo zaten yayında / yayın yok / yetki yok: üçü de forumu bozmaz.
  when others then null;
end
$$;
