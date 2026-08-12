-- Supabase taklidi: docs/supabase-forum.sql'i yerel bir Postgres'te sınamak için.
--
-- Gerçek Supabase'in forum şemasına dokunan yüzeyi küçüktür: `auth.users`
-- tablosu, `auth.uid()` / `auth.jwt()` işlevleri ve anon/authenticated/
-- service_role rolleri. Burada yalnız o yüzey taklit edilir; test dosyası
-- bunun üstünde gerçek şemayı çalıştırır.
--
-- Bu dosya üretimde ÇALIŞTIRILMAZ, yalnız scripts/test-forum-sql.sh içinden
-- geçici bir kümede kullanılır.

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Oturum, PostgREST'in kullandığı GUC'lerle taklit edilir.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- ── Test yardımcıları ───────────────────────────────────────────────────────

-- Oturum açar. security definer: `auth.users` okuması gerekir ve testler
-- çoğu zaman `authenticated` rolündeyken çağırır. `set role` BU İŞLEVİN
-- İÇİNDE yapılamaz (Postgres security definer içinde rol değiştirmeye izin
-- vermez), bu yüzden rol değişimi çağrı yerinde kalır.
create or replace function public.tst_login(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  u auth.users%rowtype;
begin
  select * into u from auth.users where id = p_id;
  if u.id is null then
    raise exception 'tst_login: kullanıcı yok %', p_id;
  end if;
  perform set_config('request.jwt.claim.sub', u.id::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', u.id,
    'email', u.email,
    'role', 'authenticated',
    'user_metadata', u.raw_user_meta_data
  )::text, false);
end;
$$;

create or replace function public.tst_logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '', false);
end;
$$;

-- Başarısız iddia testi durdurur (psql ON_ERROR_STOP ile birlikte).
create or replace function public.tst_assert(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if coalesce(p_ok, false) then
    raise notice '  ✓ %', p_label;
  else
    raise exception '  ✗ %', p_label;
  end if;
end;
$$;

grant execute on function public.tst_login(uuid) to public;
grant execute on function public.tst_logout() to public;
grant execute on function public.tst_assert(boolean, text) to public;

-- ── Test kullanıcıları ──────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ada@example.com',   '{"name": "Ada Test"}'),
  ('22222222-2222-2222-2222-222222222222', 'boran@example.com', '{"full_name": "Boran Test"}'),
  ('33333333-3333-3333-3333-333333333333', 'ceyda@example.com', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'mod@example.com',   '{"user_name": "moderator"}'),
  ('55555555-5555-5555-5555-555555555555', 'elif@example.com',  '{"name": "Elif Test"}'),
  ('66666666-6666-6666-6666-666666666666', 'ferit@example.com', '{"name": "Ferit Test"}')
on conflict (id) do nothing;
