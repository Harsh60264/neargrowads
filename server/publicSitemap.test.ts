import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import test from 'node:test';
import { buildPublicSitemapXml, createPublicSitemapHandler } from './publicSitemap';
import { publicCataloguePackages } from '../src/data/serviceCatalogueCategories';
import type { ServiceCatalogueCategory, ServicePackage } from '../src/data/serviceCatalogue';

const canonicalOrigin = 'https://www.neargrowads.com';
const modifiedAt = '2026-10-28T15:24:31.000Z';

test('includes indexable core pages and published content using the canonical host', () => {
  const xml = buildPublicSitemapXml(canonicalOrigin, {
    siteContentPublishedAt: modifiedAt,
    services: [
      { slug: 'local-seo', status: 'published', lastModified: modifiedAt },
      { slug: 'unreleased-service', status: 'draft', lastModified: modifiedAt },
      { slug: 'invalid/service', status: 'published', lastModified: modifiedAt },
    ],
    articles: [
      { slug: 'published-article', status: 'published', lastModified: modifiedAt },
      { slug: 'draft-article', status: 'draft', lastModified: modifiedAt },
    ],
    packages: [
      { slug: 'published-package', status: 'published', lastModified: modifiedAt },
      { slug: 'hidden-package', status: 'draft', lastModified: modifiedAt },
      { slug: 'checkout', status: 'published', lastModified: modifiedAt },
    ],
  });
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(locs.includes(`${canonicalOrigin}/`));
  assert.ok(locs.includes(`${canonicalOrigin}/get-started`));
  assert.ok(locs.includes(`${canonicalOrigin}/services/local-seo`));
  assert.ok(locs.includes(`${canonicalOrigin}/blog/published-article`));
  assert.ok(locs.includes(`${canonicalOrigin}/catalogue/published-package`));
  assert.ok(locs.every((loc) => loc.startsWith(`${canonicalOrigin}/`)));
  assert.ok(!xml.includes('staging.neargrowads.com'));
  assert.ok(!xml.includes('neargrowads.com/services/unreleased-service'));
  assert.ok(!xml.includes('invalid/service'));
  assert.ok(!xml.includes('draft-article'));
  assert.ok(!xml.includes('hidden-package'));
  assert.ok(!xml.includes('/catalogue/checkout'));
  assert.ok(!xml.includes('/admin'));
  assert.ok(!xml.includes('/thank-you'));
  assert.ok(!xml.includes('/privacy-policy'));
  assert.ok(xml.includes(`<lastmod>${modifiedAt}</lastmod>`));
});

test('omits missing or invalid lastmod instead of inventing a timestamp', () => {
  const xml = buildPublicSitemapXml(canonicalOrigin, {
    siteContentPublishedAt: null,
    services: [{ slug: 'no-timestamp', status: 'published', lastModified: 'not-a-date' }],
    articles: [],
    packages: [],
  });
  const serviceEntry = xml.match(new RegExp(`<url>\\s*<loc>${canonicalOrigin}/services/no-timestamp</loc>[\\s\\S]*?<\\/url>`));

  assert.ok(serviceEntry);
  assert.ok(!serviceEntry[0].includes('<lastmod>'));
  assert.ok(!xml.includes('<lastmod>'));
});

test('excludes packages in inactive or hidden catalogue categories', () => {
  const visibleCategory: ServiceCatalogueCategory = {
    id: 'visible',
    name: 'Visible',
    slug: 'visible',
    description: '',
    displayOrder: 1,
    active: true,
    showInCatalogue: true,
  };
  const hiddenCategory: ServiceCatalogueCategory = {
    ...visibleCategory,
    id: 'hidden',
    active: false,
  };
  const packageBase: ServicePackage = {
    id: 'visible-package',
    slug: 'visible-package',
    packageCode: '',
    title: 'Package',
    category: visibleCategory.name,
    categoryId: visibleCategory.id,
    packageKind: 'service',
    summary: '',
    description: '',
    priceInr: 100,
    discountedPriceInr: null,
    billingType: 'one_time',
    imageUrl: '',
    deliverables: [],
    exclusions: [],
    clientRequirements: [],
    targetAudience: '',
    deliveryTimeline: '',
    faqs: [],
    featured: false,
    catalogueBadge: null,
    quantitySupported: false,
    status: 'published',
    updatedAt: modifiedAt,
  };
  const publicPackages = publicCataloguePackages([
    packageBase,
    { ...packageBase, id: 'hidden-package', slug: 'hidden-package', categoryId: hiddenCategory.id },
  ], [visibleCategory, hiddenCategory]);
  const xml = buildPublicSitemapXml(canonicalOrigin, {
    services: [],
    articles: [],
    packages: publicPackages.map(({ slug, status, updatedAt }) => ({
      slug,
      status,
      lastModified: updatedAt,
    })),
  });

  assert.ok(xml.includes(`${canonicalOrigin}/catalogue/visible-package`));
  assert.ok(!xml.includes('hidden-package'));
});

test('serves a 200 XML response from published data through the sitemap handler', async (context) => {
  const app = express();
  app.get('/sitemap.xml', createPublicSitemapHandler(async () => ({
    siteContentPublishedAt: modifiedAt,
    services: [],
    articles: [{ slug: 'live-article', status: 'published', lastModified: modifiedAt }],
    packages: [],
  }), canonicalOrigin));
  const server = app.listen(0, '127.0.0.1');
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/sitemap.xml`);
  const xml = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/xml(?:;\s*charset=utf-8)?$/i);
  assert.ok(xml.includes(`${canonicalOrigin}/blog/live-article`));
});

test('Vercel routes sitemap requests to the server function and robots references the canonical sitemap', async () => {
  const root = process.cwd();
  const [config, robots] = await Promise.all([
    readFile(`${root}/vercel.json`, 'utf8').then((value) => JSON.parse(value) as {
      rewrites: Array<{ source: string; destination: string }>;
    }),
    readFile(`${root}/public/robots.txt`, 'utf8'),
  ]);
  const sitemapRewrite = config.rewrites.find((rewrite) => rewrite.source === '/sitemap.xml');

  assert.deepEqual(sitemapRewrite, {
    source: '/sitemap.xml',
    destination: '/api/handler?__vercel_original_api_path=/sitemap.xml',
  });
  assert.match(robots, /^Sitemap: https:\/\/www\.neargrowads\.com\/sitemap\.xml$/m);
  assert.ok(!robots.includes('https://neargrowads.com/sitemap.xml'));
});
