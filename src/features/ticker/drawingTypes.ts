export type DrawingToolType =
  | 'select'
  | 'trendline'
  | 'ray'
  | 'extended_line'
  | 'horizontal'
  | 'horizontal_ray'
  | 'vertical'
  | 'channel'
  | 'rectangle'
  | 'fibonacci'
  | 'fib_extension'
  | 'position_long'
  | 'position_short'
  | 'arrow_up'
  | 'arrow_down'
  | 'brush'
  | 'text'
  | 'callout'
  | 'measure';

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingPoint {
  /** Unix zaman damgası (saniye cinsinden) */
  time: number;
  /** Fiyat seviyesi */
  price: number;
}

export interface DrawingItem {
  id: string;
  type: DrawingToolType;
  /** Çizimi oluşturan kontrol noktaları */
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  fillColor?: string;
  fillOpacity?: number;
  text?: string;
  label?: string;
  isLocked?: boolean;
  isVisible?: boolean;
  showStats?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingToolSettings {
  activeTool: DrawingToolType;
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  fillOpacity: number;
  magnetEnabled: boolean;
  isVisible: boolean;
}

export const FIBONACCI_LEVELS = [
  { level: 0, color: '#8b949e', label: '0.0% (0.0)' },
  { level: 0.236, color: '#8957e5', label: '23.6% (0.236)' },
  { level: 0.382, color: '#388bfd', label: '38.2% (0.382)' },
  { level: 0.5, color: '#3fb950', label: '50.0% (0.500)' },
  { level: 0.618, color: '#d29922', label: '61.8% (0.618)' },
  { level: 0.786, color: '#f0883e', label: '78.6% (0.786)' },
  { level: 1.0, color: '#8b949e', label: '100.0% (1.0)' },
  { level: 1.618, color: '#f85149', label: '161.8% (1.618)' },
  { level: 2.618, color: '#ff7b72', label: '261.8% (2.618)' },
];

export const FIBONACCI_EXTENSION_LEVELS = [
  { level: 0, color: '#8b949e', label: '0.0' },
  { level: 0.618, color: '#d29922', label: '0.618' },
  { level: 1.0, color: '#388bfd', label: '1.000 (1:1 Hedef)' },
  { level: 1.272, color: '#8957e5', label: '1.272' },
  { level: 1.618, color: '#3fb950', label: '1.618 (Altın Hedef)' },
  { level: 2.618, color: '#f0883e', label: '2.618 (Genişleme)' },
];

export const DRAWING_PALETTE_COLORS = [
  '#58a6ff', // Mavi (Varsayılan)
  '#3fb950', // Yeşil / Destek
  '#f85149', // Kırmızı / Direnç
  '#d29922', // Sarı / Altın Oran
  '#a371f7', // Mor / Hedef
  '#f0883e', // Turuncu
  '#56d364', // Parlak Yeşil
  '#79c0ff', // Açık Mavi
  '#c9d1d9', // Açık Gri
  '#ffffff', // Beyaz
];
