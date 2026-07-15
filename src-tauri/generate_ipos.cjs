const fs = require('fs');

const ipos = [
    ["SARAE", "Şa-Ra Enerji", "2026-07-10", 70.0, "TALEP TOPLAMA"],
    ["SSAAT", "Saat ve Saat", "2026-07-08", 56.0, "TALEP TOPLAMA"],
    ["ISVEA", "İsvea Seramik", "2026-07-03", 20.90, "AKTİF"],
    ["EKIM", "Intercity Ekim Turizm", "2026-07-03", 30.26, "AKTİF"],
    ["GOLDA", "Golda Gıda", "2026-07-02", 9.20, "AKTİF"],
    ["SOHOE", "Soho Giyim ve Enerji", "2026-07-01", 15.0, "AKTİF"],
    ["ORZAX", "Orzaks İlaç", "2026-07-01", 69.0, "AKTİF"],
    ["BETAE", "Beta Enerji", "2026-06-25", 40.0, "AKTİF"],
    ["EKDMR", "Ekinciler Demir ve Çelik", "2026-05-13", 45.0, "TAMAMLANDI"],
    ["ENPRA", "Enpara Bank A.Ş.", "2026-04-07", 190.0, "TAMAMLANDI"],
    ["AAGYO", "Ağaoğlu Avrasya GYO", "2026-04-01", 21.10, "TAMAMLANDI"],
    ["MCARD", "MetropolCard", "2026-03-02", 80.0, "TAMAMLANDI"],
    ["LXGYO", "Luxera GYO", "2026-03-02", 12.05, "TAMAMLANDI"],
    ["GENKM", "Gentaş Kimya", "2026-03-02", 11.0, "TAMAMLANDI"],
    ["SVGYO", "Savur GYO", "2026-02-26", 3.64, "TAMAMLANDI"],
    ["HOROZ", "Horoz Lojistik", "2024-06-07", 55.00, "TAMAMLANDI"],
    ["ALTNY", "Altınay Savunma", "2024-05-16", 32.00, "TAMAMLANDI"],
    ["KOCMT", "Koç Metalurji", "2024-05-17", 20.50, "TAMAMLANDI"],
    ["HARES", "Hareket Proje", "2024-05-24", 70.00, "TAMAMLANDI"],
    ["ENTRA", "Entra Yenilenebilir Enerji", "2024-04-04", 10.00, "TAMAMLANDI"],
    ["RGYAS", "Rönesans Gayrimenkul", "2024-04-26", 135.00, "TAMAMLANDI"],
    ["ODINE", "Odine Teknoloji", "2024-03-21", 30.00, "TAMAMLANDI"],
    ["ALVES", "Alves Kablo", "2024-02-29", 19.45, "TAMAMLANDI"],
    ["ARTMS", "Artemis Halı", "2024-03-04", 25.35, "TAMAMLANDI"],
    ["OBAMS", "Oba Makarnacılık", "2024-03-01", 39.24, "TAMAMLANDI"],
    ["MOGAN", "Mogan Enerji", "2024-03-01", 11.33, "TAMAMLANDI"],
    ["BOBET", "Boğaziçi Beton", "2024-02-22", 21.00, "TAMAMLANDI"],
    ["LMKDC", "Limak Doğu Anadolu Çimento", "2024-02-22", 16.20, "TAMAMLANDI"],
    ["BORLS", "Borlease Otomotiv", "2023-10-18", 25.29, "TAMAMLANDI"],
    ["TABGD", "TAB Gıda", "2023-10-26", 130.00, "TAMAMLANDI"],
    ["REEDR", "Reeder Teknoloji", "2023-09-21", 9.30, "TAMAMLANDI"],
    ["TARKM", "Tarkim Bitki Koruma", "2023-09-12", 107.50, "TAMAMLANDI"],
    ["EBEBK", "Ebebek Mağazacılık", "2023-09-07", 46.50, "TAMAMLANDI"],
    ["KZGYO", "Kuzey Boru", "2023-12-14", 36.20, "TAMAMLANDI"],
    ["MEKAG", "Meka Beton", "2023-10-12", 25.00, "TAMAMLANDI"],
    ["SURGY", "Sur Tatil Evleri", "2023-12-14", 49.18, "TAMAMLANDI"],
    ["CATES", "Çates Elektrik", "2023-12-07", 57.15, "TAMAMLANDI"],
    ["BEGYO", "Batı Ege GYO", "2023-12-08", 3.00, "TAMAMLANDI"],
    ["SKYMD", "Şeker Yatırım", "2023-12-06", 7.00, "TAMAMLANDI"]
];

let out = "pub struct StaticIpo {\n" +
"    pub ticker: &'static str,\n" +
"    pub name: &'static str,\n" +
"    pub date: &'static str,\n" +
"    pub price: f64,\n" +
"    pub status: &'static str,\n" +
"    pub book_building: &'static str,\n" +
"    pub trading_start: &'static str,\n" +
"    pub dist_type: &'static str,\n" +
"    pub participant_count: &'static str,\n" +
"}\n\n" +
"pub const RECENT_IPOS: &[StaticIpo] = &[\n";

async function run() {
    for (let [t, n, d, p, s] of ipos) {
        try {
            let res = await fetch(`https://halkarz.com/?s=${t}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            let html = await res.text();
            
            let bb = "", start = "", dist = "", count = "";
            let m_bb = html.match(/Halka Arz Tarihi.*?<td>(.*?)<\/td>/is);
            if (m_bb) bb = m_bb[1].replace(/<[^>]*>?/gm, '').replace(/\*\*/g, '').trim();
            
            let m_start = html.match(/Bist İlk İşlem Tarihi.*?<td>(.*?)<\/td>/is);
            if (m_start) start = m_start[1].replace(/<[^>]*>?/gm, '').replace(/\*\*/g, '').trim();
            
            let m_dist = html.match(/Dağıtım Yöntemi.*?<td>(.*?)<\/td>/is);
            if (m_dist) dist = m_dist[1].replace(/<[^>]*>?/gm, '').replace(/\*\*/g, '').trim();
            
            let m_count = html.match(/Toplam.*?<td>(.*?)<\/td>/is);
            if (m_count) count = m_count[1].replace(/<[^>]*>?/gm, '').replace(/\*\*/g, '').replace(/Kişi/g, '').replace(/Müşteri/g, '').trim();
            
            out += `    StaticIpo { ticker: "${t}", name: "${n}", date: "${d}", price: ${p.toFixed(2)}, status: "${s}", book_building: "${bb}", trading_start: "${start}", dist_type: "${dist}", participant_count: "${count}" },\n`;
        } catch (e) {
            out += `    StaticIpo { ticker: "${t}", name: "${n}", date: "${d}", price: ${p.toFixed(2)}, status: "${s}", book_building: "", trading_start: "", dist_type: "", participant_count: "" },\n`;
        }
    }
    out += "];\n";
    fs.writeFileSync("new_ipos.rs", out);
}
run();
