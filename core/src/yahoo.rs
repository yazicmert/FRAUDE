use serde::Deserialize;

use std::collections::{HashMap, HashSet};

use crate::domain::{EquityRow, HistoricalQuote, MarketMetric};
use crate::indicators;

pub const YAHOO_USER_AGENT: &str = "FraudeFinance/1.0";

pub const COMMODITY_TICKERS: &[(&str, &str)] = &[
    ("GC=F", "Altın Ons ($)"),
    ("SI=F", "Gümüş Ons ($)"),
    ("USDTRY=X", "USD/TRY"),
];

/// Global hisselerin `index_memberships` grup etiketi. Frontend BIST'e özel
/// listeleri kurarken bu etiketi taşıyan satırları eler.
pub const GLOBAL_GROUP: &str = "Global";

pub const GLOBAL_TICKERS: &[(&str, &str)] = &[
    ("AAPL", "Apple Inc."),
    ("MSFT", "Microsoft Corp."),
    ("NVDA", "NVIDIA Corp."),
    ("AMZN", "Amazon.com Inc."),
    ("META", "Meta Platforms Inc."),
    ("GOOGL", "Alphabet Inc."),
    ("TSLA", "Tesla Inc."),
    ("BRK-B", "Berkshire Hathaway"),
    ("LLY", "Eli Lilly"),
    ("AVGO", "Broadcom Inc."),
    ("JPM", "JPMorgan Chase"),
    ("V", "Visa Inc."),
    ("XOM", "Exxon Mobil"),
    ("UNH", "UnitedHealth Group"),
    ("WMT", "Walmart Inc."),
    ("MA", "Mastercard Inc."),
    ("PG", "Procter & Gamble"),
    ("JNJ", "Johnson & Johnson"),
    ("HD", "Home Depot Inc."),
    ("ASML", "ASML Holding"),
    ("COST", "Costco Wholesale"),
    ("NFLX", "Netflix Inc."),
    ("AMD", "Advanced Micro Devices"),
    ("PEP", "PepsiCo Inc."),
    ("CSCO", "Cisco Systems"),
    ("TMUS", "T-Mobile US"),
    ("GS", "Goldman Sachs"),
    ("MCD", "McDonald's Corp"),
    ("CAT", "Caterpillar Inc"),
    ("CRM", "Salesforce Inc"),
    ("BA", "Boeing Co"),
    ("TRV", "Travelers Companies"),
    ("AMGN", "Amgen Inc"),
    ("IBM", "IBM Corp"),
    ("AXP", "American Express"),
    ("CVX", "Chevron Corp"),
    ("MRK", "Merck & Co"),
];

pub const BIST_TICKERS: &[(&str, &str)] = &[
    ("A1CAP", "A1 Capital Yatitim Menkul Degerler A.S."), ("A1YEN", "A1 Yenilenebilir Enerji Uretim AS"), ("AAGYO", "Agaoglu Avrasya Gayrimenkul Yatirim Ortakligi AS"), ("ACSEL", "ACISELSAN ACIPAYAM SELÜLOZ SANAYİ VE TİCARET A.Ş."), ("ADEL", "ADEL KALEMCİLİK TİCARET VE SANAYİ A.Ş."), 
    ("ADESE", "ADESE GAYRİMENKUL YATIRIM A.Ş."), ("ADGYO", "Adra Gayrimenkul Yatirim Ortakligi A.S."), ("AEFES", "ANADOLU EFES BİRACILIK VE MALT SANAYİİ A.Ş."), ("AFYON", "AFYON ÇİMENTO SANAYİ T.A.Ş."), ("AGESA", "AGESA HAYAT VE EMEKLİLİK A.Ş."), 
    ("AGHOL", "AG ANADOLU GRUBU HOLDİNG A.Ş."), ("AGROT", "Agrotech Yuksek Teknoloji ve Yatirim AS"), ("AGYO", "ATAKULE GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("AHGAZ", "AHLATCI DOĞAL GAZ DAĞITIM ENERJİ VE YATIRIM A.Ş."), ("AHSGY", "Ahes Gayrimenkul Yatirim Ortakligi AS"), 
    ("AKBNK", "AKBANK T.A.Ş."), ("AKCNS", "AKÇANSA ÇİMENTO SANAYİ VE TİCARET A.Ş."), ("AKENR", "AKENERJİ ELEKTRİK ÜRETİM A.Ş."), ("AKFGY", "AKFEN GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("AKFIS", "Akfen insaat Turizm ve Ticaret AS"), 
    ("AKFYE", "AKFEN YENİLENEBİLİR ENERJİ A.Ş."), ("AKGRT", "AKSİGORTA A.Ş."), ("AKHAN", "Akhan Un Fabrikasi Ve Tarim Urunleri Gida Sanayi Ticaret Anonim Sirketi"), ("AKMGY", "AKMERKEZ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("AKSA", "AKSA AKRİLİK KİMYA SANAYİİ A.Ş."), 
    ("AKSEN", "AKSA ENERJİ ÜRETİM A.Ş."), ("AKSGY", "AKİŞ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("AKSUE", "AKSU ENERJİ VE TİCARET A.Ş."), ("AKYHO", "AKDENİZ YATIRIM HOLDİNG A.Ş."), ("ALARK", "ALARKO HOLDİNG A.Ş."), 
    ("ALBRK", "ALBARAKA TÜRK KATILIM BANKASI A.Ş."), ("ALCAR", "ALARKO CARRIER SANAYİ VE TİCARET A.Ş."), ("ALCTL", "ALCATEL LUCENT TELETAŞ TELEKOMÜNİKASYON A.Ş."), ("ALFAS", "ALFA SOLAR ENERJİ SANAYİ VE TİCARET A.Ş."), ("ALGYO", "ALARKO GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("ALKA", "ALKİM KAĞIT SANAYİ VE TİCARET A.Ş."), ("ALKIM", "ALKİM ALKALİ KİMYA A.Ş."), ("ALKLC", "Altinkilic Gida ve Sut Sanayi Ticaret AS"), ("ALTIN", "DARPHANE ALTIN SERTİFİKASI"), ("ALTNY", "Altinay Savunma Teknolojileri A.S."), 
    ("ALVES", "Alves Kablo Sanayi ve Ticaret A. S."), ("ANELE", "ANEL ELEKTRİK PROJE TAAHHÜT VE TİCARET A.Ş."), ("ANGEN", "ANATOLİA TANI VE BİYOTEKNOLOJİ ÜRÜNLERİ ARAŞTIRMA GELİŞTİRME SANAYİ VE TİCARET A.Ş."), ("ANHYT", "ANADOLU HAYAT EMEKLİLİK A.Ş."), ("ANSGR", "ANADOLU ANONİM TÜRK SİGORTA ŞİRKETİ"), 
    ("ARASE", "DOĞU ARAS ENERJİ YATIRIMLARI A.Ş."), ("ARCLK", "ARÇELİK A.Ş."), ("ARDYZ", "ARD GRUP BİLİŞİM TEKNOLOJİLERİ A.Ş."), ("ARENA", "ARENA BİLGİSAYAR SANAYİ VE TİCARET A.Ş."), ("ARFYE", "ARF Bio Yenilenebilir Enerji Uretim AS"), 
    ("ARMGD", "Armada Gida Ticaret ve Sanayi Anonim Sirketi"), ("ARSAN", "ARSAN TEKSTİL TİCARET VE SANAYİ A.Ş."), ("ARTMS", "Artemis Hali A. S."), ("ARZUM", "ARZUM ELEKTRİKLİ EV ALETLERİ SANAYİ VE TİCARET A.Ş."), ("ASELS", "ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş."), 
    ("ASGYO", "ASCE GAYRIMENKUL YATIRIM ORTAKLIGI A.S."), ("ASTOR", "ASTOR ENERJİ A.Ş."), ("ASUZU", "ANADOLU ISUZU OTOMOTİV SANAYİ VE TİCARET A.Ş."), ("ATAGY", "ATA GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("ATAKP", "Atakey Patates Gida Sanayi ve Ticaret AS"), 
    ("ATATP", "ATP YAZILIM VE TEKNOLOJİ A.Ş."), ("ATATR", "Ata Turizm Isletmecilik Tasimacilik Madencilik Kuyumculu"), ("ATEKS", "AKIN TEKSTİL A.Ş."), ("ATLAS", "ATLAS MENKUL KIYMETLER YATIRIM ORTAKLIĞI A.Ş."), ("ATSYH", "ATLANTİS YATIRIM HOLDİNG A.Ş."), 
    ("AVGYO", "AVRASYA GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("AVHOL", "AVRUPA YATIRIM HOLDİNG A.Ş."), ("AVOD", "A.V.O.D. KURUTULMUŞ GIDA VE TARIM ÜRÜNLERİ SANAYİ TİCARET A.Ş."), ("AVPGY", "Avrupakent Gayrimenkul Yatirim Ortakligi SA"), ("AYCES", "ALTIN YUNUS ÇEŞME TURİSTİK TESİSLER A.Ş."), 
    ("AYDEM", "AYDEM YENİLENEBİLİR ENERJİ A.Ş."), ("AYEN", "AYEN ENERJİ A.Ş."), ("AYES", "AYES ÇELİK HASIR VE ÇİT SANAYİ A.Ş."), ("AYGAZ", "AYGAZ A.Ş."), ("AZTEK", "AZTEK TEKNOLOJİ ÜRÜNLERİ TİCARET A.Ş."), 
    ("BAGFS", "BAGFAŞ BANDIRMA GÜBRE FABRİKALARI A.Ş."), ("BAHKM", "Bahadir Kimya Sanayi Ve Ticaret Anonim Sirketi"), ("BAKAB", "BAK AMBALAJ SANAYİ VE TİCARET A.Ş."), ("BALAT", "BALATACILAR BALATACILIK SANAYİ VE TİCARET A.Ş."), ("BALSU", "Balsu Gida Sanayi ve Ticaret Anonim Sirketi"), 
    ("BANVT", "BANVİT BANDIRMA VİTAMİNLİ YEM SANAYİİ A.Ş."), ("BARMA", "BAREM AMBALAJ SANAYİ VE TİCARET A.Ş."), ("BASCM", "BAŞTAŞ BAŞKENT ÇİMENTO SANAYİ VE TİCARET A.Ş."), ("BASGZ", "BAŞKENT DOĞALGAZ DAĞITIM GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("BAYRK", "BAYRAK EBT TABAN SANAYİ VE TİCARET A.Ş."), 
    ("BEGYO", "Bati Ege Gayrimenkul Yatirim Ortakligi A.S."), ("BERA", "BERA HOLDİNG A.Ş."), ("BESLR", "Besler Gida Ve Kimya Sanayi Ve Ticaret AS"), ("BESTE", "Best Brands Grup Enerji Yatirim as"), ("BETAE", "Beta Enerji ve Teknoloji AS"), 
    ("BEYAZ", "BEYAZ FİLO OTO KİRALAMA A.Ş."), ("BFREN", "BOSCH FREN SİSTEMLERİ SANAYİ VE TİCARET A.Ş."), ("BIENY", "BİEN YAPI ÜRÜNLERİ SANAYİ TURİZM VE TİCARET A.Ş."), ("BIGCH", "BÜYÜK ŞEFLER GIDA TURİZM TEKSTİL DANIŞMANLIK ORGANİZASYON EĞİTİM SANAYİ VE TİCARET A.Ş."), ("BIGEN", "Birlesim Grup Enerji Yatirimlari AS"), 
    ("BIGTK", "Big Medya Teknoloji A.S."), ("BIMAS", "BİM BİRLEŞİK MAĞAZALAR A.Ş."), ("BINBN", "Bin Ulasim Ve Akilli Sehir Teknolojileri AS"), ("BINHO", "1000 Yatirimlar Holding AS"), ("BIOEN", "BİOTREND ÇEVRE VE ENERJİ YATIRIMLARI A.Ş."), 
    ("BIZIM", "BİZİM TOPTAN SATIŞ MAĞAZALARI A.Ş."), ("BJKAS", "BEŞİKTAŞ FUTBOL YATIRIMLARI SANAYİ VE TİCARET A.Ş."), ("BLCYT", "BİLİCİ YATIRIM SANAYİ VE TİCARET A.Ş."), ("BLUME", "Blume Metal Kimya Anonim Sirketi"), ("BMSCH", "BMS ÇELİK HASIR SANAYİ VE TİCARET A.Ş."), 
    ("BMSTL", "BMS BİRLEŞİK METAL SANAYİ VE TİCARET A.Ş."), ("BNTAS", "BANTAŞ BANDIRMA AMBALAJ SANAYİ TİCARET A.Ş."), ("BOBET", "BOĞAZİÇİ BETON SANAYİ VE TİCARET A.Ş."), ("BORLS", "Borlease Otomotiv AS"), ("BORSK", "Bor Seker A.S."), 
    ("BOSSA", "BOSSA TİCARET VE SANAYİ İŞLETMELERİ T.A.Ş."), ("BRISA", "BRİSA BRIDGESTONE SABANCI LASTİK SANAYİ VE TİCARET A.Ş."), ("BRKO", "BİRKO BİRLEŞİK KOYUNLULULAR MENSUCAT TİCARET VE SANAYİ A.Ş."), ("BRKSN", "BERKOSAN YALITIM VE TECRİT MADDELERİ ÜRETİM VE TİCARET A.Ş."), ("BRKVY", "BİRİKİM VARLIK YÖNETİM A.Ş."), 
    ("BRLSM", "BİRLEŞİM MÜHENDİSLİK ISITMA SOĞUTMA HAVALANDIRMA SANAYİ VE TİCARET A.Ş."), ("BRMEN", "BİRLİK MENSUCAT TİCARET VE SANAYİ İŞLETMESİ A.Ş."), ("BRSAN", "BORUSAN MANNESMANN BORU SANAYİ VE TİCARET A.Ş."), ("BRYAT", "BORUSAN YATIRIM VE PAZARLAMA A.Ş."), ("BSOKE", "BATISÖKE SÖKE ÇİMENTO SANAYİİ T.A.Ş."), 
    ("BTCIM", "BATIÇİM BATI ANADOLU ÇİMENTO SANAYİİ A.Ş."), ("BUCIM", "BURSA ÇİMENTO FABRİKASI A.Ş."), ("BULGS", "Bulls Girisim Sermayesi Yatirim Ortakligi Anonim Sirketi"), ("BURCE", "BURÇELİK BURSA ÇELİK DÖKÜM SANAYİİ A.Ş."), ("BURVA", "BURÇELİK VANA SANAYİ VE TİCARET A.Ş."), 
    ("BVSAN", "BÜLBÜLOĞLU VİNÇ SANAYİ VE TİCARET A.Ş."), ("BYDNR", "Baydoner Restoranlari A.S."), ("CANTE", "ÇAN2 TERMİK A.Ş."), ("CASA", "CASA EMTİA PETROL KİMYEVİ VE TÜREVLERİ SANAYİ TİCARET A.Ş."), ("CATES", "Cates Elektrik Uretim Anonim Sirketi"), 
    ("CCOLA", "COCA-COLA İÇECEK A.Ş."), ("CELHA", "ÇELİK HALAT VE TEL SANAYİİ A.Ş."), ("CEMAS", "ÇEMAŞ DÖKÜM SANAYİ A.Ş."), ("CEMTS", "ÇEMTAŞ ÇELİK MAKİNA SANAYİ VE TİCARET A.Ş."), ("CEMZY", "CEM ZEYTIN ANONIM SIRKETI"), 
    ("CEOEM", "CEO EVENT MEDYA A.Ş."), ("CGCAM", "Cagdas Cam Sanayi ve Ticaret AS"), ("CIMSA", "ÇİMSA ÇİMENTO SANAYİ VE TİCARET A.Ş."), ("CLEBI", "ÇELEBİ HAVA SERVİSİ A.Ş."), ("CMBTN", "ÇİMBETON HAZIRBETON VE PREFABRİK YAPI ELEMANLARI SANAYİ VE TİCARET A.Ş."), 
    ("CMENT", "ÇİMENTAŞ İZMİR ÇİMENTO FABRİKASI T.A.Ş."), ("CONSE", "CONSUS ENERJİ İŞLETMECİLİĞİ VE HİZMETLERİ A.Ş."), ("COSMO", "COSMOS YATIRIM HOLDİNG A.Ş."), ("CRDFA", "CREDITWEST FAKTORİNG A.Ş."), ("CRFSA", "CARREFOURSA CARREFOUR SABANCI TİCARET MERKEZİ A.Ş."), 
    ("CUSAN", "ÇUHADAROĞLU METAL SANAYİ VE PAZARLAMA A.Ş."), ("CVKMD", "CVK MADEN İŞLETMELERİ SANAYİ VE TİCARET A.Ş."), ("CWENE", "CW ENERJİ MÜHENDİSLİK TİCARET VE SANAYİ A.Ş."), ("DAGI", "DAGİ GİYİM SANAYİ VE TİCARET A.Ş."), ("DAPGM", "DAP GAYRİMENKUL GELİŞTİRME A.Ş."), 
    ("DARDL", "DARDANEL ÖNENTAŞ GIDA SANAYİ A.Ş."), ("DCTTR", "DCT Trading Dis Ticaret Anonim Sirketi"), ("DENGE", "DENGE YATIRIM HOLDİNG A.Ş."), ("DERHL", "DERLÜKS YATIRIM HOLDİNG A.Ş."), ("DERIM", "DERİMOD KONFEKSİYON AYAKKABI DERİ SANAYİ VE TİCARET A.Ş."), 
    ("DESA", "DESA DERİ SANAYİ VE TİCARET A.Ş."), ("DESPC", "DESPEC BİLGİSAYAR PAZARLAMA VE TİCARET A.Ş."), ("DEVA", "DEVA HOLDİNG A.Ş."), ("DGATE", "DATAGATE BİLGİSAYAR MALZEMELERİ TİCARET A.Ş."), ("DGGYO", "DOĞUŞ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("DGNMO", "DOĞANLAR MOBİLYA GRUBU İMALAT SANAYİ VE TİCARET A.Ş."), ("DIRIT", "DİRİTEKS DİRİLİŞ TEKSTİL SANAYİ VE TİCARET A.Ş."), ("DITAS", "DİTAŞ DOĞAN YEDEK PARÇA İMALAT VE TEKNİK A.Ş."), ("DMLKT", "Emlak Konut Gayrimenkul Yatirim Ortakligi A.S. 0 % Certificates 2025-31.12.2199"), ("DMRGD", "DMR Unlu Mamuller Uretim Gida Toptan Perakende Ihracat A.S."), 
    ("DMSAS", "DEMİSAŞ DÖKÜM EMAYE MAMÜLLERİ SANAYİİ A.Ş."), ("DNISI", "DİNAMİK ISI MAKİNA YALITIM MALZEMELERİ SANAYİ VE TİCARET A.Ş."), ("DOAS", "DOĞUŞ OTOMOTİV SERVİS VE TİCARET A.Ş."), ("DOCO", "DO & CO AKTIENGESELLSCHAFT"), ("DOFER", "Dofer Yapi Maizemeleri Sanayi ve Ticaret A.S."), 
    ("DOFRB", "DOF Robotik Sanayi Anonim Sirketi"), ("DOGUB", "DOĞUSAN BORU SANAYİİ VE TİCARET A.Ş."), ("DOHOL", "DOĞAN ŞİRKETLER GRUBU HOLDİNG A.Ş."), ("DOKTA", "DÖKTAŞ DÖKÜMCÜLÜK TİCARET VE SANAYİ A.Ş."), ("DSTKF", "DESTEK FAKTORİNG A.Ş."), 
    ("DUNYH", "Dunya Holding Anonim Sirketi"), ("DURDO", "DURAN DOĞAN BASIM VE AMBALAJ SANAYİ A.Ş."), ("DURKN", "Durukan Sekerleme Sanayi ve Ticaret AS"), ("DYOBY", "DYO BOYA FABRİKALARI SANAYİ VE TİCARET A.Ş."), ("DZGYO", "DENİZ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("EBEBK", "EBEBEK MAGAZACILIK ANONIM SIRKETI"), ("ECILC", "EİS ECZACIBAŞI İLAÇ SINAİ VE FİNANSAL YATIRIMLAR SANAYİ VE TİCARET A.Ş."), ("ECOGR", "Ecogreen Enerji Holding A.S."), ("ECZYT", "ECZACIBAŞI YATIRIM HOLDİNG ORTAKLIĞI A.Ş."), ("EDATA", "E-DATA TEKNOLOJİ PAZARLAMA A.Ş."), 
    ("EDIP", "EDİP GAYRİMENKUL YATIRIM SANAYİ VE TİCARET A.Ş."), ("EFOR", "Efor Yatirim Sanayi Ticaret A.S."), ("EGEEN", "EGE ENDÜSTRİ VE TİCARET A.Ş."), ("EGEGY", "Egeyapi Avrupa Gayrimenkul Yatirim Ortakligi A.S."), ("EGEPO", "NASMED ÖZEL SAĞLIK HİZMETLERİ TİCARET A.Ş."), 
    ("EGGUB", "EGE GÜBRE SANAYİİ A.Ş."), ("EGPRO", "EGE PROFİL TİCARET VE SANAYİ A.Ş."), ("EGSER", "EGE SERAMİK SANAYİ VE TİCARET A.Ş."), ("EKDMR", "Ekinciler Demir ve Celik Sanayi AS"), ("EKGYO", "EMLAK KONUT GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("EKIM", "EKİM TURİZM TİCARET VE SANAYİ A.Ş."), ("EKIZ", "EKİZ KİMYA SANAYİ VE TİCARET A.Ş."), ("EKOS", "Ekos Teknoloji ve Elektrik AS"), ("EKSUN", "EKSUN GIDA TARIM SANAYİ VE TİCARET A.Ş."), ("ELITE", "ELİTE NATUREL ORGANİK GIDA SANAYİ VE TİCARET A.Ş."), 
    ("EMKEL", "EMEK ELEKTRİK ENDÜSTRİSİ A.Ş."), ("EMNIS", "EMİNİŞ AMBALAJ SANAYİ VE TİCARET A.Ş."), ("EMPAE", "Empa Elektronik Sanayi ve Ticaret A.S."), ("ENDAE", "Enda Enerji Holding Anonim Sirketi"), ("ENERY", "Enerya Enerji A.S."), 
    ("ENJSA", "ENERJİSA ENERJİ A.Ş."), ("ENKAI", "ENKA İNŞAAT VE SANAYİ A.Ş."), ("ENPRA", "Enpara Bank A.S."), ("ENSRI", "ENSARİ DERİ GIDA SANAYİ VE TİCARET A.Ş."), ("ENTRA", "IC Enterra Yenilenebilir Enerji AS"), 
    ("EPLAS", "EGEPLAST EGE PLASTİK TİCARET VE SANAYİ A.Ş."), ("ERBOS", "ERBOSAN ERCİYAS BORU SANAYİİ VE TİCARET A.Ş."), ("ERCB", "ERCİYAS ÇELİK BORU SANAYİ A.Ş."), ("EREGL", "EREĞLİ DEMİR VE ÇELİK FABRİKALARI T.A.Ş."), ("ERSU", "ERSU MEYVE VE GIDA SANAYİ A.Ş."), 
    ("ESCAR", "ESCAR FİLO KİRALAMA HİZMETLERİ A.Ş."), ("ESCOM", "ESCORT TEKNOLOJİ YATIRIM A.Ş."), ("ESEN", "ESENBOĞA ELEKTRİK ÜRETİM A.Ş."), ("ETILR", "ETİLER GIDA VE TİCARİ YATIRIMLAR SANAYİ VE TİCARET A.Ş."), ("ETYAT", "EURO TREND YATIRIM ORTAKLIĞI A.Ş."), 
    ("EUHOL", "EURO YATIRIM HOLDİNG A.Ş."), ("EUKYO", "EURO KAPİTAL YATIRIM ORTAKLIĞI A.Ş."), ("EUPWR", "EUROPOWER ENERJİ VE OTOMASYON TEKNOLOJİLERİ SANAYİ TİCARET A.Ş."), ("EUREN", "EUROPEN ENDÜSTRİ İNŞAAT SANAYİ VE TİCARET A.Ş."), ("EUYO", "EURO MENKUL KIYMET YATIRIM ORTAKLIĞI A.Ş."), 
    ("EYGYO", "EYG GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("FADE", "FADE GIDA YATIRIM SANAYİ TİCARET A.Ş."), ("FENER", "FENERBAHÇE FUTBOL A.Ş."), ("FLAP", "FLAP KONGRE TOPLANTI HİZMETLERİ OTOMOTİV VE TURİZM A.Ş."), ("FMIZP", "FEDERAL-MOGUL İZMİT PİSTON VE PİM ÜRETİM TESİSLERİ A.Ş."), 
    ("FONET", "FONET BİLGİ TEKNOLOJİLERİ A.Ş."), ("FORMT", "FORMET METAL VE CAM SANAYİ A.Ş."), ("FORTE", "FORTE BILGI ILETISIM TEKNOLOJILERI VE SAVUNMA SANAYI A.S."), ("FRIGO", "FRİGO-PAK GIDA MADDELERİ SANAYİ VE TİCARET A.Ş."), ("FRMPL", "Formul Plastik Ve Metal Sanayi AS"), 
    ("FROTO", "FORD OTOMOTİV SANAYİ A.Ş."), ("FZLGY", "FUZUL GAYRIMENKUL YATIRIM ORTAKLIGI A.S."), ("GARAN", "TÜRKİYE GARANTİ BANKASI A.Ş."), ("GARFA", "GARANTİ FAKTORİNG A.Ş."), ("GATEG", "Gate Group Teknoloji Medya Ve Siber Guvenlik Hizmetleri A.S."), 
    ("GEDIK", "GEDİK YATIRIM MENKUL DEĞERLER A.Ş."), ("GEDZA", "GEDİZ AMBALAJ SANAYİ VE TİCARET A.Ş."), ("GENIL", "GEN İLAÇ VE SAĞLIK ÜRÜNLERİ SANAYİ VE TİCARET A.Ş."), ("GENKM", "Gentas Kimya Sanayi ve Ticaret Pazarlama"), ("GENTS", "GENTAŞ DEKORATİF YÜZEYLER SANAYİ VE TİCARET A.Ş."), 
    ("GEREL", "GERSAN ELEKTRİK TİCARET VE SANAYİ A.Ş."), ("GESAN", "GİRİŞİM ELEKTRİK SANAYİ TAAHHÜT VE TİCARET A.Ş."), ("GIPTA", "Gipta Ofis Kirtasiye ve Promosyon Urunleri Imalat Sanayi A.S."), ("GLBMD", "GLOBAL MENKUL DEĞERLER A.Ş."), ("GLCVY", "GELECEK VARLIK YÖNETİMİ A.Ş."), 
    ("GLRMK", "Gulermak Agir Sanayi Insaat Ve Taahhut A.S."), ("GLRYH", "GÜLER YATIRIM HOLDİNG A.Ş."), ("GLYHO", "GLOBAL YATIRIM HOLDİNG A.Ş."), ("GMTAS", "GİMAT MAĞAZACILIK SANAYİ VE TİCARET A.Ş."), ("GOKNR", "GÖKNUR GIDA MADDELERİ ENERJİ İMALAT İTHALAT İHRACAT TİCARET VE SANAYİ A.Ş."), 
    ("GOLDA", "Golda Gida Sanayi ve Ticaret A.S."), ("GOLTS", "GÖLTAŞ GÖLLER BÖLGESİ ÇİMENTO SANAYİ VE TİCARET A.Ş."), ("GOODY", "GOODYEAR LASTİKLERİ T.A.Ş."), ("GOZDE", "GÖZDE GİRİŞİM SERMAYESİ YATIRIM ORTAKLIĞI A.Ş."), ("GRNYO", "GARANTİ YATIRIM ORTAKLIĞI A.Ş."), 
    ("GRSEL", "GÜR-SEL TURİZM TAŞIMACILIK VE SERVİS TİCARET A.Ş."), ("GRTHO", "Grainturk Holding A.S."), ("GSDDE", "GSD DENİZCİLİK GAYRİMENKUL İNŞAAT SANAYİ VE TİCARET A.Ş."), ("GSDHO", "GSD HOLDİNG A.Ş."), ("GSRAY", "GALATASARAY SPORTİF SINAİ VE TİCARİ YATIRIMLAR A.Ş."), 
    ("GUBRF", "GÜBRE FABRİKALARI T.A.Ş."), ("GUNDG", "Gundogdu Gida Sut Urunleri Sanayi Ve Dis Ticaret AS"), ("GWIND", "GALATA WIND ENERJİ A.Ş."), ("GZNMI", "GEZİNOMİ SEYAHAT TURİZM TİCARET A.Ş."), ("HALKB", "TÜRKİYE HALK BANKASI A.Ş."), 
    ("HATEK", "HATEKS HATAY TEKSTİL İŞLETMELERİ A.Ş."), ("HATSN", "Hat-San Gemi Insaa Bakim Onarim Deniz Nakliyat Sanayi ve Ticaret A.S."), ("HDFGS", "HEDEF GİRİŞİM SERMAYESİ YATIRIM ORTAKLIĞI A.Ş."), ("HEDEF", "HEDEF HOLDİNG A.Ş."), ("HEKTS", "HEKTAŞ TİCARET T.A.Ş."), 
    ("HKTM", "HİDROPAR HAREKET KONTROL TEKNOLOJİLERİ MERKEZİ SANAYİ VE TİCARET A.Ş."), ("HLGYO", "HALK GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("HOROZ", "Horoz Lojistik Kargo Hizmetleri Ve Ticaret AS"), ("HRKET", "Hareket Proje Tasimaciligi ve Yuk Muhendisligi AS"), ("HTTBT", "HİTİT BİLGİSAYAR HİZMETLERİ A.Ş."), 
    ("HUBVC", "HUB GİRİŞİM SERMAYESİ YATIRIM ORTAKLIĞI A.Ş."), ("HUNER", "HUN YENİLENEBİLİR ENERJİ ÜRETİM A.Ş."), ("HURGZ", "HÜRRİYET GAZETECİLİK VE MATBAACILIK A.Ş."), ("ICBCT", "ICBC TURKEY BANK A.Ş."), ("ICUGS", "ICU Girisim Sermayesi Yatirim Ortakligi A.S."), 
    ("IDGYO", "İDEALİST GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("IEYHO", "IŞIKLAR ENERJİ VE YAPI HOLDİNG A.Ş."), ("IHAAS", "İHLAS HABER AJANSI A.Ş."), ("IHEVA", "İHLAS EV ALETLERİ İMALAT SANAYİ VE TİCARET A.Ş."), ("IHGZT", "İHLAS GAZETECİLİK A.Ş."), 
    ("IHLAS", "İHLAS HOLDİNG A.Ş."), ("IHLGM", "İHLAS GAYRİMENKUL PROJE GELİŞTİRME VE TİCARET A.Ş."), ("IHYAY", "İHLAS YAYIN HOLDİNG A.Ş."), ("IMASM", "İMAŞ MAKİNA SANAYİ A.Ş."), ("INDES", "İNDEKS BİLGİSAYAR SİSTEMLERİ MÜHENDİSLİK SANAYİ VE TİCARET A.Ş."), 
    ("INFO", "İNFO YATIRIM MENKUL DEĞERLER A.Ş."), ("INGRM", "INGRAM MİCRO BİLİŞİM SİSTEMLERİ A.Ş."), ("INTEK", "Innosa Teknoloji Anonim Sirketi"), ("INTEM", "İNTEMA İNŞAAT VE TESİSAT MALZEMELERİ YATIRIM VE PAZARLAMA A.Ş."), ("INVEO", "INVEO YATIRIM HOLDİNG A.Ş."), 
    ("INVES", "INVESTCO HOLDİNG A.Ş."), ("ISBIR", "İŞBİR HOLDİNG A.Ş."), ("ISBTR", "TÜRKİYE İŞ BANKASI A.Ş."), ("ISCTR", "TÜRKİYE İŞ BANKASI A.Ş."), ("ISDMR", "İSKENDERUN DEMİR VE ÇELİK A.Ş."), 
    ("ISFIN", "İŞ FİNANSAL KİRALAMA A.Ş."), ("ISGYO", "İŞ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("ISKPL", "IŞIK PLASTİK SANAYİ VE DIŞ TİCARET PAZARLAMA A.Ş."), ("ISKUR", "TÜRKİYE İŞ BANKASI A.Ş."), ("ISMEN", "İŞ YATIRIM MENKUL DEĞERLER A.Ş."), 
    ("ISSEN", "İŞBİR SENTETİK DOKUMA SANAYİ A.Ş."), ("ISVEA", "ISVEA SERAMIK VE BANYO URUNLERI SAN"), ("IZENR", "Izdemir Enerji Elektrik Uretim A.S."), ("IZFAS", "İZMİR FIRÇA SANAYİ VE TİCARET A.Ş."), ("IZINV", "İZ YATIRIM HOLDİNG A.Ş."), 
    ("IZMDC", "İZMİR DEMİR ÇELİK SANAYİ A.Ş."), ("JANTS", "JANTSA JANT SANAYİ VE TİCARET A.Ş."), ("KAPLM", "KAPLAMİN AMBALAJ SANAYİ VE TİCARET A.Ş."), ("KAREL", "KAREL ELEKTRONİK SANAYİ VE TİCARET A.Ş."), ("KARSN", "KARSAN OTOMOTİV SANAYİİ VE TİCARET A.Ş."), 
    ("KARTN", "KARTONSAN KARTON SANAYİ VE TİCARET A.Ş."), ("KATMR", "KATMERCİLER ARAÇ ÜSTÜ EKİPMAN SANAYİ VE TİCARET A.Ş."), ("KAYSE", "KAYSERİ ŞEKER FABRİKASI A.Ş."), ("KBORU", "Kuzey Boru A.S."), ("KCAER", "KOCAER ÇELİK SANAYİ VE TİCARET A.Ş."), 
    ("KCHOL", "KOÇ HOLDİNG A.Ş."), ("KENT", "KENT GIDA MADDELERİ SANAYİİ VE TİCARET A.Ş."), ("KERVN", "KERVANSARAY YATIRIM HOLDİNG A.Ş."), ("KFEIN", "KAFEİN YAZILIM HİZMETLERİ TİCARET A.Ş."), ("KGYO", "KORAY GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("KIMMR", "ERSAN ALIŞVERİŞ HİZMETLERİ VE GIDA SANAYİ TİCARET A.Ş."), ("KLGYO", "KİLER GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("KLKIM", "KALEKİM KİMYEVİ MADDELER SANAYİ VE TİCARET A.Ş."), ("KLMSN", "KLİMASAN KLİMA SANAYİ VE TİCARET A.Ş."), ("KLNMA", "TÜRKİYE KALKINMA VE YATIRIM BANKASI A.Ş."), 
    ("KLRHO", "KİLER HOLDİNG A.Ş."), ("KLSER", "Kaleseramik Canakkale Kalebodur Seramik A.S."), ("KLSYN", "KOLEKSİYON MOBİLYA SANAYİ A.Ş."), ("KLYPV", "Kalyon Gunes Teknolojileri Uretim Anonim Sirketi"), ("KMPUR", "KİMTEKS POLİÜRETAN SANAYİ VE TİCARET A.Ş."), 
    ("KNFRT", "KONFRUT GIDA SANAYİ VE TİCARET A.Ş."), ("KOCMT", "Koc Metalurji AS"), ("KONKA", "KONYA KAĞIT SANAYİ VE TİCARET A.Ş."), ("KONTR", "KONTROLMATİK TEKNOLOJİ ENERJİ VE MÜHENDİSLİK A.Ş."), ("KONYA", "KONYA ÇİMENTO SANAYİİ A.Ş."), 
    ("KOPOL", "KOZA POLYESTER SANAYİ VE TİCARET A.Ş."), ("KORDS", "KORDSA TEKNİK TEKSTİL A.Ş."), ("KOTON", "KOTON MAĞAZACILIK TEKSTİL SANAYİ VE TİCARET A.Ş."), ("KRDMA", "KARDEMİR KARABÜK DEMİR ÇELİK SANAYİ VE TİCARET A.Ş."), ("KRDMB", "KARDEMİR KARABÜK DEMİR ÇELİK SANAYİ VE TİCARET A.Ş."), 
    ("KRDMD", "KARDEMİR KARABÜK DEMİR ÇELİK SANAYİ VE TİCARET A.Ş."), ("KRGYO", "KÖRFEZ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("KRONT", "KRON TELEKOMÜNİKASYON HİZMETLERİ A.Ş."), ("KRPLS", "KOROPLAST TEMİZLİK AMBALAJ ÜRÜNLERİ SANAYİ VE DIŞ TİCARET A.Ş."), ("KRSTL", "KRİSTAL KOLA VE MEŞRUBAT SANAYİ TİCARET A.Ş."), 
    ("KRTEK", "KARSU TEKSTİL SANAYİİ VE TİCARET A.Ş."), ("KRVGD", "KERVAN GIDA SANAYİ VE TİCARET A.Ş."), ("KSTUR", "KUŞTUR KUŞADASI TURİZM ENDÜSTRİ A.Ş."), ("KTLEV", "KATILIMEVIM TASARRUF FINANSMAN A.S."), ("KTSKR", "KÜTAHYA ŞEKER FABRİKASI A.Ş."), 
    ("KUTPO", "KÜTAHYA PORSELEN SANAYİ A.Ş."), ("KUVVA", "KUVVA GIDA TİCARET VE SANAYİ YATIRIMLARI A.Ş."), ("KUYAS", "KUYAŞ YATIRIM A.Ş."), ("KZBGY", "KIZILBÜK GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("KZGYO", "Kuzugrup Gayrimenkul Yatirim Ortakligi AS"), 
    ("LIDER", "LDR TURİZM A.Ş."), ("LIDFA", "LİDER FAKTORİNG A.Ş."), ("LILAK", "Lila Kagit Sanayi Ve Ticaret Anonim Sirketi"), ("LINK", "LİNK BİLGİSAYAR SİSTEMLERİ YAZILIMI VE DONANIMI SANAYİ VE TİCARET A.Ş."), ("LKMNH", "LOKMAN HEKİM ENGÜRÜSAĞ SAĞLIK TURİZM EĞİTİM HİZMETLERİ VE İNŞAAT TAAHHÜT A.Ş."), 
    ("LMKDC", "Limak Dogu Anadolu Cimento Sanayi Ve Ticaret AS"), ("LOGO", "LOGO YAZILIM SANAYİ VE TİCARET A.Ş."), ("LRSHO", "Loras Holding Anonim Sirketi"), ("LUKSK", "LÜKS KADİFE TİCARET VE SANAYİİ A.Ş."), ("LXGYO", "Luxera Gayrimenkul Yatirim Ortakligi A.S."), 
    ("LYDHO", "Lydia Holding A.S."), ("LYDYE", "Lydia Yesil Enerji kaynaklari A.S."), ("MAALT", "MARMARİS ALTINYUNUS TURİSTİK TESİSLER A.Ş."), ("MACKO", "MACKOLİK İNTERNET HİZMETLERİ TİCARET A.Ş."), ("MAGEN", "MARGÜN ENERJİ ÜRETİM SANAYİ VE TİCARET A.Ş."), 
    ("MAKIM", "MAKİM MAKİNA TEKNOLOJİLERİ SANAYİ VE TİCARET A.Ş."), ("MAKTK", "MAKİNA TAKIM ENDÜSTRİSİ A.Ş."), ("MANAS", "MANAS ENERJİ YÖNETİMİ SANAYİ VE TİCARET A.Ş."), ("MARBL", "Tureks Turunc Madencilik Ic ve Dis Ticaret A.S."), ("MARKA", "MARKA YATIRIM HOLDİNG A.Ş."), 
    ("MARMR", "Marmara Holding AS"), ("MARTI", "MARTI OTEL İŞLETMELERİ A.Ş."), ("MAVI", "MAVİ GİYİM SANAYİ VE TİCARET A.Ş."), ("MCARD", "Metropal Kurumsal Hizmetler A.S."), ("MEDTR", "MEDİTERA TIBBİ MALZEME SANAYİ VE TİCARET A.Ş."), 
    ("MEGAP", "MEGA POLİETİLEN KÖPÜK SANAYİ VE TİCARET A.Ş."), ("MEGMT", "Mega Metal Sanayi Ve Ticaret A.S."), ("MEKAG", "Meka Global Makine Imalat Sanayi Ve Ticaret A.S."), ("MEPET", "MEPET METRO PETROL VE TESİSLERİ SANAYİ TİCARET A.Ş."), ("MERCN", "MERCAN KİMYA SANAYİ VE TİCARET A.Ş."), 
    ("MERIT", "MERİT TURİZM YATIRIM VE İŞLETME A.Ş."), ("MERKO", "MERKO GIDA SANAYİ VE TİCARET A.Ş."), ("METRO", "METRO TİCARİ VE MALİ YATIRIMLAR HOLDİNG A.Ş."), ("MEYSU", "Meysu Gida Sanayi Ve Ticaret A.S."), ("MGROS", "MİGROS TİCARET A.Ş."), 
    ("MHRGY", "MHR Gayrimenkul Yatirim Ortakligi Anonim Sirketi"), ("MIATK", "MİA TEKNOLOJİ A.Ş."), ("MMCAS", "MMC SANAYİ VE TİCARİ YATIRIMLAR A.Ş."), ("MNDRS", "MENDERES TEKSTİL SANAYİ VE TİCARET A.Ş."), ("MNDTR", "MONDİ TURKEY OLUKLU MUKAVVA KAĞIT VE AMBALAJ SANAYİ A.Ş."), 
    ("MOBTL", "MOBİLTEL İLETİŞİM HİZMETLERİ SANAYİ VE TİCARET A.Ş."), ("MOGAN", "Mogan Enerji Yatirim Holding"), ("MOPAS", "Mopas Marketcilik Gida Sanayi Ve Ticaret A.S."), ("MPARK", "MLP SAĞLIK HİZMETLERİ A.Ş."), ("MRGYO", "MARTI GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("MRSHL", "MARSHALL BOYA VE VERNİK SANAYİİ A.Ş."), ("MSGYO", "MİSTRAL GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("MTRKS", "MATRİKS FİNANSAL TEKNOLOJİLER A.Ş."), ("MTRYO", "METRO YATIRIM ORTAKLIĞI A.Ş."), ("MZHLD", "MAZHAR ZORLU HOLDİNG A.Ş."), 
    ("NATEN", "NATUREL YENİLENEBİLİR ENERJİ TİCARET A.Ş."), ("NETAS", "NETAŞ TELEKOMÜNİKASYON A.Ş."), ("NETCD", "Netcad Yazilim A.S."), ("NIBAS", "NİĞBAŞ NİĞDE BETON SANAYİ VE TİCARET A.Ş."), ("NTGAZ", "NATURELGAZ SANAYİ VE TİCARET A.Ş."), 
    ("NTHOL", "NET HOLDİNG A.Ş."), ("NUGYO", "NUROL GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("NUHCM", "NUH ÇİMENTO SANAYİ A.Ş."), ("OBAMS", "Oba Makarnacilik Sanayi Ve Ticaret A. S."), ("OBASE", "OBASE BİLGİSAYAR VE DANIŞMANLIK HİZMETLERİ TİCARET A.Ş."), 
    ("ODAS", "ODAŞ ELEKTRİK ÜRETİM SANAYİ TİCARET A.Ş."), ("ODINE", "Odine Solutions Teknoloji Ticaret ve Sanayi AS"), ("OFSYM", "Ofis Yem Gida Sanayi ve Ticaret A.S."), ("ONCSM", "ONCOSEM ONKOLOJİK SİSTEMLER SANAYİ VE TİCARET A.Ş."), ("ONRYT", "Onur Yuksek Teknoloji AS"), 
    ("ORCAY", "ORÇAY ORTAKÖY ÇAY SANAYİ VE TİCARET A.Ş."), ("ORGE", "ORGE ENERJİ ELEKTRİK TAAHHÜT A.Ş."), ("ORMA", "ORMA ORMAN MAHSULLERİ İNTEGRE SANAYİ VE TİCARET A.Ş."), ("ORZAX", "Orzaks Ilac ve Kimya Sanayi Ticaret A.S."), ("OSMEN", "OSMANLI YATIRIM MENKUL DEĞERLER A.Ş."), 
    ("OSTIM", "OSTİM ENDÜSTRİYEL YATIRIMLAR VE İŞLETME A.Ş."), ("OTKAR", "OTOKAR OTOMOTİV VE SAVUNMA SANAYİ A.Ş."), ("OTTO", "OTTO HOLDİNG A.Ş."), ("OYAKC", "OYAK ÇİMENTO FABRİKALARI A.Ş."), ("OYAYO", "OYAK YATIRIM ORTAKLIĞI A.Ş."), 
    ("OYLUM", "OYLUM SINAİ YATIRIMLAR A.Ş."), ("OYYAT", "OYAK YATIRIM MENKUL DEĞERLER A.Ş."), ("OZATD", "OZATA DENIZCILIK SANAYI VE TICARET AS"), ("OZGYO", "ÖZDERİCİ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("OZKGY", "ÖZAK GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("OZRDN", "ÖZERDEN PLASTİK SANAYİ VE TİCARET A.Ş."), ("OZSUB", "ÖZSU BALIK ÜRETİM A.Ş."), ("OZYSR", "Ozyasar Tel ve Galvanizleme Sanayi Anonim Sirketi"), ("PAGYO", "PANORA GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("PAHOL", "PASIFIK HOLDING A.S"), 
    ("PAMEL", "PAMEL YENİLENEBİLİR ELEKTRİK ÜRETİM A.Ş."), ("PAPIL", "PAPİLON SAVUNMA TEKNOLOJİ VE TİCARET A.Ş."), ("PARSN", "PARSAN MAKİNA PARÇALARI SANAYİİ A.Ş."), ("PASEU", "Pasifik Eurasia Lojistik dis Ticaret AS"), ("PATEK", "Pasifik Teknoloji AS"), 
    ("PCILT", "PC İLETİŞİM VE MEDYA HİZMETLERİ SANAYİ TİCARET A.Ş."), ("PEKGY", "PEKER GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("PENGD", "PENGUEN GIDA SANAYİ A.Ş."), ("PENTA", "PENTA TEKNOLOJİ ÜRÜNLERİ DAĞITIM TİCARET A.Ş."), ("PETKM", "PETKİM PETROKİMYA HOLDİNG A.Ş."), 
    ("PETUN", "PINAR ENTEGRE ET VE UN SANAYİİ A.Ş."), ("PGSUS", "PEGASUS HAVA TAŞIMACILIĞI A.Ş."), ("PINSU", "PINAR SU VE İÇECEK SANAYİ VE TİCARET A.Ş."), ("PKART", "PLASTİKKART AKILLI KART İLETİŞİM SİSTEMLERİ SANAYİ VE TİCARET A.Ş."), ("PKENT", "PETROKENT TURİZM A.Ş."), 
    ("PLTUR", "PLATFORM TURİZM TAŞIMACILIK GIDA İNŞAAT TEMİZLİK HİZMETLERİ SANAYİ VE TİCARET A.Ş."), ("PNLSN", "PANELSAN ÇATI CEPHE SİSTEMLERİ SANAYİ VE TİCARET A.Ş."), ("PNSUT", "PINAR SÜT MAMULLERİ SANAYİİ A.Ş."), ("POLHO", "POLİSAN HOLDİNG A.Ş."), ("POLTK", "POLİTEKNİK METAL SANAYİ VE TİCARET A.Ş."), 
    ("PRDGS", "PARDUS GİRİŞİM SERMAYESİ YATIRIM ORTAKLIĞI A.Ş."), ("PRKAB", "TÜRK PRYSMİAN KABLO VE SİSTEMLERİ A.Ş."), ("PRKME", "PARK ELEKTRİK ÜRETİM MADENCİLİK SANAYİ VE TİCARET A.Ş."), ("PRZMA", "PRİZMA PRES MATBAACILIK YAYINCILIK SANAYİ VE TİCARET A.Ş."), ("PSDTC", "PERGAMON STATUS DIŞ TİCARET A.Ş."), 
    ("PSGYO", "PASİFİK GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("QNBFK", "QNB Finansal Kiralama A.S."), ("QNBTR", "QNB Bank AS"), ("QUAGR", "QUA GRANITE HAYAL YAPI VE ÜRÜNLERİ SANAYİ TİCARET A.Ş."), ("RALYH", "RAL YATIRIM HOLDİNG A.Ş."), 
    ("RAYSG", "RAY SİGORTA A.Ş."), ("REEDR", "Reeder Teknoloji Sanayi ve Ticaret A.S."), ("RGYAS", "RÖNESANS GAYRİMENKUL YATIRIM A.Ş."), ("RNPOL", "RAİNBOW POLİKARBONAT SANAYİ TİCARET A.Ş."), ("RODRG", "RODRİGO TEKSTİL SANAYİ VE TİCARET A.Ş."), 
    ("RTALB", "RTA LABORATUVARLARI BİYOLOJİK ÜRÜNLER İLAÇ VE MAKİNE SANAYİ TİCARET A.Ş."), ("RUBNS", "RUBENİS TEKSTİL SANAYİ TİCARET A.Ş."), ("RUZYE", "Ruzy Madencilik Ve Enerji Yatirimlari Sanayi Ve Ticaret A.S."), ("RYGYO", "REYSAŞ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("RYSAS", "REYSAŞ TAŞIMACILIK VE LOJİSTİK TİCARET A.Ş."), 
    ("SAFKR", "SAFKAR EGE SOĞUTMACILIK KLİMA SOĞUK HAVA TESİSLERİ İHRACAT İTHALAT SANAYİ VE TİCARET A.Ş."), ("SAHOL", "HACI ÖMER SABANCI HOLDİNG A.Ş."), ("SAMAT", "SARAY MATBAACILIK KAĞITÇILIK KIRTASİYECİLİK TİCARET VE SANAYİ A.Ş."), ("SANEL", "SAN-EL MÜHENDİSLİK ELEKTRİK TAAHHÜT SANAYİ VE TİCARET A.Ş."), ("SANFM", "SANİFOAM ENDÜSTRİ VE TÜKETİM ÜRÜNLERİ SANAYİ TİCARET A.Ş."), 
    ("SANKO", "SANKO PAZARLAMA İTHALAT İHRACAT A.Ş."), ("SARKY", "SARKUYSAN ELEKTROLİTİK BAKIR SANAYİ VE TİCARET A.Ş."), ("SASA", "SASA POLYESTER SANAYİ A.Ş."), ("SAYAS", "SAY YENİLENEBİLİR ENERJİ EKİPMANLARI SANAYİ VE TİCARET A.Ş."), ("SDTTR", "SDT UZAY VE SAVUNMA TEKNOLOJİLERİ A.Ş."), 
    ("SEGMN", "Segmen Kardesler Gida Uretim ve Ambalaj Sanayi AS"), ("SEGYO", "ŞEKER GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("SEKFK", "ŞEKER FİNANSAL KİRALAMA A.Ş."), ("SEKUR", "SEKURO PLASTİK AMBALAJ SANAYİ A.Ş."), ("SELEC", "SELÇUK ECZA DEPOSU TİCARET VE SANAYİ A.Ş."), 
    ("SELVA", "SELVA GIDA SANAYİ A.Ş."), ("SERNT", "Seranit Granit Seramik Sanayi ve Ticaret A.S."), ("SEYKM", "SEYİTLER KİMYA SANAYİ A.Ş."), ("SILVR", "SİLVERLİNE ENDÜSTRİ VE TİCARET A.Ş."), ("SISE", "TÜRKİYE ŞİŞE VE CAM FABRİKALARI A.Ş."), 
    ("SKBNK", "ŞEKERBANK T.A.Ş."), ("SKTAS", "SÖKTAŞ TEKSTİL SANAYİ VE TİCARET A.Ş."), ("SKYLP", "Skyalp Finansal Teknolojiler ve Danismanlik A.S"), ("SKYMD", "Seker Yatirim Menkul Degerler A.S."), ("SMART", "SMARTİKS YAZILIM A.Ş."), 
    ("SMRTG", "SMART GÜNEŞ ENERJİSİ TEKNOLOJİLERİ ARAŞTIRMA GELİŞTİRME ÜRETİM SANAYİ VE TİCARET A.Ş."), ("SMRVA", "Sumer Varlik Yonetim A.S."), ("SNGYO", "SİNPAŞ GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("SNICA", "SANİCA ISI SANAYİ A.Ş."), ("SNPAM", "SÖNMEZ PAMUKLU SANAYİİ A.Ş."), 
    ("SODSN", "SODAŞ SODYUM SANAYİİ A.Ş."), ("SOHOE", "Soho Giyim ve Enerji A.S."), ("SOKE", "SÖKE DEĞİRMENCİLİK SANAYİ VE TİCARET A.Ş."), ("SOKM", "ŞOK MARKETLER TİCARET A.Ş."), ("SONME", "SÖNMEZ FİLAMENT SENTETİK İPLİK VE ELYAF SANAYİ A.Ş."), 
    ("SRVGY", "SERVET GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("SUMAS", "SUMAŞ SUNİ TAHTA VE MOBİLYA SANAYİ A.Ş."), ("SUNTK", "SUN TEKSTİL SANAYİ VE TİCARET A.Ş."), ("SURGY", "Sur Tatil Evleri Gayrimenkul Yatirim Ortakligi A.S."), ("SUWEN", "SUWEN TEKSTİL SANAYİ PAZARLAMA A.Ş."), 
    ("SVGYO", "Savur Gayrimenkul Yatirim Ortakligi A.S"), ("TABGD", "TAB Gida Sanayi ve Ticaret A.S."), ("TARKM", "Tarkim Bitki Koruma Sanayi ve Ticaret A.S."), ("TATEN", "Tatlipinar Enerji Uretim A.S."), ("TATGD", "TAT GIDA SANAYİ A.Ş."), 
    ("TAVHL", "TAV HAVALİMANLARI HOLDİNG A.Ş."), ("TBORG", "TÜRK TUBORG BİRA VE MALT SANAYİİ A.Ş."), ("TCELL", "TURKCELL İLETİŞİM HİZMETLERİ A.Ş."), ("TCKRC", "Kirac Galvaniz Telekominikasyon Metal Makine Insaat Elektrik Sanayi Ve Ticaret AS"), ("TDGYO", "TREND GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
    ("TEHOL", "Tera Yatirim Teknoloji Holding A.S."), ("TEKTU", "TEK-ART İNŞAAT TİCARET TURİZM SANAYİ VE YATIRIMLAR A.Ş."), ("TERA", "TERA YATIRIM MENKUL DEĞERLER A.Ş."), ("TEZOL", "EUROPAP TEZOL KAĞIT SANAYİ VE TİCARET A.Ş."), ("TGSAS", "TGS DIŞ TİCARET A.Ş."), 
    ("THYAO", "TÜRK HAVA YOLLARI A.O."), ("TKFEN", "TEKFEN HOLDİNG A.Ş."), ("TKNSA", "TEKNOSA İÇ VE DIŞ TİCARET A.Ş."), ("TLMAN", "TRABZON LİMAN İŞLETMECİLİĞİ A.Ş."), ("TMPOL", "TEMAPOL POLİMER PLASTİK VE İNŞAAT SANAYİ TİCARET A.Ş."), 
    ("TMSN", "TÜMOSAN MOTOR VE TRAKTÖR SANAYİ A.Ş."), ("TNZTP", "TAPDİ OKSİJEN ÖZEL SAĞLIK VE EĞİTİM HİZMETLERİ SANAYİ TİCARET A.Ş."), ("TOASO", "TOFAŞ TÜRK OTOMOBİL FABRİKASI A.Ş."), ("TRALT", "Turk Altin Isletmeleri A.S."), ("TRCAS", "TURCAS PETROL A.Ş."), 
    ("TRENJ", "TR Dogal Enerji Kaynaklari Arastirma ve Uretim Anonim Sirketi"), ("TRGYO", "TORUNLAR GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("TRHOL", "Tera Financial Investments Holding A.S."), ("TRILC", "TURK İLAÇ VE SERUM SANAYİ A.Ş."), ("TRMET", "TR Anadolu Metal Madencilik Isletmeleri Anonim Sirketi"), 
    ("TSGYO", "TSKB GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("TSKB", "TÜRKİYE SINAİ KALKINMA BANKASI A.Ş."), ("TSPOR", "TRABZONSPOR SPORTİF YATIRIM VE FUTBOL İŞLETMECİLİĞİ TİCARET A.Ş."), ("TTKOM", "TÜRK TELEKOMÜNİKASYON A.Ş."), ("TTRAK", "TÜRK TRAKTÖR VE ZİRAAT MAKİNELERİ A.Ş."), 
    ("TUCLK", "TUĞÇELİK ALÜMİNYUM VE METAL MAMÜLLERİ SANAYİ VE TİCARET A.Ş."), ("TUKAS", "TUKAŞ GIDA SANAYİ VE TİCARET A.Ş."), ("TUPRS", "TÜPRAŞ-TÜRKİYE PETROL RAFİNERİLERİ A.Ş."), ("TUREX", "TUREKS TURİZM TAŞIMACILIK A.Ş."), ("TURGG", "TÜRKER PROJE GAYRİMENKUL VE YATIRIM GELİŞTİRME A.Ş."), 
    ("TURSG", "TÜRKİYE SİGORTA A.Ş."), ("UCAYM", "Ucay Muhendislik Enerji ve Iklimlendirme Teknolojileri"), ("UFUK", "UFUK YATIRIM YÖNETİM VE GAYRİMENKUL A.Ş."), ("ULAS", "ULAŞLAR TURİZM YATIRIMLARI VE DAYANIKLI TÜKETİM MALLARI TİCARET PAZARLAMA A.Ş."), ("ULKER", "ÜLKER BİSKÜVİ SANAYİ A.Ş."), 
    ("ULUFA", "ULUSAL FAKTORİNG A.Ş."), ("ULUSE", "ULUSOY ELEKTRİK İMALAT TAAHHÜT VE TİCARET A.Ş."), ("ULUUN", "ULUSOY UN SANAYİ VE TİCARET A.Ş."), ("UNLU", "ÜNLÜ YATIRIM HOLDİNG A.Ş."), ("USAK", "UŞAK SERAMİK SANAYİ A.Ş."), 
    ("VAKBN", "TÜRKİYE VAKIFLAR BANKASI T.A.O."), ("VAKFA", "VAKIF FAKTORİNG A.Ş."), ("VAKFN", "VAKIF FİNANSAL KİRALAMA A.Ş."), ("VAKKO", "VAKKO TEKSTİL VE HAZIR GİYİM SANAYİ İŞLETMELERİ A.Ş."), ("VANGD", "VANET GIDA SANAYİ İÇ VE DIŞ TİCARET A.Ş."), 
    ("VBTYZ", "VBT YAZILIM A.Ş."), ("VERUS", "VERUSA HOLDİNG A.Ş."), ("VESBE", "VESTEL BEYAZ EŞYA SANAYİ VE TİCARET A.Ş."), ("VESTL", "VESTEL ELEKTRONİK SANAYİ VE TİCARET A.Ş."), ("VKFYO", "VAKIF MENKUL KIYMET YATIRIM ORTAKLIĞI A.Ş."), 
    ("VKGYO", "VAKIF GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("VKING", "VİKİNG KAĞIT VE SELÜLOZ A.Ş."), ("VRGYO", "Vera Konsept Gayrimenkul Yatirim Ortakligi A.S."), ("VSNMD", "Visne Madencilik Uretim Sanayi ve Ticaret AS"), ("YAPRK", "YAPRAK SÜT VE BESİ ÇİFTLİKLERİ SANAYİ VE TİCARET A.Ş."), 
    ("YATAS", "YATAŞ YATAK VE YORGAN SANAYİ TİCARET A.Ş."), ("YAYLA", "YAYLA ENERJİ ÜRETİM TURİZM VE İNŞAAT TİCARET A.Ş."), ("YBTAS", "YİBİTAŞ YOZGAT İŞÇİ BİRLİĞİ İNŞAAT MALZEMELERİ TİCARET VE SANAYİ A.Ş."), ("YEOTK", "YEO TEKNOLOJİ ENERJİ VE ENDÜSTRİ A.Ş."), ("YESIL", "YEŞİL YATIRIM HOLDİNG A.Ş."), 
    ("YGGYO", "YENİ GİMAT GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), ("YIGIT", "Yigit Aku Malzemeleri Nakliyat Turizm Insaat Sanayi Ve Ticaret"), ("YKBNK", "YAPI VE KREDİ BANKASI A.Ş."), ("YKSLN", "YÜKSELEN ÇELİK A.Ş."), ("YONGA", "YONGA MOBİLYA SANAYİ VE TİCARET A.Ş."), 
    ("YUNSA", "YÜNSA YÜNLÜ SANAYİ VE TİCARET A.Ş."), ("YYAPI", "YEŞİL YAPI ENDÜSTRİSİ A.Ş."), ("YYLGD", "YAYLA AGRO GIDA SANAYİ VE TİCARET A.Ş."), ("ZEDUR", "ZEDUR ENERJİ ELEKTRİK ÜRETİM A.Ş."), ("ZERGY", "Zeray Gayrimenkul Yatirim Ortakligi AS"), 
    ("ZGYO", "Z Gayrimenkul Yatirim Ortakligi A.S."), ("ZOREN", "ZORLU ENERJİ ELEKTRİK ÜRETİM A.Ş."), ("ZRGYO", "ZİRAAT GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş."), 
];

// BIST Halka Arz (XHARZ) evreni. Liste 10.07.2026 kapanışındaki Borsa
// Istanbul XHARZ referansı ve herkese açık bileşen tablosuyla güncellenmiştir.
// Yahoo'da henüz fiyat
// serisi oluşmayan yeni semboller sessizce atlanır ve sonraki eşlemede
// otomatik olarak gelmeye başlar.
pub const IPO_TICKERS: &[(&str, &str)] = &[
    ("ZGOLD", "Ziraat Altın S1"),
];

#[derive(Deserialize)]
struct YahooResponse { chart: YahooChart }
#[derive(Deserialize)]
struct YahooChart { result: Option<Vec<YahooResult>> }
#[derive(Deserialize)]
struct YahooResult {
    meta: YahooMeta,
    timestamp: Option<Vec<u64>>,
    indicators: YahooIndicators,
}
#[derive(Deserialize)]
struct YahooMeta {
    #[serde(rename = "regularMarketPrice", default)] regular_market_price: Option<f64>,
    #[serde(rename = "previousClose", default)] previous_close: Option<f64>,
    #[serde(rename = "fiftyTwoWeekHigh", default)] fifty_two_week_high: Option<f64>,
    #[serde(rename = "fiftyTwoWeekLow", default)] fifty_two_week_low: Option<f64>,
    #[serde(rename = "regularMarketVolume", default)] regular_market_volume: Option<u64>,
    #[serde(rename = "longName", default)] long_name: Option<String>,
    #[serde(rename = "chartPreviousClose", default)]
    chart_previous_close: Option<f64>,
    #[serde(rename = "regularMarketTime", default)]
    regular_market_time: Option<i64>,
}
#[derive(Deserialize)]
struct YahooIndicators {
    quote: Option<Vec<YahooQuote>>,
    /// Temettü + bölünme düzeltmeli kapanış serisi; göstergeler bundan beslenir.
    adjclose: Option<Vec<YahooAdjClose>>,
}
#[derive(Deserialize)]
struct YahooQuote {
    open: Option<Vec<Option<f64>>>,
    close: Option<Vec<Option<f64>>>,
    high: Option<Vec<Option<f64>>>,
    low: Option<Vec<Option<f64>>>,
    volume: Option<Vec<Option<u64>>>,
}
#[derive(Deserialize)]
struct YahooAdjClose {
    adjclose: Option<Vec<Option<f64>>>,
}

fn symbol(ticker: &str) -> String {
    let t = ticker.to_uppercase();
    match t.as_str() {
        "XAU" => "GC=F".to_string(),
        "XAG" => "SI=F".to_string(),
        "XAUTRY" => "XAUTRY=X".to_string(),
        "XAGTRY" => "XAGTRY=X".to_string(),
        // ^GSPC gibi global endeks sembolleri ve hazır Yahoo formatları olduğu gibi geçer.
        _ if crate::yahoo::GLOBAL_TICKERS.iter().any(|(sym, _)| *sym == t) => t,
        _ if t.starts_with('^') || t.contains('=') || t.contains('.') || t.contains('-') => t,
        _ => format!("{t}.IS"),
    }
}

async fn chart(client: &reqwest::Client, ticker: &str, range: &str) -> Result<YahooResult, String> {
    // Yahoo, range=max isteklerinde interval=1d'yi yok sayıp aylık bara düşürür;
    // tam günlük geçmiş yalnızca period1/period2 parametreleriyle alınabilir.
    let url = if range == "max" {
        format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1=0&period2=9999999999&interval=1d",
            symbol(ticker)
        )
    } else {
        format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval=1d",
            symbol(ticker), range
        )
    };
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(12))
        .header("User-Agent", YAHOO_USER_AGENT)
        .send().await
        .map_err(|error| format!("HTTP error for {ticker}: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Provider error for {ticker}: {error}"))?;
    let payload = response.json::<YahooResponse>().await
        .map_err(|error| format!("Parse error for {ticker}: {error}"))?;
    payload.chart.result.and_then(|rows| rows.into_iter().next())
        .ok_or_else(|| format!("No data for {ticker}"))
}

/// Yahoo'ya aynı anda gönderilen en fazla istek sayısı.
///
/// Sınır, batch + sabit uyku yerine semaforla uygulanır: istekler sürekli akar
/// ve hızlı yanıtlar batch'in en yavaşını beklemez. Anlık eşzamanlılık eski
/// batch boyutuyla aynı tutulmuştur; hızlanma bekleme süresinin kalkmasından
/// gelir, Yahoo'ya daha sert yüklenmekten değil.
///
/// Yahoo'nun kısıtlaması ani eşzamanlılığa değil zaman içindeki toplam istek
/// hacmine de bakar: yoğun kullanımda tek bir istek bile 429 dönebilir. Bu
/// sayıyı büyütmeden önce `enrich_equity` dahil sembol başına düşen istek
/// sayısını azaltmak daha etkilidir.
const YAHOO_CONCURRENCY: usize = 8;

/// Geçici hatada toplam deneme sayısı (ilk deneme dahil).
const YAHOO_MAX_ATTEMPTS: u32 = 3;

/// Ağ/geçici hatalarda ilk bekleme; her denemede ikiye katlanır.
const YAHOO_RETRY_BACKOFF: std::time::Duration = std::time::Duration::from_millis(300);

/// Hız sınırında ilk bekleme. 429 "yavaşla" demektir; ağ hatasından çok daha
/// uzun beklenir, aksi halde yeniden denemeler kısıtlamayı büyütür.
const YAHOO_RATE_LIMIT_BACKOFF: std::time::Duration = std::time::Duration::from_millis(1500);

/// `chart` çağrısını geçici hatalara karşı yeniden dener.
///
/// 429 ve ağ hataları geçicidir; geri çekilerek tekrar denenir. 404 kalıcıdır
/// (sembol Yahoo'da yok) ve beklemeden döner. Yeniden deneme olmadan hız
/// sınırına takılan sembol evrenden sessizce düşerdi.
async fn chart_with_retry(client: &reqwest::Client, ticker: &str, range: &str) -> Result<YahooResult, String> {
    let mut attempt = 1;
    loop {
        let error = match chart(client, ticker, range).await {
            Ok(result) => return Ok(result),
            Err(error) => error,
        };
        // Sembol Yahoo'da yok ya da deneme hakkı bitti.
        if error.contains("404") || attempt == YAHOO_MAX_ATTEMPTS {
            return Err(error);
        }
        let base = if error.contains("429") { YAHOO_RATE_LIMIT_BACKOFF } else { YAHOO_RETRY_BACKOFF };
        tokio::time::sleep(base * 2u32.pow(attempt - 1)).await;
        attempt += 1;
    }
}

fn quote_rows(result: &YahooResult) -> Vec<(f64, f64, f64, f64)> {
    let Some(quote) = result.indicators.quote.as_ref().and_then(|rows| rows.first()) else {
        return Vec::new();
    };
    let (Some(opens), Some(highs), Some(lows), Some(closes)) =
        (&quote.open, &quote.high, &quote.low, &quote.close) else {
        return Vec::new();
    };
    let length = opens.len().min(highs.len()).min(lows.len()).min(closes.len());
    (0..length).filter_map(|index| Some((
        opens[index]?, highs[index]?, lows[index]?, closes[index]?
    ))).collect()
}

/// Gösterge hesabı için düzeltilmiş kapanış serisi.
///
/// Ham kapanışta temettü açılışları (BIST'te tek seferde %5-10 olabilir) RSI ve
/// ortalamalara sahte bir "düşüş" olarak girer; adjclose bu boşlukları kapatır.
/// Son barın adjclose'u ham kapanışa eşittir, dolayısıyla güncel fiyatla
/// SMA/EMA karşılaştırmaları tutarlı kalır. Seri yoksa ham kapanışa düşülür.
fn adjusted_closes(result: &YahooResult) -> Option<Vec<f64>> {
    let series = result.indicators.adjclose.as_ref()?.first()?.adjclose.as_ref()?;
    let values: Vec<f64> = series.iter().flatten().copied().filter(|v| v.is_finite()).collect();
    (!values.is_empty()).then_some(values)
}

fn equity_from_result(ticker: &str, fallback_name: &str, result: YahooResult, index_memberships: Vec<String>) -> EquityRow {
    let candles = quote_rows(&result);
    let closes: Vec<f64> = candles.iter().map(|row| row.3).collect();
    let highs: Vec<f64> = candles.iter().map(|row| row.1).collect();
    let lows: Vec<f64> = candles.iter().map(|row| row.2).collect();
    let indicator_closes = adjusted_closes(&result).unwrap_or_else(|| closes.clone());
    let price = result.meta.regular_market_price
        .or_else(|| closes.last().copied())
        .unwrap_or_default();
    let previous_close = result.meta.previous_close
        .or_else(|| closes.iter().rev().nth(1).copied())
        .unwrap_or(price);
    let change_pct = if previous_close > 0.0 {
        (price - previous_close) / previous_close * 100.0
    } else { 0.0 };

    let calculate_change = |days_ago: usize| -> Option<f64> {
        let old_price = closes.iter().rev().nth(days_ago).copied().or_else(|| closes.first().copied())?;
        if old_price > 0.0 {
            let pct = (price - old_price) / old_price * 100.0;
            Some((pct * 100.0).round() / 100.0)
        } else {
            None
        }
    };

    let change_1w = calculate_change(5);
    let change_1m = calculate_change(21);
    let change_6m = calculate_change(126);
    let change_1y = calculate_change(252);

    EquityRow {
        ticker: ticker.to_string(),
        name: result.meta.long_name.unwrap_or_else(|| fallback_name.to_string()),
        price,
        change_pct: (change_pct * 100.0).round() / 100.0,
        change_1w,
        change_1m,
        change_6m,
        change_1y,
        volume: result.meta.regular_market_volume.unwrap_or_default(),
        // Kapanış tabanlı göstergeler düzeltilmiş seriden; ATR gerçek işlem
        // aralığını ölçtüğü için ham mumlarla kalır.
        rsi: indicators::rsi(&indicator_closes, 14),
        macd: indicators::macd(&indicator_closes),
        sma_50: indicators::sma(&indicator_closes, 50),
        ema_20: indicators::ema(&indicator_closes, 20),
        bollinger_position: indicators::bollinger_position(&indicator_closes, 20),
        atr: indicators::atr(&highs, &lows, &closes, 14),
        week_52_high: result.meta.fifty_two_week_high.unwrap_or_default(),
        week_52_low: result.meta.fifty_two_week_low.unwrap_or_default(),
        pe: None, pb: None, roe: None, roa: None, net_debt_ebitda: None,
        gross_margin: None, net_margin: None, sales_growth: None, profit_growth: None,
        dividend_yield: None,
        market_cap: None,
        fundamentals_available: false, fundamentals_source: None,
        fundamentals_as_of: None,
        fundamentals_currency: None,
        index_memberships,
        index_changes: None,
        free_float_ratio: None,
        foreign_ratio: None,
    }
}

fn get_ticker_memberships(ticker: &str) -> Vec<String> {
    let mut indices = Vec::new();

    if COMMODITY_TICKERS.iter().any(|(symbol, _)| *symbol == ticker) {
        indices.push("Emtialar".to_string());
        return indices; // Early return for commodities as they are not BIST equities
    }

    // Global hisseler BIST evreninin parçası değildir; "Emtialar" gibi ayrı bir
    // grup etiketi alırlar, böylece frontend BIST'e özel listeleri (yükselen/
    // düşen gibi) bu semboller olmadan kurabilir.
    if GLOBAL_TICKERS.iter().any(|(symbol, _)| *symbol == ticker) {
        indices.push(GLOBAL_GROUP.to_string());
        return indices;
    }

    if IPO_TICKERS.iter().any(|(symbol, _)| *symbol == ticker)
        || crate::ipo_store::recent_ipo_tickers(&crate::ipo_store::load()).contains(ticker)
    {
        indices.push("BIST HALKA ARZ".to_string());
    }

    let bist_30 = [
        "AKBNK", "ALARK", "ASELS", "ASTOR", "BIMAS", "DOAS", "EKGYO", "ENKAI", 
        "EREGL", "FROTO", "GARAN", "GUBRF", "HEKTS", "ISCTR", "KCHOL", "KONTR", 
        "KOZAL", "KRDMD", "MGROS", "ODAS", "PGSUS", "PETKM", "SAHOL", "SASA", 
        "SISE", "TCELL", "THYAO", "TOASO", "TUPRS", "YKBNK"
    ];

    let bist_50_additions = [
        "AEFES", "AGHOL", "AKSA", "AKSEN", "ALFAS", "ARCLK", "BRSAN", "CCOLA", 
        "CIMSA", "CWENE", "DOCO", "EGEEN", "EUPWR", "GESAN", "ISMEN", "MIATK", 
        "OYAKC", "SOKM", "TAVHL", "ULKER"
    ];

    let bist_100_additions = [
        "AGROT", "AHGAZ", "AKCNS", "AKFYE", "ALBRK", "AYDEM", "BAGFS", "BERA", 
        "BIOEN", "BRYAT", "BUCIM", "DOHOL", "ECILC", "ECZYT", "ENJSA", "EUREN", 
        "GENIL", "GLYHO", "GWIND", "HALKB", "HLGYO", "ISGYO", "IZMDC", "KAREL", 
        "KARSN", "KCAER", "KMPUR", "KONYA", "KORDS", "KOZAA", "KZBGY", "MAVI", 
        "OTKAR", "PENTA", "PSGYO", "QUAGR", "SELEC", "SKBNK", "TABGD", "TKFEN", 
        "TSKB", "TTKOM", "TTRAK", "TUKAS", "TURSG", "VAKBN", "VESBE", "VESTL", 
        "YYLGD", "ZOREN"
    ];

    let is_bist_30 = bist_30.contains(&ticker);
    let is_bist_50 = is_bist_30 || bist_50_additions.contains(&ticker);
    let is_bist_100 = is_bist_50 || bist_100_additions.contains(&ticker);

    if is_bist_100 { indices.push("BIST 100".to_string()); }
    if is_bist_50 { indices.push("BIST 50".to_string()); }
    if is_bist_30 { indices.push("BIST 30".to_string()); }

    // Borsa Istanbul (Tüm BIST) is implied for all these stocks, frontend handles it by default
    indices
}

/// Önceki kapanışı seçer. Yahoo, BIST endekslerinde `previousClose` alanını
/// göndermez ve bazı endekslerde 5 günlük istek tek mum döndürür; bu yüzden
/// sıra: son iki mumun bir önceki kapanışı → previousClose → chartPreviousClose
/// (aralık öncesi kapanış; tek mumlu yanıtlarda dünkü kapanışa denk gelir).
fn select_previous_close(
    closes: &[f64],
    meta_previous: Option<f64>,
    chart_previous: Option<f64>,
    price: f64,
) -> f64 {
    if closes.len() >= 2 {
        return closes[closes.len() - 2];
    }
    meta_previous
        .or(chart_previous)
        .filter(|p| *p > 0.0)
        .unwrap_or(price)
}

/// Üst şeritte (marquee) ve pano özetinde gösterilen piyasa göstergeleri.
/// Etiketler frontend'in `LABEL_TO_TICKER`/`SYMBOL_MAP` anahtarlarıyla birebir
/// eşleşmelidir; canlı veri gelmediğinde `services::dashboard` aynı listeden
/// yer tutucu üretir.
pub const MARKET_INDICES: &[(&str, &str)] = &[
    ("XU100.IS", "BIST 100"), ("XU030.IS", "BIST 30"), ("XBANK.IS", "BIST BANKA"), ("XUSIN.IS", "BIST SINAI"),
    ("USDTRY=X", "USD/TRY"), ("EURTRY=X", "EUR/TRY"),
    ("^GSPC", "S&P 500"), ("^IXIC", "NASDAQ"), ("^DJI", "DOW JONES"),
    ("^GDAXI", "DAX"), ("^FTSE", "FTSE 100"),
    ("GC=F", "Altın Ons ($)"), ("BZ=F", "Brent Petrol ($)"), ("BTC-USD", "Bitcoin ($)"),
];

/// Senkron sonunda okunur ada çevrilen satırlar: (Yahoo sembolü, store'daki ad).
/// Şerit ve katalog sekmeyi Yahoo sembolüyle açtığından, yerel arama da bu
/// haritayla eşlenmek zorundadır; aksi halde bu semboller store'da hiç bulunmaz
/// ve her tıklama gereksiz bir canlı Yahoo çekimine dönüşür.
const RENAMED_TICKERS: &[(&str, &str)] = &[
    ("GC=F", "Altın Ons ($)"),
    ("SI=F", "Gümüş Ons ($)"),
    ("USDTRY=X", "USD/TRY"),
];

/// Yahoo sembolünün store'da saklandığı görünen adı döndürür (varsa).
pub fn display_ticker(symbol: &str) -> Option<&'static str> {
    RENAMED_TICKERS.iter().find(|(sym, _)| *sym == symbol).map(|(_, name)| *name)
}

/// Gösterge önbelleğinin ömrü. Şerit 30 saniyede bir yenilendiği ve pano ile
/// komut paleti de aynı ucu çağırdığı için, önbellek olmadan her açılış 14 canlı
/// Yahoo isteği doğuruyordu.
const METRICS_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(45);

static METRICS_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<(std::time::Instant, Vec<MarketMetric>)>>> =
    std::sync::OnceLock::new();

fn cached_metrics() -> Option<Vec<MarketMetric>> {
    let cache = METRICS_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    let guard = cache.lock().unwrap_or_else(|error| error.into_inner());
    guard
        .as_ref()
        .filter(|(fetched_at, _)| fetched_at.elapsed() < METRICS_CACHE_TTL)
        .map(|(_, rows)| rows.clone())
}

/// Piyasa göstergelerini döndürür; `METRICS_CACHE_TTL` içinde önbellekten verir.
pub async fn fetch_market_metrics(client: &reqwest::Client) -> Vec<MarketMetric> {
    if let Some(rows) = cached_metrics() {
        return rows;
    }

    let rows = fetch_market_metrics_uncached(client).await;

    // Boş sonuç (ağ yok) önbelleğe alınmaz; ağ dönünce hemen toparlansın.
    if !rows.is_empty() {
        let cache = METRICS_CACHE.get_or_init(|| std::sync::Mutex::new(None));
        *cache.lock().unwrap_or_else(|error| error.into_inner()) =
            Some((std::time::Instant::now(), rows.clone()));
    }
    rows
}

async fn fetch_market_metrics_uncached(client: &reqwest::Client) -> Vec<MarketMetric> {
    let mut tasks = Vec::new();
    for &(ticker, label) in MARKET_INDICES {
        let client_clone = client.clone();
        tasks.push(tokio::spawn(async move {
            let result = chart_with_retry(&client_clone, ticker, "5d").await.ok()?;

            let candles = quote_rows(&result);
            let price = result.meta.regular_market_price
                .or_else(|| candles.last().map(|row| row.3)).unwrap_or_default();
            let previous = select_previous_close(
                &candles.iter().map(|row| row.3).collect::<Vec<_>>(),
                result.meta.previous_close,
                result.meta.chart_previous_close,
                price,
            );

            let diff = price - previous;
            let pct = if previous > 0.0 { (diff / previous) * 100.0 } else { 0.0 };
            let format = if pct > 0.0 { format!("+{pct:.2}%") } else { format!("{pct:.2}%") };

            Some(MarketMetric {
                symbol: label.to_string(),
                value: format!("{price:.2}"),
                change: format,
                positive: pct >= 0.0,
                as_of_ts: result.meta.regular_market_time,
            })
        }));
    }

    let mut metrics = Vec::new();
    for task in tasks {
        if let Ok(Some(metric)) = task.await {
            metrics.push(metric);
        }
    }
    metrics
}

pub async fn fetch_equity(client: &reqwest::Client, ticker: &str, name: &str) -> Result<EquityRow, String> {
    // Üyelikler güncel CSV önbelleğinden okunur; koddaki statik liste yalnızca
    // önbellek hiç oluşmamışsa devreye giren son çaredir. Aksi halde endeks
    // güncellemeleri tek hisse görünümüne hiç yansımaz.
    let index_cache = crate::bist_indices::fetch_and_update_indices(false).await;
    let memberships = match index_cache.memberships.get(ticker) {
        Some(rows) if !rows.is_empty() => rows.clone(),
        _ => get_ticker_memberships(ticker),
    };
    let result = chart_with_retry(client, ticker, "1y").await?;
    let row = equity_from_result(ticker, name, result, memberships);
    let mut rows = vec![crate::fundamentals::enrich_equity(client, row).await];
    crate::isyatirim::enrich_all(client, &mut rows).await;
    rows.pop().ok_or_else(|| format!("No enriched data for {ticker}"))
}

pub async fn fetch_all_equities(client: &reqwest::Client, force_bist_refresh: bool) -> Vec<EquityRow> {
    let mut seen = HashSet::new();
    let mut universe: Vec<(String, String)> = GLOBAL_TICKERS.iter()
        .chain(BIST_TICKERS.iter())
        .chain(IPO_TICKERS.iter())
        .chain(COMMODITY_TICKERS.iter())
        .copied()
        .filter(|(ticker, _)| seen.insert(*ticker))
        .map(|(ticker, name)| (ticker.to_string(), name.to_string()))
        .collect();

    // Halka arz arşivindeki güncel IPO'lar evrene otomatik katılır; böylece
    // yeni arzların fiyatı için statik listeyi elle güncellemek gerekmez.
    let ipo_archive = crate::ipo_store::load();
    let recent_ipos = crate::ipo_store::recent_ipo_tickers(&ipo_archive);
    universe.extend(crate::ipo_store::sync_universe_additions(&ipo_archive, &seen));

    // Tam BIST evreni: kap.org.tr'nin güncel şirket listesinden eksik kalan
    // tüm hisseler (yeni arzlar, pay grupları vb.) evrene katılır. KAP listesi
    // günde bir çekilip önbelleklenir; ulaşılamazsa statik liste kullanılır.
    // Yahoo'da bulunmayan semboller fiyat çekiminde elenir, zarar vermez.
    let mut owned_seen: HashSet<String> = universe.iter().map(|(ticker, _)| ticker.clone()).collect();
    for (ticker, name) in crate::bist_universe::load(client).await {
        if owned_seen.insert(ticker.clone()) {
            universe.push((ticker, name));
        }
    }

    let index_cache = crate::bist_indices::fetch_and_update_indices(force_bist_refresh).await;

    // Tüm evren tek seferde kuyruğa alınır; eşzamanlılığı semafor sınırlar.
    // Böylece istekler sürekli akar ve batch sınırında bekleme oluşmaz.
    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(YAHOO_CONCURRENCY));
    let mut tasks = Vec::with_capacity(universe.len());
    for (ticker, name) in universe {
        let client = client.clone();
        let gate = gate.clone();
        let mut memberships = index_cache.memberships.get(ticker.as_str()).cloned().unwrap_or_default();
        let index_changes = index_cache.changes.get(ticker.as_str()).cloned();

        if COMMODITY_TICKERS.iter().any(|(symbol, _)| *symbol == ticker) {
            memberships.push("Emtialar".to_string());
        } else if GLOBAL_TICKERS.iter().any(|(symbol, _)| *symbol == ticker) {
            memberships.push(GLOBAL_GROUP.to_string());
        } else if IPO_TICKERS.iter().any(|(symbol, _)| *symbol == ticker)
            || recent_ipos.contains(ticker.as_str())
        {
            memberships.push("BIST HALKA ARZ".to_string());
        }

        tasks.push(tokio::spawn(async move {
            // İzin, temel veri zenginleştirmesi de dahil tüm görev boyunca tutulur;
            // toplam dış istek trafiği bu sayıyla sınırlı kalır.
            let _permit = gate.acquire().await.map_err(|error| error.to_string())?;
            let result = chart_with_retry(&client, &ticker, "1y").await?;
            let mut row = equity_from_result(&ticker, &name, result, memberships);
            row.index_changes = index_changes;
            Ok::<EquityRow, String>(crate::fundamentals::enrich_equity(&client, row).await)
        }));
    }

    // Görevler kuyruğa alındıkları sırayla toplanır; çıktı sırası deterministik kalır.
    let mut equities = Vec::new();
    for task in tasks {
        if let Ok(Ok(row)) = task.await { equities.push(row); }
    }
    crate::isyatirim::enrich_all(client, &mut equities).await;

    // --- Synthetic Commodity Computation ---
    // Extract ONS prices and USD/TRY
    let gold_ons = equities.iter().find(|e| e.ticker == "GC=F").map(|e| e.price);
    let silver_ons = equities.iter().find(|e| e.ticker == "SI=F").map(|e| e.price);
    let usdtry = equities.iter().find(|e| e.ticker == "USDTRY=X").map(|e| e.price);

    let create_synthetic = |base: &EquityRow, target_ticker: &str, name: &str, usd_price: f64, usdtry_price: f64| -> EquityRow {
        let try_price = (usd_price / 31.1034768) * usdtry_price;
        let mut row = base.clone();
        row.ticker = target_ticker.to_string();
        row.name = name.to_string();
        row.price = (try_price * 100.0).round() / 100.0;
        row.index_memberships = vec!["Emtialar".to_string()];
        row
    };

    if let (Some(gold), Some(try_rate)) = (gold_ons, usdtry) {
        if let Some(base) = equities.iter().find(|e| e.ticker == "GC=F").cloned() {
            equities.push(create_synthetic(&base, "GRAM ALTIN", "Gram Altın (TRY)", gold, try_rate));
        }
    }
    
    if let (Some(silver), Some(try_rate)) = (silver_ons, usdtry) {
        if let Some(base) = equities.iter().find(|e| e.ticker == "SI=F").cloned() {
            equities.push(create_synthetic(&base, "GRAM GÜMÜŞ", "Gram Gümüş (TRY)", silver, try_rate));
        }
    }

    // Arayüz için okunur adlar; harita `display_ticker` ile ortak, böylece
    // yerel arama eşlemesiyle adlandırma birbirinden kopamaz.
    for row in &mut equities {
        if let Some(name) = display_ticker(&row.ticker) {
            row.ticker = name.to_string();
        }
    }

    equities
}

/// Artımlı senkron için global/emtia/döviz sembollerinin güncel fiyatı ve
/// önceki kapanışı: (sembol, fiyat, önceki kapanış). Sembol başına tek "5d"
/// isteği atılır (~20 istek); BIST evrenine hiç gidilmez — o taraf İş Yatırım
/// toplu screener'ından beslenir (`isyatirim::current_closes`).
pub async fn fetch_global_quotes(client: &reqwest::Client) -> Vec<(String, f64, f64)> {
    let mut seen = HashSet::new();
    let symbols: Vec<&'static str> = GLOBAL_TICKERS.iter()
        .chain(COMMODITY_TICKERS.iter())
        .map(|(symbol, _)| *symbol)
        .filter(|symbol| seen.insert(*symbol))
        .collect();

    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(YAHOO_CONCURRENCY));
    let mut tasks = Vec::with_capacity(symbols.len());
    for symbol in symbols {
        let client = client.clone();
        let gate = gate.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.ok()?;
            let result = chart_with_retry(&client, symbol, "5d").await.ok()?;
            let candles = quote_rows(&result);
            let price = result.meta.regular_market_price
                .or_else(|| candles.last().map(|row| row.3))?;
            let previous = select_previous_close(
                &candles.iter().map(|row| row.3).collect::<Vec<_>>(),
                result.meta.previous_close,
                result.meta.chart_previous_close,
                price,
            );
            Some((symbol.to_string(), price, previous))
        }));
    }

    let mut quotes = Vec::new();
    for task in tasks {
        if let Ok(Some(quote)) = task.await {
            quotes.push(quote);
        }
    }
    quotes
}

/// Ucuz toplu fiyatları mevcut evrenin üzerine işler; güncellenen satır sayısını döndürür.
///
/// BIST satırlarında önceki kapanış, satırın eldeki fiyat/değişim ikilisinden
/// türetilir; böylece değişim yüzdesi aynı tabana göre güncel kalır. Gün
/// devrildiğinde taban eskir — sapma en geç bir sonraki tam senkronda düzelir.
/// Göstergelere (RSI vb.) bilerek dokunulmaz: günlük barlarla çalışırlar ve
/// tam senkron yeniler.
pub fn apply_incremental_prices(
    equities: &mut [EquityRow],
    bist_closes: &HashMap<String, f64>,
    global_quotes: &[(String, f64, f64)],
) -> usize {
    let mut updated = 0;

    // Global/emtia satırları: Yahoo sembolü ya da store'daki görünen adla eşleşir.
    for (symbol, price, previous) in global_quotes {
        if *price <= 0.0 { continue; }
        let display = display_ticker(symbol);
        for row in equities.iter_mut() {
            let matches = row.ticker == *symbol
                || display.map_or(false, |alias| row.ticker == alias);
            if !matches { continue; }
            row.price = *price;
            if *previous > 0.0 {
                row.change_pct = (*price - *previous) / *previous * 100.0;
            }
            updated += 1;
        }
    }

    // BIST satırları: İş Yatırım toplu kapanışından güncellenir.
    for row in equities.iter_mut() {
        let Some(&close) = bist_closes.get(&row.ticker) else { continue };
        if close <= 0.0 || row.price <= 0.0 { continue; }
        let previous = row.price / (1.0 + row.change_pct / 100.0);
        row.price = close;
        if previous.is_finite() && previous > 0.0 {
            row.change_pct = (close - previous) / previous * 100.0;
        }
        updated += 1;
    }

    // Sentetik gram satırları baz satırlardan yeniden türetilir; tam senkrondaki
    // create_synthetic ile aynı yaklaşım (değişim yüzdesi baz emtiadan gelir).
    fn base_of(equities: &[EquityRow], ticker: &str) -> Option<(f64, f64)> {
        equities.iter().find(|row| row.ticker == ticker).map(|row| (row.price, row.change_pct))
    }
    let fx = base_of(equities, "USD/TRY").map(|(price, _)| price);
    for (gram_ticker, base_ticker) in [("GRAM ALTIN", "Altın Ons ($)"), ("GRAM GÜMÜŞ", "Gümüş Ons ($)")] {
        let (Some((base_price, base_change)), Some(fx_rate)) = (base_of(equities, base_ticker), fx) else { continue };
        if let Some(row) = equities.iter_mut().find(|row| row.ticker == gram_ticker) {
            row.price = ((base_price / 31.1034768) * fx_rate * 100.0).round() / 100.0;
            row.change_pct = base_change;
            updated += 1;
        }
    }

    updated
}

pub async fn fetch_price_history(client: &reqwest::Client, ticker: &str, range: &str) -> Result<Vec<HistoricalQuote>, String> {
    if ticker == "GRAM ALTIN" || ticker == "GRAM GÜMÜŞ" {
        let base_ticker = if ticker == "GRAM ALTIN" { "GC=F" } else { "SI=F" };
        
        let base_future = fetch_price_history_direct(client, base_ticker, range);
        let try_future = fetch_price_history_direct(client, "USDTRY=X", range);
        
        let (base_res, try_res) = tokio::join!(base_future, try_future);
        let mut base_hist = base_res?;
        let try_hist = try_res?;
        
        let mut try_map = std::collections::BTreeMap::new();
        for row in try_hist {
            let day = row.time / 86400;
            try_map.insert(day, row.close);
        }
        
        for row in &mut base_hist {
            let day = row.time / 86400;
            let try_rate = try_map.range(..=day).next_back().map(|(_, v)| *v)
                .or_else(|| try_map.values().next().copied())
                .unwrap_or(33.0); // Fallback if no USDTRY data at all
            
            row.open = (row.open / 31.1034768) * try_rate;
            row.high = (row.high / 31.1034768) * try_rate;
            row.low = (row.low / 31.1034768) * try_rate;
            row.close = (row.close / 31.1034768) * try_rate;
        }
        return Ok(base_hist);
    }
    
    let real_ticker = match ticker {
        "Altın Ons ($)" | "ALTIN (ONS)" => "GC=F",
        "Gümüş Ons ($)" | "GÜMÜŞ (ONS)" => "SI=F",
        "USD/TRY" | "USD/TL" => "USDTRY=X",
        "Brent Petrol ($)" => "BZ=F",
        "Bitcoin ($)" => "BTC-USD",
        _ => ticker
    };
    
    fetch_price_history_direct(client, real_ticker, range).await
}

async fn fetch_price_history_direct(client: &reqwest::Client, ticker: &str, range: &str) -> Result<Vec<HistoricalQuote>, String> {
    let result = chart_with_retry(client, ticker, range).await?;
    
    let timestamps = result.timestamp.ok_or("No timestamp data")?;
    let indicators = result.indicators.quote.as_ref().and_then(|q| q.first()).ok_or("No quote data")?;
    
    let (opens, highs, lows, closes) = match (&indicators.open, &indicators.high, &indicators.low, &indicators.close) {
        (Some(o), Some(h), Some(l), Some(c)) => (o, h, l, c),
        _ => return Err("Incomplete OHLC data".into()),
    };
    let length = timestamps.len().min(opens.len()).min(highs.len()).min(lows.len()).min(closes.len());
    let mut historical = Vec::new();
    for index in 0..length {
        if let (Some(open), Some(high), Some(low), Some(close)) =
            (opens[index], highs[index], lows[index], closes[index]) {
            historical.push(HistoricalQuote {
                time: timestamps[index], open, high, low, close,
                volume: indicators.volume.as_ref().and_then(|rows| rows.get(index)).copied().flatten().unwrap_or_default(),
            });
        }
    }
    Ok(historical)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Yeniden adlandırılan semboller görünen ada çözülür; yerel arama eşlemesi
    /// (services::ticker_snapshot) bu haritaya dayanır.
    #[test]
    fn renamed_commodities_resolve_display_name() {
        assert_eq!(display_ticker("GC=F"), Some("Altın Ons ($)"));
        assert_eq!(display_ticker("SI=F"), Some("Gümüş Ons ($)"));
        assert_eq!(display_ticker("USDTRY=X"), Some("USD/TRY"));
        assert_eq!(display_ticker("THYAO"), None);
    }

    /// Artımlı fiyat işleme: BIST kapanışı türetilmiş önceki kapanışa göre
    /// yüzde üretir, globaller görünen adla eşleşir, kapsam dışı satır eski
    /// değerini korur, gram satırları bazdan yeniden hesaplanır.
    #[test]
    fn incremental_prices_update_rows_in_place() {
        fn row(ticker: &str, price: f64, change_pct: f64) -> EquityRow {
            EquityRow { ticker: ticker.into(), price, change_pct, ..Default::default() }
        }
        let mut equities = vec![
            row("ASELS", 100.0, 25.0),         // önceki kapanış 80'e denk gelir
            row("THYAO", 300.0, 0.0),          // kapanış gelmeyecek → aynı kalmalı
            row("Altın Ons ($)", 2000.0, 1.0), // GC=F görünen adıyla eşleşmeli
            row("USD/TRY", 40.0, 0.5),
            row("GRAM ALTIN", 2572.0, 1.0),
        ];
        let closes = HashMap::from([("ASELS".to_string(), 90.0)]);
        let globals = vec![
            ("GC=F".to_string(), 2100.0, 2000.0),
            ("USDTRY=X".to_string(), 41.0, 40.0),
        ];

        let updated = apply_incremental_prices(&mut equities, &closes, &globals);
        assert_eq!(updated, 4, "ASELS + altın + USD/TRY + gram altın");

        assert_eq!(equities[0].price, 90.0);
        assert!((equities[0].change_pct - 12.5).abs() < 1e-9, "80 tabanına göre %12.5 olmalı: {}", equities[0].change_pct);

        assert_eq!(equities[1].price, 300.0);
        assert_eq!(equities[1].change_pct, 0.0);

        let gold = equities.iter().find(|r| r.ticker == "Altın Ons ($)").unwrap();
        assert_eq!(gold.price, 2100.0);
        assert!((gold.change_pct - 5.0).abs() < 1e-9);

        let gram = equities.iter().find(|r| r.ticker == "GRAM ALTIN").unwrap();
        let expected = ((2100.0_f64 / 31.1034768) * 41.0 * 100.0).round() / 100.0;
        assert_eq!(gram.price, expected);
        assert!((gram.change_pct - 5.0).abs() < 1e-9, "gram değişimi baz emtiayı izler");
    }

    #[tokio::test]
    #[ignore = "requires live Yahoo access"]
    async fn live_max_range_keeps_daily_granularity() {
        let client = reqwest::Client::new();
        let rows = fetch_price_history(&client, "ASELS", "max").await.unwrap();
        assert!(rows.len() > 5_000, "max aralığı günlük bar döndürmeli: {}", rows.len());
        let sp500 = fetch_price_history(&client, "^GSPC", "max").await.unwrap();
        assert!(sp500.len() > 10_000, "^GSPC tam günlük geçmiş: {}", sp500.len());
    }

    #[test]
    fn previous_close_selection_chain() {
        // Çok mumlu: sondan bir önceki kapanış
        assert_eq!(select_previous_close(&[10.0, 11.0, 12.0], None, Some(9.0), 12.0), 11.0);
        // Tek mumlu: chartPreviousClose devreye girer (XU050/XUTEK/XHARZ durumu)
        assert_eq!(select_previous_close(&[12865.1], None, Some(12674.3), 12865.1), 12674.3);
        // Hiçbir kaynak yoksa fiyata düşer (%0 gösterilir)
        assert_eq!(select_previous_close(&[], None, None, 42.0), 42.0);
        // previousClose varsa chartPreviousClose'a tercih edilir
        assert_eq!(select_previous_close(&[5.0], Some(4.0), Some(3.0), 5.0), 4.0);
    }

    #[tokio::test]
    #[ignore = "requires live Yahoo access"]
    async fn live_market_metrics_have_changes_and_timestamps() {
        let client = reqwest::Client::new();
        let metrics = fetch_market_metrics(&client).await;
        assert_eq!(metrics.len(), 10, "10 kartın hepsi dolmalı: {:?}",
            metrics.iter().map(|m| m.symbol.clone()).collect::<Vec<_>>());
        let zero_changes: Vec<_> = metrics.iter()
            .filter(|m| m.change == "0.00%" || m.change == "+0.00%")
            .map(|m| m.symbol.clone())
            .collect();
        assert!(zero_changes.len() <= 1, "değişimler artık hesaplanmalı, 0 kalanlar: {zero_changes:?}");
        let with_ts = metrics.iter().filter(|m| m.as_of_ts.is_some()).count();
        assert!(with_ts >= 8, "zaman damgası gelmeli, gelen: {with_ts}");
        for m in &metrics {
            println!("{:16} {:>12} {:>8} ts={:?}", m.symbol, m.value, m.change, m.as_of_ts);
        }
    }

    #[tokio::test]
    #[ignore = "requires live Yahoo access"]
    async fn live_new_ipo_profile_fallback_works() {
        // IPO takvimindeki bir hisse profili tıklandığında canlı çekilebilmeli
        let client = reqwest::Client::new();
        let ipo = fetch_equity(&client, "ISVEA", "İsvea Seramik").await.unwrap();
        assert!(ipo.price > 0.0, "yeni IPO fiyatı canlı gelmeli");
        assert!(
            ipo.index_memberships.iter().any(|index| index == "BIST HALKA ARZ"),
            "arşivden BIST HALKA ARZ üyeliği türetilmeli"
        );
    }

    #[tokio::test]
    #[ignore = "requires live Yahoo access"]
    async fn live_fundamentals_and_ipo_index_are_available() {
        let client = reqwest::Client::new();
        let asels = fetch_equity(&client, "ASELS", "Aselsan").await.unwrap();
        assert!(asels.pe.is_some_and(|value| (47.0..48.0).contains(&value)));
        assert!(asels.pb.is_some_and(|value| (5.0..7.0).contains(&value)));
        assert!(asels.fundamentals_as_of.is_some());

        let xharz = chart(&client, "XHARZ.IS", "5d").await.unwrap();
        assert!(xharz.meta.regular_market_price.is_some_and(|value| value > 0.0));

        let recent_ipo = fetch_equity(&client, "BETAE", "Beta Enerji").await.unwrap();
        assert!(recent_ipo.price > 0.0);
        assert!(recent_ipo.index_memberships.iter().any(|index| index == "BIST HALKA ARZ"));

        let loss_making = fetch_equity(&client, "KONTR", "Kontrolmatik").await.unwrap();
        assert!(loss_making.pe.is_none(), "negative earnings must not produce a P/E");
    }

    #[test]
    fn configured_universe_has_unique_symbols() {
        let mut symbols = HashSet::new();
        for (ticker, _) in BIST_TICKERS.iter().chain(IPO_TICKERS.iter()) {
            assert!(symbols.insert(*ticker), "duplicate universe symbol: {ticker}");
        }
    }
}

#[cfg(test)]
mod group_tests {
    use super::*;

    #[test]
    fn global_and_commodity_tickers_get_their_own_group() {
        // Global hisse: BIST listelerine sızmamalı.
        let apple = get_ticker_memberships("AAPL");
        assert_eq!(apple, vec![GLOBAL_GROUP.to_string()]);

        // Emtia: eskiden olduğu gibi kendi grubunda.
        assert_eq!(get_ticker_memberships("GC=F"), vec!["Emtialar".to_string()]);

        // BIST hissesi: global grubu almamalı, endeks üyeliklerini korumalı.
        let thyao = get_ticker_memberships("THYAO");
        assert!(!thyao.contains(&GLOBAL_GROUP.to_string()), "BIST hissesi Global etiketi almamalı");
        assert!(thyao.iter().any(|m| m.starts_with("BIST")), "THYAO bir BIST endeksinde olmalı: {thyao:?}");
    }

    #[test]
    fn global_group_covers_every_configured_global_ticker() {
        for (ticker, _) in GLOBAL_TICKERS {
            let groups = get_ticker_memberships(ticker);
            assert!(
                groups.contains(&GLOBAL_GROUP.to_string()),
                "{ticker} Global grubuna girmeli, bulunan: {groups:?}"
            );
        }
    }
}
