-- GitHub girişini kilitleyen hesap çakışması: teşhis ve onarım
-- ==========================================================================
--
-- BELİRTİ
--   "GitHub ile devam et" → tarayıcı → dönüşte giriş olmuyor. Supabase dönüş
--   adresine şunu yazar:
--
--     error=server_error
--     error_code=unexpected_failure
--     error_description=Multiple accounts with the same email address in the
--                       same linking domain detected: default
--
-- MESAJ YANILTICIDIR — SEBEP "AYNI E-POSTA İKİ HESAPTA" DEĞİLDİR
--   (2026-08-12'de ölçülerek bulundu: auth.users'ta da auth.identities'te de
--   hiç mükerrer e-posta yokken hata çıkıyordu.)
--
--   Gerçek mekanizma: GitHub, Supabase'e tek bir adres değil hesabındaki
--   DOĞRULANMIŞ E-POSTALARIN HEPSİNİ verir. GoTrue bunların her birini kendi
--   kullanıcılarıyla eşleştirir ve eşleşenlerin hepsinin AYNI kullanıcıya ait
--   olmasını bekler. Bir GitHub hesabında doğrulanmış iki adres varsa ve bu
--   adresler İKİ AYRI FRAUDE hesabına aitse, kimliğin hangisine bağlanacağı
--   belirsizdir; GoTrue -doğru olarak- hiçbirini seçmez ve akışı durdurur.
--
--   Yani çakışan şey e-postaların birbirine eşit olması değil, aynı kişinin
--   FRAUDE'de birden fazla hesabı olması. Örnek: ad@gmail.com ve ad@icloud.com
--   iki ayrı FRAUDE hesabı, ikisi de aynı GitHub hesabında doğrulanmış.
--
--   Tek eşleşme olduğunda sorun YOKTUR: kişisel e-postasıyla kayıt olup sonra
--   GitHub ile giren kullanıcının kimliği mevcut hesabına kendiliğinden
--   eklenir. Onarımın amacı bu tekilliği sağlamaktır.
--
-- HANGİ PROJEDE?
--   Çakışma taşımada olduğu gibi kopyalanır; hem eski (frfbmutvkekctpacktlz)
--   hem yeni (emrusyelfekcfyisfzzl) projede bulunabilir. Betiği istemcilerin
--   O AN baktığı projede çalıştırın (bkz. src/features/auth/supabaseClient.ts).
--   Supabase CLI bağlantısı (supabase/.temp) başka projeyi gösterebilir;
--   SQL Editor'da proje adını doğrulayın.


-- ── 1) Hesaplar, kimlikleri ve sahip oldukları veri ───────────────────────
-- Aynı kişiye ait birden fazla satır var mı? Ad/soyad benzerliği ve kayıt
-- zamanı yakınlığı iyi ipuçlarıdır; karar veriyle verilir, tahminle değil.

select u.created_at                                                            as hesap_olusturma,
       u.id                                                                    as hesap_id,
       u.email                                                                 as hesap_epostasi,
       u.last_sign_in_at,
       i.provider                                                              as saglayici,
       i.identity_data->>'email'                                               as kimlik_epostasi,
       (select count(*) from public.licenses            where activated_by = u.id) as lisans,
       (select count(*) from public.license_activations where user_id     = u.id) as cihaz,
       (select count(*) from public.license_requests    where user_id     = u.id) as talep,
       (select count(*) from public.admins              where user_id     = u.id) as yonetici
  from auth.users u
  left join auth.identities i on i.user_id = u.id
 order by u.created_at, i.created_at;


-- ── 2) Karar ──────────────────────────────────────────────────────────────
-- Çakışan iki hesaptan hangisi KORUNUR?
--   • Lisansı/cihazı/talebi olan korunur (veri orada).
--   • İkisi de doluysa yöneticilik ve daha eski kayıt tarihi belirleyicidir;
--     adım 3 zaten veriyi kaybetmeden taşır.
--   • Hesaplar farklı KİŞİLERE aitse birleştirilmez — o durumda çözüm,
--     GitHub hesabından fazla adresi kaldırmaktır (aşağıda 4. bölüm).


-- ── 3) Onarım: iki hesabı tek hesapta birleştir ──────────────────────────
-- Aşağıdaki iki kimliği doldurun. Tek transaction'dır; sonunda commit ister.
--
-- Neden önce devir, sonra silme:
--   • public.licenses.activated_by → "on delete set null". Devretmeden
--     silerseniz lisans hiçbir hesaba bağlı kalmaz.
--   • Diğer tablolar "on delete cascade": devretmeden silmek veriyi götürür.
--   • license_activations (user_id, device_id) ve notify_prefs (user_id)
--     benzersizdir; çakışan satırlar önce temizlenir, kalanlar taşınır.

begin;

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

  -- Lisans talepleri ve yöneticilik.
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

  -- Fazla hesap: silinince kimlikleri (auth.identities) de düşer, böylece
  -- GitHub'ın doğrulanmış adresleri tek hesapla eşleşir.
  delete from auth.users where id = v_giden;
end $$;

commit;


-- ── 4) Birleştirme uygun değilse ─────────────────────────────────────────
-- Hesaplar farklı kişilere aitse ya da ikisi de ayrı kalmalıysa: giriş yapan
-- kişi GitHub → Settings → Emails'te fazla adresi kaldırır (ya da doğrulamayı
-- geri alır). GitHub o adresi artık göndermez, eşleşme tekleşir ve giriş açılır.


-- ── 5) Onarım sonrası doğrulama ──────────────────────────────────────────
-- (a) Uygulamada "GitHub ile devam et" yeniden denenir; kimlik korunan hesaba
--     bağlanır ve e-posta+şifre girişi de aynı hesabı açar.
-- (b) Bağlanan kimlik gerçekten oluştu mu:
--       select u.email, i.provider, i.identity_data->>'email'
--         from auth.identities i join auth.users u on u.id = i.user_id
--        where i.provider = 'github';
-- (c) Hâlâ hata alınıyorsa sebebi uygulamanın izinde yazılıdır:
--     localStorage anahtarı `fraude-auth-callback-trace` (son 12 kayıt).
