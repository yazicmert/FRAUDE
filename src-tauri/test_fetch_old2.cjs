const https = require('https');

const ipos = [
    ["HARES", "Hareket Proje", "hareket-proje-tasimaciligi-ve-yuku-muhendisligi-a-s"],
    ["ENTRA", "Entra Yenilenebilir Enerji", "ic-entra-yenilenebilir-enerji-a-s"],
    ["ODINE", "Odine Teknoloji", "odine-solutions-teknoloji-san-ve-tic-a-s"],
    ["ALVES", "Alves Kablo", "alves-kablo-sanayi-ve-ticaret-a-s"]
];

async function run() {
    for (let [ticker, name, slug] of ipos) {
        console.log(`curl "https://halkarz.com/?s=${ticker}"`);
    }
}
run();
