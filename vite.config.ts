import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function regionHtmlPlugin() {
  return {
    name: 'region-html-metadata',
    transformIndexHtml(html: string) {
      const regionsCfgPath = path.resolve(import.meta.dirname, 'regions.config.json');
      const singleCfgPath = path.resolve(import.meta.dirname, 'region.config.json');
      try {
        let brandName = 'Peta Alur Air';
        let brandTagline = 'Topografi, Drainase & Aliran Hujan';
        let regionNames: string[] = [];

        if (fs.existsSync(regionsCfgPath)) {
          const manifest = JSON.parse(fs.readFileSync(regionsCfgPath, 'utf8'));
          brandName = manifest.appBrand?.name || brandName;
          brandTagline = manifest.appBrand?.tagline?.id || brandTagline;
          if (Array.isArray(manifest.regions)) {
            regionNames = manifest.regions.map((r: { name?: string }) => r.name).filter(Boolean) as string[];
          }
        } else if (fs.existsSync(singleCfgPath)) {
          const cfg = JSON.parse(fs.readFileSync(singleCfgPath, 'utf8'));
          if (cfg.name) regionNames = [cfg.name];
        }

        const escapeHtml = (s: string) =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const title = `${escapeHtml(brandName)} — ${escapeHtml(brandTagline)}`;
        const regionSummary =
          regionNames.length > 0 ? ` (${regionNames.join(', ')})` : '';
        const desc = `${brandName} — portal data spasial terbuka${regionSummary} untuk menampilkan kontur & topografi DEM, jenis tanah, jaringan sungai, inventaris drainase/gorong-gorong, serta simulasi aliran hujan.`;

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
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'maplibre',
              test: /node_modules[\\/]maplibre-gl/
            }
          ]
        }
      }
    }
  }
});
