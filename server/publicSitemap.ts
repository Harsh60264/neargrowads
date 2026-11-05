import type { RequestHandler } from 'express';
import { validServiceCatalogueSlug } from '../src/data/serviceCatalogueCategories';

export interface SitemapContentItem {
  slug: string;
  status: string;
  lastModified?: string | null;
}

export interface PublicSitemapContent {
  siteContentPublishedAt?: string | null;
  services: readonly SitemapContentItem[];
  articles: readonly SitemapContentItem[];
  packages: readonly SitemapContentItem[];
}

const PUBLIC_PAGE_PATHS = [
  '/',
  '/services',
  '/catalogue',
  '/work',
  '/about',
  '/blog',
  '/contact',
  '/get-started',
] as const;

const CONTENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] || character);
}

function sitemapDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function canonicalOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.pathname !== '/') {
    throw new Error('The sitemap origin must be a canonical HTTPS origin.');
  }
  return parsed.origin;
}

export function buildPublicSitemapXml(origin: string, content: PublicSitemapContent): string {
  const siteOrigin = canonicalOrigin(origin);
  const urls = new Map<string, string | undefined>();
  const siteLastModified = sitemapDate(content.siteContentPublishedAt);

  for (const pathname of PUBLIC_PAGE_PATHS) {
    urls.set(pathname, siteLastModified);
  }
  for (const service of content.services) {
    if (service.status === 'published' && CONTENT_SLUG.test(service.slug)) {
      urls.set(`/services/${service.slug}`, sitemapDate(service.lastModified));
    }
  }
  for (const article of content.articles) {
    if (article.status === 'published' && CONTENT_SLUG.test(article.slug)) {
      urls.set(`/blog/${article.slug}`, sitemapDate(article.lastModified));
    }
  }
  for (const item of content.packages) {
    if (item.status === 'published' && validServiceCatalogueSlug(item.slug)) {
      urls.set(`/catalogue/${item.slug}`, sitemapDate(item.lastModified));
    }
  }

  const entries = [...urls].map(([pathname, lastModified]) => {
    const loc = escapeXml(`${siteOrigin}${pathname === '/' ? '/' : pathname}`);
    const lastmod = lastModified ? `\n    <lastmod>${lastModified}</lastmod>` : '';
    return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`;
}

export function createPublicSitemapHandler(
  loadContent: () => Promise<PublicSitemapContent>,
  origin: string,
): RequestHandler {
  return async (_request, response): Promise<void> => {
    try {
      const content = await loadContent();
      const xml = buildPublicSitemapXml(origin, content);
      response.setHeader('Cache-Control', 'public, max-age=300');
      response.status(200).type('application/xml').send(xml);
    } catch (error) {
      console.error('[NearGrow Ads] Published-content sitemap could not be generated.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      response.status(503).type('text/plain').send('The sitemap is temporarily unavailable.');
    }
  };
}
