-- GitHub girişini kilitleyen mükerrer hesap onarımı
-- ==========================================================================
--
-- BELİRTİ
--   Uygulamada "GitHub ile devam et" → tarayıcı → dönüşte giriş olmuyor.
--   Supabase dönüş adresine şu hatayı yazar:
--
--     error=server_error
--     error_code=unexpected_failure
--     error_description=Multiple accounts with the same email address in the
--                       same linking domain detected: default
--
--   Bu hata GoTrue'nun kimlik bağlama (identity linking) adımından gelir:
--   GitHub'ın döndürdüğü e-posta auth.users içinde BİRDEN FAZLA satırla
--   eşleşiyorsa, GitHub kimliğinin hangi hesaba bağlanacağı seçilemez ve akış
--   jeton üretmeden durur. Yani sorun uygulamada veya derin bağlantıda değil,
--   auth.users'taki veri durumundadır — kod tarafında çözülemez.
--
--   Not: e-posta adresleri auth.users'ta büyük/küçük harf duyarlı tutulabilir;
--   mükerrerlik çoğu zaman lower(email) düzeyinde ortaya çıkar.
--
-- KULLANIM
--   Supabase Studio → SQL Editor. Önce 1. adımı çalıştırın (yalnız okur),
--   hangi satırın korunacağına karar verin, sonra 3. adımı doldurup çalıştırın.
--   Adım 3 tek işlemdir (transaction) ve sonunda commit gerektirir.


-- ── 1) Mükerrer e-postaları ve her satırın kim olduğunu listele ────────────
-- Her mükerrer e-posta için: hesap kimliği, ne zaman açıldığı, hangi giriş
-- yöntemlerinin bağlı olduğu (email/github), ve hesaba ait veri var mı.
-- "veri" sütunları 0 ise o satır boştur; silinmeye aday odur.

with dupes as (
  select lower(email) as email_key
    from auth.users
   where email is not null and deleted_at is null
   group by lower(email)
  having count(*) > 1
)
select
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  u.email_confirmed_at is not null                        as email_dogrulanmis,
  (select array_agg(i.provider order by i.provider)
     from auth.identities i where i.user_id = u.id)        as yontemler,
  (select count(*) from public.licenses
    where activated_by = u.id)                             as lisans,
  (select count(*) from public.license_activations
    where user_id = u.id)                                  as cihaz,
  (select count(*) from public.license_requests
    where user_id = u.id)                                  as talep,
  (select count(*) from public.admins
    where user_id = u.id)                                  as yonetici,
  (select count(*) from public.notify_prefs
    where user_id = u.id)                                  as bildirim_tercihi
from auth.users u
join dupes d on d.email_key = lower(u.email)
where u.deleted_at is null
order by lower(u.email), u.created_at;


-- ── 2) Hangi satır korunur? ───────────────────────────────────────────────
-- Kural: lisansı/cihazı/talebi olan satır KORUNUR. Hepsi boşsa en eski
-- (created_at küçük) satır korunur — kullanıcının asıl hesabı odur.
-- İkisinde de veri varsa silmeyin: adım 3 verileri korunan hesaba taşır.


-- ── 3) Onarım: fazla hesabı korunan hesaba devret ve sil ──────────────────
-- Aşağıdaki iki kimliği doldurun:
--   :kalan  → korunacak hesabın id'si (1. adımdaki listeden)
--   :giden  → silinecek fazla hesabın id'si
--
-- Neden önce devir, sonra silme:
--   • public.licenses.activated_by → "on delete set null" ile tanımlı.
--     Devretmeden silerseniz lisans hiçbir hesaba bağlı kalmaz ve kullanıcı
--     lisansını yeniden etkinleştirmek zorunda kalır.
--   • Diğer tablolar "on delete cascade": devretmeden silmek veriyi götürür.
--   • license_activations (user_id, device_id) ve notify_prefs (user_id)
--     benzersizdir; çakışan satırlar önce temizlenir, kalanlar taşınır.

begin;

-- Yanlış kimlik girildiyse işlem burada durur (iki farklı, var olan hesap).
do $$
declare
  v_kalan uuid := '00000000-0000-0000-0000-000000000000';  -- ← korunacak hesap
  v_giden uuid := '00000000-0000-0000-0000-000000000000';  -- ← silinecek hesap
begin
  if v_kalan = v_giden then
    raise exception 'Kalan ve giden hesap aynı: %', v_kalan;
  end if;
  if not exists (select 1 from auth.users where id = v_kalan) then
    raise exception 'Korunacak hesap bulunamadı: %', v_kalan;
  end if;
  if not exists (select 1 from auth.users where id = v_giden) then
    raise exception 'Silinecek hesap bulunamadı: %', v_giden;
  end if;

  -- Lisans: giden hesabın lisansları korunan hesaba geçer.
  update public.licenses
     set activated_by = v_kalan
   where activated_by = v_giden;

  -- Cihaz kayıtları: aynı cihaz iki hesapta da varsa gidenin kaydı düşer.
  delete from public.license_activations a
   where a.user_id = v_giden
     and exists (
       select 1 from public.license_activations b
        where b.user_id = v_kalan and b.device_id = a.device_id
     );
  update public.license_activations
     set user_id = v_kalan
   where user_id = v_giden;

  -- Lisans talepleri ve yöneticilik: doğrudan taşınır.
  update public.license_requests set user_id = v_kalan where user_id = v_giden;
  delete from public.admins
   where user_id = v_giden
     and exists (select 1 from public.admins where user_id = v_kalan);
  update public.admins set user_id = v_kalan where user_id = v_giden;

  -- Bildirim tercihi tek satırdır: korunan hesabınki geçerli sayılır.
  delete from public.notify_prefs
   where user_id = v_giden
     and exists (select 1 from public.notify_prefs where user_id = v_kalan);
  update public.notify_prefs set user_id = v_kalan where user_id = v_giden;

  -- Fazla hesap: silinince ona bağlı kimlikler (auth.identities) de düşer,
  -- böylece e-posta artık tek hesapla eşleşir ve GitHub girişi bağlanabilir.
  delete from auth.users where id = v_giden;
end $$;

-- Sonucu doğrulayın: bu sorgu artık HİÇ satır döndürmemeli.
select lower(email) as email_key, count(*)
  from auth.users
 where email is not null and deleted_at is null
 group by lower(email)
having count(*) > 1;

commit;


-- ── 4) Onarım sonrası ─────────────────────────────────────────────────────
-- Uygulamada "GitHub ile devam et" yeniden denenir. GitHub kimliği artık
-- korunan hesaba bağlanır; e-posta+şifre girişi de aynı hesabı açar.
-- Hâlâ hata alınıyorsa uygulamanın izinde sebep yazılıdır:
--   localStorage anahtarı: fraude-auth-callback-trace (son 12 kayıt)
