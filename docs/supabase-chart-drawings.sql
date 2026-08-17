-- FRAUDE Grafik Çizimleri Şeması (Chart Drawings Persistence)
-- ─────────────────────────────────────────────────────────────────────────────
-- Kullanıcıların grafikler üzerine yaptığı teknik analiz çizimlerini bulutta
-- saklar; uygulama güncellendiğinde, silinip tekrar yüklendiğinde veya başka
-- cihazlardan açıldığında çizimlerin korunmasını sağlar.
--
-- Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırabilirsiniz.

create table if not exists public.user_chart_drawings (
  user_id      uuid not null references auth.users (id) on delete cascade,
  ticker       text not null,
  drawings     jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (user_id, ticker)
);

create index if not exists user_chart_drawings_user_idx
  on public.user_chart_drawings (user_id);

create index if not exists user_chart_drawings_ticker_idx
  on public.user_chart_drawings (ticker);

alter table public.user_chart_drawings enable row level security;

-- Kullanıcı yalnızca kendi çizimlerini görebilir ve yönetebilir.
drop policy if exists user_chart_drawings_own_select on public.user_chart_drawings;
create policy user_chart_drawings_own_select on public.user_chart_drawings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_chart_drawings_own_insert on public.user_chart_drawings;
create policy user_chart_drawings_own_insert on public.user_chart_drawings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_chart_drawings_own_update on public.user_chart_drawings;
create policy user_chart_drawings_own_update on public.user_chart_drawings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_chart_drawings_own_delete on public.user_chart_drawings;
create policy user_chart_drawings_own_delete on public.user_chart_drawings
  for delete to authenticated using (user_id = auth.uid());

grant usage on schema public to service_role, authenticated;
grant select, insert, update, delete on public.user_chart_drawings to service_role, authenticated;
