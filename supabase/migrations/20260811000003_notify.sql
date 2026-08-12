-- FRAUDE bildirim + BIST evreni şeması
-- ─────────────────────────────────────────────────────────────────────────────
-- ÖNKOŞUL: docs/supabase-licenses.sql çalıştırılmış olmalı (auth.users bağı).
-- Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırın.
-- Tekrar çalıştırmak güvenlidir (create ... if not exists / create or replace).
--
-- NEDEN BU DOSYA VAR: bu dört tablo uzun süre yalnızca canlı veritabanında
-- vardı, depoda karşılığı yoktu. Yeni bir Supabase projesi kurulurken
-- (2026-08-11 taşıması) eksik oldukları ortaya çıktı. Şema, canlı projenin
-- PostgREST tip bilgisinden ve bu tabloları kullanan Edge Function'lardan
-- birebir çıkarıldı.
--
-- Tabloları kullananlar:
--   bist_tickers      → refresh-bist-universe (yazar), site/src/lib/bistUniverse.ts (okur)
--   notify_prefs      → market-watch + notify-feed (okur), uygulama ve site (kendi satırı)
--   notify_deliveries → market-watch (yazar), notify-feed (okur)
--   notify_seen       → market-watch (imleç: her kaynakta en son işlenen kayıt)

-- ── BIST evreni ─────────────────────────────────────────────────────────────
-- KAP'tan günlük tazelenen kod→ad eşlemesi. Herkese açık referans veridir.
create table if not exists public.bist_tickers (
  code       text primary key,
  name       text not null,
  updated_at timestamptz not null default now()
);

alter table public.bist_tickers enable row level security;

-- Site giriş yapmadan da ticker listesini okur.
drop policy if exists bist_tickers_read on public.bist_tickers;
create policy bist_tickers_read on public.bist_tickers
  for select to anon, authenticated using (true);

-- ── Bildirim tercihleri ─────────────────────────────────────────────────────
-- Her hesap için tek satır. feed_token Chrome eklentisinin kimliğidir:
-- notify-feed bu değerle kullanıcıyı bulur, Supabase oturumu istemez.
create table if not exists public.notify_prefs (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  enabled      boolean not null default true,
  kap_enabled  boolean not null default true,
  spk_enabled  boolean not null default true,
  news_enabled boolean not null default true,
  tickers      text[] not null default '{}',
  keywords     text[] not null default '{}',
  min_priority smallint not null default 2,
  feed_token   text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists notify_prefs_enabled on public.notify_prefs (enabled);

alter table public.notify_prefs enable row level security;

-- Kullanıcı yalnız kendi satırını görür/yazar. feed_token da bu yolla okunur.
drop policy if exists notify_prefs_own_select on public.notify_prefs;
create policy notify_prefs_own_select on public.notify_prefs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notify_prefs_own_insert on public.notify_prefs;
create policy notify_prefs_own_insert on public.notify_prefs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notify_prefs_own_update on public.notify_prefs;
create policy notify_prefs_own_update on public.notify_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Teslim edilen bildirimler ───────────────────────────────────────────────
-- market-watch yazar, notify-feed (service_role) okur. İstemci doğrudan
-- erişmez: RLS açık, policy yok.
create table if not exists public.notify_deliveries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  source     text not null,
  priority   smallint not null default 3,
  title      text not null,
  summary    text,
  tickers    text[] not null default '{}',
  url        text,
  created_at timestamptz not null default now()
);

create index if not exists notify_deliveries_user_time
  on public.notify_deliveries (user_id, created_at desc);

alter table public.notify_deliveries enable row level security;

-- ── Kaynak imleçleri ────────────────────────────────────────────────────────
-- Her kaynak (kap / spk / news) için en son işlenen kayıt anahtarı; aynı
-- bildirimin iki kez gönderilmesini engeller. Yalnız market-watch dokunur.
create table if not exists public.notify_seen (
  source     text primary key,
  last_key   text,
  updated_at timestamptz not null default now()
);

alter table public.notify_seen enable row level security;

-- ── Edge Function'lar için erişim ───────────────────────────────────────────
-- service_role RLS'i atlar; yine de yeni tablolarda varsayılan grant
-- gelmediği için açıkça verilir.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.bist_tickers to service_role;
grant select, insert, update, delete on public.notify_prefs to service_role;
grant select, insert, update, delete on public.notify_deliveries to service_role;
grant select, insert, update, delete on public.notify_seen to service_role;
