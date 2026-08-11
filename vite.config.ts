import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      //
      // Derleme çıktıları da yok sayılmalı. İzleyici proje kökünün tamamını
      // kapsıyor ve kökte 1,8 GB'lık bir `target/` var: her cargo derlemesi
      // yüzlerce dosya olayı üretiyor, vite bunu kaynak değişikliği sanıp
      // **sayfayı tam yeniden yüklüyordu** — çalışan uygulama kendiliğinden
      // refresh atıyor görünüyor. `.claude/worktrees` ise kökün içinde duran
      // ayrı bir çalışma kopyası (kendi `target/`'ıyla); orada yapılan bir
      // derleme de aynı yeniden yüklemeyi tetikliyordu.
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        "**/dist/**",
        "**/.claude/**",
      ],
    },
  },
}));
