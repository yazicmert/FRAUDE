// FRAUDE — 10 Yıllık BIST KAP XBRL Finansal Veritabanı Doldurucu Edge Fonksiyonu
//
// BIST şirketlerinin 2016-2026 arası KAP XBRL finansal raporlarını sunucu tarafında
// ayrıştırır ve merkezi `bist_financial_periods` tablosuna kaydeder.
// İstemcilerden doğrudan tetiklenebilir veya pg_cron ile periyodik çalışabilir.

import { createClient } from 'npm:@supabase/supabase-js@2';

const KAP_BASE = 'https://www.kap.org.tr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/Ş/g, 'S')
    .replace(/Ç/g, 'C')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Â/g, 'A');
}

function parseXbrlTaxonomy(html: string) {
  const rowSplit = /<tr[^>]*data-input-row[^>]*>/g;
  const labelRe = /content-tr[^>]*>\s*([^<]+?)\s*<\/div>/s;
  const valueRe = /col-order-class-(\d+)[^>]*>.*?title="(-?\d+)"/gs;

  const parts = html.split(rowSplit);
  if (parts.length <= 1) return [];

  const items: Array<{ labelNorm: string; values: Record<number, number> }> = [];

  for (let i = 1; i < parts.length; i++) {
    const labelMatch = labelRe.exec(parts[i]);
    if (!labelMatch) continue;
    const label = labelMatch[1].trim();

    const values: Record<number, number> = {};
    let valMatch: RegExpExecArray | null;
    valueRe.lastIndex = 0;
    while ((valMatch = valueRe.exec(parts[i])) !== null) {
      const col = parseInt(valMatch[1], 10);
      const val = parseFloat(valMatch[2]);
      if (!isNaN(col) && !isNaN(val)) {
        values[col] = val;
      }
    }

    if (Object.keys(values).length > 0) {
      items.push({
        labelNorm: normalize(label),
        values,
      });
    }
  }
  return items;
}

function getPresentationMultiplier(html: string): number {
  if (html.includes('1.000.000 TL')) return 1_000_000;
  if (html.includes('1.000 TL')) return 1_000;
  return 1;
}

function derivePeriodFromDate(pubDateStr: string) {
  try {
    const parts = pubDateStr.substring(0, 10).split('.');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (month >= 4 && month <= 6) {
      return { period: `${year}-03-31`, year, quarter: 1, isAnnual: false };
    } else if (month >= 7 && month <= 9) {
      return { period: `${year}-06-30`, year, quarter: 2, isAnnual: false };
    } else if (month >= 10 && month <= 12) {
      return { period: `${year}-09-30`, year, quarter: 3, isAnnual: false };
    } else {
      return { period: `${year - 1}-12-31`, year: year - 1, quarter: 4, isAnnual: true };
    }
  } catch {
    return null;
  }
}

function findXbrlItem(items: Array<{ labelNorm: string; values: Record<number, number> }>, labels: string[]): number | null {
  for (const label of labels) {
    for (const item of items) {
      if (item.labelNorm === label) {
        const cols = Object.keys(item.values).map(Number).sort((a, b) => a - b);
        if (cols.length > 0) return item.values[cols[0]];
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: { tickers?: string[]; fromYear?: number; toYear?: number; limit?: number } = {};
  try {
    if (req.method === 'POST') {
      body = await req.json();
    }
  } catch {
    // defaults
  }

  const fromYear = body.fromYear ?? 2020;
  const toYear = body.toYear ?? new Date().getFullYear();

  // Hedef hisseler: parametre olarak verilmişse al, yoksa henüz taranmamış BIST hisselerinden seç
  let targetTickers = body.tickers ?? [];
  if (targetTickers.length === 0) {
    const { data: covered } = await supabase
      .from('bist_financial_periods')
      .select('ticker');
    const coveredSet = new Set((covered ?? []).map((c: { ticker: string }) => c.ticker));

    const { data: allTickers } = await supabase
      .from('bist_tickers')
      .select('code')
      .limit(body.limit ?? 5);

    targetTickers = (allTickers ?? [])
      .map((t: { code: string }) => t.code)
      .filter((code: string) => !coveredSet.has(code));
  }

  if (targetTickers.length === 0) {
    targetTickers = ['THYAO', 'MPARK', 'ASELS', 'BIMAS'];
  }

  const results: Record<string, number> = {};

  for (const ticker of targetTickers.slice(0, 10)) {
    const now = new Date();
    const startYear = Math.max(2016, fromYear);
    const endYear = Math.min(now.getFullYear(), toYear);

    const insertedRows: any[] = [];
    const seenPeriods = new Set<string>();

    for (let yr = startYear; yr <= endYear; yr++) {
      const seasons = [
        [`${yr}-04-15`, `${yr}-06-15`],
        [`${yr}-07-15`, `${yr}-09-15`],
        [`${yr}-10-15`, `${yr}-12-15`],
        [`${yr + 1}-01-20`, `${yr + 1}-05-15`],
      ];

      for (const [sStart, sEnd] of seasons) {
        if (new Date(sStart) > now) continue;

        try {
          const kapReq = await fetch(`${KAP_BASE}/tr/api/disclosure/members/byCriteria`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ fromDate: sStart, toDate: sEnd }),
          });

          if (!kapReq.ok) continue;
          const rows = await kapReq.json();

          for (const row of rows) {
            const stockCodes = (row.stockCodes || '').toUpperCase();
            const related = (row.relatedStocks || '').toUpperCase();
            const codes = `${stockCodes},${related}`.split(',').map((s) => s.trim());

            if (!codes.includes(ticker)) continue;

            const discClass = row.disclosureClass || '';
            const subject = (row.subject || '').toLowerCase();
            if ((discClass === 'FR' || subject.includes('finansal rapor')) &&
                !subject.includes('faaliyet') && !subject.includes('sorumluluk')) {
              
              const idx = row.disclosureIndex;
              const pageRes = await fetch(`${KAP_BASE}/tr/Bildirim/${idx}`, {
                headers: { 'User-Agent': UA },
              });
              if (!pageRes.ok) continue;
              const html = await pageRes.text();

              const mult = getPresentationMultiplier(html);
              const items = parseXbrlTaxonomy(html);
              if (items.length === 0) continue;

              const periodInfo = derivePeriodFromDate(row.publishDate || '');
              if (!periodInfo || seenPeriods.has(periodInfo.period)) continue;
              seenPeriods.add(periodInfo.period);

              const revenue = findXbrlItem(items, ['HASILAT', 'SATIS GELIRLERI', 'FAIZ GELIRLERI']);
              const grossProfit = findXbrlItem(items, ['BRUT KAR (ZARAR)', 'NET FAIZ GELIRI']);
              const opIncome = findXbrlItem(items, ['ESAS FAALIYET KARI (ZARARI)']);
              const netIncome = findXbrlItem(items, ['DONEM KARI (ZARARI)']);
              const totalAssets = findXbrlItem(items, ['TOPLAM VARLIKLAR']);
              const totalEquity = findXbrlItem(items, ['ANA ORTAKLIGA AIT OZKAYNAKLAR', 'TOPLAM OZKAYNAKLAR']);
              const kvDebt = findXbrlItem(items, ['KISA VADELI BORCLANMALAR']) || 0;
              const uvDebt = findXbrlItem(items, ['UZUN VADELI BORCLANMALAR']) || 0;
              const totalDebt = (kvDebt + uvDebt) > 0 ? (kvDebt + uvDebt) : null;
              const opCf = findXbrlItem(items, ['ISLETME FAALIYETLERINDEN KAYNAKLANAN NAKIT AKISLARI']);
              const invCf = findXbrlItem(items, ['YATIRIM FAALIYETLERINDEN KAYNAKLANAN NAKIT AKISLARI']);
              const freeCf = (opCf !== null && invCf !== null) ? (opCf + invCf) : null;

              const mul = (v: number | null) => (v !== null ? v * mult : null);

              insertedRows.push({
                ticker,
                period: periodInfo.period,
                year: periodInfo.year,
                quarter: periodInfo.quarter,
                is_annual: periodInfo.isAnnual,
                currency: 'TRY',
                revenue: mul(revenue),
                gross_profit: mul(grossProfit),
                operating_income: mul(opIncome),
                net_income: mul(netIncome),
                total_assets: mul(totalAssets),
                total_equity: mul(totalEquity),
                total_debt: mul(totalDebt),
                operating_cash_flow: mul(opCf),
                free_cash_flow: mul(freeCf),
                disclosure_index: idx,
                source: 'KAP_XBRL',
              });
            }
          }
        } catch {
          // ignore window error
        }
      }
    }

    if (insertedRows.length > 0) {
      await supabase.from('bist_financial_periods').upsert(insertedRows, {
        onConflict: 'ticker,period,currency',
      });
      results[ticker] = insertedRows.length;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
