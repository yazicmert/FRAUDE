import type { EquityRow } from '../../types';

// Kullanıcı tanımlı fiyat/teknik alarm kuralları. Değerlendirme kenar-tetikli
// (edge-triggered) çalışır: koşul yanlıştan doğruya geçtiği anda bir kez tetiklenir,
// böylece koşul doğru kaldıkça sürekli bildirim gelmez.

export type AlertMetric =
  | 'price'        // fiyat eşiğe göre
  | 'change_pct'   // günlük değişim %
  | 'rsi'          // RSI(14)
  | 'sma50'        // fiyatın 50 günlük SMA'yı kesmesi
  | 'week_52_high' // 52 hafta zirvesi kırılımı
  | 'week_52_low'; // 52 hafta dibi kırılımı

export type AlertOp = 'above' | 'below';

export interface AlertRule {
  id: string;
  ticker: string;
  metric: AlertMetric;
  op: AlertOp;
  /** price / change_pct / rsi için gerekli eşik. Diğer metrikler için yok sayılır. */
  threshold: number;
  note?: string;
  enabled: boolean;
  /** true ise tetiklendikten sonra da aktif kalır; false ise bir kez tetiklenip pasifleşir. */
  repeat: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  /** Son değerlendirmede koşulun durumu; kenar tetikleme için tutulur. */
  lastMet: boolean | null;
}

export interface TriggeredAlert {
  id: string;
  ruleId: string;
  ticker: string;
  message: string;
  value: number;
  at: string;
  read: boolean;
}

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  price: 'Fiyat',
  change_pct: 'Günlük Değişim %',
  rsi: 'RSI (14)',
  sma50: '50 Günlük Ortalama Kesişimi',
  week_52_high: '52 Hafta Zirvesi Kırılımı',
  week_52_low: '52 Hafta Dibi Kırılımı',
};

/** Bu metrik kullanıcıdan sayısal eşik ister mi? */
export function metricNeedsThreshold(metric: AlertMetric): boolean {
  return metric === 'price' || metric === 'change_pct' || metric === 'rsi';
}

const OP_TEXT: Record<AlertOp, string> = { above: 'üzerine çıkarsa', below: 'altına inerse' };

/** Kuralın insan-okur özeti (liste ve bildirim başlığı için). */
export function describeRule(rule: AlertRule): string {
  const { metric, op, threshold, ticker } = rule;
  switch (metric) {
    case 'price':
      return `${ticker} fiyatı ${threshold} ${OP_TEXT[op]}`;
    case 'change_pct':
      return `${ticker} günlük değişim %${threshold} ${OP_TEXT[op]}`;
    case 'rsi':
      return `${ticker} RSI ${threshold} ${OP_TEXT[op]}`;
    case 'sma50':
      return `${ticker} fiyatı 50 günlük ortalamayı ${op === 'above' ? 'yukarı' : 'aşağı'} keserse`;
    case 'week_52_high':
      return `${ticker} 52 hafta zirvesini kırarsa`;
    case 'week_52_low':
      return `${ticker} 52 hafta dibini kırarsa`;
    default:
      return `${ticker} alarmı`;
  }
}

// Kuralın verilen anlık veriye göre şu an "karşılandı mı" durumunu döndürür.
// Değerlendirilemezse null döner (veri eksik).
export function evaluateRule(rule: AlertRule, eq: EquityRow): { met: boolean; value: number } | null {
  switch (rule.metric) {
    case 'price': {
      const v = eq.price;
      if (!Number.isFinite(v)) return null;
      return { met: rule.op === 'above' ? v > rule.threshold : v < rule.threshold, value: v };
    }
    case 'change_pct': {
      const v = eq.change_pct;
      if (!Number.isFinite(v)) return null;
      return { met: rule.op === 'above' ? v > rule.threshold : v < rule.threshold, value: v };
    }
    case 'rsi': {
      const v = eq.rsi;
      if (!Number.isFinite(v) || v === 0) return null;
      return { met: rule.op === 'above' ? v > rule.threshold : v < rule.threshold, value: v };
    }
    case 'sma50': {
      const v = eq.price;
      const ma = eq.sma_50;
      if (!Number.isFinite(v) || !Number.isFinite(ma) || ma === 0) return null;
      return { met: rule.op === 'above' ? v > ma : v < ma, value: v };
    }
    case 'week_52_high': {
      const v = eq.price;
      const hi = eq.week_52_high;
      if (!Number.isFinite(v) || !Number.isFinite(hi) || hi === 0) return null;
      return { met: v >= hi, value: v };
    }
    case 'week_52_low': {
      const v = eq.price;
      const lo = eq.week_52_low;
      if (!Number.isFinite(v) || !Number.isFinite(lo) || lo === 0) return null;
      return { met: v <= lo, value: v };
    }
    default:
      return null;
  }
}
