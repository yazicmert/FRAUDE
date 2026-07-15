/// Technical indicator calculations for financial data

pub fn sma(data: &[f64], period: usize) -> f64 {
    if data.len() < period || period == 0 {
        return 0.0;
    }
    let slice = &data[data.len() - period..];
    slice.iter().sum::<f64>() / period as f64
}

pub fn ema(data: &[f64], period: usize) -> f64 {
    if data.is_empty() || period == 0 {
        return 0.0;
    }
    if data.len() < period {
        return sma(data, data.len());
    }
    let k = 2.0 / (period as f64 + 1.0);
    let mut ema_val = sma(&data[..period], period);
    for price in &data[period..] {
        ema_val = price * k + ema_val * (1.0 - k);
    }
    ema_val
}

pub fn rsi(data: &[f64], period: usize) -> f64 {
    if data.len() < period + 1 {
        return 50.0;
    }
    let mut avg_gain = 0.0;
    let mut avg_loss = 0.0;
    for i in 1..=period {
        let diff = data[i] - data[i - 1];
        if diff > 0.0 {
            avg_gain += diff;
        } else {
            avg_loss += diff.abs();
        }
    }
    avg_gain /= period as f64;
    avg_loss /= period as f64;
    for i in (period + 1)..data.len() {
        let change = data[i] - data[i - 1];
        let gain = change.max(0.0);
        let loss = (-change).max(0.0);
        avg_gain = (avg_gain * (period - 1) as f64 + gain) / period as f64;
        avg_loss = (avg_loss * (period - 1) as f64 + loss) / period as f64;
    }
    if avg_gain == 0.0 && avg_loss == 0.0 {
        return 50.0;
    }
    if avg_loss == 0.0 {
        return 100.0;
    }
    let rs = avg_gain / avg_loss;
    100.0 - (100.0 / (1.0 + rs))
}

pub fn macd(data: &[f64]) -> f64 {
    if data.len() < 26 {
        return 0.0;
    }
    ema(data, 12) - ema(data, 26)
}

pub fn atr(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> f64 {
    let len = highs.len().min(lows.len()).min(closes.len());
    if len < 2 || period == 0 {
        return 0.0;
    }
    let mut trs = Vec::with_capacity(len - 1);
    for i in 1..len {
        let hl = highs[i] - lows[i];
        let hc = (highs[i] - closes[i - 1]).abs();
        let lc = (lows[i] - closes[i - 1]).abs();
        trs.push(hl.max(hc).max(lc));
    }
    if trs.len() < period {
        return trs.iter().sum::<f64>() / trs.len().max(1) as f64;
    }
    let mut average = trs[..period].iter().sum::<f64>() / period as f64;
    for true_range in &trs[period..] {
        average = (average * (period - 1) as f64 + true_range) / period as f64;
    }
    average
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_market_rsi_is_neutral() {
        assert_eq!(rsi(&[10.0; 20], 14), 50.0);
    }

    #[test]
    fn rising_market_rsi_is_one_hundred() {
        let prices: Vec<f64> = (1..=20).map(|value| value as f64).collect();
        assert_eq!(rsi(&prices, 14), 100.0);
    }

    #[test]
    fn rsi_matches_wilder_reference_series() {
        let closes = [
            44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
            45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
        ];
        assert!((rsi(&closes, 14) - 70.4641).abs() < 0.001);
    }

    #[test]
    fn atr_uses_wilder_smoothing() {
        let highs = [11.0, 12.0, 14.0, 15.0, 16.0];
        let lows = [9.0, 10.0, 11.0, 13.0, 14.0];
        let closes = [10.0, 11.0, 13.0, 14.0, 15.0];
        let value = atr(&highs, &lows, &closes, 3);
        assert!((value - 2.2222222222).abs() < 1e-9);
    }
}

pub fn bollinger_position(data: &[f64], period: usize) -> String {
    if data.len() < period || period == 0 {
        return "Insufficient data".into();
    }
    let mean = sma(data, period);
    let slice = &data[data.len() - period..];
    let variance = slice.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / period as f64;
    let std_dev = variance.sqrt();
    let upper = mean + 2.0 * std_dev;
    let lower = mean - 2.0 * std_dev;
    let price = *data.last().unwrap_or(&0.0);

    if price > upper {
        "Above upper band".into()
    } else if price > mean + std_dev {
        "Upper half".into()
    } else if price > mean - std_dev {
        "Mid channel".into()
    } else if price > lower {
        "Near lower band".into()
    } else {
        "Below lower band".into()
    }
}
