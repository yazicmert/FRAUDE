-- =============================================================================
-- FRAUDE — Kullanıcı Bazlı Özel Bulut Alarm Şeması (user_alerts)
-- =============================================================================
-- Fiyat eşikleri, KAP bildirimleri, SPK bültenleri ve haber koşulları için
-- kullanıcı tanımlı 24/7 bulut alarmlarını saklar.
--
-- market-watch Edge Function bu tabloyu 10 dakikada bir kontrol eder ve
-- koşul sağlandığında kullanıcıya Brevo/SMTP üzerinden anlık e-posta gönderir.
--
-- Kurulum:
--   Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırın.
-- =============================================================================

create table if not exists public.user_alerts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  ticker         text not null,                         -- 'THYAO', 'ASELS', 'BTC-USD', 'XU100' vb.
  metric         text not null                          -- 'price', 'change_pct', 'rsi', 'kap', 'spk', 'news'
                 check (metric in ('price', 'change_pct', 'rsi', 'sma50', 'week_52_high', 'week_52_low', 'kap', 'spk', 'news')),
  op             text not null default 'above'          -- 'above', 'below', 'contains', 'any'
                 check (op in ('above', 'below', 'contains', 'any')),
  threshold      numeric,                               -- Hedef fiyat / yüzde / rsi eşiği (örn: 340.50)
  keywords       text[] default '{}',                   -- KAP / Haber için anahtar kelimeler
  note           text,                                  -- Kullanıcının özel notu (örn: 'Direnç Kırılımı')
  enabled        boolean not null default true,
  repeat         boolean not null default false,        -- Tek seferlik mi, sürekli mi?
  email_notify   boolean not null default true,         -- E-posta gönderilsin mi?
  is_triggered   boolean not null default false,
  created_at     timestamptz not null default now(),
  triggered_at   timestamptz,
  last_value     numeric,
  trigger_reason text
);

-- Hızlı sorgulama için indeksler
create index if not exists idx_user_alerts_lookup
  on public.user_alerts (user_id, enabled, metric);

create index if not exists idx_user_alerts_ticker
  on public.user_alerts (ticker, metric) where enabled = true;

-- Row Level Security (RLS)
alter table public.user_alerts enable row level security;

-- Kullanıcı sadece kendi alarmlarını görebilir ve yönetebilir
drop policy if exists "user_alerts_own_select" on public.user_alerts;
create policy "user_alerts_own_select" on public.user_alerts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_alerts_own_insert" on public.user_alerts;
create policy "user_alerts_own_insert" on public.user_alerts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_alerts_own_update" on public.user_alerts;
create policy "user_alerts_own_update" on public.user_alerts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_alerts_own_delete" on public.user_alerts;
create policy "user_alerts_own_delete" on public.user_alerts
  for delete to authenticated
  using (user_id = auth.uid());

-- Yetkilendirmeler
grant select, insert, update, delete on public.user_alerts to authenticated;
grant select, insert, update, delete on public.user_alerts to service_role;
