use crate::domain::{AiHistoryRecord, DataSourceStatus, EquityRow, KapAnnouncement, NewsItem, StoredAiKey};
use crate::services::clock_string;

#[derive(Debug)]
pub struct AppStore {
    pub equities: Vec<EquityRow>,
    pub kap: Vec<KapAnnouncement>,
    pub news: Vec<NewsItem>,
    pub sources: Vec<DataSourceStatus>,
    pub ai_keys: Vec<StoredAiKey>,
    pub ai_history: Vec<AiHistoryRecord>,
    pub agents: Vec<crate::domain::AiAgent>,
    pub spk_bulletins: Vec<crate::spk::SpkBulletin>,
    pub artifacts: Vec<crate::domain::Artifact>,
    pub indices: std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>>,
    pub index_changes: Vec<crate::domain::IndexChange>,
}

impl AppStore {
    pub fn seeded() -> Self {
        let mut store = Self {
            equities: Vec::new(),
            news: Vec::new(),
            spk_bulletins: Vec::new(),
            artifacts: Vec::new(),
            indices: std::collections::HashMap::new(),
            index_changes: Vec::new(),
            kap: vec![
                KapAnnouncement {
                    id: "KAP-001".into(),
                    ticker: "ASELS".into(),
                    title: "Yeni Sözleşme İmzalanması".into(),
                    date: "2026-07-12".into(),
                    category: "Özel Durum Açıklaması".into(),
                    summary: "Aselsan ile Savunma Sanayii Başkanlığı arasında 125.4 Milyon USD tutarında elektronik harp sistemleri tedarik sözleşmesi imzalanmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 9,
                },
                KapAnnouncement {
                    id: "KAP-002".into(),
                    ticker: "THYAO".into(),
                    title: "Haziran 2026 Trafik Sonuçları".into(),
                    date: "2026-07-10".into(),
                    category: "Trafik Sonuçları".into(),
                    summary: "Türk Hava Yolları'nın Haziran 2026 döneminde taşınan yolcu sayısı geçen yılın aynı ayına göre %8.2 artarak 7.8 milyona ulaşmıştır. Doluluk oranı %83.4'tür.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 8,
                },
                KapAnnouncement {
                    id: "KAP-003".into(),
                    ticker: "TUPRS".into(),
                    title: "Rafineri Bakım Duruş Planı Güncellemesi".into(),
                    date: "2026-07-08".into(),
                    category: "Üretim ve Satış Açıklaması".into(),
                    summary: "İzmir rafinerisi U-7000 ünitesinde planlanan periyodik bakım duruşu 10 gün erken tamamlanmış olup ünite tam kapasiteyle faaliyete alınmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 7,
                },
                KapAnnouncement {
                    id: "KAP-004".into(),
                    ticker: "EREGL".into(),
                    title: "Yüksek Fırın Revizyonu Hakkında".into(),
                    date: "2026-07-05".into(),
                    category: "Yatırım Açıklaması".into(),
                    summary: "Ereğli Demir Çelik 1 nolu yüksek fırınının planlı modernizasyon çalışmaları başlamış olup, üretimin duraksamaması için stoklar devreye alınmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 6,
                },
                KapAnnouncement {
                    id: "KAP-005".into(),
                    ticker: "KCHOL".into(),
                    title: "Pay Geri Alım İşlemleri".into(),
                    date: "2026-07-04".into(),
                    category: "Pay Alım/Satım Bildirimi".into(),
                    summary: "Şirketimizce 2026 geri alım programı kapsamında Borsa İstanbul'da adet başına ortalama 205.5 TL fiyattan toplam 500,000 adet pay geri alımı yapılmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 8,
                },
                KapAnnouncement {
                    id: "KAP-006".into(),
                    ticker: "MIATK".into(),
                    title: "Yeni Ar-Ge Projesi Onayı".into(),
                    date: "2026-07-02".into(),
                    category: "Ar-Ge Faaliyetleri".into(),
                    summary: "Mia Teknoloji'nin TÜBİTAK TEYDEB kapsamında sunduğu 'Yapay Zeka Destekli Akıllı Trafik Yönetim Sistemi' projesi desteklenmeye hak kazanmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 7,
                },
                KapAnnouncement {
                    id: "KAP-007".into(),
                    ticker: "ASTOR".into(),
                    title: "İhracat Sözleşmesi İmzalanması".into(),
                    date: "2026-06-30".into(),
                    category: "Özel Durum Açıklaması".into(),
                    summary: "Astor Enerji, İspanya merkezli bir dağıtım şirketi ile 18.2 Milyon Euro tutarında transformatör satış sözleşmesi imzalamıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 9,
                },
                KapAnnouncement {
                    id: "KAP-008".into(),
                    ticker: "KONTR".into(),
                    title: "Teşvik Belgesi Alınması".into(),
                    date: "2026-06-28".into(),
                    category: "Yatırım Teşviki".into(),
                    summary: "Kontrolmatik Teknoloji'nin Ankara'daki batarya hücresi üretim tesisi kapasite artış yatırımı için 1.2 Milyar TL tutarında yatırım teşvik belgesi onaylanmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 8,
                },
                KapAnnouncement {
                    id: "KAP-009".into(),
                    ticker: "BIMAS".into(),
                    title: "Yeni Mağaza Açılışları".into(),
                    date: "2026-06-25".into(),
                    category: "Büyüme Hedefleri".into(),
                    summary: "BİM Birleşik Mağazalar A.Ş. 2026 ikinci çeyreğinde toplam 185 yeni mağaza açılışı gerçekleştirerek yurt içi toplam mağaza sayısını 11,850'ye ulaştırmıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 6,
                },
                KapAnnouncement {
                    id: "KAP-010".into(),
                    ticker: "SAHOL".into(),
                    title: "Finansal Duran Varlık Edinimi".into(),
                    date: "2026-06-22".into(),
                    category: "Finansal Yatırım".into(),
                    summary: "Sabancı Holding, yeşil enerji portföyünü büyütmek amacıyla rüzgar enerjisi lisansına sahip bir şirketin %100 hisselerini satın almıştır.".into(),
                    url: "https://www.kap.org.tr".into(),
                    ai_importance_score: 8,
                }
            ],
            sources: vec![
                DataSourceStatus {
                    name: "BIST OHLCV".into(),
                    provider: "Yahoo chart adapter".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 41,
                },
                DataSourceStatus {
                    name: "Fundamental ratios".into(),
                    provider: "İş Yatırım current ratios / Yahoo raw statements fallback".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 41,
                },
                DataSourceStatus {
                    name: "BIST Halka Arz (XHARZ)".into(),
                    provider: "Borsa Istanbul XHARZ reference / public constituent list / Yahoo OHLCV".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 7,
                },
                DataSourceStatus {
                    name: "KAP".into(),
                    provider: "Public indexed results (not official API)".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 10,
                },
                DataSourceStatus {
                    name: "EVDS".into(),
                    provider: "TCMB EVDS macro adapter".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 5,
                },
                DataSourceStatus {
                    name: "TUIK".into(),
                    provider: "TUIK statistics adapter".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 5,
                },
                DataSourceStatus {
                    name: "News".into(),
                    provider: "GDELT / Bloomberg HT / Yahoo RSS adapters".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 30,
                },
                DataSourceStatus {
                    name: "Manual CSV".into(),
                    provider: "Local import adapter".into(),
                    status: "ready".into(),
                    last_sync: clock_string(),
                    records: 0,
                },
            ],
            ai_keys: Vec::new(),
            ai_history: Vec::new(),
            agents: Vec::new(),
        };
        store.load_ai_keys();
        store.load_ai_history();
        store.load_agents();
        store.load_indices();
        
        // Seed "Haber Analisti" AI agent if not already present
        if !store.agents.iter().any(|a| a.id == "news-tagger-agent") {
            store.agents.push(crate::domain::AiAgent {
                id: "news-tagger-agent".into(),
                name: "Haber Analisti".into(),
                role_description: "Finansal haberleri analiz ederek etkilenen BIST hisselerini tespit eder".into(),
                system_prompt: r#"Sen bir BIST finans haber analisti AI'sın. Sana verilen haber metnini analiz et.
Yanıtını YALNIZCA aşağıdaki JSON formatında ver, başka hiçbir şey yazma:

{"tags": [
  {"ticker": "THYAO", "sentiment": "POSITIVE", "reason": "Doğrudan konu"},
  {"ticker": "PGSUS", "sentiment": "NEGATIVE", "reason": "Sektörel etki"}
]}

Kurallar:
- ticker: BIST ticker kodu (3-5 harf)
- sentiment: POSITIVE | NEGATIVE | NEUTRAL
- reason: Kısa Türkçe açıklama (maks 10 kelime)
- En fazla 5 ticker öner
- Emin olmadığın hisseleri ekleme
- Sadece JSON döndür, başka metin yazma"#.into(),
                api_key_id: String::new(),
                is_active: false,
                created_at: clock_string(),
                linked_artifacts: Vec::new(),
                linked_tickers: Vec::new(),
            });
        }

        // Seed "KAP Analisti": bağlı hisselerin KAP bildirimlerini okuyup özet not çıkarır
        if !store.agents.iter().any(|a| a.id == "kap-analyst-agent") {
            store.agents.push(crate::domain::AiAgent {
                id: "kap-analyst-agent".into(),
                name: "KAP Analisti".into(),
                role_description: "Bağlı hisselerin KAP bildirimlerini ve haberlerini okuyup yatırımcı için özet not çıkarır".into(),
                system_prompt: "Sen bir BIST KAP bildirim analisti AI'sın. Sana verilen KAP bildirimlerini ve şirket haberlerini oku; her hisse için önemli gelişmeleri, olası fiyat etkilerini ve dikkat edilmesi gerekenleri maddeler halinde Türkçe özetle. Kısa, net ve tarafsız yaz. Bu çıktı yatırım tavsiyesi değildir.".into(),
                api_key_id: String::new(),
                is_active: true,
                created_at: clock_string(),
                linked_artifacts: Vec::new(),
                linked_tickers: Vec::new(),
            });
        }

        store.load_artifacts();
        store
    }

    fn artifacts_file_path() -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|h| h.join(".fraude_artifacts.json"))
    }

    pub fn load_artifacts(&mut self) {
        if let Some(path) = Self::artifacts_file_path() {
            if let Ok(data) = std::fs::read_to_string(&path) {
                if let Ok(artifacts) = serde_json::from_str::<Vec<crate::domain::Artifact>>(&data) {
                    if !artifacts.is_empty() {
                        self.artifacts = artifacts;
                    }
                }
            }
        }
    }

    pub fn save_artifacts(&self) {
        if let Some(path) = Self::artifacts_file_path() {
            if let Ok(json) = serde_json::to_string_pretty(&self.artifacts) {
                let _ = std::fs::write(&path, json);
            }
        }
    }

    fn keys_file_path() -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|h| h.join(".fraude_keys.json"))
    }

    pub fn load_ai_keys(&mut self) {
        let Some(path) = Self::keys_file_path() else { return };
        let Ok(contents) = std::fs::read_to_string(&path) else { return };
        let Ok(mut keys) = serde_json::from_str::<Vec<StoredAiKey>>(&contents) else { return };
        if keys.is_empty() {
            return;
        }

        // Sırlar OS anahtarlığında tutulur. Dosyadaki `secret` alanı boşsa
        // anahtarlıktan okunur; doluysa bu eski düz-metin (legacy) kayıttır —
        // anahtarlığa taşınır ve dosya sanitize edilerek yeniden yazılır.
        let mut migrated = false;
        for key in &mut keys {
            if key.secret.is_empty() {
                if let Some(secret) = crate::keychain::read_secret(&key.id) {
                    key.secret = secret;
                }
            } else if crate::keychain::store_secret(&key.id, &key.secret) {
                // Düz-metin sır başarıyla anahtarlığa taşındı; bellekte kalır,
                // dosyadan silinecek.
                migrated = true;
            }
        }

        self.ai_keys = keys;
        if migrated {
            self.save_ai_keys();
        }
    }

    pub fn save_ai_keys(&self) {
        let Some(path) = Self::keys_file_path() else { return };

        // Sırrı anahtarlığa yaz; başarılıysa dosyaya boş `secret` ile sanitize
        // edilmiş kopya yazılır. Anahtarlık erişilemezse düz-metin yedeğe
        // düşülür (işlevsellik korunur) — bu durumda sır dosyada kalır.
        let sanitized: Vec<StoredAiKey> = self
            .ai_keys
            .iter()
            .map(|key| {
                let stored_in_keychain = !key.secret.is_empty()
                    && crate::keychain::store_secret(&key.id, &key.secret);
                StoredAiKey {
                    secret: if stored_in_keychain { String::new() } else { key.secret.clone() },
                    ..key.clone()
                }
            })
            .collect();

        let _ = crate::persist::write_json_atomic(&path, &sanitized);
    }

    fn history_file_path() -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|h| h.join(".fraude_ai_history.json"))
    }

    pub fn load_ai_history(&mut self) {
        if let Some(path) = Self::history_file_path() {
            if let Ok(contents) = std::fs::read_to_string(&path) {
                if let Ok(history) = serde_json::from_str::<Vec<AiHistoryRecord>>(&contents) {
                    if !history.is_empty() {
                        self.ai_history = history;
                    }
                }
            }
        }
    }

    pub fn save_ai_history(&self) {
        if let Some(path) = Self::history_file_path() {
            if let Ok(json) = serde_json::to_string_pretty(&self.ai_history) {
                let _ = std::fs::write(&path, json);
            }
        }
    }

    fn agents_file_path() -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|h| h.join(".fraude_ai_agents.json"))
    }

    pub fn load_agents(&mut self) {
        if let Some(path) = Self::agents_file_path() {
            if let Ok(data) = std::fs::read_to_string(&path) {
                if let Ok(agents) = serde_json::from_str::<Vec<crate::domain::AiAgent>>(&data) {
                    self.agents = agents;
                }
            }
        }
    }

    pub fn save_agents(&self) {
        if let Some(path) = Self::agents_file_path() {
            if let Ok(json) = serde_json::to_string_pretty(&self.agents) {
                let _ = std::fs::write(&path, json);
            }
        }
    }

    fn indices_file_path() -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|h| h.join(".fraude_indices.json"))
    }

    pub fn load_indices(&mut self) {
        if let Some(path) = Self::indices_file_path() {
            if let Ok(data) = std::fs::read_to_string(&path) {
                if let Ok(indices) = serde_json::from_str::<std::collections::HashMap<String, Vec<crate::domain::IndexConstituent>>>(&data) {
                    if !indices.is_empty() {
                        self.indices = indices;
                    }
                }
            }
        }
    }

    pub fn save_indices(&self) {
        if let Some(path) = Self::indices_file_path() {
            if let Ok(json) = serde_json::to_string_pretty(&self.indices) {
                let _ = std::fs::write(&path, json);
            }
        }
    }
}
