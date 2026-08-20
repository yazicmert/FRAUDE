"""KAP bildirim sayfalarındaki XBRL finansal tablolarının ayrıştırıcısı.

Sayfa yapısı (Ağustos 2026 itibarıyla ölçüldü):

* Belge Next.js RSC akışı olarak geliyor; tablo işaretlemesi belgede **iki kez**
  bulunuyor — bir kez `self.__next_f.push(...)` içinde `\\u003c` kaçışlı, bir kez
  sunucu tarafında render edilmiş DOM olarak. Kaçışlar çözüldükten sonra her
  satır iki kez görünüyor; satır sınıfındaki `-row-N` indeksi kopya başına tekil
  olduğu için ilk görülen kopya alınıp diğeri atılıyor.

* Her satır makine-okunur XBRL concept adı taşıyor:
      <div class="gwt-Label taxonomy-field-name">ifrs-full_Revenue|</div>
  Türkçe etiket yerine bunu kullanmak şart: tek bildirimde 700+ satır ve 5-6 ayrı
  tablo var, etiketler tablolar arasında tekrar ediyor ("Dönem Karı (Zararı)"
  aynı sayfada üç farklı satırda, farklı değerlerle geçiyor).

* Satır sınıfı ait olduğu tabloyu veriyor: `general_role_310000-row-4`. Sanayi ve
  ticaret şirketleri `general_role_*`, bankalar `banks_role_*` önekini
  kullanıyor; rol numaraları sektöre göre değişiyor.

* Kolon anlamı tabloya göre değişiyor. Her tablonun kendi başlıkları var ve
  başlıklar kolon sırasına karşılık geliyor:
      Bilanço      : Cari Dönem 30.06.2025 | Önceki Dönem 31.12.2024
      Gelir tablosu: Cari 01.01-30.06.2025 | Önceki 01.01-30.06.2024
                     | Cari 3 Aylık 01.04-30.06.2025 | Önceki 3 Aylık ...
  Yani gelir tablosunda ilk kolon **yılbaşından itibaren kümülatif**, çeyreklik
  değil. Ç1'de kümülatif 3 aya eşit; yıllık raporda 3 aylık kolon hiç yok.
"""

import re
from datetime import date

# --- Sayfa geneli ------------------------------------------------------------

_ROW = re.compile(r'<tr class="([^"]*?data-input-row[^"]*)">')
_CONCEPT = re.compile(r'taxonomy-field-name">([^<|]*)')
_LABEL = re.compile(r"content-tr[^>]*>\s*([^<]+?)\s*</div>", re.S)
_ROLE = re.compile(r"([a-z_]+_role_\d+)-row-(\d+)")

# Değer hücresi. `title` özniteliği ham (biçimlenmemiş) sayıyı taşıyor.
# Ondalık ayırıcı nokta; binlik ayırıcı yalnızca görünen metinde var.
_VALUE = re.compile(
    r'col-order-class-(\d+)"[^>]*>(?:(?!col-order-class-).)*?title="(-?\d+(?:\.\d+)?)"',
    re.S,
)

# Tablo başlığındaki dönem hücresi: "Cari Dönem<br/>01.01.2025 - 30.06.2025"
_HEADER = re.compile(
    r">\s*((?:Cari|Önceki) Dönem(?: 3 Aylık)?)\s*<br/?>\s*"
    r"(\d{2}\.\d{2}\.\d{4})(?:\s*-\s*(\d{2}\.\d{2}\.\d{4}))?\s*<"
)

# Üst bilgi tablosundaki alanlar
_META = r'{}</td>\s*<td>([^<]*)</td>'

_PRESENTATION_UNITS = {
    "TL": 1.0,
    "1.000 TL": 1_000.0,
    "1.000.000 TL": 1_000_000.0,
}

# Enflasyon muhasebesi (TMS-29) BIST şirketleri için 31.12.2023 dönemiyle
# birlikte zorunlu oldu. Bu tarihten itibaren rakamlar cari alım gücüne göre
# düzeltilmiş; daha eski dönemlerle doğrudan kıyaslanamaz.
INFLATION_ACCOUNTING_FROM = date(2023, 12, 31)


def _unescape(html):
    """RSC akışındaki JSON kaçışlarını çözer."""
    return (
        html.replace("\\u003c", "<")
        .replace("\\u003e", ">")
        .replace('\\"', '"')
        .replace("\\r", "")
        .replace("\\n", "\n")
    )


def _parse_tr_date(text):
    day, month, year = text.split(".")
    return date(int(year), int(month), int(day))


def _month_span(start, end):
    """İki tarih arasındaki ay sayısı (kapsayıcı, ay sonuna yuvarlanmış)."""
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


class Column(object):
    """Bir tablo kolonunun dönem bağlamı.

    Banka bilançoları her dönemi TP (Türk parası) | YP (yabancı para) | Toplam
    olarak üçe bölüyor, yani dönem başlığı başına üç kolon düşüyor. `subcolumn`
    bu ayrımı, `is_total` ise hangisinin dönem toplamı olduğunu tutuyor.
    """

    __slots__ = ("index", "is_current", "start", "end", "months", "subcolumn", "is_total")

    def __init__(self, index, is_current, start, end, subcolumn=None, is_total=True):
        self.index = index
        self.is_current = is_current
        self.start = start
        self.end = end
        self.months = _month_span(start, end) if start else None
        self.subcolumn = subcolumn
        self.is_total = is_total

    @property
    def is_instant(self):
        return self.start is None

    def __repr__(self):
        kind = "instant" if self.is_instant else "{}m".format(self.months)
        suffix = "/{}".format(self.subcolumn) if self.subcolumn else ""
        return "<col{} {} {} {}{}>".format(
            self.index, "cari" if self.is_current else "onceki", kind, self.end, suffix
        )


class Table(object):
    """Tek bir finansal tablo (XBRL sunum rolü)."""

    def __init__(self, role, order):
        self.role = role
        self.order = order
        self.columns = {}
        self.rows = []

    @property
    def is_instant(self):
        return all(c.is_instant for c in self.columns.values()) if self.columns else False

    def current_column(self, months=None):
        """Cari döneme ait kolonu döndürür.

        `months` verilmezse süre tabloları için en uzun (kümülatif) kolon
        seçilir; bilanço gibi anlık tablolarda tek cari kolon zaten vardır.
        Para birimi kırılımı olan tablolarda yalnızca toplam kolonu alınır.
        """
        candidates = [c for c in self.columns.values() if c.is_current and c.is_total]
        if not candidates:
            return None
        if months is not None:
            exact = [c for c in candidates if c.months == months]
            return exact[0] if exact else None
        instants = [c for c in candidates if c.is_instant]
        if instants:
            return instants[0]
        return max(candidates, key=lambda c: c.months or 0)

    def value(self, concept, column):
        if column is None:
            return None
        for row in self.rows:
            if row["concept"] == concept and column.index in row["values"]:
                return row["values"][column.index]
        return None


def parse_document(html):
    """Bildirim HTML'ini tablolara ve üst bilgiye ayrıştırır."""
    doc = _unescape(html)

    meta = {}
    for field in ("Sunum Para Birimi", "Finansal Tablo Niteliği", "Para Birimi"):
        match = re.search(_META.format(re.escape(field)), doc)
        if match:
            meta[field] = match.group(1).strip()

    headers = [(m.start(), m) for m in _HEADER.finditer(doc)]

    tables = []
    by_role = {}
    seen_rows = set()
    row_positions = []

    for match in _ROW.finditer(doc):
        class_attr = match.group(1).strip()
        role_match = _ROLE.search(class_attr)
        if not role_match:
            continue
        # Belge iki kopya içeriyor; `role-row-N` kopya başına tekil olduğu için
        # ilk görülen kopya kazanıyor.
        key = role_match.group(0)
        if key in seen_rows:
            continue
        seen_rows.add(key)
        row_positions.append((match.start(), match.end(), role_match.group(1)))

    for position, (start, body_start, role) in enumerate(row_positions):
        body_end = row_positions[position + 1][0] if position + 1 < len(row_positions) else len(doc)
        body = doc[body_start:body_end]

        table = by_role.get(role)
        if table is None:
            table = Table(role, len(tables))
            by_role[role] = table
            tables.append(table)
            _attach_columns(table, headers, start, doc)

        concept = _CONCEPT.search(body)
        if not concept or not concept.group(1).strip():
            continue
        values = {}
        for column_index, raw in _VALUE.findall(body):
            try:
                values[int(column_index)] = float(raw)
            except ValueError:
                continue
        if not values:
            continue
        label = _LABEL.search(body)
        table.rows.append(
            {
                "concept": concept.group(1).strip(),
                "label": label.group(1).strip() if label else "",
                "values": values,
            }
        )

    for table in tables:
        _bind_columns(table)

    return {"meta": meta, "tables": tables}


_SUBHEADER = re.compile(r'content-tr"[^>]*>\s*([^<]{1,16}?)\s*</div>')
_TOTAL_LABELS = ("toplam", "total")

# Bir dönem başlığının altına düşebilecek en fazla alt kolon. KAP'ın banka
# şablonunda üç (TP | YP | Toplam). Özkaynak değişim tablosu onlarca boyutsal
# kolon taşıyor ve tesadüfen tam bölünebiliyor; bu sınır onu eliyor.
MAX_SUBCOLUMNS = 4


def _attach_columns(table, headers, row_start, doc):
    """Tabloyu kendinden hemen önce gelen başlık hücreleriyle ilişkilendirir.

    Başlıklar tablonun ilk satırından önce, kolon sırasıyla geliyor. Bir önceki
    tablonun satırlarından sonra gelen başlıklar bu tabloya aittir.
    """
    preceding = [(position, m) for position, m in headers if position < row_start]
    table._pending_headers = [m for _, m in preceding]
    # Dönem başlıklarından sonra, ilk veri satırından önce kalan bölge para
    # birimi alt başlıklarını (TP / YP / Toplam) taşıyor.
    region_start = preceding[-1][1].end() if preceding else row_start
    table._subheader_region = doc[region_start:row_start]


def _period_of(header):
    scope, first, second = header.group(1), header.group(2), header.group(3)
    is_current = scope.startswith("Cari")
    if second:
        return is_current, _parse_tr_date(first), _parse_tr_date(second)
    return is_current, None, _parse_tr_date(first)


def _bind_columns(table):
    """Başlıkları tablodaki gerçek kolon indeksleriyle eşler."""
    pending = getattr(table, "_pending_headers", [])
    indexes = sorted({index for row in table.rows for index in row["values"]})
    if not indexes or not pending:
        table.columns = {}
        return

    # Bire bir eşleşme: tablonun kendi başlık bloğu, sondan geriye doğru kolon
    # sayısı kadar hücre.
    if len(pending) >= len(indexes):
        for index, header in zip(indexes, pending[-len(indexes):]):
            is_current, start, end = _period_of(header)
            table.columns[index] = Column(index, is_current, start, end)
        return

    # Gruplu eşleşme: her dönem başlığı birden çok kolona karşılık geliyor
    # (banka bilançolarında TP | YP | Toplam).
    group_size, remainder = divmod(len(indexes), len(pending))
    if group_size < 2 or group_size > MAX_SUBCOLUMNS or remainder:
        # Boyutsal (dimension) tablolar makul bir gruplamaya oturmuyor; bunlar
        # geniş tabloya da uzun tabloya da girmiyor, bağlamsız kalıyorlar.
        table.columns = {}
        return

    labels = _SUBHEADER.findall(getattr(table, "_subheader_region", ""))
    if len(labels) == len(indexes):
        # Alt başlıklar birebir okunabildi.
        sublabels = labels
    elif len(labels) == group_size:
        sublabels = labels * len(pending)
    else:
        sublabels = [None] * len(indexes)

    own_headers = pending[-(len(indexes) // group_size):]
    for position, index in enumerate(indexes):
        header = own_headers[position // group_size]
        is_current, start, end = _period_of(header)
        label = sublabels[position]
        if label is None:
            # Alt başlık okunamadıysa grubun sonuncusu toplam kabul edilir;
            # KAP'ın banka şablonunda sıra her zaman TP, YP, Toplam.
            is_total = (position % group_size) == group_size - 1
        else:
            is_total = label.strip().lower() in _TOTAL_LABELS
        table.columns[index] = Column(index, is_current, start, end, label, is_total)


# --- Tablo sınıflandırma -----------------------------------------------------

# Bir tablonun hangi finansal tablo olduğu rol numarasından güvenilir biçimde
# çıkarılamıyor (KAP numaraları IFRS standardıyla örtüşmüyor: genel şirketlerde
# nakit akış 520003, bankalarda 510007). Bunun yerine tabloyu içeriğindeki
# çapa concept'lere göre sınıflandırıyoruz.
# `ifrs-full_Equity` çapa olarak kullanılamaz: özkaynak değişim tablosunda da
# geçiyor ve o tabloyu bilanço sanmaya yol açıyor.
_ANCHORS = (
    ("balance_sheet", ("ifrs-full_Assets", "ifrs-full_Liabilities")),
    (
        "cash_flow",
        (
            "ifrs-full_CashFlowsFromUsedInOperatingActivities",
            "kap-fr_CashFlowsFromUsedInBankingOperations",
        ),
    ),
    ("income", ("ifrs-full_Revenue", "kap-fr_InterestIncome", "ifrs-full_GrossProfit")),
)


def classify(table):
    concepts = {row["concept"] for row in table.rows}
    for kind, anchors in _ANCHORS:
        if concepts & set(anchors):
            return kind
    return "other"


def find_tables(document, kind):
    """Belgedeki verilen türdeki tabloları belge sırasına göre döndürür.

    Ana tablo her zaman ek/dipnot tablolarından önce geliyor (bankalarda
    bilanço 210011, nazım hesaplar 210500), bu yüzden sıra korunuyor.
    """
    return [t for t in document["tables"] if classify(t) == kind and t.columns]
