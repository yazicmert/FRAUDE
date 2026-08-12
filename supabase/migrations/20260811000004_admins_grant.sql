-- admins tablosuna service_role yazma yetkisi.
--
-- 20260811000002_site.sql yalnız `select` veriyordu; tablo elle doldurulacak
-- varsayılmıştı. Proje taşıması (scripts/migrate-supabase.mjs) satırları
-- service_role ile yazdığı için insert/update de gerekiyor. Kaynak dosya da
-- düzeltildi; bu dosya şemayı önceki sürümle kurmuş projeler için farkı kapatır.
-- Grant'ler tekrar çalıştırılabilir.

grant select, insert, update, delete on public.admins to service_role;
