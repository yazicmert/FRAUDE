-- ==============================================================================
-- FRAUDE — bist_financial_periods Tablo İzinleri ve Güvenli Toplu Yazma RPC'si
-- ==============================================================================

-- 1. Tablo yetkilerini açıkça ver
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.bist_financial_periods to anon, authenticated, service_role;

-- RLS Politikalarını Açıkça Tanımla
alter table public.bist_financial_periods enable row level security;

drop policy if exists bist_financial_periods_public_select on public.bist_financial_periods;
create policy bist_financial_periods_public_select on public.bist_financial_periods
  for select to anon, authenticated using (true);

drop policy if exists bist_financial_periods_public_insert on public.bist_financial_periods;
create policy bist_financial_periods_public_insert on public.bist_financial_periods
  for insert to anon, authenticated with check (true);

drop policy if exists bist_financial_periods_public_update on public.bist_financial_periods;
create policy bist_financial_periods_public_update on public.bist_financial_periods
  for update to anon, authenticated using (true) with check (true);

-- 2. Güvenli Toplu Bilanço Yazma RPC Fonksiyonu (Security Definer - Sıfır Yetki Hatası)
create or replace function public.upsert_financial_periods_batch(p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  insert into public.bist_financial_periods (
    ticker, period, year, quarter, is_annual, currency,
    revenue, gross_profit, operating_income, net_income,
    total_assets, total_equity, total_debt,
    operating_cash_flow, free_cash_flow, disclosure_index, source
  )
  select
    (x->>'ticker')::text,
    (x->>'period')::text,
    (x->>'year')::int,
    (x->>'quarter')::smallint,
    (x->>'is_annual')::boolean,
    coalesce((x->>'currency')::text, 'TRY'),
    (x->>'revenue')::numeric,
    (x->>'gross_profit')::numeric,
    (x->>'operating_income')::numeric,
    (x->>'net_income')::numeric,
    (x->>'total_assets')::numeric,
    (x->>'total_equity')::numeric,
    (x->>'total_debt')::numeric,
    (x->>'operating_cash_flow')::numeric,
    (x->>'free_cash_flow')::numeric,
    (x->>'disclosure_index')::bigint,
    coalesce((x->>'source')::text, 'KAP_XBRL')
  from jsonb_array_elements(p_rows) as x
  on conflict (ticker, period, currency) do update set
    revenue = excluded.revenue,
    gross_profit = excluded.gross_profit,
    operating_income = excluded.operating_income,
    net_income = excluded.net_income,
    total_assets = excluded.total_assets,
    total_equity = excluded.total_equity,
    total_debt = excluded.total_debt,
    operating_cash_flow = excluded.operating_cash_flow,
    free_cash_flow = excluded.free_cash_flow,
    disclosure_index = excluded.disclosure_index,
    source = excluded.source,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.upsert_financial_periods_batch(jsonb) to anon, authenticated, service_role;
