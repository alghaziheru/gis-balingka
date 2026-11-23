import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function regionHtmlPlugin() {
  return {
    name: 'region-html-metadata',
    transformIndexHtml(html: string) {
      const cfgPath = path.resolve(import.meta.dirname, 'region.config.json');
      if (!fs.existsSync(cfgPath)) return html;
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const appTitle = cfg.appTitle?.id || `Peta ${cfg.name || 'Wilayah'}`;
        const regionName = cfg.name || 'Wilayah';
        const loc = [cfg.district, cfg.regency].filter(Boolean).join(', ');
        const title = `${appTitle} — Portal Data Spasial Topografi &amp; Drainase`;
        const desc = `Portal data spasial terbuka ${regionName}${loc ? ` (${loc})` : ''} untuk menampilkan jaringan sungai, inventaris drainase/gorong-gorong, topografi DEM, dan simulasi model aliran.`;
        return html
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
          .replace(
            /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
            `<meta\n      name="description"\n      content="${desc.replace(/"/g, '&quot;')}"\n    />`
          );
      } catch {
        return html;
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), regionHtmlPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  }
});
