-- KAP boru hattı v2 şemasının davranış testleri.
-- scripts/kap/tests/run-schema-tests.sh içinden geçici bir Postgres'te koşar.

\set ON_ERROR_STOP on

-- Testler durum biriktiriyor (düzeltme senaryosu kayıtlı yayın tarihini
-- ilerletiyor), bu yüzden her koşu temiz tablolarla başlıyor.
truncate table public.bist_financial_statements,
               public.bist_financial_facts,
               public.kap_disclosures;

create or replace function assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'BASARISIZ: %', label;
  end if;
  raise notice '  ok: %', label;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Konsolide ve solo aynı dönemde yan yana durabilmeli
-- ─────────────────────────────────────────────────────────────────────────────

select public.upsert_financial_statements($$[
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"consolidated","year":2024,
   "quarter":4,"is_annual":true,"total_assets":2653105361000,"revenue_ytd":498842475000,
   "publish_date":"2025-01-30T18:15:20Z"},
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"solo","year":2024,
   "quarter":4,"is_annual":true,"total_assets":2515596654000,"revenue_ytd":480072926000,
   "publish_date":"2025-01-30T18:15:07Z"}
]$$::jsonb);

select assert(count(*) = 2, 'konsolide ve solo ayri satirlar')
from public.bist_financial_statements where ticker = 'AKBNK';

select assert(
  (select total_assets from public.bist_financial_statements
     where ticker='AKBNK' and consolidation='consolidated') = 2653105361000,
  'konsolide degeri solo tarafindan ezilmiyor');

-- ─────────────────────────────────────────────────────────────────────────────
-- Düzeltme bildirimlerinde en yeni yayın kazanmalı
-- ─────────────────────────────────────────────────────────────────────────────

select public.upsert_financial_statements($$[
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"consolidated","year":2024,
   "quarter":4,"is_annual":true,"total_assets":9999999999999,"revenue_ytd":1,
   "publish_date":"2024-06-01T00:00:00Z"}
]$$::jsonb);

select assert(
  (select total_assets from public.bist_financial_statements
     where ticker='AKBNK' and consolidation='consolidated') = 2653105361000,
  'eski yayin tarihli bildirim yeniyi ezmiyor');

select public.upsert_financial_statements($$[
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"consolidated","year":2024,
   "quarter":4,"is_annual":true,"total_assets":2700000000000,"revenue_ytd":498842475000,
   "publish_date":"2025-03-15T10:00:00Z"}
]$$::jsonb);

select assert(
  (select total_assets from public.bist_financial_statements
     where ticker='AKBNK' and consolidation='consolidated') = 2700000000000,
  'duzeltme bildirimi (daha yeni yayin) eskiyi guncelliyor');

-- ─────────────────────────────────────────────────────────────────────────────
-- Çeyreklik türetme: raporlanan varsa o, yoksa kümülatif farkı
-- ─────────────────────────────────────────────────────────────────────────────

select public.upsert_financial_statements($$[
  {"ticker":"TEST","period":"2024-03-31","consolidation":"consolidated","year":2024,
   "quarter":1,"is_annual":false,"revenue_ytd":100,"revenue_q":100},
  {"ticker":"TEST","period":"2024-06-30","consolidation":"consolidated","year":2024,
   "quarter":2,"is_annual":false,"revenue_ytd":250,"revenue_q":150},
  {"ticker":"TEST","period":"2024-09-30","consolidation":"consolidated","year":2024,
   "quarter":3,"is_annual":false,"revenue_ytd":400,"revenue_q":150},
  {"ticker":"TEST","period":"2024-12-31","consolidation":"consolidated","year":2024,
   "quarter":4,"is_annual":true,"revenue_ytd":600}
]$$::jsonb);

-- Ç4'te KAP 3 aylık kolon yayımlamadığı için revenue_q NULL; görünüm
-- 600 - 400 = 200 olarak türetmeli.
select assert(
  (select revenue from public.bist_financial_quarters
     where ticker='TEST' and quarter=4) = 200,
  'Ç4 ceyregi yillik eksi dokuz aylik olarak turetiliyor');

select assert(
  (select revenue from public.bist_financial_quarters
     where ticker='TEST' and quarter=2) = 150,
  'raporlanan ceyreklik deger oldugu gibi kullaniliyor');

select assert(
  (select revenue from public.bist_financial_quarters
     where ticker='TEST' and quarter=1) = 100,
  'Ç1 kumulatif ile ceyreklik esit');

-- Yıl sınırında kümülatif fark alınmamalı: 2025 Ç1 kendi yılının ilk çeyreği.
select public.upsert_financial_statements($$[
  {"ticker":"TEST","period":"2025-03-31","consolidation":"consolidated","year":2025,
   "quarter":1,"is_annual":false,"revenue_ytd":120,"revenue_q":120}
]$$::jsonb);

select assert(
  (select revenue from public.bist_financial_quarters
     where ticker='TEST' and year=2025 and quarter=1) = 120,
  'yil sinirinda onceki yilin kumulatifi karismiyor');

-- Yıllık seri Ç4 satırının kümülatifinden okunuyor: türetilmiş çeyreklik 200
-- iken tam yıl 600 olmalı. İkisi karışırsa yıllık grafikler çeyreklik değer
-- gösteriyordu.
select assert(
  (select revenue_ytd from public.bist_financial_quarters
     where ticker='TEST' and year=2024 and quarter=4) = 600,
  'Ç4 kumulatifi tam yil olarak tasiniyor');

select assert(
  (select revenue from public.bist_financial_quarters
     where ticker='TEST' and year=2024 and quarter=4) = 200,
  'ayni satirda ceyreklik ve yillik yan yana duruyor');

-- ─────────────────────────────────────────────────────────────────────────────
-- Serbest nakit akışı: çeyreklik kolonu yok, iki yoldan türetiliyor
-- ─────────────────────────────────────────────────────────────────────────────

select public.upsert_financial_statements($$[
  {"ticker":"TESTCF","period":"2024-03-31","consolidation":"consolidated","year":2024,
   "quarter":1,"is_annual":false,"operating_cash_flow_q":90,"investing_cash_flow_q":-30,
   "free_cash_flow_ytd":60},
  {"ticker":"TESTCF","period":"2024-06-30","consolidation":"consolidated","year":2024,
   "quarter":2,"is_annual":false,"operating_cash_flow_q":110,"investing_cash_flow_q":-40,
   "free_cash_flow_ytd":130},
  {"ticker":"TESTCF","period":"2024-12-31","consolidation":"consolidated","year":2024,
   "quarter":4,"is_annual":true,"free_cash_flow_ytd":300}
]$$::jsonb);

-- Raporlanan çeyreklik kolonlar varken doğrudan toplamları kullanılıyor.
select assert(
  (select free_cash_flow from public.bist_financial_quarters
     where ticker='TESTCF' and quarter=2) = 70,
  'ceyreklik serbest nakit akisi isletme + yatirim toplami');

-- Yıllık raporda çeyreklik kolon yok; kümülatif farkına düşüyor (300 - 130).
select assert(
  (select free_cash_flow from public.bist_financial_quarters
     where ticker='TESTCF' and quarter=4) = 170,
  'ceyreklik kolon yoksa kumulatif farkina dusuyor');

-- ─────────────────────────────────────────────────────────────────────────────
-- Uzun formatlı gerçek tablosu: aynı concept farklı sürelerde durabilmeli
-- ─────────────────────────────────────────────────────────────────────────────

select public.upsert_financial_facts($$[
  {"ticker":"YUNSA","period":"2025-06-30","consolidation":"consolidated",
   "statement":"income","concept":"ifrs-full_Revenue","months":6,"value":1101690617},
  {"ticker":"YUNSA","period":"2025-06-30","consolidation":"consolidated",
   "statement":"income","concept":"ifrs-full_Revenue","months":3,"value":653559393},
  {"ticker":"YUNSA","period":"2025-06-30","consolidation":"consolidated",
   "statement":"balance_sheet","concept":"ifrs-full_Assets","months":0,"value":5447216986}
]$$::jsonb);

select assert(count(*) = 3, 'kumulatif ve 3 aylik ayni concept icin yan yana')
from public.bist_financial_facts where ticker = 'YUNSA';

-- Banka bilançosundaki TP / YP / Toplam kırılımı çakışmamalı.
select public.upsert_financial_facts($$[
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"consolidated",
   "statement":"balance_sheet","concept":"ifrs-full_Assets","months":0,
   "subcolumn":"TP","value":1787749012000},
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"consolidated",
   "statement":"balance_sheet","concept":"ifrs-full_Assets","months":0,
   "subcolumn":"YP","value":865356349000},
  {"ticker":"AKBNK","period":"2024-12-31","consolidation":"consolidated",
   "statement":"balance_sheet","concept":"ifrs-full_Assets","months":0,
   "subcolumn":"Toplam","value":2653105361000}
]$$::jsonb);

select assert(count(*) = 3, 'TP/YP/Toplam ayri satirlar')
from public.bist_financial_facts where ticker = 'AKBNK';

-- ─────────────────────────────────────────────────────────────────────────────
-- Yetkiler: anon yazamaz
-- ─────────────────────────────────────────────────────────────────────────────

select assert(
  not has_table_privilege('anon', 'public.bist_financial_statements', 'INSERT')
  and not has_table_privilege('anon', 'public.bist_financial_statements', 'UPDATE')
  and not has_table_privilege('anon', 'public.bist_financial_statements', 'DELETE'),
  'anon yeni tabloya yazamiyor');

select assert(
  has_table_privilege('anon', 'public.bist_financial_statements', 'SELECT'),
  'anon yeni tabloyu okuyabiliyor');

select assert(
  not has_table_privilege('anon', 'public.bist_financial_periods', 'INSERT')
  and not has_table_privilege('anon', 'public.bist_financial_periods', 'UPDATE')
  and not has_table_privilege('anon', 'public.bist_financial_periods', 'DELETE'),
  'anon v1 tablosuna artik yazamiyor');

select assert(
  has_table_privilege('anon', 'public.bist_financial_periods', 'SELECT'),
  'v1 tablosu gecis suresince okunabilir kaliyor');

select assert(
  not has_function_privilege('anon', 'public.upsert_financial_statements(jsonb)', 'EXECUTE'),
  'anon toplu yazma RPC sini cagiramiyor');

select assert(
  has_function_privilege('service_role', 'public.upsert_financial_statements(jsonb)', 'EXECUTE'),
  'service_role toplu yazma RPC sini cagirabiliyor');

-- v1'in security definer RPC si anon a tam yazma yetkisi veriyordu; kaldırıldı.
select assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'upsert_financial_periods_batch'),
  'v1 guvenlik acigi olan RPC kaldirildi');

-- RPC'ler security invoker olmalı: definer olsalardı çağıranın yetkisi
-- baypas edilir, anon yine yazabilirdi.
select assert(
  (select bool_and(not prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('upsert_financial_statements','upsert_financial_facts')),
  'toplu yazma RPC leri security invoker');

-- ─────────────────────────────────────────────────────────────────────────────
-- Bildirim defteri
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.kap_disclosures (disclosure_index, ticker, status)
values (1392350, 'ISATR', 'parsed'), (1392350, 'ISBTR', 'parsed'), (1392350, 'ISCTR', 'parsed');

select assert(count(*) = 3, 'tek bildirim birden cok hisseye baglanabiliyor')
from public.kap_disclosures where disclosure_index = 1392350;

select assert(
  (select status from public.kap_disclosures
   where disclosure_index=1392350 and ticker='ISCTR') = 'parsed',
  'defter durumu okunabiliyor');

\echo 'TUM SEMA TESTLERI GECTI'
