#!/usr/bin/env python3
"""
KAP XBRL 10 Yıllık Finansal Rapor Çekici & Supabase Yükleyici v3
===============================================================
- `/tr/Bildirim/{id}` uç noktası kullanır (Excel export'un 2 istekte 429'a düşen
  hız sınırından etkilenmez, kota 60+ istek taşır).
- Bilanço Sezonları hedefli tarama (istek sayısı %70 az).
- Tam XBRL taksonomi ayrıştırma (290+ kalem, kuruşu kuruşuna).
- Supabase `bist_financial_periods` tablosuna otomatik upsert.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from urllib.error import HTTPError
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


def http_get_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=25) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except HTTPError as e:
            if e.code == 429:
                wait_time = 15 * (attempt + 1)
                print(f"     ⏳ 429 Hız sınırı: {wait_time}s bekleniyor...")
                time.sleep(wait_time)
            elif e.code in (500, 502, 503, 504):
                time.sleep(3)
            else:
                raise
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(2)
    return ""


def http_post_json_with_retry(url, payload, extra_headers=None, max_retries=3):
    headers = dict(HEADERS)
    headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(payload).encode("utf-8")

    for attempt in range(max_retries):
        try:
            req = Request(url, data=data, headers=headers, method="POST")
            with urlopen(req, timeout=25) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw) if raw.strip() else {}
        except HTTPError as e:
            if e.code == 429:
                wait_time = 15 * (attempt + 1)
                print(f"     ⏳ 429 Hız sınırı: {wait_time}s bekleniyor...")
                time.sleep(wait_time)
            elif e.code in (500, 502, 503, 504):
                time.sleep(3)
            else:
                raise
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(2)
    return {}


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
    label_re = re.compile(r"(?s)content-tr[^>]*>\s*([^<]+?)\s*</div>")
    value_re = re.compile(r'(?s)col-order-class-(\d+)[^>]*>.*?title="(-?\d+)"')

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


def derive_period_from_date(pub_date_str):
    """KAP bildirim yayın tarihinden ilgili bilanço dönemini çıkarır."""
    try:
        dt = datetime.strptime(pub_date_str[:10], "%d.%m.%Y")
        y = dt.year
        m = dt.month

        if m in (4, 5, 6):
            return f"{y}-03-31", y, 1, False
        elif m in (7, 8, 9):
            return f"{y}-06-30", y, 2, False
        elif m in (10, 11, 12):
            return f"{y}-09-30", y, 3, False
        else: # Ocak - Nisan arası genelde bir önceki yılın Q4/Yıllık bilançosudur
            return f"{y-1}-12-31", y-1, 4, True
    except Exception:
        return None, None, None, None


def xbrl_find(items, labels):
    for label in labels:
        for item in items:
            if item["label_norm"] == label:
                if item["values"]:
                    first_col = sorted(item["values"].keys())[0]
                    return item["values"][first_col]
    return None


def get_earnings_season_windows(year):
    return [
        (f"{year}-04-15", f"{year}-06-15"),
        (f"{year}-07-15", f"{year}-09-15"),
        (f"{year}-10-15", f"{year}-12-15"),
        (f"{year+1}-01-20", f"{year+1}-05-15"),
    ]


def find_company_fr_disclosures(ticker, from_year, to_year, sleep_sec=0.5):
    """KAP'ta ilgili hisseye ait asıl Finansal Rapor bildirimlerini bulur."""
    now = datetime.now()
    disclosures = []
    seen_indices = set()

    print(f"  🔍 {ticker}: KAP Bilanço Sezonları taranıyor ({from_year} - {to_year})...")

    for year in range(from_year, to_year + 1):
        for start_str, end_str in get_earnings_season_windows(year):
            start_dt = datetime.strptime(start_str, "%Y-%m-%d")
            if start_dt > now:
                continue

            end_dt = min(datetime.strptime(end_str, "%Y-%m-%d"), now)
            cur = start_dt
            while cur < end_dt:
                w_end = min(cur + timedelta(days=20), end_dt)
                url = f"{KAP_BASE}/tr/api/disclosure/members/byCriteria"
                payload = {
                    "fromDate": cur.strftime("%Y-%m-%d"),
                    "toDate": w_end.strftime("%Y-%m-%d"),
                }

                try:
                    rows = http_post_json_with_retry(url, payload)
                    if isinstance(rows, list):
                        for row in rows:
                            stock_codes = (row.get("stockCodes") or "").upper()
                            related = (row.get("relatedStocks") or "").upper()
                            all_codes = [c.strip() for c in f"{stock_codes},{related}".split(",") if c.strip() and c.strip() != "-"]

                            if ticker not in all_codes:
                                continue

                            disc_class = row.get("disclosureClass") or ""
                            subject = (row.get("subject") or "").strip()
                            subj_lower = subject.lower()
                            idx = row.get("disclosureIndex")

                            if idx in seen_indices:
                                continue

                            # Sadece asıl Finansal Rapor'u al (Faaliyet Raporu ve Sorumluluk Beyanı hariç)
                            if (disc_class == "FR" or "finansal rapor" in subj_lower) and \
                               "faaliyet" not in subj_lower and "sorumluluk" not in subj_lower:
                                seen_indices.add(idx)
                                disclosures.append({
                                    "index": idx,
                                    "subject": subject,
                                    "date": row.get("publishDate", ""),
                                })
                except Exception as e:
                    print(f"     ⚠️ {cur.strftime('%Y-%m-%d')} pencere hatası: {e}")

                cur = w_end + timedelta(days=1)
                time.sleep(sleep_sec)

    disclosures.sort(key=lambda x: x["date"])
    print(f"  ✅ {ticker}: {len(disclosures)} adet Finansal Rapor bildirimi bulundu.")
    return disclosures


def parse_disclosure_financials(ticker, disc_index, pub_date, sleep_sec=0.5):
    """`/tr/Bildirim/{id}` üzerinden tam XBRL taksonomisini ayrıştırır."""
    url = f"{KAP_BASE}/tr/Bildirim/{disc_index}"
    html = http_get_with_retry(url)
    if not html or "data-input-row" not in html:
        return None

    mult = xbrl_presentation_unit(html)
    items = parse_xbrl_taxonomy(html)
    if not items:
        return None

    period, year, quarter, is_annual = derive_period_from_date(pub_date)
    if not period:
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
    """Satırları Supabase bist_financial_periods tablosuna yazar."""
    if not rows:
        return 0

    url = f"{SUPABASE_URL}/rest/v1/bist_financial_periods?on_conflict=ticker,period,currency"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    try:
        http_post_json_with_retry(url, rows, extra_headers=headers)
        print(f"  💾 Supabase'e {len(rows)} dönem kaydedildi.")
        return len(rows)
    except Exception as e:
        print(f"  ⚠️ Supabase kayıt hatası: {e}")
        return 0


def process_ticker(ticker, from_year, to_year, dry_run=False, sleep_sec=0.5):
    print(f"\n{'━' * 80}")
    print(f"  🏢 {ticker} ({from_year} - {to_year})")
    print(f"{'━' * 80}")

    disclosures = find_company_fr_disclosures(ticker, from_year, to_year, sleep_sec)
    if not disclosures:
        return 0

    parsed_periods = []
    seen_periods = set()

    for disc in disclosures:
        idx = disc["index"]
        pub_date = disc["date"]
        data = parse_disclosure_financials(ticker, idx, pub_date, sleep_sec)
        if data:
            period_key = (data["period"], data["currency"])
            if period_key in seen_periods:
                continue
            seen_periods.add(period_key)

            rev_str = f"{data['revenue']/1e9:,.2f}B TL" if data['revenue'] else "—"
            assets_str = f"{data['total_assets']/1e9:,.2f}B TL" if data['total_assets'] else "—"
            print(f"     ✅ {data['period']} (Q{data['quarter']}) | Hasılat: {rev_str:>12} | Varlıklar: {assets_str:>12} | #{idx}")
            parsed_periods.append(data)
        time.sleep(sleep_sec)

    if dry_run:
        print(f"  ℹ️ Dry-run modu: Supabase'e yazılmadı ({len(parsed_periods)} kayıt başarıyla ayrıştırıldı).")
        return len(parsed_periods)

    return upsert_to_supabase(parsed_periods)


def main():
    parser = argparse.ArgumentParser(description="KAP 10 Yıllık XBRL Backfill to Supabase v3")
    parser.add_argument("--ticker", type=str, help="Tek hisse kodu (örn. THYAO)")
    parser.add_argument("--from-year", type=int, default=2020, help="Başlangıç yılı (varsayılan: 2020)")
    parser.add_argument("--to-year", type=int, default=datetime.now().year, help="Bitiş yılı")
    parser.add_argument("--sleep", type=float, default=0.5, help="İstekler arası güvenli bekleme süresi (sn)")
    parser.add_argument("--dry-run", action="store_true", help="Supabase'e yazmadan sadece ayrıştır")
    args = parser.parse_args()

    tickers = [args.ticker.upper()] if args.ticker else ["THYAO", "MPARK", "ASELS", "BIMAS"]

    total = 0
    for t in tickers:
        total += process_ticker(t, args.from_year, args.to_year, dry_run=args.dry_run, sleep_sec=args.sleep)

    print(f"\n🎉 İşlem tamamlandı. Toplam {total} finansal dönem başarıyla işlendi.")


if __name__ == "__main__":
    main()
