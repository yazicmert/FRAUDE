"""KAP HTTP istemcisi ve bildirim tarayıcısı.

`byCriteria` uç noktası sorgu başına 2000 satırda kesiyor ve kestiğinde
*en yeni* kayıtları döndürüp pencerenin başını sessizce atıyor. Hata dönmüyor,
yalnızca eksik dönüyor. Ölçüm (Ağustos 2026):

    01.08–05.08.2025 ->  850 satır, 5 günün hepsi
    01.08–26.08.2025 -> 2000 satır, yalnızca 18.08–26.08
    01.01–31.03.2025 -> 2000 satır, yalnızca 24.03–31.03

Bu modül iki katmanla korunuyor: `disclosureClass="FR"` filtresi hacmi ~3.4 kat
düşürüyor (aynı pencerede 2000 -> 590) ve `fetch_window` limite dayanan her
pencereyi ikiye bölerek özyinelemeli yeniden sorguluyor.
"""

import json
import threading
import time
from datetime import date, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

KAP_BASE = "https://www.kap.org.tr"

# Uç noktanın sunucu tarafı sayfa limiti. Dönen satır sayısı buna eşit veya
# büyükse yanıtın kesilmiş olduğunu varsayıyoruz.
PAGE_LIMIT = 2000

# Özyinelemeli bölmenin taban durumu. Tek güne inildiğinde daha fazla
# bölünemez; o günde 2000'den fazla FR bildirimi olması pratikte imkânsız.
MIN_WINDOW_DAYS = 1

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip",
    "Referer": f"{KAP_BASE}/tr/bist-sirketler",
}


class KapError(RuntimeError):
    pass


def _decode(resp):
    payload = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        import gzip

        payload = gzip.decompress(payload)
    return payload.decode("utf-8", errors="replace")


class KapClient:
    """Yeniden deneme ve hız sınırı yönetimi yapan ince HTTP sarmalayıcı."""

    def __init__(self, sleep_sec=0.5, max_retries=6, timeout=45, log=None):
        self.sleep_sec = sleep_sec
        self.max_retries = max_retries
        self.timeout = timeout
        self.log = log or (lambda msg: None)
        self.request_count = 0
        # Backfill istemciyi iş parçacıkları arasında paylaşıyor; `+=` bytecode
        # düzeyinde oku-artır-yaz olduğu için sayaç kilitsiz eksik kalıyordu.
        self._counter_lock = threading.Lock()

    def _request(self, url, data=None, extra_headers=None):
        headers = dict(HEADERS)
        if data is not None:
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)

        last_error = None
        for attempt in range(self.max_retries):
            try:
                req = Request(
                    url,
                    data=data,
                    headers=headers,
                    method="POST" if data is not None else "GET",
                )
                with urlopen(req, timeout=self.timeout) as resp:
                    with self._counter_lock:
                        self.request_count += 1
                    return _decode(resp)
            except HTTPError as exc:
                last_error = exc
                if exc.code == 429:
                    wait = 60 * (attempt + 1)
                    self.log("     KAP hız sınırı (429), {}s bekleniyor (deneme {}/{})...".format(wait, attempt + 1, self.max_retries))
                    time.sleep(wait)
                elif exc.code in (500, 502, 503, 504):
                    time.sleep(2.0 * (attempt + 1))
                else:
                    raise KapError("HTTP {} ({}): {}".format(exc.code, url, exc.reason))
            except (URLError, OSError, TimeoutError) as exc:
                last_error = exc
                time.sleep(2.0 * (attempt + 1))

        raise KapError("{} için {} deneme başarısız: {}".format(url, self.max_retries, last_error))

    def post_json(self, path, payload):
        raw = self._request(KAP_BASE + path, data=json.dumps(payload).encode("utf-8"))
        time.sleep(self.sleep_sec)
        return json.loads(raw) if raw.strip() else []

    def get_text(self, path):
        raw = self._request(KAP_BASE + path)
        time.sleep(self.sleep_sec)
        return raw


def _iso(day):
    return day.strftime("%Y-%m-%d")


def fetch_window(client, start, end, disclosure_class="FR", depth=0, max_depth=12):
    """`start`..`end` (dahil) aralığındaki bildirimleri kesilmeden getirir.

    Yanıt `PAGE_LIMIT`e dayanırsa pencere ikiye bölünüp her yarı ayrı
    sorgulanır. Bölme, aralık tek güne inene ya da `max_depth`e ulaşana kadar
    sürer; her iki taban durumda da eldeki kısmi sonuç döndürülür.
    """
    rows = client.post_json(
        "/tr/api/disclosure/members/byCriteria",
        {
            "fromDate": _iso(start),
            "toDate": _iso(end),
            "disclosureClass": disclosure_class,
        },
    )
    if not isinstance(rows, list):
        return []

    span_days = (end - start).days
    if len(rows) < PAGE_LIMIT or span_days < MIN_WINDOW_DAYS or depth >= max_depth:
        if len(rows) >= PAGE_LIMIT:
            client.log(
                "     UYARI: {}..{} bölünemedi, {} satırda kesilmiş olabilir".format(
                    _iso(start), _iso(end), len(rows)
                )
            )
        return rows

    mid = start + timedelta(days=span_days // 2)
    left = fetch_window(client, start, mid, disclosure_class, depth + 1, max_depth)
    right = fetch_window(client, mid + timedelta(days=1), end, disclosure_class, depth + 1, max_depth)
    return left + right


def _normalize_tr(text):
    """Türkçe karakterleri güvenli şekilde küçük harfe çevirir.

    Standart Python .lower() 'İ' harfini 'i\\u0307' (birleşik noktalı i)
    yapar ve 'finansal' ile eşleşmez.
    """
    return (
        text.replace("İ", "i")
        .replace("I", "ı")
        .replace("Ç", "ç")
        .replace("Ş", "ş")
        .replace("Ğ", "ğ")
        .replace("Ö", "ö")
        .replace("Ü", "ü")
        .lower()
        .strip()
    )


def is_financial_report(row):
    """Satırın ayrıştırılabilir bir finansal rapor bildirimi olup olmadığı.

    KAP'ın FR sınıfı finansal tablonun yanında faaliyet raporu ve sorumluluk
    beyanını da içeriyor; ikisinde de XBRL tablosu yok.
    """
    subject = _normalize_tr(row.get("subject") or "")
    if not subject.startswith("finansal rapor"):
        return False
    return "faaliyet" not in subject and "sorumluluk" not in subject


def extract_tickers(row, universe=None):
    """Bildirimin ilgili olduğu hisse kodlarını çıkarır.

    Tek bildirim birden çok koda bağlanabiliyor (ör. ISATR/ISBTR/ISCTR aynı
    finansal tabloyu paylaşıyor), bu yüzden liste dönüyor.
    """
    codes = set()
    for field in ("stockCodes", "relatedStocks"):
        raw = (row.get(field) or "").upper()
        for part in raw.split(","):
            code = part.strip()
            if code and code != "-":
                codes.add(code)
    if universe is not None:
        codes &= universe
    return sorted(codes)


def scan_disclosures(client, from_date, to_date, universe=None, window_days=45):
    """Verilen tarih aralığındaki tüm finansal rapor bildirimlerini tarar.

    `window_days` yalnızca başlangıç pencere boyutu; kesilme olursa
    `fetch_window` otomatik daralıyor, bu yüzden geniş tutmak güvenli ve
    sakin dönemlerde istek sayısını düşürüyor.
    """
    found = {}
    cursor = from_date

    while cursor <= to_date:
        window_end = min(cursor + timedelta(days=window_days - 1), to_date)
        rows = fetch_window(client, cursor, window_end)

        kept = 0
        for row in rows:
            if not is_financial_report(row):
                continue
            index = row.get("disclosureIndex")
            if not index or index in found:
                continue
            tickers = extract_tickers(row, universe)
            if not tickers:
                continue
            found[index] = {
                "disclosure_index": int(index),
                "tickers": tickers,
                "publish_date": row.get("publishDate", ""),
                "subject": (row.get("subject") or "").strip(),
            }
            kept += 1

        client.log(
            "  {}..{}: {} bildirim, {} finansal rapor".format(
                _iso(cursor), _iso(window_end), len(rows), kept
            )
        )
        cursor = window_end + timedelta(days=1)

    return found


def year_bounds(from_year, to_year, today=None):
    """Tarama aralığını yıl sınırlarından takvim tarihlerine çevirir."""
    today = today or date.today()
    start = date(from_year, 1, 1)
    end = min(date(to_year, 12, 31), today)
    return start, end
