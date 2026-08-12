-- FRAUDE lisans şeması
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor'a bu dosyanın tamamını yapıştırıp çalıştırın.
-- Tekrar çalıştırmak güvenlidir (create or replace / if not exists).
--
-- Tasarım:
--  • Anahtarların düz hali DB'de tutulmaz; yalnız SHA-256 özeti (key_hash).
--    Üretim: scripts/gen-licenses.mjs (service-role ile hash yazar, anahtarı
--    ekrana/CSV'ye döker).
--  • İstemci tablolara dokunamaz (RLS açık, policy yok). Tüm işlemler
--    security definer RPC'lerle: activate_license / check_license /
--    release_device / license_overview.
--  • Bir lisans tek HESABA bağlanır; max_devices kadar cihazda çalışır.
--    expires_at null ise süresizdir. status='revoked' anında erişimi keser.
--  • Anahtar YALNIZCA BİR KEZ sorulur: lisansı etkin olan e-posta yeniden
--    giriş yaptığında check_license cihazı kendiliğinden bağlar; anahtar
--    ekranı bir daha çıkmaz. Cihaz sınırı dolduğunda kullanıcı Ayarlar →
--    Hesap'tan (ya da kapıdaki ekrandan) release_device ile yer açar.

create table if not exists public.licenses (
  id            uuid primary key default gen_random_uuid(),
  key_hash      text not null unique,
  status        text not null default 'unused'
                check (status in ('unused', 'active', 'revoked')),
  plan          text not null default 'standard',
  max_devices   int  not null default 2 check (max_devices > 0),
  expires_at    timestamptz,
  note          text,
  activated_by  uuid references auth.users (id) on delete set null,
  activated_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.license_activations (
  id           uuid primary key default gen_random_uuid(),
  license_id   uuid not null references public.licenses (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_id    text not null,
  device_name  text,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_id, device_id)
);

create index if not exists license_activations_user_device
  on public.license_activations (user_id, device_id);

-- RLS: politika tanımlanmaz → anon/authenticated hiçbir satıra erişemez.
-- Erişim yalnızca aşağıdaki security definer fonksiyonlar üzerindendir.
alter table public.licenses enable row level security;
alter table public.license_activations enable row level security;

-- ── Aktivasyon ──────────────────────────────────────────────────────────────
create or replace function public.activate_license(
  p_key_hash    text,
  p_device_id   text,
  p_device_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_license licenses%rowtype;
  v_devices int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not-authenticated');
  end if;
  if p_device_id is null or length(p_device_id) < 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid-key');
  end if;

  select * into v_license from licenses where key_hash = p_key_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid-key');
  end if;
  if v_license.status = 'revoked' then
    return jsonb_build_object('ok', false, 'error', 'revoked');
  end if;
  if v_license.expires_at is not null and v_license.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  -- Lisans başka bir hesaba bağlıysa reddet.
  if v_license.status = 'active' and v_license.activated_by is distinct from v_user then
    return jsonb_build_object('ok', false, 'error', 'in-use');
  end if;
  -- Yeni cihaz için limit denetimi (mevcut cihazın yeniden aktivasyonu serbest).
  select count(*) into v_devices
    from license_activations
   where license_id = v_license.id;
  if v_devices >= v_license.max_devices
     and not exists (
       select 1 from license_activations
        where license_id = v_license.id and device_id = p_device_id
     ) then
    return jsonb_build_object('ok', false, 'error', 'device-limit');
  end if;

  update licenses
     set status = 'active',
         activated_by = v_user,
         activated_at = coalesce(activated_at, now())
   where id = v_license.id;

  insert into license_activations (license_id, user_id, device_id, device_name)
  values (v_license.id, v_user, p_device_id, p_device_name)
  on conflict (license_id, device_id)
  do update set last_seen_at = now(), user_id = excluded.user_id;

  return jsonb_build_object(
    'ok', true,
    'plan', v_license.plan,
    'expires_at', v_license.expires_at
  );
end;
$$;

-- ── Açılış denetimi ─────────────────────────────────────────────────────────
-- Lisans CİHAZA değil HESABA bağlıdır: anahtarı bir kez etkinleştiren e-posta
-- yeni bir bilgisayarda (ya da uygulama verisi silindiğinde oluşan yeni cihaz
-- kimliğiyle) tekrar giriş yaptığında anahtar SORULMAZ — cihaz max_devices
-- sınırı içinde kendiliğinden bağlanır. Sınır dolduysa 'device-limit' döner;
-- kullanıcı release_device ile bir cihaz çıkarıp yer açabilir.
create or replace function public.check_license(p_device_id text, p_device_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_license    licenses%rowtype;
  v_license_id uuid;
  v_devices    int;
  v_bound      boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not-authenticated');
  end if;
  if p_device_id is null or length(p_device_id) < 8 then
    return jsonb_build_object('ok', false, 'error', 'no-license');
  end if;

  -- 1) Hesabın kendi etkinleştirdiği lisans (cihazdan bağımsız).
  select l.* into v_license
    from licenses l
   where l.activated_by = v_user
     and l.status = 'active'
     and (l.expires_at is null or l.expires_at > now())
   order by l.activated_at desc nulls last
   limit 1;

  -- 2) Devir/eski kayıt durumu: lisans başka hesapta görünse de bu kullanıcının
  --    cihaz kaydı varsa o lisans geçerli sayılır.
  if not found then
    select l.* into v_license
      from license_activations a
      join licenses l on l.id = a.license_id
     where a.user_id = v_user
       and l.status = 'active'
       and (l.expires_at is null or l.expires_at > now())
     order by a.last_seen_at desc
     limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no-license');
  end if;

  select exists (
           select 1 from license_activations
            where license_id = v_license.id and device_id = p_device_id
         ) into v_bound;

  -- Yeni cihaz bağlanacaksa sınırı kilit altında say (eşzamanlı açılışlarda
  -- limitin aşılmaması için lisans satırı kilitlenir).
  if not v_bound then
    v_license_id := v_license.id;
    select * into v_license from licenses where id = v_license_id for update;
    select count(*) into v_devices
      from license_activations
     where license_id = v_license_id;
    if v_devices >= v_license.max_devices then
      return jsonb_build_object(
        'ok', false,
        'error', 'device-limit',
        'plan', v_license.plan,
        'expires_at', v_license.expires_at,
        'max_devices', v_license.max_devices
      );
    end if;
  end if;

  insert into license_activations (license_id, user_id, device_id, device_name)
  values (v_license.id, v_user, p_device_id, p_device_name)
  on conflict (license_id, device_id)
  do update set last_seen_at = now(),
                user_id     = excluded.user_id,
                device_name = coalesce(excluded.device_name, license_activations.device_name);

  return jsonb_build_object('ok', true, 'plan', v_license.plan, 'expires_at', v_license.expires_at);
end;
$$;

-- Eski sürümlerin çağırdığı tek argümanlı biçim korunur (cihaz adı olmadan).
create or replace function public.check_license(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.check_license(p_device_id, null::text);
end;
$$;

-- ── Cihaz çıkarma ───────────────────────────────────────────────────────────
-- Kullanıcı kendi lisansına bağlı bir cihazı bırakabilir; böylece sınır dolduğunda
-- yeni bilgisayara yer açmak için geliştiriciye başvurmak gerekmez.
create or replace function public.release_device(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_license licenses%rowtype;
  v_deleted int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not-authenticated');
  end if;

  select l.* into v_license
    from licenses l
   where l.activated_by = v_user and l.status = 'active'
   order by l.activated_at desc nulls last
   limit 1;
  if not found then
    select l.* into v_license
      from license_activations a
      join licenses l on l.id = a.license_id
     where a.user_id = v_user and l.status = 'active'
     order by a.last_seen_at desc
     limit 1;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no-license');
  end if;

  delete from license_activations
   where license_id = v_license.id and device_id = p_device_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'no-license');
  end if;

  return jsonb_build_object('ok', true, 'plan', v_license.plan, 'expires_at', v_license.expires_at);
end;
$$;

-- Yalnızca oturumlu kullanıcılar çağırabilir.
revoke execute on function public.activate_license(text, text, text) from public, anon;
revoke execute on function public.check_license(text) from public, anon;
revoke execute on function public.check_license(text, text) from public, anon;
revoke execute on function public.release_device(text) from public, anon;
grant execute on function public.activate_license(text, text, text) to authenticated;
grant execute on function public.check_license(text) to authenticated;
grant execute on function public.check_license(text, text) to authenticated;
grant execute on function public.release_device(text) to authenticated;

-- Lisans üretim script'i (service_role) tablolara doğrudan yazar; bu projede
-- yeni tablolara varsayılan grant gelmediği için açıkça verilir.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.licenses to service_role;
grant select, insert, update, delete on public.license_activations to service_role;

-- ── Ayarlar → Hesap sekmesi: lisans özeti ───────────────────────────────────
-- Kullanıcının aktif lisansını ve bağlı cihazlarını döndürür (yalnız kendi).
create or replace function public.license_overview(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_license licenses%rowtype;
  v_devices jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not-authenticated');
  end if;

  select l.* into v_license
    from licenses l
   where l.activated_by = v_user and l.status = 'active'
   order by l.activated_at desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no-license');
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'device_id', a.device_id,
               'device_name', a.device_name,
               'last_seen_at', a.last_seen_at,
               'current', a.device_id = p_device_id
             ) order by a.activated_at
           ),
           '[]'::jsonb
         )
    into v_devices
    from license_activations a
   where a.license_id = v_license.id;

  return jsonb_build_object(
    'ok', true,
    'plan', v_license.plan,
    'expires_at', v_license.expires_at,
    'max_devices', v_license.max_devices,
    'activated_at', v_license.activated_at,
    'devices', v_devices
  );
end;
$$;

revoke execute on function public.license_overview(text) from public, anon;
grant execute on function public.license_overview(text) to authenticated;
