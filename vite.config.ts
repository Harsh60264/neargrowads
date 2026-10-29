import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { resolveSiteOrigin } from './server/siteOrigin.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredSiteUrl = env.SITE_URL || process.env.SITE_URL || '';
  const production = process.env.VERCEL_ENV === 'production';
  const siteOrigin = configuredSiteUrl || production
    ? resolveSiteOrigin(configuredSiteUrl || undefined, production)
    : '';
  return {
    plugins: [
      {
        name: 'configured-site-origin',
        transformIndexHtml(html) {
          return html.replaceAll('__SITE_ORIGIN__', siteOrigin);
        },
      },
      react(),
      tailwindcss(),
    ],
    define: {
      'import.meta.env.VITE_SITE_URL': JSON.stringify(siteOrigin),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'ui-vendor';
            }
            if (id.includes('node_modules/three')) {
              return 'visual-vendor';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
