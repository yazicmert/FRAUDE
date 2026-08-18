#!/usr/bin/env python3
"""
KAP XBRL 10 Yıllık Finansal Rapor Çekici & Supabase Yükleyici
============================================================
BIST şirketlerinin 2016-2026 arası KAP XBRL finansal raporlarını
ayrıştırır ve merkezi Supabase veritabanına (`bist_financial_periods`) yükler.

Kullanım:
  python3 scripts/backfill_kap_to_supabase.py --ticker THYAO --from-year 2020 --to-year 2024
  python3 scripts/backfill_kap_to_supabase.py --all-bist --from-year 2016 --to-year 2026
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Supabase Konfigürasyonu
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://emrusyelfekcfyisfzzl.supabase.co"
)
SUPABASE_KEY = os.environ.get(
    "SUPABASE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtcnVzeWVsZmVrY2Z5aXNmenpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NzQwMzcsImV4cCI6MjEwMjA1MDAzN30.384frz30oK69aZO6rwLE8Cw50vHmnlxjxbtsOg0wI9M",
)

KAP_BASE = "https://www.kap.org.tr"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/126.0.0.0 Safari/537.36",
}


def http_get(url):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


def http_post_json(url, payload, extra_headers=None):
    headers = dict(HEADERS)
    headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers=headers, method="POST")
    with urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


def xbrl_normalize(text):
    return (
        text.upper()
        .replace("İ", "I")
        .replace("Ğ", "G")
        .replace("Ş", "S")
        .replace("Ç", "C")
        .replace("Ü", "U")
        .replace("Ö", "O")
        .replace("Â", "A")
        .replace("Î", "I")
    )


def parse_xbrl_taxonomy(html):
    row_split = re.compile(r"<tr[^>]*data-input-row[^>]*>")
    label_re = re.compile(
        r"(?s)content-tr[^>]*>\s*([^<]+?)\s*</div>"
    )
    value_re = re.compile(
        r'(?s)col-order-class-(\d+)[^>]*>.*?title="(-?\d+)"'
    )

    parts = row_split.split(html)
    if len(parts) <= 1:
        return []

    items = []
    for part in parts[1:]:
        label_match = label_re.search(part)
        if not label_match:
            continue
        label = label_match.group(1).strip()

        values = {}
        for val_match in value_re.finditer(part):
            try:
                col = int(val_match.group(1))
                val = float(val_match.group(2))
                values[col] = val
            except ValueError:
                pass

        if values:
            items.append({
                "label": label,
                "label_norm": xbrl_normalize(label),
                "values": values,
            })
    return items


def xbrl_presentation_unit(html):
    if "1.000.000 TL" in html:
        return 1_000_000.0
    elif "1.000 TL" in html:
        return 1_000.0
    return 1.0


def xbrl_period_string(html):
    period_re = re.compile(r"Cari D[öo]nem\s*(\d{2})\.(\d{2})\.(\d{4})")
    m = period_re.search(html)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def xbrl_find(items, labels):
    for label in labels:
        for item in items:
            if item["label_norm"] == label:
                if item["values"]:
                    # İlk sütun (cari dönem)
                    first_col = sorted(item["values"].keys())[0]
                    return item["values"][first_col]
    return None


def find_company_fr_disclosures(ticker, from_year, to_year, sleep_sec=1.0):
    """KAP byCriteria ile belirtilen hissenin FR finansal rapor bildirimlerini bulur."""
    start = datetime(from_year, 1, 1)
    end = datetime(to_year, 12, 31)
    
    print(f"  🔍 {ticker}: KAP bildirimleri taranıyor ({from_year} - {to_year})...")
    disclosures = []
    current = start
    
    while current < end:
        window_end = min(current + timedelta(days=27), end)
        url = f"{KAP_BASE}/tr/api/disclosure/members/byCriteria"
        payload = {
            "fromDate": current.strftime("%Y-%m-%d"),
            "toDate": window_end.strftime("%Y-%m-%d"),
        }
        
        try:
            raw = http_post_json(url, payload)
            rows = json.loads(raw) if raw else []
            for row in rows:
                stock_codes = (row.get("stockCodes") or "").upper()
                related = (row.get("relatedStocks") or "").upper()
                all_codes = [c.strip() for c in f"{stock_codes},{related}".split(",") if c.strip() and c.strip() != "-"]
                
                if ticker not in all_codes:
                    continue
                
                disc_class = row.get("disclosureClass") or ""
                subject = (row.get("subject") or "").strip()
                subject_lower = subject.lower()
                
                # Sadece asıl Finansal Rapor'u al (Faaliyet Raporu ve Sorumluluk Beyanı hariç)
                if disc_class == "FR" or "finansal rapor" in subject_lower:
                    if "faaliyet" not in subject_lower and "sorumluluk" not in subject_lower:
                        disclosures.append({
                            "index": row.get("disclosureIndex"),
                            "subject": subject,
                            "date": row.get("publishDate", ""),
                        })
        except Exception as e:
            print(f"     ⚠️ {current.strftime('%Y-%m-%d')} pencere hatası: {e}")
        
        current = window_end + timedelta(days=1)
        time.sleep(sleep_sec)
    
    # Tarihe göre sırala
    disclosures.sort(key=lambda x: x["date"])
    print(f"  ✅ {ticker}: {len(disclosures)} adet Finansal Rapor bulundu.")
    return disclosures


def parse_disclosure_financials(ticker, disc_index, sleep_sec=0.5):
    """Tek bir KAP Finansal Rapor Excel export'unu çeker ve veritabanı satırı üretir."""
    url = f"{KAP_BASE}/tr/api/notification/export/excel/{disc_index}"
    try:
        html = http_get(url)
    except Exception as e:
        print(f"     ⚠️ #{disc_index} export hatası: {e}")
        return None
    
    mult = xbrl_presentation_unit(html)
    items = parse_xbrl_taxonomy(html)
    if not items:
        return None
    
    period = xbrl_period_string(html)
    if not period:
        return None
    
    # Yıl ve çeyrek çıkar
    try:
        dt = datetime.strptime(period, "%Y-%m-%d")
        year = dt.year
        quarter = {3: 1, 6: 2, 9: 3, 12: 4}.get(dt.month, 4)
        is_annual = (quarter == 4)
    except Exception:
        return None
    
    revenue = xbrl_find(items, ["HASILAT", "SATIS GELIRLERI", "FAIZ GELIRLERI"])
    gross_profit = xbrl_find(items, ["BRUT KAR (ZARAR)", "NET FAIZ GELIRI"])
    operating_income = xbrl_find(items, ["ESAS FAALIYET KARI (ZARARI)"])
    net_income = xbrl_find(items, ["DONEM KARI (ZARARI)"])
    total_assets = xbrl_find(items, ["TOPLAM VARLIKLAR"])
    total_equity = xbrl_find(items, ["ANA ORTAKLIGA AIT OZKAYNAKLAR", "TOPLAM OZKAYNAKLAR"])
    
    kv_debt = xbrl_find(items, ["KISA VADELI BORCLANMALAR"])
    uv_debt = xbrl_find(items, ["UZUN VADELI BORCLANMALAR"])
    total_debt = None
    if kv_debt is not None or uv_debt is not None:
        total_debt = (kv_debt or 0.0) + (uv_debt or 0.0)
    
    op_cf = xbrl_find(items, ["ISLETME FAALIYETLERINDEN KAYNAKLANAN NAKIT AKISLARI"])
    inv_cf = xbrl_find(items, ["YATIRIM FAALIYETLERINDEN KAYNAKLANAN NAKIT AKISLARI"])
    free_cf = (op_cf + inv_cf) if (op_cf is not None and inv_cf is not None) else None
    
    mul = lambda x: (x * mult) if x is not None else None
    
    return {
        "ticker": ticker,
        "period": period,
        "year": year,
        "quarter": quarter,
        "is_annual": is_annual,
        "currency": "TRY",
        "revenue": mul(revenue),
        "gross_profit": mul(gross_profit),
        "operating_income": mul(operating_income),
        "net_income": mul(net_income),
        "total_assets": mul(total_assets),
        "total_equity": mul(total_equity),
        "total_debt": mul(total_debt),
        "operating_cash_flow": mul(op_cf),
        "free_cash_flow": mul(free_cf),
        "disclosure_index": disc_index,
        "source": "KAP_XBRL",
    }


def upsert_to_supabase(rows):
    """Satırları Supabase bist_financial_periods tablosuna topluca yazar."""
    if not rows:
        return 0
    
    url = f"{SUPABASE_URL}/rest/v1/bist_financial_periods?on_conflict=ticker,period,currency"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    
    try:
        http_post_json(url, rows, extra_headers=headers)
        print(f"  💾 Supabase'e {len(rows)} dönem kaydedildi.")
        return len(rows)
    except Exception as e:
        print(f"  ⚠️ Supabase kayıt hatası: {e}")
        return 0


def process_ticker(ticker, from_year, to_year, dry_run=False, sleep_sec=1.0):
    print(f"\n{'━' * 80}")
    print(f"  🏢 {ticker} ({from_year} - {to_year})")
    print(f"{'━' * 80}")
    
    disclosures = find_company_fr_disclosures(ticker, from_year, to_year, sleep_sec)
    if not disclosures:
        return 0
    
    parsed_periods = []
    for disc in disclosures:
        idx = disc["index"]
        data = parse_disclosure_financials(ticker, idx, sleep_sec)
        if data:
            rev_str = f"{data['revenue']/1e9:,.2f}B TL" if data['revenue'] else "—"
            print(f"     ✅ {data['period']} (Q{data['quarter']}) | Hasılat: {rev_str:>12} | Varlıklar: {data['total_assets']/1e9:,.2f}B TL | #{idx}")
            parsed_periods.append(data)
        time.sleep(sleep_sec)
    
    if dry_run:
        print(f"  ℹ️ Dry-run modu: Supabase'e yazılmadı ({len(parsed_periods)} kayıt hazır).")
        return len(parsed_periods)
    
    return upsert_to_supabase(parsed_periods)


def main():
    parser = argparse.ArgumentParser(description="KAP 10 Yıllık XBRL Backfill to Supabase")
    parser.add_argument("--ticker", type=str, help="Tek hisse kodu (örn. THYAO)")
    parser.add_argument("--from-year", type=int, default=2016, help="Başlangıç yılı (varsayılan: 2016)")
    parser.add_argument("--to-year", type=int, default=datetime.now().year, help="Bitiş yılı")
    parser.add_argument("--sleep", type=float, default=1.0, help="İstekler arası güvenli bekleme süresi (sn)")
    parser.add_argument("--dry-run", action="store_true", help="Supabase'e yazmadan sadece ayrıştır")
    args = parser.parse_args()
    
    tickers = [args.ticker.upper()] if args.ticker else ["THYAO", "MPARK", "ASELS", "BIMAS", "GARAN"]
    
    total = 0
    for t in tickers:
        total += process_ticker(t, args.from_year, args.to_year, dry_run=args.dry_run, sleep_sec=args.sleep)
    
    print(f"\n🎉 İşlem tamamlandı. Toplam {total} finansal dönem işlendi.")


if __name__ == "__main__":
    main()
