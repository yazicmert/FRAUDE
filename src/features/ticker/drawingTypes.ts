/**
 * FRAUDE Grafik Çizim Araçları Tipleri
 */

export type DrawingToolType =
  | 'select'
  | 'trendline'
  | 'ray'
  | 'horizontal'
  | 'vertical'
  | 'rectangle'
  | 'fibonacci'
  | 'brush'
  | 'text'
  | 'measure';

export interface DrawingPoint {
  /** Unix zaman damgası (saniye cinsinden) */
  time: number;
  /** Fiyat seviyesi */
  price: number;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingItem {
  id: string;
  type: DrawingToolType;
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  fillColor?: string;
  fillOpacity?: number;
  text?: string;
  fontSize?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingToolSettings {
  activeTool: DrawingToolType;
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  magnetEnabled: boolean;
  isVisible: boolean;
}

export const FIBONACCI_LEVELS = [
  { level: 0.0, label: '0.0% (0.0)', color: '#8b949e' },
  { level: 0.236, label: '23.6% (0.236)', color: '#f85149' },
  { level: 0.382, label: '38.2% (0.382)', color: '#f0883e' },
  { level: 0.5, label: '50.0% (0.5)', color: '#3fb950' },
  { level: 0.618, label: '61.8% (0.618 - Altın Oran)', color: '#58a6ff' },
  { level: 0.786, label: '78.6% (0.786)', color: '#bc8cff' },
  { level: 1.0, label: '100.0% (1.0)', color: '#8b949e' },
] as const;

export const DRAWING_PALETTE_COLORS = [
  '#58a6ff', // FRAUDE Mavi
  '#3fb950', // Yeşil / Yükseliş
  '#f85149', // Kırmızı / Düşüş
  '#e3b341', // Altın / Sarı
  '#bc8cff', // Mor
  '#f0883e', // Turuncu
  '#39d353', // Açık Yeşil
  '#ffffff', // Beyaz
] as const;
