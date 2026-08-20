-- FRAUDE — bildirim öncelik varsayılanı ve spam koruması
-- ─────────────────────────────────────────────────────────────────────────────
-- Süzgeç tanımlamamış kullanıcıların posta kutusunu 10 dakikada bir sıradan
-- KAP açıklamalarıyla boğmamak için varsayılan önem eşiği 4'e (Kritik & Önemli)
-- yükseltilir.

alter table public.notify_prefs
  alter column min_priority set default 4;

-- Boş hisse listesi ve düşük eşikli (1-3) mevcut kayıtların eşiğini güvenli
-- seviyeye (4) çek:
update public.notify_prefs
set min_priority = 4
where min_priority < 4
  and cardinality(tickers) = 0
  and cardinality(keywords) = 0;
