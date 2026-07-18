#[derive(Debug, Clone, PartialEq)]
pub enum FqlCommand {
    OpenTicker { ticker: String },
    Scan { market: String, expression: String },
    Kap { ticker: Option<String>, period: Option<String> },
    Ai { prompt: String },
    Sync { source: String, mode: String },
    Help,
}

pub fn parse(input: &str) -> Result<FqlCommand, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Command is empty".into());
    }

    let lower = trimmed.to_lowercase();
    let mut parts = trimmed.split_whitespace();
    let verb = parts.next().unwrap_or_default().to_lowercase();

    match verb.as_str() {
        "open" => {
            let ticker = parts
                .next()
                .ok_or_else(|| "Usage: open ASELS".to_string())?
                .to_uppercase();
            Ok(FqlCommand::OpenTicker { ticker })
        }
        "scan" => {
            let market = parts
                .next()
                .ok_or_else(|| "Usage: scan BIST100 where rsi < 35".to_string())?
                .to_uppercase();
            let expression = parts.collect::<Vec<_>>().join(" ");
            Ok(FqlCommand::Scan { market, expression })
        }
        "kap" => {
            let ticker = parts.next().map(|ticker| ticker.to_uppercase());
            let rest = parts.collect::<Vec<_>>();
            let period = if rest.is_empty() {
                None
            } else {
                Some(rest.join(" "))
            };
            Ok(FqlCommand::Kap { ticker, period })
        }
        "ai" => {
            let prompt = trimmed
                .get(2..)
                .unwrap_or_default()
                .trim()
                .trim_matches('"')
                .to_string();
            if prompt.is_empty() {
                return Err("Usage: ai explain ASELS".into());
            }
            Ok(FqlCommand::Ai { prompt })
        }
        "sync" => {
            let source = parts.next().unwrap_or("all").to_lowercase();
            let mode = parts.next().unwrap_or("incremental").to_lowercase();
            Ok(FqlCommand::Sync { source, mode })
        }
        "help" | "?" => Ok(FqlCommand::Help),
        _ if lower.starts_with("scan ") => Err("Scan command could not be parsed".into()),
        _ if parts.clone().count() == 0 => {
            // It's a single word without a known verb. Assume it's a ticker search.
            Ok(FqlCommand::OpenTicker { ticker: verb.to_uppercase() })
        }
        _ => Err(format!("Unknown command: {verb}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, FqlCommand};

    #[test]
    fn parses_open() {
        assert_eq!(
            parse("open asels").unwrap(),
            FqlCommand::OpenTicker {
                ticker: "ASELS".into()
            }
        );
    }

    #[test]
    fn parses_scan_expression() {
        assert_eq!(
            parse("scan bist100 where rsi < 35").unwrap(),
            FqlCommand::Scan {
                market: "BIST100".into(),
                expression: "where rsi < 35".into()
            }
        );
    }

    #[test]
    fn rejects_empty_ai() {
        assert!(parse("ai").is_err());
    }
}
