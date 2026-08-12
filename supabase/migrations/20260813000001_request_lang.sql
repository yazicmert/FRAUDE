-- Lisans talebinin dili
-- ─────────────────────────────────────────────────────────────────────────────
-- Kullanıcı siteyi hangi dilde kullanıyorsa lisans anahtarı e-postası da o
-- dilde gitsin (send-license-email Edge Function bu sütunu okur). Kayıt
-- doğrulama ve şifre yenileme e-postaları ayrı yoldan dillenir: onlar
-- user_metadata.lang ve redirect_to adresine bakar (docs/email-templates/).
--
-- Eski satırlar ve `lang` göndermeyen istemciler için varsayılan 'tr'.

alter table public.license_requests
  add column if not exists lang text not null default 'tr';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'license_requests_lang_check'
  ) then
    alter table public.license_requests
      add constraint license_requests_lang_check check (lang in ('tr', 'en'));
  end if;
end $$;
