const https = require('https');

const ipos = [
    ["HOROZ", "Horoz Lojistik", "horoz-lojistik-kargo-hizmetleri-ve-tic-a-s"],
    ["HARES", "Hareket Proje", "hareket-proje-tasimaciligi-ve-yuku-muhendisligi-a-s"],
    ["KOCMT", "Koç Metalurji", "koc-metalurji-a-s"],
    ["ALTNY", "Altınay Savunma", "altinay-savunma-teknolojileri-a-s"],
    ["RGYAS", "Rönesans Gayrimenkul", "ronesans-gayrimenkul-yatirim-a-s"],
    ["ENTRA", "Entra Yenilenebilir Enerji", "ic-entra-yenilenebilir-enerji-a-s"],
    ["ODINE", "Odine Teknoloji", "odine-solutions-teknoloji-san-ve-tic-a-s"],
    ["ARTMS", "Artemis Halı", "artemis-hali-a-s"],
    ["OBAMS", "Oba Makarnacılık", "oba-makarnacilik-san-ve-tic-a-s"],
    ["MOGAN", "Mogan Enerji", "mogan-enerji-yatirim-holding-a-s"],
    ["ALVES", "Alves Kablo", "alves-kablo-sanayi-ve-ticaret-a-s"]
];

async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    for (let [ticker, name, slug] of ipos) {
        let url = `https://halkarz.com/${slug}/`;
        let html = await fetchHtml(url);
        
        let bb = html.match(/Halka Arz Tarihi.*?<td>(.*?)<\/td>/is);
        let start = html.match(/Bist İlk İşlem Tarihi.*?<td>(.*?)<\/td>/is);
        let dist = html.match(/Dağıtım Yöntemi.*?<td>(.*?)<\/td>/is);
        let count = html.match(/Toplam.*?<td>(.*?)<\/td>/is);
        
        console.log(`("${ticker}", "${name}", "", 0.0, "TAMAMLANDI", "${bb ? bb[1].replace(/<[^>]*>?/gm, '').trim() : ''}", "${start ? start[1].replace(/<[^>]*>?/gm, '').trim() : ''}", "${dist ? dist[1].replace(/<[^>]*>?/gm, '').trim() : ''}", "${count ? count[1].replace(/<[^>]*>?/gm, '').replace('Kişi', '').replace('Müşteri', '').trim() : ''}"),`);
    }
}
run();
