/**
 * Uygulama genelinde aranabilir hazır varlık kataloğu: BIST endeksleri,
 * döviz, emtia, global endeksler ve kripto. Hem üst çubuk araması hem de
 * karşılaştırma grafiği bu listeyi kullanır.
 */
export interface PresetSymbol {
  /** Veri sembolü (Yahoo/backend formatı) */
  symbol: string;
  label: string;
  group: string;
  /** Etiket/sembolde geçmeyen yaygın arama terimleri (XAU, gold, bitcoin...) */
  keywords?: string[];
  /**
   * IndexView'in beklediği ad; varsa endeks sekmesi bu adla açılır. Etiket
   * IndexView'in SYMBOL_MAP anahtarından farklı olduğunda zorunludur
   * (ör. etiket "Dolar/TL", SYMBOL_MAP anahtarı "USD/TRY").
   */
  indexName?: string;
}

export const PRESET_SYMBOLS: PresetSymbol[] = [
  // --- BIST endeksleri (86) ---
  // `indexName` Borsa İstanbul'un bileşen CSV'sindeki ENDEKS ADI sütununun
  // birebir kopyasıdır: hem `MARKET_INDICES` etiketleriyle (şeritteki canlı
  // değer bu adla bulunur) hem de üyelik listeleriyle aynı yazım. `label` ise
  // yalnız gösterim/arama içindir, Türkçe yazılır. İkisini ayırmak, endeks
  // adını güzelleştirirken veri eşleşmesini bozmayı imkânsız kılar.
  { symbol: 'XU100.IS', label: 'BIST 100', group: 'Endeks', keywords: ['xu100', 'bist100'], indexName: 'BIST 100' },
  { symbol: 'XU050.IS', label: 'BIST 50', group: 'Endeks', keywords: ['xu050', 'bist50'], indexName: 'BIST 50' },
  { symbol: 'XU030.IS', label: 'BIST 30', group: 'Endeks', keywords: ['xu030', 'bist30'], indexName: 'BIST 30' },
  { symbol: 'XU500.IS', label: 'BIST 500', group: 'Endeks', keywords: ['xu500', 'bist500'], indexName: 'BIST 500' },
  { symbol: 'XUTUM.IS', label: 'BIST Tüm', group: 'Endeks', indexName: 'BIST TUM' },
  { symbol: 'XTUMY.IS', label: 'BIST Tüm-100', group: 'Endeks', indexName: 'BIST TUM-100' },
  { symbol: 'XYLDZ.IS', label: 'BIST Yıldız', group: 'Endeks', indexName: 'BIST YILDIZ' },
  { symbol: 'XBANA.IS', label: 'BIST Ana', group: 'Endeks', indexName: 'BIST ANA' },
  { symbol: 'XYUZO.IS', label: 'BIST 100-30', group: 'Endeks', indexName: 'BIST 100-30' },
  { symbol: 'XELOT.IS', label: 'BIST 50-30', group: 'Endeks', indexName: 'BIST 50-30' },
  { symbol: 'XSIST.IS', label: 'BIST İstanbul', group: 'Endeks', indexName: 'BIST ISTANBUL' },
  { symbol: 'XKOBI.IS', label: 'BIST KOBİ Sanayi', group: 'Endeks', indexName: 'BIST KOBI SANAYI' },
  { symbol: 'X10XB.IS', label: 'BIST Banka Dışı Likit 10', group: 'Endeks', indexName: 'BIST BANKA DISI LIKIT 10' },
  { symbol: 'XLBNK.IS', label: 'BIST Likit Banka', group: 'Endeks', indexName: 'BIST LIKIT BANKA' },

  { symbol: 'XUMAL.IS', label: 'BIST Mali', group: 'Endeks', indexName: 'BIST MALI' },
  { symbol: 'XUSIN.IS', label: 'BIST Sınai', group: 'Endeks', indexName: 'BIST SINAI' },
  { symbol: 'XUHIZ.IS', label: 'BIST Hizmetler', group: 'Endeks', indexName: 'BIST HIZMETLER' },
  { symbol: 'XUTEK.IS', label: 'BIST Teknoloji', group: 'Endeks', indexName: 'BIST TEKNOLOJI' },

  { symbol: 'XBANK.IS', label: 'BIST Banka', group: 'Endeks', indexName: 'BIST BANKA' },
  { symbol: 'XAKUR.IS', label: 'BIST Aracı Kurumlar', group: 'Endeks', indexName: 'BIST ARACI KURUMLAR' },
  { symbol: 'XBLSM.IS', label: 'BIST Bilişim', group: 'Endeks', indexName: 'BIST BILISIM' },
  { symbol: 'XELKT.IS', label: 'BIST Elektrik', group: 'Endeks', indexName: 'BIST ELEKTRIK' },
  { symbol: 'XFINK.IS', label: 'BIST Fin. Kir. Faktoring', group: 'Endeks', keywords: ['leasing', 'faktoring'], indexName: 'BIST FIN. KIR. FAKTORING' },
  { symbol: 'XGIDA.IS', label: 'BIST Gıda İçecek', group: 'Endeks', indexName: 'BIST GIDA ICECEK' },
  { symbol: 'XGMYO.IS', label: 'BIST Gayrimenkul Y.O.', group: 'Endeks', keywords: ['gyo'], indexName: 'BIST GAYRIMENKUL Y.O.' },
  { symbol: 'XGSYO.IS', label: 'BIST Girişim Sermayesi Y.O.', group: 'Endeks', keywords: ['gsyo'], indexName: 'BIST GIRISIM SERMAYESI Y.O.' },
  { symbol: 'XHOLD.IS', label: 'BIST Holding ve Yatırım', group: 'Endeks', indexName: 'BIST HOLDING VE YATIRIM' },
  { symbol: 'XILTM.IS', label: 'BIST İletişim', group: 'Endeks', indexName: 'BIST ILETISIM' },
  { symbol: 'XINSA.IS', label: 'BIST İnşaat', group: 'Endeks', indexName: 'BIST INSAAT' },
  { symbol: 'XKAGT.IS', label: 'BIST Orman Kağıt Basım', group: 'Endeks', indexName: 'BIST ORMAN KAGIT BASIM' },
  { symbol: 'XKMYA.IS', label: 'BIST Kimya Petrol Plastik', group: 'Endeks', indexName: 'BIST KIMYA PETROL PLASTIK' },
  { symbol: 'XKNKL.IS', label: 'BIST Konaklama', group: 'Endeks', indexName: 'BIST KONAKLAMA' },
  { symbol: 'XMADN.IS', label: 'BIST Madencilik', group: 'Endeks', indexName: 'BIST MADENCILIK' },
  { symbol: 'XMANA.IS', label: 'BIST Metal Ana', group: 'Endeks', indexName: 'BIST METAL ANA' },
  { symbol: 'XMESY.IS', label: 'BIST Metal Eşya Makina', group: 'Endeks', indexName: 'BIST METAL ESYA MAKINA' },
  { symbol: 'XPTIC.IS', label: 'BIST Perakende Ticaret', group: 'Endeks', indexName: 'BIST PERAKENDE TICARET' },
  { symbol: 'XSGRT.IS', label: 'BIST Sigorta', group: 'Endeks', indexName: 'BIST SIGORTA' },
  { symbol: 'XSPOR.IS', label: 'BIST Spor', group: 'Endeks', indexName: 'BIST SPOR' },
  { symbol: 'XTAST.IS', label: 'BIST Taş Toprak', group: 'Endeks', indexName: 'BIST TAS TOPRAK' },
  { symbol: 'XTCRT.IS', label: 'BIST Ticaret', group: 'Endeks', indexName: 'BIST TICARET' },
  { symbol: 'XTEKS.IS', label: 'BIST Tekstil Deri', group: 'Endeks', indexName: 'BIST TEKSTIL DERI' },
  { symbol: 'XTRZM.IS', label: 'BIST Turizm', group: 'Endeks', indexName: 'BIST TURIZM' },
  { symbol: 'XTTIC.IS', label: 'BIST Toptan Ticaret', group: 'Endeks', indexName: 'BIST TOPTAN TICARET' },
  { symbol: 'XULAS.IS', label: 'BIST Ulaştırma', group: 'Endeks', indexName: 'BIST ULASTIRMA' },
  { symbol: 'XYIHZ.IS', label: 'BIST Yiyecek ve İçecek Hizmetleri', group: 'Endeks', indexName: 'BIST YIYECEK VE ICECEK HIZMETLERI' },
  { symbol: 'XYORT.IS', label: 'BIST Menkul Kıym. Y.O.', group: 'Endeks', keywords: ['myo'], indexName: 'BIST MENKUL KIYM. Y.O.' },

  { symbol: 'XTMTU.IS', label: 'BIST Temettü', group: 'Endeks', keywords: ['dividend'], indexName: 'BIST TEMETTU' },
  { symbol: 'XTM25.IS', label: 'BIST Temettü 25', group: 'Endeks', keywords: ['dividend'], indexName: 'BIST TEMETTU 25' },
  { symbol: 'XT05Y.IS', label: 'BIST Temettü 5 Yıl', group: 'Endeks', keywords: ['dividend'], indexName: 'BIST TEMETTU 5 YIL' },
  { symbol: 'XT10Y.IS', label: 'BIST Temettü 10 Yıl', group: 'Endeks', keywords: ['dividend'], indexName: 'BIST TEMETTU 10 YIL' },
  { symbol: 'XUSRD.IS', label: 'BIST Sürdürülebilirlik', group: 'Endeks', keywords: ['esg'], indexName: 'BIST SURDURULEBILIRLIK' },
  { symbol: 'XSD25.IS', label: 'BIST Sürdürülebilirlik 25', group: 'Endeks', keywords: ['esg'], indexName: 'BIST SURDURULEBILIRLIK 25' },
  { symbol: 'XKURY.IS', label: 'BIST Kurumsal Yönetim', group: 'Endeks', indexName: 'BIST KURUMSAL YONETIM' },
  { symbol: 'XHARZ.IS', label: 'BIST Halka Arz', group: 'Endeks', keywords: ['ipo'], indexName: 'BIST HALKA ARZ' },
  { symbol: 'XUGRA.IS', label: 'BIST Geri Alım', group: 'Endeks', keywords: ['buyback'], indexName: 'BIST GERI ALIM' },

  { symbol: 'X100C.IS', label: 'BIST 100 Ağırlık Sınırlamalı 25', group: 'Endeks', indexName: 'BIST 100 AGIRLIK SINIRLAMALI 25' },
  { symbol: 'X100S.IS', label: 'BIST 100 Ağırlık Sınırlamalı 10', group: 'Endeks', indexName: 'BIST 100 AGIRLIK SINIRLAMALI 10' },
  { symbol: 'X030C.IS', label: 'BIST 30 Ağırlık Sınırlamalı 25', group: 'Endeks', indexName: 'BIST 30 AGIRLIK SINIRLAMALI 25' },
  { symbol: 'X030S.IS', label: 'BIST 30 Ağırlık Sınırlamalı 10', group: 'Endeks', indexName: 'BIST 30 AGIRLIK SINIRLAMALI 10' },
  { symbol: 'X030EA.IS', label: 'BIST 30 Eşit Ağırlıklı Getiri', group: 'Endeks', indexName: 'BIST 30 ESIT AGIRLIKLI GETIRI' },
  { symbol: 'XELOC.IS', label: 'BIST 50-30 Ağırlık Sınırlamalı 25', group: 'Endeks', indexName: 'BIST 50-30 AGIRLIK SINIRLAMALI 25' },
  { symbol: 'XELOS.IS', label: 'BIST 50-30 Ağırlık Sınırlamalı 10', group: 'Endeks', indexName: 'BIST 50-30 AGIRLIK SINIRLAMALI 10' },
  { symbol: 'XSINS.IS', label: 'BIST Sınai Ağırlık Sınırlamalı', group: 'Endeks', indexName: 'BIST SINAI AGIRLIK SINIRLAMALI' },
  { symbol: 'XGYOS.IS', label: 'BIST Gayrimenkul Y.O. Ağırlık Sınırlamalı', group: 'Endeks', keywords: ['gyo'], indexName: 'BIST GAYRIMENKUL Y.O. AGIRLIK SINIRLAMALI' },
  { symbol: 'XTKJS.IS', label: 'BIST Teknoloji Ağırlık Sınırlamalı', group: 'Endeks', indexName: 'BIST TEKNOLOJI AGIRLIK SINIRLAMALI' },
  { symbol: 'XTM25S.IS', label: 'BIST Temettü 25 Ağırlık Sınırlamalı 10', group: 'Endeks', keywords: ['dividend'], indexName: 'BIST TEMETTU 25 AGIRLIK SINIRLAMALI 10' },

  { symbol: 'XKTUM.IS', label: 'BIST Katılım Tüm', group: 'Endeks', indexName: 'BIST KATILIM TUM' },
  { symbol: 'XK100.IS', label: 'BIST Katılım 100', group: 'Endeks', indexName: 'BIST KATILIM 100' },
  { symbol: 'XK050.IS', label: 'BIST Katılım 50', group: 'Endeks', indexName: 'BIST KATILIM 50' },
  { symbol: 'XK030.IS', label: 'BIST Katılım 30', group: 'Endeks', indexName: 'BIST KATILIM 30' },
  { symbol: 'XK030EA.IS', label: 'BIST Katılım 30 Eşit Ağırlıklı Getiri', group: 'Endeks', indexName: 'BIST KATILIM 30 ESIT AGIRLIKLI GETIRI' },
  { symbol: 'XKTMT.IS', label: 'BIST Katılım Temettü', group: 'Endeks', keywords: ['dividend'], indexName: 'BIST KATILIM TEMETTU' },
  { symbol: 'XSRDK.IS', label: 'BIST Katılım Sürdürülebilirlik', group: 'Endeks', keywords: ['esg'], indexName: 'BIST KATILIM SURDURULEBILIRLIK' },

  { symbol: 'XSADA.IS', label: 'BIST Adana', group: 'Endeks', indexName: 'BIST ADANA' },
  { symbol: 'XSANK.IS', label: 'BIST Ankara', group: 'Endeks', indexName: 'BIST ANKARA' },
  { symbol: 'XSANT.IS', label: 'BIST Antalya', group: 'Endeks', indexName: 'BIST ANTALYA' },
  { symbol: 'XSAYD.IS', label: 'BIST Aydın', group: 'Endeks', indexName: 'BIST AYDIN' },
  { symbol: 'XSBAL.IS', label: 'BIST Balıkesir', group: 'Endeks', indexName: 'BIST BALIKESIR' },
  { symbol: 'XSBUR.IS', label: 'BIST Bursa', group: 'Endeks', indexName: 'BIST BURSA' },
  { symbol: 'XSDNZ.IS', label: 'BIST Denizli', group: 'Endeks', indexName: 'BIST DENIZLI' },
  { symbol: 'XSIZM.IS', label: 'BIST İzmir', group: 'Endeks', indexName: 'BIST IZMIR' },
  { symbol: 'XSKAY.IS', label: 'BIST Kayseri', group: 'Endeks', indexName: 'BIST KAYSERI' },
  { symbol: 'XSKOC.IS', label: 'BIST Kocaeli', group: 'Endeks', indexName: 'BIST KOCAELI' },
  { symbol: 'XSKON.IS', label: 'BIST Konya', group: 'Endeks', indexName: 'BIST KONYA' },
  { symbol: 'XSMNS.IS', label: 'BIST Manisa', group: 'Endeks', indexName: 'BIST MANISA' },
  { symbol: 'XSTKR.IS', label: 'BIST Tekirdağ', group: 'Endeks', indexName: 'BIST TEKIRDAG' },
  { symbol: 'USDTRY=X', label: 'Dolar/TL', group: 'Döviz', keywords: ['usd', 'usdtry', 'dolar', 'dollar'], indexName: 'USD/TRY' },
  { symbol: 'EURTRY=X', label: 'Euro/TL', group: 'Döviz', keywords: ['eur', 'eurtry', 'euro'], indexName: 'EUR/TRY' },
  { symbol: 'GBPTRY=X', label: 'Sterlin/TL', group: 'Döviz', keywords: ['gbp', 'pound'], indexName: 'GBP/TRY' },
  { symbol: 'GRAM ALTIN', label: 'Gram Altın (TL)', group: 'Emtia', keywords: ['xau', 'gold', 'altin'] },
  { symbol: 'GRAM GÜMÜŞ', label: 'Gram Gümüş (TL)', group: 'Emtia', keywords: ['xag', 'silver', 'gumus'] },
  { symbol: 'GC=F', label: 'Altın Ons ($)', group: 'Emtia', keywords: ['xau', 'gold', 'altin', 'ons'] },
  { symbol: 'SI=F', label: 'Gümüş Ons ($)', group: 'Emtia', keywords: ['xag', 'silver', 'gumus', 'ons'] },
  { symbol: 'BZ=F', label: 'Brent Petrol ($)', group: 'Emtia', keywords: ['oil', 'petrol'] },
  { symbol: 'CL=F', label: 'WTI Petrol ($)', group: 'Emtia', keywords: ['oil', 'petrol', 'wti'] },
  { symbol: 'NG=F', label: 'Doğalgaz ($)', group: 'Emtia', keywords: ['gas', 'dogalgaz'] },
  { symbol: 'HG=F', label: 'Bakır ($)', group: 'Emtia', keywords: ['copper', 'bakir'] },
  { symbol: '^GSPC', label: 'S&P 500', group: 'Global', keywords: ['sp500', 'spx'], indexName: 'S&P 500' },
  { symbol: '^IXIC', label: 'Nasdaq', group: 'Global', keywords: ['nasdaq', 'ixic'], indexName: 'NASDAQ' },
  { symbol: '^DJI', label: 'Dow Jones', group: 'Global', keywords: ['dow', 'dji'], indexName: 'DOW JONES' },
  { symbol: '^GDAXI', label: 'DAX', group: 'Global', keywords: ['dax'], indexName: 'DAX' },
  { symbol: '^FTSE', label: 'FTSE 100', group: 'Global', keywords: ['ftse'], indexName: 'FTSE 100' },
  { symbol: 'AAPL', label: 'Apple Inc.', group: 'Global', keywords: ['apple', 'aapl'] },
  { symbol: 'NVDA', label: 'NVIDIA Corp.', group: 'Global', keywords: ['nvidia', 'nvda'] },
  { symbol: 'TSLA', label: 'Tesla Inc.', group: 'Global', keywords: ['tesla', 'tsla'] },
  { symbol: 'MSFT', label: 'Microsoft Corp.', group: 'Global', keywords: ['microsoft', 'msft'] },
  { symbol: 'AMZN', label: 'Amazon.com', group: 'Global', keywords: ['amazon', 'amzn'] },
  { symbol: 'META', label: 'Meta Platforms', group: 'Global', keywords: ['meta', 'facebook'] },
  { symbol: 'GOOGL', label: 'Alphabet Inc.', group: 'Global', keywords: ['google', 'googl'] },
  { symbol: 'BTC-USD', label: 'Bitcoin ($)', group: 'Kripto', keywords: ['btc', 'kripto', 'crypto'] },
  { symbol: 'ETH-USD', label: 'Ethereum ($)', group: 'Kripto', keywords: ['eth', 'kripto', 'crypto'] },
  { symbol: 'SOL-USD', label: 'Solana ($)', group: 'Kripto', keywords: ['sol', 'kripto', 'crypto'] },
  { symbol: 'XRP-USD', label: 'Ripple ($)', group: 'Kripto', keywords: ['xrp', 'kripto', 'crypto'] },
  { symbol: 'AVAX-USD', label: 'Avalanche ($)', group: 'Kripto', keywords: ['avax', 'avalanche', 'kripto', 'crypto'] },
  { symbol: 'ADA-USD', label: 'Cardano ($)', group: 'Kripto', keywords: ['ada', 'cardano', 'kripto', 'crypto'] },
  { symbol: 'LINK-USD', label: 'Chainlink ($)', group: 'Kripto', keywords: ['link', 'chainlink', 'kripto', 'crypto'] },
  { symbol: 'DOT-USD', label: 'Polkadot ($)', group: 'Kripto', keywords: ['dot', 'polkadot', 'kripto', 'crypto'] },
];

/** Aksan ve Türkçe ı/i farklarını düzleştirerek arama eşleştirmesi yapar. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .trim();
}

/** Katalog kaydının sorguyla eşleşip eşleşmediğini döndürür. */
export function presetMatchesQuery(preset: PresetSymbol, query: string): boolean {
  return (
    normalizeSearch(preset.label).includes(query) ||
    normalizeSearch(preset.symbol).includes(query) ||
    (preset.keywords ?? []).some(k => k.includes(query) || query.includes(k))
  );
}
