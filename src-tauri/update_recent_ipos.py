import re

with open("src/corporate_actions.rs", "r") as f:
    code = f.read()

struct_def = """pub struct StaticIpo {
    pub ticker: &'static str,
    pub name: &'static str,
    pub date: &'static str,
    pub price: f64,
    pub status: &'static str,
    pub book_building: Option<&'static str>,
    pub trading_start: Option<&'static str>,
    pub dist_type: Option<&'static str>,
    pub participant_count: Option<&'static str>,
}

pub const RECENT_IPOS: &[StaticIpo] = &["""

replacements = {
    "HOROZ": 'StaticIpo { ticker: "HOROZ", name: "Horoz Lojistik", date: "2024-06-07", price: 55.0, status: "TAMAMLANDI", book_building: Some("29-30-31 Mayıs 2024"), trading_start: Some("7 Haziran 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("1.689.224") }',
    "HARES": 'StaticIpo { ticker: "HARES", name: "Hareket Proje", date: "2024-05-24", price: 70.0, status: "TAMAMLANDI", book_building: Some("15-16-17 Mayıs 2024"), trading_start: Some("24 Mayıs 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("1.956.272") }',
    "KOCMT": 'StaticIpo { ticker: "KOCMT", name: "Koç Metalurji", date: "2024-05-17", price: 20.5, status: "TAMAMLANDI", book_building: Some("9-10 Mayıs 2024"), trading_start: Some("17 Mayıs 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("2.634.178") }',
    "ALTNY": 'StaticIpo { ticker: "ALTNY", name: "Altınay Savunma", date: "2024-05-16", price: 32.0, status: "TAMAMLANDI", book_building: Some("8-9-10 Mayıs 2024"), trading_start: Some("16 Mayıs 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("3.628.586") }',
    "RGYAS": 'StaticIpo { ticker: "RGYAS", name: "Rönesans Gayrimenkul", date: "2024-04-26", price: 135.0, status: "TAMAMLANDI", book_building: Some("17-18-19 Nisan 2024"), trading_start: Some("26 Nisan 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("2.454.271") }',
    "ENTRA": 'StaticIpo { ticker: "ENTRA", name: "Entra Yenilenebilir", date: "2024-04-04", price: 10.0, status: "TAMAMLANDI", book_building: Some("27-28-29 Mart 2024"), trading_start: Some("4 Nisan 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("3.583.578") }',
    "ODINE": 'StaticIpo { ticker: "ODINE", name: "Odine Teknoloji", date: "2024-03-21", price: 30.0, status: "TAMAMLANDI", book_building: Some("13-14-15 Mart 2024"), trading_start: Some("21 Mart 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("3.198.260") }',
    "ARTMS": 'StaticIpo { ticker: "ARTMS", name: "Artemis Halı", date: "2024-03-04", price: 25.35, status: "TAMAMLANDI", book_building: Some("27-28 Şubat 2024"), trading_start: Some("4 Mart 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("2.189.498") }',
    "OBAMS": 'StaticIpo { ticker: "OBAMS", name: "Oba Makarnacılık", date: "2024-03-01", price: 39.24, status: "TAMAMLANDI", book_building: Some("22-23 Şubat 2024"), trading_start: Some("1 Mart 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("3.388.824") }',
    "MOGAN": 'StaticIpo { ticker: "MOGAN", name: "Mogan Enerji", date: "2024-03-01", price: 11.33, status: "TAMAMLANDI", book_building: Some("28-29 Şubat, 1 Mart 2024"), trading_start: Some("7 Mart 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("3.502.383") }',
    "ALVES": 'StaticIpo { ticker: "ALVES", name: "Alves Kablo", date: "2024-02-29", price: 19.45, status: "TAMAMLANDI", book_building: Some("22-23 Şubat 2024"), trading_start: Some("29 Şubat 2024"), dist_type: Some("Eşit Dağıtım"), participant_count: Some("2.870.401") }'
}

def transform_line(m):
    ticker = m.group(1)
    name = m.group(2)
    date = m.group(3)
    price = m.group(4)
    status = m.group(5)
    if ticker in replacements:
        return f"    {replacements[ticker]},"
    else:
        return f'    StaticIpo {{ ticker: "{ticker}", name: "{name}", date: "{date}", price: {price}, status: "{status}", book_building: None, trading_start: None, dist_type: None, participant_count: None }},'

new_code = re.sub(r'pub const RECENT_IPOS: &\[\(&str, &str, &str, f64, &str\)\] = &\[', struct_def, code)
new_code = re.sub(r'\s*\(\"([^\"]+)\",\s*\"([^\"]+)\",\s*\"([^\"]+)\",\s*([0-9\.]+),\s*\"([^\"]+)\"\),?', transform_line, new_code)

with open("src/corporate_actions.rs", "w") as f:
    f.write(new_code)
