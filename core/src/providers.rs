use crate::domain::DataSourceStatus;
use crate::services::clock_string;

pub trait DataProvider {
    fn name(&self) -> &'static str;
    fn provider(&self) -> &'static str;
    fn status(&self, records: usize) -> DataSourceStatus {
        DataSourceStatus {
            name: self.name().into(),
            provider: self.provider().into(),
            status: "ready".into(),
            last_sync: clock_string(),
            records,
        }
    }
    fn status_at(&self, records: usize, as_of_ts: Option<i64>) -> DataSourceStatus {
        DataSourceStatus {
            name: self.name().into(),
            provider: self.provider().into(),
            status: match (records, as_of_ts) {
                (0, _) => "empty",
                (_, Some(_)) => "ready",
                _ => "partial",
            }.into(),
            last_sync: as_of_ts
                .map(|timestamp| format!("unix:{timestamp}"))
                .unwrap_or_else(|| "never".into()),
            records,
        }
    }
}

pub struct BistProvider;
pub struct KapProvider;
pub struct EvdsProvider;
pub struct TuikProvider;
pub struct NewsProvider;
pub struct CsvProvider;
pub struct FundamentalsProvider;
pub struct IpoIndexProvider;

impl DataProvider for BistProvider {
    fn name(&self) -> &'static str {
        "Market OHLCV"
    }

    fn provider(&self) -> &'static str {
        "Yahoo Finance / İş Yatırım routed adapter"
    }
}

impl DataProvider for KapProvider {
    fn name(&self) -> &'static str {
        "KAP"
    }

    fn provider(&self) -> &'static str {
        "KAP disclosure adapter"
    }
}

impl DataProvider for EvdsProvider {
    fn name(&self) -> &'static str {
        "EVDS"
    }

    fn provider(&self) -> &'static str {
        "TCMB EVDS adapter"
    }
}

impl DataProvider for TuikProvider {
    fn name(&self) -> &'static str {
        "TUIK"
    }

    fn provider(&self) -> &'static str {
        "TUIK statistics adapter"
    }
}

impl DataProvider for NewsProvider {
    fn name(&self) -> &'static str {
        "News"
    }

    fn provider(&self) -> &'static str {
        "GDELT/NewsAPI adapter"
    }
}

impl DataProvider for CsvProvider {
    fn name(&self) -> &'static str {
        "Manual CSV"
    }

    fn provider(&self) -> &'static str {
        "Local import adapter"
    }
}

impl DataProvider for FundamentalsProvider {
    fn name(&self) -> &'static str { "Fundamental ratios" }
    fn provider(&self) -> &'static str { "İş Yatırım current ratios / Yahoo raw statements fallback" }
}

impl DataProvider for IpoIndexProvider {
    fn name(&self) -> &'static str { "BIST Halka Arz (XHARZ)" }
    fn provider(&self) -> &'static str { "Borsa Istanbul XHARZ reference / public constituent list / Yahoo OHLCV" }
}
