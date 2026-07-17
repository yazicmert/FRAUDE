# FRAUDE Terminal

[🇹🇷 Türkçe Rehber](#-türkçe-rehber) | [🇬🇧 English Guide](#-english-guide)

---

# 🇬🇧 English Guide

**FRAUDE** is a dynamic, open-source financial decision-support terminal designed for traders, investors, and developers interested in analyzing financial markets with high performance. Built on top of **Tauri**, **React**, and **TypeScript**, it runs as a lightweight, blazing-fast desktop application.

---

## 📌 Table of Contents
1. [Key Features](#-key-features)
2. [Prerequisites](#-prerequisites)
3. [Quick Start & Installation](#-quick-start--installation)
4. [Project Structure](#-project-structure)
5. [Data Flow & Reliability](#-data-flow--reliability)
6. [Contributing](#-contributing)
7. [License](#-license)

---

## 🚀 Key Features

*   **Multi-Market Dashboard:** Track global assets, indices, and specific market domains.
*   **Technical Analysis Suite:** Locally computed real-time indicators like RSI(14), ATR(14), EMA, SMA, MACD, and Bollinger Bands.
*   **Deep Financial Analytics:** Automatic calculation of valuation metrics (P/E, P/B, ROE, ROA, gross/net margins, growth, and Net Debt/EBITDA).
*   **Aggregated News Terminal:** Multi-source feed readers including GDELT 2.0 API, Google News RSS, Bloomberg HT, and KAP (Public Disclosure Platform) indexers.
*   **Decision Support Modules:** Includes Market Bulletins, Model Portfolios (multi-factor scoring), Balance Sheet Comparators, and Multi-criteria Screener.

---

## 🛠 Prerequisites

Before running the application, make sure you have the following installed on your system:
*   [Node.js](https://nodejs.org/) (v18 or higher recommended)
*   [Rust & Cargo](https://www.rust-lang.org/tools/install) (required for Tauri desktop build)
*   System dependencies for Tauri (check the [Tauri Getting Started Guide](https://tauri.app/v1/guides/getting-started/prerequisites)).

---

## 💻 Quick Start & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/fraude.git
cd fraude
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables (Optional)
Copy the example environment file and configure variables:
```bash
cp .env.example .env
```
*   `VITE_FRAUDE_API_URL`: Points to the FRAUDE backend API (defaults to `http://localhost:8787` for registry).
*   `VITE_FRAUDE_TRUST_KEYS`: Public keys for secure communications.

### 4. Run in Development Mode
To launch the desktop app locally:
```bash
npm run tauri dev
```

To run only the web frontend in your browser (without Tauri's native APIs):
```bash
npm run dev
```

---

## 📁 Project Structure

*   `src/`: React frontend source code (components, hooks, state, routing).
*   `src-tauri/`: Rust backend code configuration, system permissions, and desktop integration.
*   `scripts/`: Automation and registry verification scripts.
*   `server/`: Backend integration / Cloudflare Workers or server code.

---

## 📊 Data Flow & Reliability

*   **Market Data:** Pricing and historical OHLCV data are derived from public Yahoo Chart APIs.
*   **Indicator Calculations:** All calculations (RSI, EMA, Bollinger, etc.) are computed **locally** on the client to avoid lag and server bottlenecks.
*   **Corporate & Fundamental Data:** Primarily sourced from institutional portals (like İş Yatırım for BIST) and fallback fundamental APIs. If a primary data source is unavailable, fallback methods approximate valuation metrics using trailing twelve months (TTM) net income and equity.
*   **Caching Strategy:** Fundamental and historical metrics are cached locally for up to 12 hours to reduce network requests and respect API rate limits.

---

## 🤝 Contributing

We welcome contributions from the community! Whether you want to fix a bug, add a new market indicator, or improve the user interface:
1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License
This project is open-source. See the LICENSE file for details.

---
---

# 🇹🇷 Türkçe Rehber

**FRAUDE**, finansal piyasaları analiz etmek, takip etmek ve veri destekli kararlar almak isteyen herkes için geliştirilmiş, yüksek performanslı ve açık kaynaklı bir finansal terminaldir. **Tauri**, **React** ve **TypeScript** tabanlı mimarisi sayesinde masaüstünde son derece hafif ve hızlı çalışır.

---

## 📌 İçindekiler
1. [Temel Özellikler](#-temel-özellikler)
2. [Gereksinimler](#-gereksinimler)
3. [Hızlı Başlangıç ve Kurulum](#-hızlı-başlangıç-ve-kurulum)
4. [Proje Yapısı](#-proje-yapısı)
5. [Veri Doğruluğu ve Hesaplamalar](#-veri-doğruluğu-ve-hesaplamalar)
6. [Katkıda Bulunma](#-katkıda-bulunma)
7. [Lisans](#-lisans)

---

## 🚀 Temel Özellikler

*   **Çoklu Piyasa Gösterge Paneli:** Küresel hisse senetleri, endeksler ve özel pazar alanlarını anlık izleme.
*   **Teknik Analiz Motoru:** RSI(14), ATR(14), EMA, SMA, MACD ve Bollinger Bantları gibi popüler indikatörlerin istemci tarafında (yerel) anlık hesaplanması.
*   **Gelişmiş Temel Analiz Raporları:** Cari F/K, PD/DD, ROE, ROA, brüt/net marjlar, büyüme oranları ve Net Borç/FAVÖK gibi rasyoların otomatik hesaplanması.
*   **Entegre Haber Akışı:** GDELT 2.0 API, Google News RSS, Bloomberg HT ve KAP indeksleme araçlarıyla çok kaynaklı haber akışı.
*   **Karar Destek Araçları:** Günlük Piyasa Bülteni, Çok faktörlü puanlama sunan Model Portföy, Bilanço Karşılaştırma Modülü ve Filtreli Filtreleme (Screener) aracı.

---

## 🛠 Gereksinimler

Projeyi yerel makinenizde çalıştırmadan önce sisteminizde şunların kurulu olduğundan emin olun:
*   [Node.js](https://nodejs.org/) (v18 ve üzeri önerilir)
*   [Rust & Cargo](https://www.rust-lang.org/tools/install) (Tauri derlemesi için zorunludur)
*   Tauri sistem bağımlılıkları (Kullandığınız işletim sistemine göre kurulum rehberini inceleyin: [Tauri Başlangıç Rehberi](https://tauri.app/v1/guides/getting-started/prerequisites)).

---

## 💻 Hızlı Başlangıç ve Kurulum

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/kullaniciadi/fraude.git
cd fraude
```

### 2. Bağımlılıkları Yükleyin
```bash
npm install
```

### 3. Çevre Değişkenlerini Ayarlayın (Opsiyonel)
`.env.example` dosyasını kopyalayarak yerel ortam değişkenlerinizi oluşturun:
```bash
cp .env.example .env
```
*   `VITE_FRAUDE_API_URL`: FRAUDE arka plan API/Kayıt URL'sini belirtir.
*   `VITE_FRAUDE_TRUST_KEYS`: Güvenli iletişim için doğrulanmış genel anahtarlar (Ed25519).

### 4. Geliştirici Modunda Çalıştırın
Masaüstü uygulamasını yerel olarak başlatmak için:
```bash
npm run tauri dev
```

Yalnızca web arayüzünü tarayıcıda çalıştırmak için (Tauri API'leri olmadan):
```bash
npm run dev
```

---

## 📁 Proje Yapısı

*   `src/`: React arayüz kodları (bileşenler, hooks, state yönetimi, sayfalar).
*   `src-tauri/`: Rust tabanlı masaüstü entegrasyonu, sistem izinleri ve konfigürasyonlar.
*   `scripts/`: Otomasyon ve yerel kayıt (registry) doğrulama scriptleri.
*   `server/`: API entegrasyonları ve sunucu taraflı kodlar.

---

## 📊 Veri Doğruluğu ve Hesaplamalar

*   **Fiyat ve Grafik Verileri:** Fiyat, hacim ve tarihsel grafik verileri Yahoo Chart API'leri üzerinden çekilir.
*   **İndikatör Hesaplamaları:** İndikatörler (RSI, MACD, Bollinger vb.) sunucu yükünü azaltmak amacıyla **kullanıcı cihazında (yerel)** hesaplanır.
*   **Finansal Rasyolar ve Temel Analiz:** Birincil finansal oranlar İş Yatırım ve diğer kamuya açık finansal tarayıcılardan beslenir. Ana kaynağa erişilemediğinde sistem, son 12 aylık (TTM) net kâr ve özsermaye verileriyle rasyoları otomatik olarak hesaplar.
*   **Önbellek (Caching):** Ağ trafiğini azaltmak ve veri sınırlarına takılmamak adına temel finansal veriler 12 saat boyunca yerel olarak bellekte tutulur.

---

## 🤝 Katkıda Bulunma

Açık kaynak topluluğunun katkılarını memnuniyetle karşılıyoruz! Bir hata gidermek, yeni bir finansal indikatör eklemek veya arayüzü geliştirmek isterseniz:
1. Projeyi fork'layın.
2. Yeni bir özellik dalı (feature branch) oluşturun (`git checkout -b feature/YeniOzellik`).
3. Değişikliklerinizi commit edin (`git commit -m 'Yeni özellik eklendi'`).
4. Dalınızı push edin (`git push origin feature/YeniOzellik`).
5. Bir Pull Request (Çekme İsteği) açın.

---

## 📄 Lisans
Bu proje açık kaynak kodludur. Detaylar için LICENSE dosyasına göz atabilirsiniz.
