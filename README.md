# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Haber kaynakları

- GDELT DOC 2.0 API: API anahtarı gerektirmeyen küresel şirket haberi araması.
- Google News RSS: Türkçe şirket haberi araması; kişisel ve ticari olmayan feed-reader kullanımı içindir.
- Bloomberg HT RSS: genel ekonomi haberleri ve şirket adı/hisse kodu eşleşmeleri.
- KAP sonuçları: resmi KAP REST servisi ücretli ve yetkilendirmeli olduğu için, herkese açık KAP bildirim sayfalarının Google News tarafından indekslenen sonuçları kullanılır. Bu sonuçlar gecikebilir veya eksik olabilir ve resmi KAP akışının yerine geçmez.

## Finansal veri doğruluğu

- Fiyat, OHLC, hacim, 52 haftalık yüksek/düşük ve endeks değerleri Yahoo Chart yanıtından alınır.
- RSI(14) ve ATR(14), Wilder/RMA yumuşatmasıyla; EMA, SMA, MACD ve Bollinger değerleri günlük kapanış/OHLC serilerinden yerel olarak hesaplanır.
- Ekranda gösterilen F/K, PD/DD, ROE ve ROA için birincil kaynak İş Yatırım'ın `Cari` tarama oranlarıdır. Böylece FRAUDE'deki değerler Türkiye piyasasında karşılaştırılan cari oran tanımıyla aynı kalır.
- Yahoo Fundamentals Timeseries ham kalemleri yedek ve tamamlayıcı kaynaktır. Brüt/net marj, büyüme ve Net Borç/FAVÖK bu kalemlerden FRAUDE içinde hesaplanır; hazır Yahoo oranları doğrudan kullanılmaz.
- İş Yatırım geçici olarak ulaşılamazsa F/K = güncel piyasa değeri / TTM net kâr ve PD/DD = güncel piyasa değeri / son özsermaye yedek hesabı kullanılır; kaynak etiketi bu durumu açıkça gösterir. Kâr sıfır veya negatifse F/K `—` gösterilir.
- Yahoo yedeğinde ROE ve ROA, TTM net kârın son bilanço ile yaklaşık bir yıl önceki bilanco ortalamasına bölünmesiyle hesaplanır. Finansal tablo para birimi piyasa değerinden farklıysa Yahoo döviz kuru ile aynı para birimine çevrilir.
- Eksik finansal kalemler sıfıra dönüştürülmez; arayüzde `—` gösterilir. Kaynak, finansal veri tarihi ve para birimi hisse detayında belirtilir. Temel veriler 12 saat bellekte tutulur.
- Geçmiş F/K ve PD/DD için dönemsel EPS ve defter değeri serileri gerekir. Bu veri bağlı olmadığından yanıltıcı vekil grafikler kaldırılmıştır.

## BIST Halka Arz evreni

- Dashboard, BIST Halka Arz (XHARZ) endeks kartını ve endeks detayını içerir.
- XHARZ evrenindeki yeni hisseler dashboard artanlar/düşenler hesabına katılır ve `IPO` etiketiyle gösterilir.
- Endeks seviyesi ve hisse OHLCV verileri Yahoo'dan; bileşen evreni 10.07.2026 tarihli Borsa İstanbul XHARZ referansı ve herkese açık bileşen tablosundan alınır. Yeni sembolün Yahoo fiyat serisi henüz oluşmadıysa o eşlemede atlanır, sonraki eşlemede otomatik olarak eklenir.

## Dashboard karar destek modülleri

- Günlük Piyasa Bülteni; piyasa genişliği, BIST 100, XHARZ, lider/zayıf hisse ve aşırı satım sayısını özetler.
- Model Portföy; değer, kalite ve momentum puanlarını görünür formüllerle birleştiren eşit ağırlıklı bir araştırma/izleme listesidir; yatırım tavsiyesi değildir.
- Bilanço Analizi; cari F/K, PD/DD, ROE, ROA, net marj ve büyüme metriklerini seçilen kritere göre karşılaştırır.
- Filtreli Analiz; BIST/XHARZ evreni, F/K, PD/DD, ROE, RSI ve günlük değişim eşiklerini birlikte uygulayabilir.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
