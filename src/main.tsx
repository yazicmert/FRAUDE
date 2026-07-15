import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";

// Yakalanmayan hatalar beyaz ekran yerine okunur biçimde gösterilir;
// WebView'de devtools kapalıyken teşhis ancak böyle mümkün olur.
function showFatalError(message: string) {
  const root = document.getElementById("root");
  if (!root || root.querySelector("[data-fatal-error]")) return;
  const box = document.createElement("pre");
  box.setAttribute("data-fatal-error", "1");
  box.style.cssText =
    "position:fixed;top:12px;left:12px;right:12px;z-index:99999;background:#2d0f12;color:#ff7b72;" +
    "border:1px solid #f85149;border-radius:8px;padding:14px;font-size:12px;white-space:pre-wrap;" +
    "max-height:60vh;overflow:auto;font-family:monospace;";
  box.textContent = `Uygulama hatası:\n${message}`;
  root.appendChild(box);
}

window.addEventListener("error", (event) => {
  showFatalError(event.error?.stack ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  showFatalError(String(event.reason?.stack ?? event.reason));
});

// React render-fazı hataları window.onerror'a düşmez; ErrorBoundary olmadan
// ağaç sessizce sökülür ve beyaz ekran kalır. Boundary hatayı yakalayıp aynı
// okunur kutuda (showFatalError) bileşen iziyle birlikte gösterir.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    showFatalError(`${error?.stack ?? error?.message ?? String(error)}\n\nBileşen izi:${info?.componentStack ?? ""}`);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
