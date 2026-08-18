-- FRAUDE 10 Yıllık BIST KAP XBRL Finansal Veritabanı Şeması
-- ─────────────────────────────────────────────────────────────────────────────
-- Borsa İstanbul şirketlerinin son 10 yıllık (2016-2026) tüm çeyreklik ve yıllık
-- KAP XBRL finansal raporlarını merkezi veritabanında saklar.
-- Kullanıcıların her açılışta 22.000 KAP dosyası indirmesini önler ve ~50ms'de
-- tüm geçmiş bilançoların çekilmesini sağlar.

create table if not exists public.bist_financial_periods (
  id                   bigint generated always as identity primary key,
  ticker               text not null,
  period               text not null, -- 'YYYY-MM-DD' (ör. '2024-06-30')
  year                 integer not null,
  quarter              smallint not null check (quarter between 1 and 4),
  is_annual            boolean not null default false,
  currency             text not null default 'TRY',

  -- Gelir Tablosu Kalemleri (TL)
  revenue              double precision,
  gross_profit         double precision,
  operating_income     double precision,
  net_income           double precision,

  -- Bilanço Kalemleri (TL)
  total_assets         double precision,
  total_equity         double precision,
  total_debt           double precision,

  -- Nakit Akış Kalemleri (TL)
  operating_cash_flow  double precision,
  free_cash_flow       double precision,

  -- Üst Veri
  disclosure_index     bigint,
  source               text not null default 'KAP_XBRL', -- 'KAP_XBRL' veya 'IS_YATIRIM'
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint uq_bist_fin_ticker_period_curr unique (ticker, period, currency)
);

create index if not exists bist_financial_periods_ticker_idx
  on public.bist_financial_periods (ticker);

create index if not exists bist_financial_periods_period_idx
  on public.bist_financial_periods (period);

create index if not exists bist_financial_periods_year_quarter_idx
  on public.bist_financial_periods (year, quarter);

-- RLS (Row Level Security) Yapılandırması
alter table public.bist_financial_periods enable row level security;

-- Herkes (anonim ve giriş yapmış kullanıcılar) finansal tabloları okuyabilir ve ekleyebilir.
drop policy if exists bist_financial_periods_public_select on public.bist_financial_periods;
create policy bist_financial_periods_public_select on public.bist_financial_periods
  for select to anon, authenticated using (true);

drop policy if exists bist_financial_periods_public_insert on public.bist_financial_periods;
create policy bist_financial_periods_public_insert on public.bist_financial_periods
  for insert to anon, authenticated with check (true);

drop policy if exists bist_financial_periods_public_update on public.bist_financial_periods;
create policy bist_financial_periods_public_update on public.bist_financial_periods
  for update to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on public.bist_financial_periods to anon, authenticated;
grant all on public.bist_financial_periods to service_role;
