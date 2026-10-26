import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredSiteUrl = env.SITE_URL || process.env.SITE_URL || '';
  let siteOrigin = '';
  if (configuredSiteUrl) {
    const parsedSiteUrl = new URL(configuredSiteUrl);
    if ((parsedSiteUrl.protocol !== 'https:' && parsedSiteUrl.hostname !== 'localhost') ||
      parsedSiteUrl.username || parsedSiteUrl.password || parsedSiteUrl.pathname !== '/' ||
      parsedSiteUrl.search || parsedSiteUrl.hash) {
      throw new Error('SITE_URL must be the canonical HTTPS origin without a path, query or fragment.');
    }
    siteOrigin = parsedSiteUrl.origin;
  }
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
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
