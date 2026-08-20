#!/usr/bin/env python3
"""KAP XBRL finansal rapor arşivini Supabase'e doldurur.

    python3 -m kap.backfill --from-year 2016
    python3 -m kap.backfill --ticker THYAO --force
    python3 -m kap.backfill --dry-run --from-year 2025

Yazma işlemleri `SUPABASE_SERVICE_KEY` ortam değişkeni istiyor; anon anahtarın
yazma yetkisi 20260818000005 göçüyle kaldırıldı.

v1'e göre yapısal farklar:

* Tarama `disclosureClass="FR"` filtresi kullanıyor ve KAP'ın 2000 satırlık
  sayfa limitine dayanan pencereleri ikiye bölüyor. v1'in 25 günlük sabit
  penceresi yoğun bilanço sezonunda her pencerenin ilk ~%65'ini sessizce
  kaybediyordu.

* Atlama kararı bildirim numarasına bakıyor. v1 dönemi yayın tarihinden tahmin
  edip o dönem kayıtlıysa indirmeyi atlıyordu; gecikmeli ve düzeltilmiş
  raporlarda tahmin tutmadığı için gerçekten eksik çeyrekler atlanıyordu.

* Sayfalar paralel indiriliyor. Tek iş parçacığıyla 22.000 sayfa saatler
  sürüyordu.
"""

import argparse
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone

from .client import KapClient, scan_disclosures, year_bounds
from .report import ParseError, build_facts, build_report
from .supabase import SupabaseWriter, chunked

PARSER_VERSION = 2

# Bir Supabase isteğine sığdırılan satır sayısı. Bildirim başına ~200-400 gerçek
# çıkıyor, 500'lük yığın istek boyutunu makul tutuyor.
STATEMENT_BATCH = 100
FACT_BATCH = 500


def log(message=""):
    print(message, flush=True)


def load_universe(repo_root):
    """FRAUDE'un kanonik BIST hisse evrenini `core/src/yahoo.rs`'ten okur."""
    path = os.path.join(repo_root, "core", "src", "yahoo.rs")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except OSError as exc:
        raise SystemExit("BIST evreni okunamadı ({}): {}".format(path, exc))

    match = re.search(
        r"pub const BIST_TICKERS: &\[\(&str, &str\)\] = &\[(.*?)\];", content, re.DOTALL
    )
    if not match:
        raise SystemExit("yahoo.rs içinde BIST_TICKERS bulunamadı")

    tickers = {code for code, _name in re.findall(r'\("([^"]+)",\s*"([^"]+)"\)', match.group(1))}
    if len(tickers) < 500:
        raise SystemExit("BIST evreni beklenenden küçük: {} hisse".format(len(tickers)))
    return tickers


def parse_publish_date(raw):
    """KAP'ın '20.08.2025 18:22:02' biçimini ISO 8601'e çevirir."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw.strip()[:19], "%d.%m.%Y %H:%M:%S").isoformat()
    except ValueError:
        try:
            return datetime.strptime(raw.strip()[:10], "%d.%m.%Y").isoformat()
        except ValueError:
            return None


def load_ledger(writer):
    """Daha önce işlenmiş (bildirim, hisse) çiftlerini çeker.

    `unparsable` olanlar da atlanıyor. XBRL tablosu taşımayan bildirim (finansal
    rapor başlıklı ama tablosuz olanlar) parser değişmeden yeniden denendiğinde
    yine ayrıştırılamıyor, ama her denemede sayfa baştan indiriliyordu; defter
    bunu kaydettiği hâlde sorgu dışarıda bıraktığı için her koşuda binlerce
    boşuna istek çıkıyordu.

    `failed` bilerek listede yok: o ağ hatası demek ve gerçekten geçici.
    Parser sürümü ilerlediğinde eşik tutmayacağı için tüm kayıtlar zaten
    kendiliğinden yeniden kuyruğa giriyor.
    """
    rows = writer.select_all(
        "kap_disclosures",
        "disclosure_index,ticker,parser_version",
        query="&status=in.(parsed,unparsable)",
    )
    return {
        (row["disclosure_index"], row["ticker"])
        for row in rows
        if (row.get("parser_version") or 0) >= PARSER_VERSION
    }


class Collector(object):
    """İş parçacıkları arasında paylaşılan sonuç biriktiricisi."""

    def __init__(self):
        self.lock = threading.Lock()
        self.statements = []
        self.facts = []
        self.ledger = []
        self.parsed = 0
        self.failed = 0
        self.unparsable = 0

    def add(self, statements, facts, ledger, outcome):
        with self.lock:
            self.statements.extend(statements)
            self.facts.extend(facts)
            self.ledger.extend(ledger)
            if outcome == "parsed":
                self.parsed += 1
            elif outcome == "unparsable":
                self.unparsable += 1
            else:
                self.failed += 1

    def drain(self):
        with self.lock:
            statements, facts, ledger = self.statements, self.facts, self.ledger
            self.statements, self.facts, self.ledger = [], [], []
        return statements, facts, ledger


def process_disclosure(client, disclosure, tickers, collect_facts=True):
    """Tek bir bildirimi indirip ilgili tüm hisseler için kayıt üretir."""
    index = disclosure["disclosure_index"]
    published = parse_publish_date(disclosure.get("publish_date"))

    html = client.get_text("/tr/Bildirim/{}".format(index))
    statements, facts, ledger = [], [], []

    if not html or "data-input-row" not in html:
        for ticker in tickers:
            ledger.append(
                {
                    "disclosure_index": index,
                    "ticker": ticker,
                    "publish_date": published,
                    "subject": disclosure.get("subject"),
                    "period": None,
                    "consolidation": None,
                    "status": "unparsable",
                    "parser_version": PARSER_VERSION,
                    "error": "XBRL tablosu yok",
                    "parsed_at": None,
                }
            )
        return statements, facts, ledger, "unparsable"

    outcome = "parsed"
    for ticker in tickers:
        try:
            row, document = build_report(html, ticker, index, published)
        except ParseError as exc:
            ledger.append(
                {
                    "disclosure_index": index,
                    "ticker": ticker,
                    "publish_date": published,
                    "subject": disclosure.get("subject"),
                    "period": None,
                    "consolidation": None,
                    "status": "unparsable",
                    "parser_version": PARSER_VERSION,
                    "error": str(exc)[:400],
                    "parsed_at": None,
                }
            )
            outcome = "unparsable"
            continue

        statements.append(row)
        if collect_facts:
            for fact in build_facts(document, ticker, index):
                fact["period"] = row["period"]
                fact["consolidation"] = row["consolidation"]
                facts.append(fact)
        ledger.append(
            {
                "disclosure_index": index,
                "ticker": ticker,
                "publish_date": published,
                "subject": disclosure.get("subject"),
                "period": row["period"],
                "consolidation": row["consolidation"],
                "status": "parsed",
                "parser_version": PARSER_VERSION,
                "error": None,
                # Saat dilimi açıkça yazılıyor: kolon `timestamptz` ve naif bir
                # damga sunucunun yerel dilimine göre yorumlanıyor.
                "parsed_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    return statements, facts, ledger, outcome


def flush(writer, collector, dry_run):
    statements, facts, ledger = collector.drain()
    if dry_run:
        return len(statements)

    # Aynı yığın içinde çakışan birincil anahtarları tekilleştir
    unique_statements = {}
    for s in statements:
        key = (s["ticker"], s["period"], s["consolidation"], s.get("currency", "TRY"))
        unique_statements[key] = s

    unique_facts = {}
    for f in facts:
        key = (
            f["ticker"],
            f["period"],
            f["consolidation"],
            f["statement"],
            f["concept"],
            f.get("months", 0),
            f.get("subcolumn", "Toplam"),
        )
        unique_facts[key] = f

    unique_ledger = {}
    for l in ledger:
        key = (l["disclosure_index"], l["ticker"])
        unique_ledger[key] = l

    for batch in chunked(list(unique_statements.values()), STATEMENT_BATCH):
        writer.rpc("upsert_financial_statements", {"p_rows": batch})
    for batch in chunked(list(unique_facts.values()), FACT_BATCH):
        writer.rpc("upsert_financial_facts", {"p_rows": batch})
    for batch in chunked(list(unique_ledger.values()), STATEMENT_BATCH):
        writer.upsert("kap_disclosures", batch, "disclosure_index,ticker")
    return len(unique_statements)


BIST_30 = {
    "AEFES", "AKBNK", "ASELS", "ASTOR", "BIMAS", "DSTKF", "EKGYO", "ENKAI",
    "EREGL", "FROTO", "GARAN", "GUBRF", "ISCTR", "KCHOL", "KRDMD", "MGROS",
    "PETKM", "PGSUS", "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO",
    "TOASO", "TRALT", "TTKOM", "TUPRS", "VAKBN", "YKBNK",
}


def main(argv=None):
    parser = argparse.ArgumentParser(description="KAP XBRL finansal arşiv doldurucu")
    parser.add_argument("--from-year", type=int, default=2016)
    parser.add_argument("--to-year", type=int, default=date.today().year)
    parser.add_argument("--ticker", help="Yalnızca tek hisse işle")
    parser.add_argument("--tickers", help="Virgülle ayrılmış hisse listesi (ör. THYAO,GARAN,ASELS)")
    parser.add_argument("--bist30", action="store_true", help="Yalnızca BIST 30 endeks hisselerini işle")
    parser.add_argument("--force", action="store_true", help="İşlenmiş bildirimleri yeniden çek")
    parser.add_argument("--dry-run", action="store_true", help="Supabase'e yazma, yalnızca ayrıştır")
    parser.add_argument("--workers", type=int, default=4, help="Eşzamanlı indirme sayısı")
    parser.add_argument("--sleep", type=float, default=0.25, help="İstekler arası bekleme (sn)")
    parser.add_argument("--no-facts", action="store_true", help="Uzun formatlı tabloyu doldurma")
    parser.add_argument("--window-days", type=int, default=45, help="Başlangıç tarama penceresi")
    args = parser.parse_args(argv)

    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    universe = load_universe(repo_root)
    if args.ticker:
        target = args.ticker.strip().upper()
        if target not in universe:
            raise SystemExit("{} BIST evreninde yok".format(target))
        universe = {target}
    elif args.tickers:
        selected = {t.strip().upper() for t in args.tickers.split(",") if t.strip()}
        invalid = selected - universe
        if invalid:
            raise SystemExit("BIST evreninde olmayan hisseler: {}".format(", ".join(sorted(invalid))))
        universe = selected
    elif args.bist30:
        universe = BIST_30 & universe
    log("BIST evreni: {} hisse".format(len(universe)))

    writer = None if args.dry_run else SupabaseWriter(log=log)

    processed = set()
    if writer and not args.force:
        processed = load_ledger(writer)
        log("Defterde {} işlenmiş (bildirim, hisse) çifti var".format(len(processed)))

    client = KapClient(sleep_sec=args.sleep, log=log)
    start, end = year_bounds(args.from_year, args.to_year)
    log("\nBildirimler taranıyor: {} .. {}".format(start, end))

    disclosures = scan_disclosures(client, start, end, universe, window_days=args.window_days)
    log("\n{} finansal rapor bildirimi bulundu".format(len(disclosures)))

    pending = []
    for disclosure in disclosures.values():
        tickers = [
            ticker
            for ticker in disclosure["tickers"]
            if args.force or (disclosure["disclosure_index"], ticker) not in processed
        ]
        if tickers:
            pending.append((disclosure, tickers))

    skipped = len(disclosures) - len(pending)
    log("{} bildirim işlenecek, {} tanesi defterde zaten işaretli".format(len(pending), skipped))
    if not pending:
        log("\nArşiv güncel.")
        return 0

    collector = Collector()
    done = 0
    written = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(
                process_disclosure, client, disclosure, tickers, not args.no_facts
            ): disclosure
            for disclosure, tickers in pending
        }
        for future in as_completed(futures):
            disclosure = futures[future]
            try:
                statements, facts, ledger, outcome = future.result()
                collector.add(statements, facts, ledger, outcome)
            except Exception as exc:  # ağ ya da beklenmedik ayrıştırma hatası
                collector.add([], [], [], "failed")
                log("  {} bildirimi işlenemedi: {}".format(disclosure["disclosure_index"], exc))

            done += 1
            if done % STATEMENT_BATCH == 0 or done == len(pending):
                written += flush(writer, collector, args.dry_run)
                log(
                    "  {}/{} bildirim | {} dönem yazıldı | {} ayrıştırılamadı | {} hata".format(
                        done, len(pending), written, collector.unparsable, collector.failed
                    )
                )

    written += flush(writer, collector, args.dry_run)

    log("\nTamamlandı.")
    log("  KAP istekleri     : {}".format(client.request_count))
    log("  Yazılan dönem     : {}".format(written))
    log("  Ayrıştırılamayan  : {}".format(collector.unparsable))
    log("  Hata              : {}".format(collector.failed))
    if args.dry_run:
        log("  (dry-run: Supabase'e hiçbir şey yazılmadı)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
