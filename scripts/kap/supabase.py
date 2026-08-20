"""Supabase PostgREST istemcisi.

Yazma yolları `service_role` anahtarı istiyor. v1'de yazma anon anahtarıyla
yapılıyordu ve anon anahtar hem depoda hem dağıtılan uygulama ikilisinde açıktı;
tabloya insert/update/delete yetkisi verildiği için arşiv herkese açık biçimde
silinebilir durumdaydı. Anahtar burada yalnızca ortam değişkeninden okunuyor,
varsayılan gömülü değer yok.
"""

import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DEFAULT_URL = "https://emrusyelfekcfyisfzzl.supabase.co"


class SupabaseError(RuntimeError):
    pass


class SupabaseWriter(object):
    def __init__(self, url=None, key=None, timeout=60, log=None):
        self.url = (url or os.environ.get("SUPABASE_URL") or DEFAULT_URL).rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
            "SUPABASE_SERVICE_ROLE_KEY"
        )
        if not self.key:
            raise SupabaseError(
                "SUPABASE_SERVICE_KEY tanımlı değil. Yazma işlemleri service_role "
                "anahtarı istiyor; anon anahtarın yazma yetkisi kaldırıldı."
            )
        self.timeout = timeout
        self.log = log or (lambda msg: None)

    def _headers(self, extra=None):
        headers = {
            "apikey": self.key,
            "Authorization": "Bearer {}".format(self.key),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def _send(self, path, payload, method="POST", extra_headers=None, retries=3):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        last_error = None
        for attempt in range(retries):
            try:
                request = Request(
                    self.url + path,
                    data=data,
                    headers=self._headers(extra_headers),
                    method=method,
                )
                with urlopen(request, timeout=self.timeout) as response:
                    body = response.read().decode("utf-8", errors="replace").strip()
                    return json.loads(body) if body else None
            except HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:400]
                if exc.code in (500, 502, 503, 504, 408):
                    last_error = SupabaseError("HTTP {}: {}".format(exc.code, detail))
                    time.sleep(2.0 * (attempt + 1))
                    continue
                raise SupabaseError("HTTP {} ({}): {}".format(exc.code, path, detail))
            except Exception as exc:  # ağ kesintisi
                last_error = exc
                time.sleep(2.0 * (attempt + 1))
        raise SupabaseError("{} yazılamadı: {}".format(path, last_error))

    def rpc(self, name, payload):
        return self._send("/rest/v1/rpc/" + name, payload)

    def upsert(self, table, rows, on_conflict):
        if not rows:
            return 0
        self._send(
            "/rest/v1/{}?on_conflict={}".format(table, on_conflict),
            rows,
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        return len(rows)

    def select_all(self, table, columns, page_size=1000, query=""):
        """PostgREST'in 1000 satırlık varsayılan sayfa sınırını aşarak tümünü çeker."""
        rows = []
        offset = 0
        while True:
            path = "/rest/v1/{}?select={}{}&limit={}&offset={}".format(
                table, columns, query, page_size, offset
            )
            request = Request(self.url + path, headers=self._headers(), method="GET")
            with urlopen(request, timeout=self.timeout) as response:
                page = json.loads(response.read().decode("utf-8", errors="replace") or "[]")
            rows.extend(page)
            if len(page) < page_size:
                return rows
            offset += page_size


def chunked(items, size):
    for start in range(0, len(items), size):
        yield items[start:start + size]
