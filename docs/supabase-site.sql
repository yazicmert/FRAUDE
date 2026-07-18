-- FRAUDE web sitesi şeması: lisans talepleri + admin paneli
-- ─────────────────────────────────────────────────────────────────────────────
-- ÖNKOŞUL: docs/supabase-licenses.sql çalıştırılmış olmalı.
-- Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırın.
-- Tekrar çalıştırmak güvenlidir.
--
-- Kendinizi admin yapmak için (bir kez):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'SIZIN-EPOSTANIZ'
--   on conflict do nothing;

-- ── Adminler ────────────────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- Politika yok: tabloya yalnız SQL editor / service_role dokunur.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ── Lisans talepleri ────────────────────────────────────────────────────────
create table if not exists public.license_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  email         text not null,
  name          text,
  note          text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  -- Onayda üretilen anahtar; RLS gereği yalnız sahibi (ve admin RPC'leri) okur.
  -- Anahtar hash olarak licenses'ta durur; buradaki kopya teslimat içindir.
  delivered_key text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.license_requests enable row level security;
-- Lisans e-postası gönderim damgası (send-license-email Edge Function yazar)
alter table public.license_requests add column if not exists emailed_at timestamptz;

drop policy if exists "own-insert" on public.license_requests;
create policy "own-insert" on public.license_requests
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own-select" on public.license_requests;
create policy "own-select" on public.license_requests
  for select to authenticated
  using (user_id = auth.uid());

-- ── Anahtar üretimi (SQL içinde; algoritma license.ts / gen-licenses.mjs ile
--    BİREBİR aynı: 12 karakter yük + SHA-256 tabanlı 4 karakter checksum) ────
create or replace function public._generate_license(
  p_plan    text,
  p_devices int,
  p_expires timestamptz,
  p_note    text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  payload   text := '';
  check4    text := '';
  full16    text;
  canonical text;
  rnd       bytea;
  dgst      bytea;
  i         int;
begin
  rnd := extensions.gen_random_bytes(12);
  for i in 0..11 loop
    payload := payload || substr(alphabet, (get_byte(rnd, i) % 30) + 1, 1);
  end loop;
  dgst := extensions.digest(payload, 'sha256');
  for i in 0..3 loop
    check4 := check4 || substr(alphabet, (get_byte(dgst, i) % 30) + 1, 1);
  end loop;
  full16 := payload || check4;
  canonical := 'FRAUDE-' || substr(full16, 1, 4) || '-' || substr(full16, 5, 4)
            || '-' || substr(full16, 9, 4) || '-' || substr(full16, 13, 4);

  insert into licenses (key_hash, plan, max_devices, expires_at, note)
  values (
    encode(extensions.digest(canonical, 'sha256'), 'hex'),
    coalesce(p_plan, 'standard'),
    coalesce(p_devices, 2),
    p_expires,
    p_note
  );
  return canonical;
end;
$$;
revoke execute on function public._generate_license(text, int, timestamptz, text)
  from public, anon, authenticated;

-- ── Admin RPC'leri ──────────────────────────────────────────────────────────
create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  return jsonb_build_object(
    'ok', true,
    'licenses_total',   (select count(*) from licenses),
    'licenses_unused',  (select count(*) from licenses where status = 'unused'),
    'licenses_active',  (select count(*) from licenses where status = 'active'
                           and (expires_at is null or expires_at > now())),
    'licenses_revoked', (select count(*) from licenses where status = 'revoked'),
    'licenses_expired', (select count(*) from licenses
                           where expires_at is not null and expires_at < now()
                             and status <> 'revoked'),
    'requests_pending', (select count(*) from license_requests where status = 'pending'),
    'users_total',      (select count(*) from auth.users),
    'activations_total',(select count(*) from license_activations)
  );
end;
$$;

create or replace function public.admin_list_licenses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  return jsonb_build_object('ok', true, 'licenses', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'status', l.status,
      'plan', l.plan,
      'max_devices', l.max_devices,
      'expires_at', l.expires_at,
      'expired', (l.expires_at is not null and l.expires_at < now()),
      'note', l.note,
      'email', u.email,
      'devices', (select count(*) from license_activations a where a.license_id = l.id),
      'activated_at', l.activated_at,
      'created_at', l.created_at
    ) order by l.created_at desc)
    from licenses l
    left join auth.users u on u.id = l.activated_by
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_list_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  return jsonb_build_object('ok', true, 'requests', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'email', r.email,
      'name', r.name,
      'note', r.note,
      'status', r.status,
      'delivered_key', r.delivered_key,
      'decided_at', r.decided_at,
      'emailed_at', r.emailed_at,
      'created_at', r.created_at
    ) order by (r.status = 'pending') desc, r.created_at desc)
    from license_requests r
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_generate_licenses(
  p_count   int,
  p_plan    text default 'standard',
  p_devices int default 2,
  p_expires timestamptz default null,
  p_note    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keys jsonb := '[]'::jsonb;
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  if p_count is null or p_count < 1 or p_count > 200 then
    return jsonb_build_object('ok', false, 'error', 'count-range');
  end if;
  for _ in 1..p_count loop
    keys := keys || to_jsonb(_generate_license(p_plan, p_devices, p_expires, p_note));
  end loop;
  -- Anahtarlar YALNIZ bu yanıtta görünür; veritabanında sadece hash durur.
  return jsonb_build_object('ok', true, 'keys', keys);
end;
$$;

create or replace function public.admin_approve_request(
  p_request_id uuid,
  p_plan       text default 'standard',
  p_devices    int default 2,
  p_expires    timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request license_requests%rowtype;
  v_key     text;
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  select * into v_request from license_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already-decided');
  end if;

  v_key := _generate_license(p_plan, p_devices, p_expires, 'talep: ' || v_request.email);
  update license_requests
     set status = 'approved', delivered_key = v_key, decided_at = now()
   where id = p_request_id;
  return jsonb_build_object('ok', true, 'key', v_key);
end;
$$;

create or replace function public.admin_reject_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  update license_requests
     set status = 'rejected', decided_at = now()
   where id = p_request_id and status = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_revoke_license(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not-admin');
  end if;
  update licenses set status = 'revoked' where id = p_license_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Yalnız oturumlu kullanıcılar çağırabilir (fonksiyon içi is_admin ayrıca korur).
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_overview()',
    'admin_list_licenses()',
    'admin_list_requests()',
    'admin_generate_licenses(int, text, int, timestamptz, text)',
    'admin_approve_request(uuid, text, int, timestamptz)',
    'admin_reject_request(uuid)',
    'admin_revoke_license(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;
