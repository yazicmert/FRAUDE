-- ==============================================================================
-- FRAUDE — KAP XBRL Finansal Veri Boru Hattı v2
-- ==============================================================================
--
-- v1 şemasının düzeltilen sorunları:
--
-- 1. `bist_financial_periods` anahtarı (ticker, period, currency) idi. Şirketler
--    aynı dönem için hem konsolide hem solo tablo yayımlıyor (AKBNK 2024/Ç4:
--    konsolide 2,65 trn TL, solo 2,52 trn TL). İki kayıt aynı satıra çöküyor,
--    hangisinin kaldığı hangisinin sonra işlendiğine bağlı kalıyordu. Artık
--    `consolidation` anahtarın parçası.
--
-- 2. `revenue` gibi akış kalemleri KAP'ta **yılbaşından itibaren kümülatif**
--    yayımlanıyor (Ç2 raporundaki hasılat altı aylık). Şemada bunu belirten bir
--    şey yoktu; çeyreklik grafikler her yıl sıfırlanan testere dişi üretiyordu.
--    Artık `_ytd` ve `_q` ayrı kolonlar.
--
-- 3. Para alanları `double precision` idi ve upsert RPC'si `::numeric`e çevirip
--    float8'e yazdığı için hassasiyet yine kayboluyordu. Artık `numeric(38,4)`.
--
-- 4. `anon` rolünün tabloya insert/update/delete yetkisi vardı ve anon anahtar
--    hem dağıtılan uygulama ikilisinde hem depoda açıktı. Uygulamayı indiren
--    herkes tüm finansal arşivi tek istekte silebiliyordu. Artık anon yalnızca
--    okuyabiliyor; yazma service_role'e ait.
--
-- 5. Ham veri saklanmıyordu; parser iyileştiğinde 22.000 sayfayı yeniden
--    indirmek gerekiyordu. `bist_financial_facts` her XBRL satırını uzun
--    formatta tutuyor, yeni gösterge eklemek yeniden tarama gerektirmiyor.

-- ─────────────────────────────────────────────────────────────────────────────
-- Ortak yardımcılar
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Bildirim defteri — tarama durumunu tam olarak takip eder
-- ─────────────────────────────────────────────────────────────────────────────
--
-- v1'de atlama kararı yayın tarihinden **tahmin edilen** döneme bakıyordu.
-- Gecikmeli ve düzeltilmiş raporlarda tahmin tutmadığı için gerçekten eksik olan
-- çeyrekler atlanıyordu. Burada bildirim numarası birincil anahtar olduğu için
-- "bu bildirim işlendi mi" sorusu kesin yanıtlanıyor.
--
-- Tek bildirim birden çok hisseye bağlanabiliyor (ISATR/ISBTR/ISCTR aynı
-- finansal tabloyu paylaşıyor), bu yüzden anahtar (bildirim, hisse) çifti.

create table if not exists public.kap_disclosures (
  disclosure_index  bigint      not null,
  ticker            text        not null,
  publish_date      timestamptz,
  subject           text,
  period            date,
  consolidation     text        check (consolidation in ('consolidated', 'solo')),
  status            text        not null default 'pending'
                                check (status in ('pending', 'parsed', 'failed', 'unparsable')),
  parser_version    integer,
  error             text,
  parsed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  primary key (disclosure_index, ticker)
);

create index if not exists kap_disclosures_ticker_idx on public.kap_disclosures (ticker);
create index if not exists kap_disclosures_status_idx on public.kap_disclosures (status);
create index if not exists kap_disclosures_period_idx on public.kap_disclosures (period);

drop trigger if exists kap_disclosures_touch on public.kap_disclosures;
create trigger kap_disclosures_touch before update on public.kap_disclosures
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Uzun formatlı gerçek tablosu — her XBRL satırı olduğu gibi
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Geniş tablo yalnızca ortak metrikleri taşıyor. Beneish M-Score, Altman
-- Z-Score, Sloan tahakkuk oranı gibi göstergeler stok, ticari alacak, amortisman
-- gibi kalemleri istiyor; onları buradan türetmek yeniden tarama gerektirmiyor.

create table if not exists public.bist_financial_facts (
  ticker            text          not null,
  period            date          not null,
  consolidation     text          not null check (consolidation in ('consolidated', 'solo')),
  statement         text,                              -- balance_sheet | income | cash_flow
  concept           text          not null,            -- ör. ifrs-full_Revenue
  -- Ölçüm süresi: 0 anlık (bilanço), 3/6/9/12 süre ölçümü.
  months            smallint      not null default 0,
  -- Banka bilançolarında para birimi kırılımı: TP | YP | Toplam.
  subcolumn         text          not null default 'Toplam',
  label             text,
  role              text,
  period_start      date,
  value             numeric(38, 4),
  disclosure_index  bigint,
  updated_at        timestamptz   not null default now(),

  primary key (ticker, period, consolidation, statement, concept, months, subcolumn)
);

create index if not exists bist_financial_facts_concept_idx
  on public.bist_financial_facts (concept, period);
create index if not exists bist_financial_facts_lookup_idx
  on public.bist_financial_facts (ticker, consolidation, period);

drop trigger if exists bist_financial_facts_touch on public.bist_financial_facts;
create trigger bist_financial_facts_touch before update on public.bist_financial_facts
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Geniş dönem tablosu
-- ─────────────────────────────────────────────────────────────────────────────
--
-- v1'deki `bist_financial_periods` yerine geçiyor. Eski tablo bu tablo
-- doldurulup uygulama geçiş yapana kadar duruyor; doğrulama sonrası elle
-- düşürülebilir.

create table if not exists public.bist_financial_statements (
  ticker            text        not null,
  period            date        not null,
  consolidation     text        not null check (consolidation in ('consolidated', 'solo')),
  currency          text        not null default 'TRY',

  year              integer     not null,
  quarter           smallint    not null check (quarter between 1 and 4),
  is_annual         boolean     not null default false,

  -- Gelir tablosu — `_ytd` yılbaşından itibaren kümülatif, `_q` yalnızca çeyrek.
  -- Yıllık raporlarda KAP 3 aylık kolon yayımlamıyor; `_q` orada NULL kalıyor ve
  -- `bist_financial_quarters` görünümünde kümülatif farkından türetiliyor.
  revenue_ytd                   numeric(38, 4),
  revenue_q                     numeric(38, 4),
  cost_of_sales_ytd             numeric(38, 4),
  cost_of_sales_q               numeric(38, 4),
  gross_profit_ytd              numeric(38, 4),
  gross_profit_q                numeric(38, 4),
  operating_income_ytd          numeric(38, 4),
  operating_income_q            numeric(38, 4),
  pretax_income_ytd             numeric(38, 4),
  pretax_income_q               numeric(38, 4),
  net_income_ytd                numeric(38, 4),
  net_income_q                  numeric(38, 4),
  parent_net_income_ytd         numeric(38, 4),
  parent_net_income_q           numeric(38, 4),
  net_interest_income_ytd       numeric(38, 4),
  net_interest_income_q         numeric(38, 4),

  -- Bilanço — anlık ölçümler, dönem sonu itibarıyla.
  total_assets                  numeric(38, 4),
  current_assets                numeric(38, 4),
  cash_and_equivalents          numeric(38, 4),
  trade_receivables             numeric(38, 4),
  inventories                   numeric(38, 4),
  property_plant_equipment      numeric(38, 4),
  total_liabilities             numeric(38, 4),
  equity_and_liabilities        numeric(38, 4),
  current_liabilities           numeric(38, 4),
  short_term_borrowings         numeric(38, 4),
  current_portion_long_term_debt numeric(38, 4),
  long_term_borrowings          numeric(38, 4),
  total_debt                    numeric(38, 4),
  total_equity                  numeric(38, 4),
  parent_equity                 numeric(38, 4),

  -- Nakit akış
  operating_cash_flow_ytd       numeric(38, 4),
  operating_cash_flow_q         numeric(38, 4),
  investing_cash_flow_ytd       numeric(38, 4),
  investing_cash_flow_q         numeric(38, 4),
  financing_cash_flow_ytd       numeric(38, 4),
  financing_cash_flow_q         numeric(38, 4),
  depreciation_amortisation_ytd numeric(38, 4),
  depreciation_amortisation_q   numeric(38, 4),
  free_cash_flow_ytd            numeric(38, 4),

  -- Üst veri
  -- Enflasyon muhasebesi (TMS-29) 31.12.2023 döneminden itibaren zorunlu.
  -- Bu tarihten önceki dönemlerle doğrudan kıyaslanamaz; grafiklerde uyarı
  -- gösterebilmek için bayrak tutuluyor.
  inflation_adjusted            boolean     not null default false,
  presentation_unit             text,
  disclosure_index              bigint,
  publish_date                  timestamptz,
  source                        text        not null default 'KAP_XBRL',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  primary key (ticker, period, consolidation, currency)
);

create index if not exists bist_financial_statements_ticker_idx
  on public.bist_financial_statements (ticker, consolidation, period desc);
create index if not exists bist_financial_statements_year_quarter_idx
  on public.bist_financial_statements (year, quarter);

drop trigger if exists bist_financial_statements_touch on public.bist_financial_statements;
create trigger bist_financial_statements_touch before update on public.bist_financial_statements
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Çeyreklik türetme görünümü
-- ─────────────────────────────────────────────────────────────────────────────
--
-- KAP yıllık raporda 3 aylık kolon yayımlamıyor, ara raporlarda yayımlıyor.
-- Bu görünüm ikisini birleştiriyor: raporlanan çeyreklik değer varsa onu,
-- yoksa kümülatif farkını (Ç4 = yıllık − dokuz aylık) kullanıyor.
--
-- Kümülatif (`*_ytd`) kolonlar da olduğu gibi taşınıyor. Masaüstü istemcisi tek
-- sorguda hem çeyreklik hem yıllık seriyi kurabilsin diye: yıllık seri Ç4
-- satırının kümülatifi, çeyreklik seri türetilmiş değer. İkisi ayrı sorgudan
-- gelseydi istemci her hisse için iki tur atardı.

drop view if exists public.bist_financial_quarters;
create view public.bist_financial_quarters as
select
  s.ticker,
  s.period,
  s.consolidation,
  s.currency,
  s.year,
  s.quarter,
  s.is_annual,
  s.inflation_adjusted,
  coalesce(
    s.revenue_q,
    s.revenue_ytd - lag(s.revenue_ytd) over w
  ) as revenue,
  coalesce(
    s.gross_profit_q,
    s.gross_profit_ytd - lag(s.gross_profit_ytd) over w
  ) as gross_profit,
  coalesce(
    s.operating_income_q,
    s.operating_income_ytd - lag(s.operating_income_ytd) over w
  ) as operating_income,
  coalesce(
    s.net_income_q,
    s.net_income_ytd - lag(s.net_income_ytd) over w
  ) as net_income,
  coalesce(
    s.operating_cash_flow_q,
    s.operating_cash_flow_ytd - lag(s.operating_cash_flow_ytd) over w
  ) as operating_cash_flow,
  -- Serbest nakit akışının çeyreklik kolonu yok; önce raporlanan çeyreklik
  -- işletme + yatırım toplamı, o eksikse kümülatif farkı kullanılıyor.
  coalesce(
    s.operating_cash_flow_q + s.investing_cash_flow_q,
    s.free_cash_flow_ytd - lag(s.free_cash_flow_ytd) over w
  ) as free_cash_flow,
  -- Yıllık seri için kümülatifler: Ç4 satırında bunlar tam yıl demek.
  s.revenue_ytd,
  s.gross_profit_ytd,
  s.operating_income_ytd,
  s.net_income_ytd,
  s.operating_cash_flow_ytd,
  s.free_cash_flow_ytd,
  -- Anlık bilanço kalemleri; dönem sonu itibarıyla, türetme gerekmiyor.
  s.total_assets,
  s.total_equity,
  s.total_debt
from public.bist_financial_statements s
-- Kümülatif fark yalnızca aynı yıl içinde anlamlı; bölümleme yılı da kapsıyor.
window w as (
  partition by s.ticker, s.consolidation, s.currency, s.year
  order by s.quarter
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Toplu yazma RPC'leri (yalnızca service_role)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.upsert_financial_statements(p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  insert into public.bist_financial_statements (
    ticker, period, consolidation, currency, year, quarter, is_annual,
    revenue_ytd, revenue_q, cost_of_sales_ytd, cost_of_sales_q,
    gross_profit_ytd, gross_profit_q, operating_income_ytd, operating_income_q,
    pretax_income_ytd, pretax_income_q, net_income_ytd, net_income_q,
    parent_net_income_ytd, parent_net_income_q,
    net_interest_income_ytd, net_interest_income_q,
    total_assets, current_assets, cash_and_equivalents, trade_receivables,
    inventories, property_plant_equipment, total_liabilities,
    equity_and_liabilities, current_liabilities, short_term_borrowings,
    current_portion_long_term_debt, long_term_borrowings, total_debt,
    total_equity, parent_equity,
    operating_cash_flow_ytd, operating_cash_flow_q,
    investing_cash_flow_ytd, investing_cash_flow_q,
    financing_cash_flow_ytd, financing_cash_flow_q,
    depreciation_amortisation_ytd, depreciation_amortisation_q,
    free_cash_flow_ytd,
    inflation_adjusted, presentation_unit, disclosure_index, publish_date, source
  )
  select
    x->>'ticker',
    (x->>'period')::date,
    x->>'consolidation',
    coalesce(x->>'currency', 'TRY'),
    (x->>'year')::integer,
    (x->>'quarter')::smallint,
    (x->>'is_annual')::boolean,
    (x->>'revenue_ytd')::numeric, (x->>'revenue_q')::numeric,
    (x->>'cost_of_sales_ytd')::numeric, (x->>'cost_of_sales_q')::numeric,
    (x->>'gross_profit_ytd')::numeric, (x->>'gross_profit_q')::numeric,
    (x->>'operating_income_ytd')::numeric, (x->>'operating_income_q')::numeric,
    (x->>'pretax_income_ytd')::numeric, (x->>'pretax_income_q')::numeric,
    (x->>'net_income_ytd')::numeric, (x->>'net_income_q')::numeric,
    (x->>'parent_net_income_ytd')::numeric, (x->>'parent_net_income_q')::numeric,
    (x->>'net_interest_income_ytd')::numeric, (x->>'net_interest_income_q')::numeric,
    (x->>'total_assets')::numeric, (x->>'current_assets')::numeric,
    (x->>'cash_and_equivalents')::numeric, (x->>'trade_receivables')::numeric,
    (x->>'inventories')::numeric, (x->>'property_plant_equipment')::numeric,
    (x->>'total_liabilities')::numeric, (x->>'equity_and_liabilities')::numeric,
    (x->>'current_liabilities')::numeric, (x->>'short_term_borrowings')::numeric,
    (x->>'current_portion_long_term_debt')::numeric,
    (x->>'long_term_borrowings')::numeric, (x->>'total_debt')::numeric,
    (x->>'total_equity')::numeric, (x->>'parent_equity')::numeric,
    (x->>'operating_cash_flow_ytd')::numeric, (x->>'operating_cash_flow_q')::numeric,
    (x->>'investing_cash_flow_ytd')::numeric, (x->>'investing_cash_flow_q')::numeric,
    (x->>'financing_cash_flow_ytd')::numeric, (x->>'financing_cash_flow_q')::numeric,
    (x->>'depreciation_amortisation_ytd')::numeric,
    (x->>'depreciation_amortisation_q')::numeric,
    (x->>'free_cash_flow_ytd')::numeric,
    coalesce((x->>'inflation_adjusted')::boolean, false),
    x->>'presentation_unit',
    (x->>'disclosure_index')::bigint,
    (x->>'publish_date')::timestamptz,
    coalesce(x->>'source', 'KAP_XBRL')
  from jsonb_array_elements(p_rows) as x
  on conflict (ticker, period, consolidation, currency) do update set
    year = excluded.year,
    quarter = excluded.quarter,
    is_annual = excluded.is_annual,
    revenue_ytd = excluded.revenue_ytd, revenue_q = excluded.revenue_q,
    cost_of_sales_ytd = excluded.cost_of_sales_ytd, cost_of_sales_q = excluded.cost_of_sales_q,
    gross_profit_ytd = excluded.gross_profit_ytd, gross_profit_q = excluded.gross_profit_q,
    operating_income_ytd = excluded.operating_income_ytd, operating_income_q = excluded.operating_income_q,
    pretax_income_ytd = excluded.pretax_income_ytd, pretax_income_q = excluded.pretax_income_q,
    net_income_ytd = excluded.net_income_ytd, net_income_q = excluded.net_income_q,
    parent_net_income_ytd = excluded.parent_net_income_ytd, parent_net_income_q = excluded.parent_net_income_q,
    net_interest_income_ytd = excluded.net_interest_income_ytd, net_interest_income_q = excluded.net_interest_income_q,
    total_assets = excluded.total_assets, current_assets = excluded.current_assets,
    cash_and_equivalents = excluded.cash_and_equivalents, trade_receivables = excluded.trade_receivables,
    inventories = excluded.inventories, property_plant_equipment = excluded.property_plant_equipment,
    total_liabilities = excluded.total_liabilities, equity_and_liabilities = excluded.equity_and_liabilities,
    current_liabilities = excluded.current_liabilities, short_term_borrowings = excluded.short_term_borrowings,
    current_portion_long_term_debt = excluded.current_portion_long_term_debt,
    long_term_borrowings = excluded.long_term_borrowings, total_debt = excluded.total_debt,
    total_equity = excluded.total_equity, parent_equity = excluded.parent_equity,
    operating_cash_flow_ytd = excluded.operating_cash_flow_ytd, operating_cash_flow_q = excluded.operating_cash_flow_q,
    investing_cash_flow_ytd = excluded.investing_cash_flow_ytd, investing_cash_flow_q = excluded.investing_cash_flow_q,
    financing_cash_flow_ytd = excluded.financing_cash_flow_ytd, financing_cash_flow_q = excluded.financing_cash_flow_q,
    depreciation_amortisation_ytd = excluded.depreciation_amortisation_ytd,
    depreciation_amortisation_q = excluded.depreciation_amortisation_q,
    free_cash_flow_ytd = excluded.free_cash_flow_ytd,
    inflation_adjusted = excluded.inflation_adjusted,
    presentation_unit = excluded.presentation_unit,
    disclosure_index = excluded.disclosure_index,
    publish_date = excluded.publish_date,
    source = excluded.source,
    updated_at = now()
  -- Düzeltme (revize) bildirimlerinde en yeni yayın kazanır. Bildirimler
  -- tarih sırasız işlendiği için bu koşul olmadan hangi sürümün kalacağı
  -- rastgele oluyordu.
  where excluded.publish_date is null
     or public.bist_financial_statements.publish_date is null
     or excluded.publish_date >= public.bist_financial_statements.publish_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.upsert_financial_facts(p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  insert into public.bist_financial_facts (
    ticker, period, consolidation, statement, concept, months, subcolumn,
    label, role, period_start, value, disclosure_index
  )
  select
    x->>'ticker',
    (x->>'period')::date,
    x->>'consolidation',
    x->>'statement',
    x->>'concept',
    coalesce((x->>'months')::smallint, 0),
    coalesce(x->>'subcolumn', 'Toplam'),
    x->>'label',
    x->>'role',
    (x->>'period_start')::date,
    (x->>'value')::numeric,
    (x->>'disclosure_index')::bigint
  from jsonb_array_elements(p_rows) as x
  on conflict (ticker, period, consolidation, statement, concept, months, subcolumn)
  do update set
    value = excluded.value,
    label = excluded.label,
    role = excluded.role,
    period_start = excluded.period_start,
    disclosure_index = excluded.disclosure_index,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Yetkiler ve RLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Anon anahtar dağıtılan masaüstü uygulamasının içinde gömülü geliyor, yani
-- herkese açık. Bu yüzden anon **yalnızca okuyabilir**; tüm yazma işlemleri
-- service_role anahtarıyla, sunucu tarafındaki backfill işinden yapılır.

alter table public.kap_disclosures            enable row level security;
alter table public.bist_financial_facts       enable row level security;
alter table public.bist_financial_statements  enable row level security;

drop policy if exists kap_disclosures_read on public.kap_disclosures;
create policy kap_disclosures_read on public.kap_disclosures
  for select to anon, authenticated using (true);

drop policy if exists bist_financial_facts_read on public.bist_financial_facts;
create policy bist_financial_facts_read on public.bist_financial_facts
  for select to anon, authenticated using (true);

drop policy if exists bist_financial_statements_read on public.bist_financial_statements;
create policy bist_financial_statements_read on public.bist_financial_statements
  for select to anon, authenticated using (true);

revoke all on public.kap_disclosures           from anon, authenticated;
revoke all on public.bist_financial_facts      from anon, authenticated;
revoke all on public.bist_financial_statements from anon, authenticated;

grant select on public.kap_disclosures           to anon, authenticated;
grant select on public.bist_financial_facts      to anon, authenticated;
grant select on public.bist_financial_statements to anon, authenticated;
grant select on public.bist_financial_quarters   to anon, authenticated;

grant all on public.kap_disclosures           to service_role;
grant all on public.bist_financial_facts      to service_role;
grant all on public.bist_financial_statements to service_role;

-- RPC'ler `security invoker`: yetkiyi çağıranın rolünden alıyorlar, bu yüzden
-- anon çağırsa bile yazamaz. v1'deki `security definer` sürümü anon'a tam yazma
-- yetkisi veriyordu.
revoke all on function public.upsert_financial_statements(jsonb) from public, anon, authenticated;
revoke all on function public.upsert_financial_facts(jsonb)      from public, anon, authenticated;
grant execute on function public.upsert_financial_statements(jsonb) to service_role;
grant execute on function public.upsert_financial_facts(jsonb)      to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. v1 tablolarının kilitlenmesi
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `bist_financial_periods` yeni tablo doğrulanana kadar okunabilir kalıyor,
-- fakat yazma yetkisi hemen kaldırılıyor: v1 politikaları anon'a delete veriyordu.

drop policy if exists bist_financial_periods_public_insert on public.bist_financial_periods;
drop policy if exists bist_financial_periods_public_update on public.bist_financial_periods;
revoke insert, update, delete on public.bist_financial_periods from anon, authenticated;

drop policy if exists bist_tickers_public_write on public.bist_tickers;
revoke insert, update, delete on public.bist_tickers from anon, authenticated;

drop function if exists public.upsert_financial_periods_batch(jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Arşiv istatistiği
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_financial_archive_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tickers integer;
  v_periods integer;
  v_facts bigint;
  v_universe integer;
  v_latest timestamptz;
  v_pending integer;
begin
  select count(distinct ticker), count(*), max(created_at)
    into v_tickers, v_periods, v_latest
    from public.bist_financial_statements;

  select count(*) into v_facts from public.bist_financial_facts;

  select count(*) into v_universe
    from public.bist_tickers where status = 'active';

  select count(*) into v_pending
    from public.kap_disclosures where status = 'pending';

  return json_build_object(
    'indexed_tickers', coalesce(v_tickers, 0),
    'total_periods', coalesce(v_periods, 0),
    'total_facts', coalesce(v_facts, 0),
    'universe_count', coalesce(v_universe, 0),
    'pending_disclosures', coalesce(v_pending, 0),
    'latest_created_at', v_latest
  );
end;
$$;

grant execute on function public.get_financial_archive_stats() to anon, authenticated, service_role;
