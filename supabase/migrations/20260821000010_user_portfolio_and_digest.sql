-- FRAUDE — Telegram Mini Portföy ve Günlük Bülten Tercihi
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. notify_prefs tablosuna daily_digest_enabled (Sabah/Akşam bülteni) ekle
alter table public.notify_prefs
  add column if not exists daily_digest_enabled boolean not null default true;

-- 2. user_portfolio_items tablosu (Telegram & Terminal Portföy Takibi)
create table if not exists public.user_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  shares numeric(14, 4) not null check (shares > 0),
  cost_basis numeric(14, 4) not null check (cost_basis >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_portfolio_ticker_unique unique (user_id, ticker)
);

create index if not exists idx_user_portfolio_lookup
  on public.user_portfolio_items (user_id);

alter table public.user_portfolio_items enable row level security;

drop policy if exists "user_portfolio_own_select" on public.user_portfolio_items;
create policy "user_portfolio_own_select" on public.user_portfolio_items
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_portfolio_own_insert" on public.user_portfolio_items;
create policy "user_portfolio_own_insert" on public.user_portfolio_items
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_portfolio_own_update" on public.user_portfolio_items;
create policy "user_portfolio_own_update" on public.user_portfolio_items
  for update to authenticated using (auth.uid() = user_id);

drop policy if exists "user_portfolio_own_delete" on public.user_portfolio_items;
create policy "user_portfolio_own_delete" on public.user_portfolio_items
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_portfolio_items to authenticated;
grant select, insert, update, delete on public.user_portfolio_items to service_role;

-- Realtime yayınına ekle
alter publication supabase_realtime add table public.user_portfolio_items;
alter table public.user_portfolio_items replica identity full;
