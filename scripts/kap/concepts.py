"""Geniş tabloya yazılan metriklerin XBRL concept eşlemesi.

Adaylar öncelik sırasına göre denenir; ilk bulunan kazanır. Sektör farkı burada
çözülüyor: sanayi/ticaret şirketleri `ifrs-full_Revenue` kullanırken bankalarda
hasılat karşılığı `kap-fr_InterestIncome`.

Concept adları KAP'ın yayımladığı taksonomiden birebir alındı; iki tanesi
KAP kaynaklı yazım hatası taşıyor ve **düzeltilmemeli**:
    kap-fr_CurrentBorowings      (tek 'r')
    ifrs-full_LongtermBorrowings (küçük 't')
"""

# Anlık ölçümler — bilançodan, cari dönem kolonundan okunur.
INSTANT_METRICS = (
    ("total_assets", ("ifrs-full_Assets",)),
    ("current_assets", ("ifrs-full_CurrentAssets",)),
    ("cash_and_equivalents", ("ifrs-full_CashAndCashEquivalents",)),
    ("trade_receivables", ("ifrs-full_CurrentTradeReceivables",)),
    ("inventories", ("ifrs-full_Inventories",)),
    ("property_plant_equipment", ("ifrs-full_PropertyPlantAndEquipment",)),
    ("total_liabilities", ("ifrs-full_Liabilities",)),
    # Bilançonun kaynak tarafı toplamı. Bankalar ayrı bir "toplam yükümlülük"
    # satırı yayımlamıyor; "YÜKÜMLÜLÜKLER TOPLAMI" etiketi aslında özkaynak
    # dahil toplamı gösteriyor, bu yüzden denklik kontrolü buradan yapılıyor.
    ("equity_and_liabilities", ("ifrs-full_EquityAndLiabilities",)),
    ("current_liabilities", ("ifrs-full_CurrentLiabilities",)),
    ("short_term_borrowings", ("kap-fr_CurrentBorowings",)),
    ("current_portion_long_term_debt", ("kap-fr_CurrentPortionOfNoncurrentBorrowings",)),
    ("long_term_borrowings", ("ifrs-full_LongtermBorrowings",)),
    ("total_equity", ("ifrs-full_Equity",)),
    ("parent_equity", ("ifrs-full_EquityAttributableToOwnersOfParent",)),
)

# Süre ölçümleri — gelir tablosu ve nakit akış tablosundan okunur. Her biri hem
# kümülatif (yılbaşından itibaren) hem de varsa 3 aylık kolondan alınır.
DURATION_METRICS = (
    ("revenue", ("ifrs-full_Revenue", "kap-fr_InterestIncome"), "income"),
    ("cost_of_sales", ("ifrs-full_CostOfSales",), "income"),
    ("gross_profit", ("ifrs-full_GrossProfit", "kap-fr_GrossProfitLossFromOperatingActivitiesForBankingSector"), "income"),
    ("operating_income", ("ifrs-full_ProfitLossFromOperatingActivities",), "income"),
    ("pretax_income", ("ifrs-full_ProfitLossBeforeTax",), "income"),
    ("net_income", ("ifrs-full_ProfitLoss",), "income"),
    ("parent_net_income", ("ifrs-full_ProfitLossAttributableToOwnersOfParent",), "income"),
    ("net_interest_income", ("kap-fr_InterestIncomeOrExpense",), "income"),
    (
        "operating_cash_flow",
        (
            "ifrs-full_CashFlowsFromUsedInOperatingActivities",
            "kap-fr_CashFlowsFromUsedInBankingOperations",
        ),
        "cash_flow",
    ),
    ("investing_cash_flow", ("ifrs-full_CashFlowsFromUsedInInvestingActivities",), "cash_flow"),
    ("financing_cash_flow", ("ifrs-full_CashFlowsFromUsedInFinancingActivities",), "cash_flow"),
    ("depreciation_amortisation", ("ifrs-full_AdjustmentsForDepreciationAndAmortisationExpense",), "cash_flow"),
)

# Uzun formatlı `bist_financial_facts` tablosuna yazılan concept'ler. Geniş
# tablodaki metriklerin ötesinde, ileride türetilecek göstergeler (Beneish
# M-Score, Altman Z-Score, Sloan tahakkuk oranı) için gereken kalemleri de
# kapsıyor. Boş bırakılırsa tüm concept'ler yazılır.
FACT_CONCEPTS = None
