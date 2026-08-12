-- FRAUDE forum şeması: topluluk gönderileri + hisse etiketleri
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırın.
-- Tekrar çalıştırmak güvenlidir.
--
-- ÖNKOŞUL YOK. docs/supabase-site.sql çalıştırılmışsa (is_admin() varsa)
-- yönetici moderasyon politikası da kendiliğinden kurulur.
--
-- Model: her gönderi bir kök konu ya da bir kök konunun yanıtıdır (tek seviye).
-- Gövdede geçen hisse kodları `tickers` dizisine yazılır; hisse sayfasındaki
-- forum bölümü tam olarak bu diziyi sorgular (`tickers @> {THYAO}`).

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

-- ── Beğeniler ───────────────────────────────────────────────────────────────
create table if not exists public.forum_likes (
  post_id    uuid not null references public.forum_posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists forum_likes_user_idx on public.forum_likes (user_id);

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
  new.id          := old.id;
  new.user_id     := old.user_id;
  new.author_name := old.author_name;
  new.parent_id   := old.parent_id;
  new.created_at  := old.created_at;
  new.like_count  := old.like_count;
  new.reply_count := old.reply_count;

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

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.forum_posts enable row level security;
alter table public.forum_likes enable row level security;

-- Okuma herkese (giriş yapmış herkese) açık: forum ortak alandır.
drop policy if exists "forum-read" on public.forum_posts;
create policy "forum-read" on public.forum_posts
  for select to authenticated using (true);

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

-- Yönetici moderasyonu yalnız docs/supabase-site.sql kurulduysa (is_admin()
-- varsa) eklenir; bu dosya tek başına da çalışsın diye koşullu.
do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    execute 'drop policy if exists "forum-moderate" on public.forum_posts';
    execute 'create policy "forum-moderate" on public.forum_posts
               for update to authenticated using (public.is_admin()) with check (true)';
  end if;
end
$$;

-- Tablo düzeyi yetkiler: RLS tek başına yetmez, GRANT olmadan
-- "permission denied for table forum_posts" gelir.
grant select, insert, update, delete on public.forum_posts to authenticated;
grant select, insert, delete on public.forum_likes to authenticated;
grant select, insert, update, delete on public.forum_posts to service_role;
grant select, insert, update, delete on public.forum_likes to service_role;

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
