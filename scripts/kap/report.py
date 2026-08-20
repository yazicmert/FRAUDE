"""Ayrıştırılmış bildirimi normalize finansal döneme dönüştürür."""

from datetime import date

from . import concepts as concept_registry
from .xbrl import (
    INFLATION_ACCOUNTING_FROM,
    _PRESENTATION_UNITS,
    classify,
    find_tables,
    parse_document,
)

CONSOLIDATED = "consolidated"
SOLO = "solo"


class ParseError(RuntimeError):
    pass


def _consolidation(meta):
    raw = (meta.get("Finansal Tablo Niteliği") or "").strip().lower()
    if not raw:
        return None
    # "Konsolide Olmayan" -> solo, "Konsolide" -> konsolide. Sıra önemli:
    # "konsolide" her iki metnin de öneki.
    return SOLO if "olmayan" in raw else CONSOLIDATED


def _unit_and_currency(meta):
    raw = (meta.get("Sunum Para Birimi") or meta.get("Para Birimi") or "TL").strip()
    multiplier = _PRESENTATION_UNITS.get(raw)
    if multiplier is not None:
        return multiplier, "TRY", raw
    # "1.000 USD" gibi beklenmedik birimler: çarpanı önekten, para birimini
    # sondan çöz.
    parts = raw.split()
    currency = parts[-1].upper() if parts else "TL"
    prefix = " ".join(parts[:-1])
    multiplier = {"": 1.0, "1.000": 1_000.0, "1.000.000": 1_000_000.0}.get(prefix)
    if multiplier is None:
        raise ParseError("Bilinmeyen sunum birimi: {!r}".format(raw))
    return multiplier, ("TRY" if currency == "TL" else currency), raw


def _quarter_of(day):
    if day.month == 3:
        return 1
    if day.month == 6:
        return 2
    if day.month == 9:
        return 3
    if day.month == 12:
        return 4
    return None


def _pick(tables, candidates, column_months=None):
    """Tablolar arasında ilk eşleşen concept değerini döndürür."""
    for table in tables:
        column = table.current_column(months=column_months)
        if column is None:
            continue
        for concept in candidates:
            value = table.value(concept, column)
            if value is not None:
                return value, concept
    return None, None


def build_report(html, ticker, disclosure_index, publish_date=None):
    """Bildirim HTML'inden tek bir finansal dönem kaydı üretir.

    Dönem, bildirim yayın tarihinden **türetilmiyor**; bilançonun cari dönem
    başlığındaki resmi tarih okunuyor. Gecikmeli yayımlanan ve düzeltilmiş
    raporlarda yayın tarihi yanıltıcı oluyor.
    """
    document = parse_document(html)
    meta = document["meta"]

    balance_sheets = find_tables(document, "balance_sheet")
    income_statements = find_tables(document, "income")
    cash_flows = find_tables(document, "cash_flow")

    if not balance_sheets and not income_statements:
        raise ParseError("Bildirimde ayrıştırılabilir finansal tablo yok")

    period = None
    for table in balance_sheets:
        column = table.current_column()
        if column is not None:
            period = column.end
            break
    if period is None:
        for table in income_statements:
            column = table.current_column()
            if column is not None:
                period = column.end
                break
    if period is None:
        raise ParseError("Cari dönem tarihi belirlenemedi")

    quarter = _quarter_of(period)
    if quarter is None:
        raise ParseError("Çeyrek sonu olmayan dönem: {}".format(period))

    multiplier, currency, unit_label = _unit_and_currency(meta)
    consolidation = _consolidation(meta)
    if consolidation is None:
        raise ParseError("Finansal tablo niteliği (konsolide/solo) okunamadı")

    scale = lambda v: None if v is None else v * multiplier

    row = {
        "ticker": ticker,
        "period": period.isoformat(),
        "year": period.year,
        "quarter": quarter,
        "is_annual": quarter == 4,
        "currency": currency,
        "consolidation": consolidation,
        "disclosure_index": disclosure_index,
        "publish_date": publish_date,
        "presentation_unit": unit_label,
        "inflation_adjusted": period >= INFLATION_ACCOUNTING_FROM,
        "source": "KAP_XBRL",
    }

    for metric, candidates in concept_registry.INSTANT_METRICS:
        value, _ = _pick(balance_sheets, candidates)
        row[metric] = scale(value)

    # Süre ölçümleri iki kez okunuyor: kümülatif (yılbaşından itibaren) ve varsa
    # 3 aylık kolon. Kolonların anlamı karışmasın diye alan adları açık:
    # `_ytd` yılbaşından itibaren, `_q` yalnızca ilgili çeyrek.
    for metric, candidates, table_kind in concept_registry.DURATION_METRICS:
        tables = income_statements if table_kind == "income" else cash_flows
        ytd, _ = _pick(tables, candidates)
        quarterly, _ = _pick(tables, candidates, column_months=3)
        row[metric + "_ytd"] = scale(ytd)
        # Ç1'de kümülatif zaten üç aylık; ayrı bir 3 aylık kolon yayımlanmıyor.
        if quarterly is None and quarter == 1:
            quarterly = ytd
        row[metric + "_q"] = scale(quarterly)

    total_debt = None
    debt_parts = (
        row.get("short_term_borrowings"),
        row.get("current_portion_long_term_debt"),
        row.get("long_term_borrowings"),
    )
    if any(part is not None for part in debt_parts):
        total_debt = sum(part for part in debt_parts if part is not None)
    row["total_debt"] = total_debt

    operating = row.get("operating_cash_flow_ytd")
    investing = row.get("investing_cash_flow_ytd")
    row["free_cash_flow_ytd"] = (
        operating + investing if operating is not None and investing is not None else None
    )

    return row, document


def build_facts(document, ticker, disclosure_index):
    """Belgedeki tüm concept değerlerini uzun formatta üretir.

    Geniş tablo yalnızca ortak metrikleri taşıyor; burada her satır olduğu gibi
    saklanıyor ki yeni bir gösterge eklemek 22.000 sayfayı yeniden indirmeyi
    gerektirmesin.
    """
    allow = concept_registry.FACT_CONCEPTS
    facts_by_key = {}
    for table in document["tables"]:
        kind = classify(table)
        if kind == "other" or not table.columns:
            continue
        for row in table.rows:
            if allow is not None and row["concept"] not in allow:
                continue
            for column_index, value in row["values"].items():
                column = table.columns.get(column_index)
                if column is None or not column.is_current:
                    continue
                months = column.months or 0
                subcolumn = column.subcolumn or ("Toplam" if column.is_total else "")
                key = (kind, row["concept"], months, subcolumn)
                if key in facts_by_key:
                    continue
                facts_by_key[key] = {
                    "disclosure_index": disclosure_index,
                    "ticker": ticker,
                    "role": table.role,
                    "statement": kind,
                    "concept": row["concept"],
                    "label": row["label"],
                    "period_start": column.start.isoformat() if column.start else None,
                    "period_end": column.end.isoformat(),
                    # 0 = anlık ölçüm (bilanço kalemi); veritabanı anahtarı
                    # NULL taşıyamadığı için sıfırla temsil ediliyor.
                    "months": months,
                    # Banka bilançolarında TP / YP / Toplam kırılımı.
                    # Yabancı para pozisyonu göstergeleri için saklanıyor.
                    "subcolumn": subcolumn,
                    "value": value,
                }
    return list(facts_by_key.values())
