-- FRAUDE — bildirim maillerinin kuyruğu ve kullanıcı başına gönderim kanalı
-- ─────────────────────────────────────────────────────────────────────────────
-- NEDEN: market-watch bugüne kadar maili tespit döngüsünün içinde, satır satır
-- `await` ederek gönderiyordu. İki sonucu vardı:
--   1) Tek bir yavaş/ölü alıcı sunucusu tüm tarama turunu wall-clock sınırına
--      sürüklüyor, o turdaki KAP/SPK imleçleri ilerlemiyordu.
--   2) Gönderim başarısız olduğunda yeniden deneme yoktu; bildirim kayboluyordu.
--
-- Bu migration tespit ile gönderimi ayırır: market-watch yalnız kuyruğa yazar,
-- mail-dispatch fonksiyonu kuyruğu üstel geri çekilmeyle boşaltır.
--
-- Ayrıca kullanıcı başına gönderim kanalı (transport) gelir: varsayılan
-- platform (Brevo) dışında kullanıcı kendi webhook'unu ya da kendi
-- transactional sağlayıcı API anahtarını tanımlayabilir. Ham SMTP kimlik
-- bilgisi BİLİNÇLİ olarak kapsam dışıdır (bkz. docs/mail-transports.md).

-- ── Kuyruk ──────────────────────────────────────────────────────────────────
-- Bir satır = gönderilecek tek bir mail. `delivery_id` ile notify_deliveries'e
-- bağlıdır: aynı bildirim hem Chrome eklentisi beslemesine hem de kuyruğa
-- düşer, biri diğeri olmadan da anlamlıdır (mail kapalı, besleme açık olabilir).
create table if not exists public.notify_outbox (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  delivery_id     uuid references public.notify_deliveries (id) on delete set null,
  to_email        text not null,
  subject         text not null,
  html            text not null,
  -- Webhook transport'u HTML yerine yapılandırılmış veri ister; gövdeyi ikinci
  -- kez üretmemek için bildirim alanları burada da durur.
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts        smallint not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- Dispatcher'ın tek sorgusu: sırası gelmiş bekleyenler. Kısmi indeks, kuyruk
-- büyüdükçe (gönderilmiş satırlar birikince) taramayı sabit tutar.
create index if not exists notify_outbox_due
  on public.notify_outbox (next_attempt_at)
  where status = 'pending';

-- Takılı kalmış 'sending' satırlarını kurtarmak için.
create index if not exists notify_outbox_claimed
  on public.notify_outbox (claimed_at)
  where status = 'sending';

create index if not exists notify_outbox_user_time
  on public.notify_outbox (user_id, created_at desc);

alter table public.notify_outbox enable row level security;
-- Politika yok: kuyruk yalnız service_role'ün. Kullanıcı kendi bildirimini
-- notify_deliveries üzerinden görür; ham mail gövdesini görmesine gerek yok.

-- ── Kullanıcı başına gönderim kanalı ────────────────────────────────────────
-- kind:
--   platform → Brevo (varsayılan; hiç satır yoksa da bu geçerlidir)
--   webhook  → kullanıcının verdiği https uca bildirim JSON'u POST edilir
--   api      → kullanıcının kendi transactional sağlayıcı anahtarıyla mail
-- Ham SMTP yok: kimlik bilgisi saklama riski ile kazanılan fayda orantısız.
create table if not exists public.notify_transports (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  kind          text not null default 'platform'
                  check (kind in ('platform', 'webhook', 'api')),

  -- webhook alanları
  webhook_url   text,

  -- api alanları. api_key BURADA DEĞİL, notify_transport_secrets'ta şifreli.
  api_provider  text check (api_provider in ('resend', 'brevo', 'postmark')),
  from_email    text,
  from_name     text,

  -- Arayüz sır tablosunu okuyamaz (okuyamamalı da), ama "anahtar kayıtlı mı"
  -- bilgisini göstermesi gerekir. Bu bayrak transport-config tarafından
  -- güncellenir; sırrın kendisi hakkında hiçbir şey sızdırmaz.
  has_secret    boolean not null default false,

  -- Sağlık durumu. Doğrulanmamış kanal kullanılmaz: verified_at null ise
  -- dispatcher platform'a düşer.
  verified_at   timestamptz,
  failure_count smallint not null default 0,
  last_error    text,
  disabled_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Kanal seçildiyse gerekli alanlar dolu olmalı; yarım konfigürasyon
  -- veritabanına hiç girmesin.
  constraint notify_transports_webhook_complete
    check (kind <> 'webhook' or webhook_url is not null),
  constraint notify_transports_api_complete
    check (kind <> 'api' or (api_provider is not null and from_email is not null))
);

alter table public.notify_transports enable row level security;

-- Kullanıcı kendi kanalını görebilir (durumu arayüzde göstermek için) ama
-- YAZAMAZ: yazma transport-config Edge Function'ı üzerinden gider, çünkü
-- kaydetmeden önce doğrulama testi ve SSRF kontrolü yapılması gerekir.
drop policy if exists notify_transports_own_select on public.notify_transports;
create policy notify_transports_own_select on public.notify_transports
  for select to authenticated using (user_id = auth.uid());

-- ── Sırlar ──────────────────────────────────────────────────────────────────
-- Ayrı tablo, çünkü buradaki tek kural şu: hiç kimse geri okumaz. RLS açık ve
-- BİLEREK hiçbir policy yok — authenticated rolü bu tabloya select dahil hiçbir
-- şey yapamaz. Arayüz "kayıtlı" yazar, yalnız değiştirmeye izin verir.
--
-- İçerik ayrıca uygulama seviyesinde AES-GCM ile şifrelenir; anahtar
-- (MAIL_CRED_KEY) Edge Function secret'ındadır, veritabanında değildir. Böylece
-- bir veritabanı dökümü tek başına anahtarları açığa çıkarmaz.
create table if not exists public.notify_transport_secrets (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  ciphertext  text not null,               -- base64(AES-GCM çıktısı)
  iv          text not null,               -- base64(12 bayt nonce)
  key_version smallint not null default 1, -- rotasyon için
  updated_at  timestamptz not null default now()
);

alter table public.notify_transport_secrets enable row level security;
-- Politika yok. Kasıtlı.

-- ── Kuyruktan güvenli parti alma ────────────────────────────────────────────
-- Cron turları üst üste binebilir (bir tur uzun sürerse bir sonraki başlar).
-- FOR UPDATE SKIP LOCKED + tek adımda 'sending' damgası, aynı mailin iki kez
-- gönderilmesini engeller.
create or replace function public.claim_outbox_batch(p_limit int default 20)
returns setof public.notify_outbox
language sql
security definer
set search_path = public
as $$
  update public.notify_outbox o
     set status     = 'sending',
         attempts   = o.attempts + 1,
         claimed_at = now()
   where o.id in (
     select id
       from public.notify_outbox
      where status = 'pending'
        and next_attempt_at <= now()
      order by next_attempt_at
      limit p_limit
      for update skip locked
   )
  returning o.*;
$$;

revoke all on function public.claim_outbox_batch(int) from public, anon, authenticated;
grant execute on function public.claim_outbox_batch(int) to service_role;

-- Dispatcher tur ortasında ölürse (deploy, timeout, panic) satır 'sending'de
-- asılı kalır. Beş dakika sonra bekleyene geri döner; attempts zaten artmış
-- olduğu için sonsuz döngü oluşmaz, normal deneme sınırına takılır.
create or replace function public.reap_stuck_outbox(p_older_than interval default '5 minutes')
returns int
language sql
security definer
set search_path = public
as $$
  with revived as (
    update public.notify_outbox
       set status          = 'pending',
           next_attempt_at = now(),
           last_error      = coalesce(last_error, 'dispatcher-timeout')
     where status = 'sending'
       and claimed_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from revived;
$$;

revoke all on function public.reap_stuck_outbox(interval) from public, anon, authenticated;
grant execute on function public.reap_stuck_outbox(interval) to service_role;

-- ── Edge Function erişimi ───────────────────────────────────────────────────
grant select, insert, update, delete on public.notify_outbox to service_role;
grant select, insert, update, delete on public.notify_transports to service_role;
grant select, insert, update, delete on public.notify_transport_secrets to service_role;
grant select on public.notify_transports to authenticated;
