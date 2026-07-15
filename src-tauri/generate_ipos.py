import requests
import re
from bs4 import BeautifulSoup

ipos = [
    ("SARAE", "Şa-Ra Enerji", "2026-07-10", 70.0, "TALEP TOPLAMA"),
    ("SSAAT", "Saat ve Saat", "2026-07-08", 56.0, "TALEP TOPLAMA"),
    ("ISVEA", "İsvea Seramik", "2026-07-03", 20.90, "AKTİF"),
    ("EKIM", "Intercity Ekim Turizm", "2026-07-03", 30.26, "AKTİF"),
    ("GOLDA", "Golda Gıda", "2026-07-02", 9.20, "AKTİF"),
    ("SOHOE", "Soho Giyim ve Enerji", "2026-07-01", 15.0, "AKTİF"),
    ("ORZAX", "Orzaks İlaç", "2026-07-01", 69.0, "AKTİF"),
    ("BETAE", "Beta Enerji", "2026-06-25", 40.0, "AKTİF"),
    ("EKDMR", "Ekinciler Demir ve Çelik", "2026-05-13", 45.0, "TAMAMLANDI"),
    ("ENPRA", "Enpara Bank A.Ş.", "2026-04-07", 190.0, "TAMAMLANDI"),
    ("AAGYO", "Ağaoğlu Avrasya GYO", "2026-04-01", 21.10, "TAMAMLANDI"),
    ("MCARD", "MetropolCard", "2026-03-02", 80.0, "TAMAMLANDI"),
    ("LXGYO", "Luxera GYO", "2026-03-02", 12.05, "TAMAMLANDI"),
    ("GENKM", "Gentaş Kimya", "2026-03-02", 11.0, "TAMAMLANDI"),
    ("SVGYO", "Savur GYO", "2026-02-26", 3.64, "TAMAMLANDI"),
    ("HOROZ", "Horoz Lojistik", "2024-06-07", 55.00, "TAMAMLANDI"),
    ("ALTNY", "Altınay Savunma", "2024-05-16", 32.00, "TAMAMLANDI"),
    ("KOCMT", "Koç Metalurji", "2024-05-17", 20.50, "TAMAMLANDI"),
    ("HARES", "Hareket Proje", "2024-05-24", 70.00, "TAMAMLANDI"),
    ("ENTRA", "Entra Yenilenebilir Enerji", "2024-04-04", 10.00, "TAMAMLANDI"),
    ("RGYAS", "Rönesans Gayrimenkul", "2024-04-26", 135.00, "TAMAMLANDI"),
    ("ODINE", "Odine Teknoloji", "2024-03-21", 30.00, "TAMAMLANDI"),
    ("ALVES", "Alves Kablo", "2024-02-29", 19.45, "TAMAMLANDI"),
    ("ARTMS", "Artemis Halı", "2024-03-04", 25.35, "TAMAMLANDI"),
    ("OBAMS", "Oba Makarnacılık", "2024-03-01", 39.24, "TAMAMLANDI"),
    ("MOGAN", "Mogan Enerji", "2024-03-01", 11.33, "TAMAMLANDI"),
    ("BOBET", "Boğaziçi Beton", "2024-02-22", 21.00, "TAMAMLANDI"),
    ("LMKDC", "Limak Doğu Anadolu Çimento", "2024-02-22", 16.20, "TAMAMLANDI"),
    ("BORLS", "Borlease Otomotiv", "2023-10-18", 25.29, "TAMAMLANDI"),
    ("TABGD", "TAB Gıda", "2023-10-26", 130.00, "TAMAMLANDI"),
    ("REEDR", "Reeder Teknoloji", "2023-09-21", 9.30, "TAMAMLANDI"),
    ("TARKM", "Tarkim Bitki Koruma", "2023-09-12", 107.50, "TAMAMLANDI"),
    ("EBEBK", "Ebebek Mağazacılık", "2023-09-07", 46.50, "TAMAMLANDI"),
    ("KZGYO", "Kuzey Boru", "2023-12-14", 36.20, "TAMAMLANDI"),
    ("MEKAG", "Meka Beton", "2023-10-12", 25.00, "TAMAMLANDI"),
    ("SURGY", "Sur Tatil Evleri", "2023-12-14", 49.18, "TAMAMLANDI"),
    ("CATES", "Çates Elektrik", "2023-12-07", 57.15, "TAMAMLANDI"),
    ("BEGYO", "Batı Ege GYO", "2023-12-08", 3.00, "TAMAMLANDI"),
    ("SKYMD", "Şeker Yatırım", "2023-12-06", 7.00, "TAMAMLANDI")
]

import urllib.parse
print("pub struct StaticIpo {")
print("    pub ticker: &'static str,")
print("    pub name: &'static str,")
print("    pub date: &'static str,")
print("    pub price: f64,")
print("    pub status: &'static str,")
print("    pub book_building: &'static str,")
print("    pub trading_start: &'static str,")
print("    pub dist_type: &'static str,")
print("    pub participant_count: &'static str,")
print("}\n")
print("pub const RECENT_IPOS: &[StaticIpo] = &[")

headers = {'User-Agent': 'Mozilla/5.0'}

for t, n, d, p, s in ipos:
    q = urllib.parse.quote(t)
    search_url = f"https://halkarz.com/?s={q}"
    res = requests.get(search_url, headers=headers)
    
    bb, start, dist, count = "", "", "", ""
    if res.status_code == 200:
        # Check if search redirected to the detail page (it does if there's an exact match)
        html = res.text
        
        m_bb = re.search(r'Halka Arz Tarihi.*?<td>(.*?)<\/td>', html, re.S)
        if m_bb: bb = re.sub(r'<[^>]*>', '', m_bb.group(1)).replace("**", "").strip()
        
        m_start = re.search(r'Bist İlk İşlem Tarihi.*?<td>(.*?)<\/td>', html, re.S)
        if m_start: start = re.sub(r'<[^>]*>', '', m_start.group(1)).replace("**", "").strip()
        
        m_dist = re.search(r'Dağıtım Yöntemi.*?<td>(.*?)<\/td>', html, re.S)
        if m_dist: dist = re.sub(r'<[^>]*>', '', m_dist.group(1)).replace("**", "").strip()
        
        m_count = re.search(r'Toplam.*?<td>(.*?)<\/td>', html, re.S)
        if m_count: count = re.sub(r'<[^>]*>', '', m_count.group(1)).replace("**", "").replace("Kişi", "").replace("Müşteri", "").strip()

    print(f'    StaticIpo {{ ticker: "{t}", name: "{n}", date: "{d}", price: {p}, status: "{s}", book_building: "{bb}", trading_start: "{start}", dist_type: "{dist}", participant_count: "{count}" }},')

print("];")
