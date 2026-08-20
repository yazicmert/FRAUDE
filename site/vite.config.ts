import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { prerender } from './scripts/prerender';

export default defineConfig({
  plugins: [react(), prerender()],
  build: {
    // Bir tanıtım sayfası için 500 kB uyarısı fazla cömert; eşiği düşük tutmak
    // paketin sessizce şişmesini engelliyor.
    chunkSizeWarningLimit: 260,
  },
});
