// Uygulama genelinde bileşenler arası "aksiyon" olayları. Bunları yayınlayan
// bileşenlerin App state'ine bağımlı olmasını engeller; App tarafı dinleyip
// ilgili paneli açar (bkz. App.tsx olay dinleyicileri).

/** Sağ AI panelinde verilen prompt'u otomatik çalıştırır (panel kapalıysa açar). */
export function dispatchAiAsk(prompt: string) {
  window.dispatchEvent(new CustomEvent('fraude-ai-ask', { detail: { prompt } }));
}

/** Fiyat & teknik alarm penceresini açar; ticker verilirse formu ön-doldurur. */
export function dispatchOpenAlerts(ticker?: string) {
  window.dispatchEvent(new CustomEvent('fraude-open-alerts', { detail: { ticker } }));
}

/** Komut paletini açar. */
export function dispatchOpenPalette() {
  window.dispatchEvent(new CustomEvent('fraude-open-palette'));
}

/** Araştırma modülünü açar. */
export function dispatchOpenResearch() {
  window.dispatchEvent(new CustomEvent('fraude-open-research'));
}

/** Bir hisse için takım araştırması başlatır ve araştırma modülünü açar. */
export function dispatchResearchTicker(ticker: string) {
  window.dispatchEvent(new CustomEvent('fraude-research-ticker', { detail: { ticker } }));
}

/** Araştırma listesini yeniden çektirir (yeni iş gönderildikten sonra). */
export function dispatchResearchRefresh() {
  window.dispatchEvent(new CustomEvent('fraude-research-refresh'));
}
