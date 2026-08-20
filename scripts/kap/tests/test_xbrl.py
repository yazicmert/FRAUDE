"""KAP XBRL ayrıştırıcısının gerçek bildirim sayfalarına karşı regresyon testleri.

Fixture'lar KAP'tan indirilmiş gerçek bildirimlerin gzip'lenmiş halleri. Bu
pipeline'ın doğruluğu tamamen upstream HTML şekline bağlı olduğu için sentetik
örnek yerine gerçek sayfa tutuluyor; KAP şablonu değiştiğinde testler kırılsın.

Fixture'ların kapsadığı şekiller:
    yunsa_2025q2       ara dönem, 3 aylık kolonu olan gelir tablosu, birim TL
    asels_2025q1       Ç1, kümülatif = 3 ay, birim 1.000 TL
    thyao_2024fy       yıllık, 3 aylık kolon yok, birim 1.000.000 TL
    akbnk_2024fy_*     banka taksonomisi, TP|YP|Toplam alt kolonları,
                       konsolide ve solo çifti
"""

import gzip
import os
import unittest

from ..report import CONSOLIDATED, SOLO, build_facts, build_report
from ..xbrl import classify, parse_document

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load(name):
    with gzip.open(os.path.join(FIXTURES, name + ".html.gz"), "rt", encoding="utf-8") as handle:
        return handle.read()


class PeriodDetectionTest(unittest.TestCase):
    """Dönem, yayın tarihinden değil tablonun resmi başlığından okunmalı."""

    def test_interim_period(self):
        row, _ = build_report(load("yunsa_2025q2"), "YUNSA", 1481151)
        self.assertEqual(row["period"], "2025-06-30")
        self.assertEqual(row["quarter"], 2)
        self.assertFalse(row["is_annual"])

    def test_first_quarter(self):
        row, _ = build_report(load("asels_2025q1"), "ASELS", 1431115)
        self.assertEqual(row["period"], "2025-03-31")
        self.assertEqual(row["quarter"], 1)

    def test_annual_period(self):
        row, _ = build_report(load("thyao_2024fy"), "THYAO", 1396940)
        self.assertEqual(row["period"], "2024-12-31")
        self.assertEqual(row["quarter"], 4)
        self.assertTrue(row["is_annual"])


class CumulativeVersusQuarterlyTest(unittest.TestCase):
    """Gelir tablosunun ilk kolonu kümülatif; 3 aylık kolon ayrı okunmalı."""

    def test_interim_splits_cumulative_and_quarterly(self):
        row, _ = build_report(load("yunsa_2025q2"), "YUNSA", 1481151)
        # Ç2 raporunda kümülatif altı aylık, çeyreklik yalnızca Nisan-Haziran.
        self.assertEqual(row["revenue_ytd"], 1_101_690_617.0)
        self.assertEqual(row["revenue_q"], 653_559_393.0)
        self.assertLess(row["revenue_q"], row["revenue_ytd"])

    def test_first_quarter_cumulative_equals_quarterly(self):
        row, _ = build_report(load("asels_2025q1"), "ASELS", 1431115)
        self.assertEqual(row["revenue_ytd"], row["revenue_q"])

    def test_annual_has_no_quarterly_column(self):
        # Yıllık raporda KAP 3 aylık kolon yayımlamıyor; Ç4 çeyrekliği
        # veritabanı katmanında yıllık eksi dokuz aylık olarak türetiliyor.
        row, _ = build_report(load("thyao_2024fy"), "THYAO", 1396940)
        self.assertIsNotNone(row["revenue_ytd"])
        self.assertIsNone(row["revenue_q"])


class PresentationUnitTest(unittest.TestCase):
    """Birim, sayfada arama yapılarak değil üst bilgi alanından okunmalı."""

    def test_plain_lira(self):
        row, _ = build_report(load("yunsa_2025q2"), "YUNSA", 1481151)
        self.assertEqual(row["presentation_unit"], "TL")
        self.assertEqual(row["total_assets"], 5_447_216_986.0)

    def test_thousands(self):
        row, _ = build_report(load("asels_2025q1"), "ASELS", 1431115)
        self.assertEqual(row["presentation_unit"], "1.000 TL")
        self.assertEqual(row["total_assets"], 270_045_781_000.0)

    def test_millions(self):
        row, _ = build_report(load("thyao_2024fy"), "THYAO", 1396940)
        self.assertEqual(row["presentation_unit"], "1.000.000 TL")
        self.assertEqual(row["total_assets"], 1_399_606_000_000.0)


class ConsolidationTest(unittest.TestCase):
    """Konsolide ve solo aynı döneme ait iki ayrı kayıt olmalı."""

    def test_pair_is_distinguished(self):
        consolidated, _ = build_report(load("akbnk_2024fy_konsolide"), "AKBNK", 1386664)
        solo, _ = build_report(load("akbnk_2024fy_solo"), "AKBNK", 1386666)

        self.assertEqual(consolidated["consolidation"], CONSOLIDATED)
        self.assertEqual(solo["consolidation"], SOLO)
        self.assertEqual(consolidated["period"], solo["period"])
        # Aynı anahtar altında toplanırlarsa biri diğerini eziyordu.
        self.assertNotEqual(consolidated["total_assets"], solo["total_assets"])
        self.assertEqual(consolidated["total_assets"], 2_653_105_361_000.0)
        self.assertEqual(solo["total_assets"], 2_515_596_654_000.0)


class BankTaxonomyTest(unittest.TestCase):
    """Banka şablonu ayrı roller ve TP|YP|Toplam alt kolonları kullanıyor."""

    def test_totals_come_from_total_subcolumn(self):
        row, document = build_report(load("akbnk_2024fy_konsolide"), "AKBNK", 1386664)
        # TP 1.787.749.012 + YP 865.356.349 = Toplam 2.653.105.361 (bin TL)
        self.assertEqual(row["total_assets"], 2_653_105_361_000.0)
        self.assertEqual(row["net_income_ytd"], 42_362_192_000.0)
        roles = {table.role for table in document["tables"]}
        self.assertIn("banks_role_210011", roles)

    def test_bank_revenue_falls_back_to_interest_income(self):
        row, _ = build_report(load("akbnk_2024fy_konsolide"), "AKBNK", 1386664)
        # Banka taksonomisinde ifrs-full_Revenue yok.
        self.assertEqual(row["revenue_ytd"], 498_842_475_000.0)


class BalanceSheetIdentityTest(unittest.TestCase):
    """Varlık toplamı kaynak toplamına eşit olmalı — ayrıştırmanın uçtan uca kontrolü."""

    FIXTURES = (
        ("yunsa_2025q2", "YUNSA"),
        ("asels_2025q1", "ASELS"),
        ("thyao_2024fy", "THYAO"),
        ("akbnk_2024fy_konsolide", "AKBNK"),
        ("akbnk_2024fy_solo", "AKBNK"),
    )

    def test_assets_equal_equity_and_liabilities(self):
        for name, ticker in self.FIXTURES:
            with self.subTest(fixture=name):
                row, _ = build_report(load(name), ticker, 1)
                assets = row["total_assets"]
                resources = row["equity_and_liabilities"]
                self.assertIsNotNone(assets, "aktif toplamı okunamadı")
                self.assertIsNotNone(resources, "kaynak toplamı okunamadı")
                self.assertAlmostEqual(assets, resources, delta=abs(assets) * 1e-9)


class TableClassificationTest(unittest.TestCase):
    def test_equity_statement_is_not_a_balance_sheet(self):
        # Özkaynak değişim tablosu ifrs-full_Equity içeriyor; çapa olarak
        # kullanılırsa bilanço sanılıp yanlış kolondan okumaya yol açıyordu.
        document = parse_document(load("yunsa_2025q2"))
        for table in document["tables"]:
            if "610000" in table.role:
                self.assertNotEqual(classify(table), "balance_sheet")

    def test_dimensional_tables_are_left_unbound(self):
        # Özkaynak değişim tablosunun onlarca boyutsal kolonu var; bunlar
        # tesadüfen tam bölünüp sahte dönem bağlamı üretmemeli.
        document = parse_document(load("asels_2025q1"))
        for table in document["tables"]:
            if "610000" in table.role:
                self.assertEqual(table.columns, {})


class FactExtractionTest(unittest.TestCase):
    def test_facts_carry_period_context(self):
        row, document = build_report(load("yunsa_2025q2"), "YUNSA", 1481151)
        facts = build_facts(document, "YUNSA", 1481151)
        self.assertTrue(facts)

        by_concept = {}
        for fact in facts:
            by_concept.setdefault(fact["concept"], []).append(fact)

        assets = [f for f in by_concept["ifrs-full_Assets"] if f["statement"] == "balance_sheet"]
        self.assertEqual(len(assets), 1)
        self.assertIsNone(assets[0]["period_start"], "bilanço kalemi anlık olmalı")
        self.assertEqual(assets[0]["period_end"], "2025-06-30")

        revenue = sorted(by_concept["ifrs-full_Revenue"], key=lambda f: f["months"])
        self.assertEqual([f["months"] for f in revenue], [3, 6])

    def test_facts_only_cover_current_period(self):
        _, document = build_report(load("asels_2025q1"), "ASELS", 1431115)
        for fact in build_facts(document, "ASELS", 1431115):
            self.assertEqual(fact["period_end"], "2025-03-31")


if __name__ == "__main__":
    unittest.main()
