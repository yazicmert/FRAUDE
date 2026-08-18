-- ==============================================================================
-- FRAUDE — BIST Şirket Evreni & Otomatik Bilanço Senkronizasyon Şeması
-- ==============================================================================

-- 1. BIST Şirketleri Evren Tablosu (KAP bist-sirketler kaynağından beslenir)
create table if not exists public.bist_tickers (
  code text primary key,
  name text not null,
  status text not null default 'active', -- 'active' veya 'delisted'
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_reconciled_at timestamptz
);

-- Kolonların mevcut olduğundan emin ol (varsa alter et)
alter table public.bist_tickers add column if not exists first_seen_at timestamptz not null default now();
alter table public.bist_tickers add column if not exists status text not null default 'active';
alter table public.bist_tickers add column if not exists last_reconciled_at timestamptz;

-- İndeksler
create index if not exists idx_bist_tickers_status on public.bist_tickers(status);
create index if not exists idx_bist_tickers_updated on public.bist_tickers(updated_at desc);

-- RLS Politikaları
alter table public.bist_tickers enable row level security;

drop policy if exists bist_tickers_public_select on public.bist_tickers;
create policy bist_tickers_public_select on public.bist_tickers
  for select to anon, authenticated using (true);

drop policy if exists bist_tickers_public_write on public.bist_tickers;
create policy bist_tickers_public_write on public.bist_tickers
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update on public.bist_tickers to anon, authenticated;
grant all on public.bist_tickers to service_role;

-- 2. Hızlı İstatistik Fonksiyonu (Frontend ve CLI için)
create or replace function public.get_financial_archive_stats()
returns json
language plpgsql
security definer
as $$
declare
  v_total_tickers int;
  v_total_periods int;
  v_universe_count int;
  v_latest timestamptz;
begin
  select count(distinct ticker), count(*), max(created_at)
    into v_total_tickers, v_total_periods, v_latest
    from public.bist_financial_periods;

  select count(*)
    into v_universe_count
    from public.bist_tickers
    where status = 'active';

  return json_build_object(
    'indexed_tickers', coalesce(v_total_tickers, 0),
    'total_periods', coalesce(v_total_periods, 0),
    'universe_count', coalesce(v_universe_count, 614),
    'latest_created_at', v_latest
  );
end;
$$;

grant execute on function public.get_financial_archive_stats() to anon, authenticated, service_role;
