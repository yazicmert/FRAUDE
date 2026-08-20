-- FRAUDE — Telegram Botu ve 6 Haneli Eşleştirme Kodu Altyapısı
-- ─────────────────────────────────────────────────────────────────────────────
-- Kullanıcıların Telegram botu üzerinden (@FraudeTerminalBot) 6 haneli kod
-- ile hesaplarını bağlamasını sağlar.

-- 1. Eşleştirme Kodları Tablosu
create table if not exists public.telegram_link_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text not null,
  code       text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_codes_lookup
  on public.telegram_link_codes (code, expires_at)
  where used_at is null;

create index if not exists telegram_link_codes_user
  on public.telegram_link_codes (user_id, created_at desc);

alter table public.telegram_link_codes enable row level security;

-- Kullanıcı yalnız kendi kodlarını görebilir ve oluşturabilir
drop policy if exists telegram_link_codes_select on public.telegram_link_codes;
create policy telegram_link_codes_select on public.telegram_link_codes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists telegram_link_codes_insert on public.telegram_link_codes;
create policy telegram_link_codes_insert on public.telegram_link_codes
  for insert to authenticated with check (user_id = auth.uid());

grant select, insert on public.telegram_link_codes to authenticated;
grant select, insert, update, delete on public.telegram_link_codes to service_role;

-- 2. notify_transports tablosuna Telegram desteği
alter table public.notify_transports
  drop constraint if exists notify_transports_kind_check,
  add constraint notify_transports_kind_check
    check (kind in ('platform', 'webhook', 'api', 'telegram'));

alter table public.notify_transports
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_username text;
