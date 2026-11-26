import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import test from 'node:test';
import {
  createPublicDynamicPageHandler,
  isPublicDynamicPagePath,
  PUBLIC_DYNAMIC_PAGE_ROUTE_PATTERNS,
} from './publicDynamicPages';

test('configures exact 301 redirects and validates dynamic routes before SPA fallbacks', async () => {
  const config = JSON.parse(await readFile(`${process.cwd()}/vercel.json`, 'utf8')) as {
    redirects: { source: string; destination: string; statusCode: number }[];
    functions: Record<string, { includeFiles: string }>;
    rewrites: { source: string; destination: string }[];
  };

  assert.deepEqual(config.redirects, [
    { source: '/google-ads-delhi', destination: '/services/google-ads', statusCode: 301 },
    { source: '/catalogue/gmb-audit', destination: '/gmb-audit', statusCode: 301 },
    { source: '/catalogue/gmb-audit/', destination: '/gmb-audit', statusCode: 301 },
    { source: '/catalogue/https-www-neargrowads-com-gmb-audit', destination: '/gmb-audit', statusCode: 301 },
    { source: '/catalogue/https-www-neargrowads-com-gmb-audit/', destination: '/gmb-audit', statusCode: 301 },
    { source: '/gmb-audit/', destination: '/gmb-audit', statusCode: 301 },
  ]);
  assert.equal(config.functions['api/handler.ts']?.includeFiles, 'dist/index.html');

  const routes = new Map(config.rewrites.map((rewrite, index) => [rewrite.source, { ...rewrite, index }]));
  assert.equal(routes.get('/services')?.destination, '/index.html');
  assert.equal(routes.get('/catalogue')?.destination, '/index.html');
  assert.equal(routes.get('/blog')?.destination, '/index.html');
  assert.equal(routes.get('/api/:path*')?.destination,
    '/api/handler?__vercel_original_api_path=/api/:path*');
  assert.equal(routes.get('/gmb-audit')?.destination,
    '/api/handler?__vercel_original_api_path=/gmb-audit');
  assert.equal(routes.get('/admin')?.destination, '/index.html');
  assert.equal(routes.get('/admin/:path*')?.destination, '/index.html');

  for (const prefix of ['/services', '/catalogue', '/blog']) {
    const rootRoute = routes.get(prefix);
    const dynamicRoute = routes.get(`${prefix}/:path*`);
    assert.ok(rootRoute && dynamicRoute);
    assert.ok(rootRoute.index < dynamicRoute.index);
    assert.equal(dynamicRoute.destination, `/api/handler?__vercel_original_api_path=${prefix}/:path*`);
  }
  assert.deepEqual(routes.get('/sitemap.xml')?.destination,
    '/api/handler?__vercel_original_api_path=/sitemap.xml');
  assert.deepEqual(routes.get('/partners/localdrop')?.destination,
    '/api/handler?__vercel_original_api_path=/partners/localdrop');
  const serviceCatchAll = routes.get('/services/:path*');
  assert.ok(serviceCatchAll);
  for (const pathname of [
    '/partners/portal-preview',
    '/partners/dashboard',
    '/partners/recovery',
    '/partners/register',
    '/partners/login',
  ]) {
    const route = routes.get(pathname);
    assert.ok(route);
    assert.equal(route.destination, `/api/handler?__vercel_original_api_path=${pathname}`);
    assert.ok(route.index < serviceCatchAll.index);
  }
});

test('matches only routes inside the public dynamic page families', () => {
  for (const pathname of [
    '/partners/localdrop',
    '/partners/portal-preview',
    '/partners/dashboard',
    '/partners/recovery',
    '/partners/register',
    '/partners/login',
    '/services/slug',
    '/services/slug/child',
    '/catalogue/slug',
    '/blog/slug',
    '/gmb-audit',
  ]) {
    assert.equal(isPublicDynamicPagePath(pathname), true);
  }
  for (const pathname of ['/partners', '/partners/other', '/services', '/services/', '/hi', '/admin/slug', '/sitemap.xml']) {
    assert.equal(isPublicDynamicPagePath(pathname), false);
  }
});

test('routes all public dynamic families through a status-aware page handler', async (context) => {
  const app = express();
  const renderedPaths: string[] = [];
  app.get([...PUBLIC_DYNAMIC_PAGE_ROUTE_PATTERNS], createPublicDynamicPageHandler(async (pathname) => {
    renderedPaths.push(pathname);
    return { found: true, html: '<!doctype html><div id="root"></div>' };
  }));
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

  for (const pathname of [
    '/partners/localdrop',
    '/partners/portal-preview',
    '/partners/dashboard',
    '/partners/recovery',
    '/partners/register',
    '/partners/login',
    '/services/service-slug',
    '/catalogue/package-slug',
    '/blog/article-slug',
    '/gmb-audit',
  ]) {
    const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}${pathname}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="root"/);
  }
  assert.deepEqual(renderedPaths, [
    '/partners/localdrop',
    '/partners/portal-preview',
    '/partners/dashboard',
    '/partners/recovery',
    '/partners/register',
    '/partners/login',
    '/services/service-slug',
    '/catalogue/package-slug',
    '/blog/article-slug',
    '/gmb-audit',
  ]);
});

test('returns 404 only when content resolution succeeds and finds no page', async (context) => {
  const app = express();
  app.get('/services/*', createPublicDynamicPageHandler(async () => ({
    found: false,
    html: '<!doctype html><title>Page Not Found</title>',
  })));
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

  const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}/services/missing`);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Page Not Found/);
});

test('returns 503 instead of a false 404 when content resolution fails', async (context) => {
  const app = express();
  app.get('/blog/*', createPublicDynamicPageHandler(async () => {
    throw new Error('Temporary CMS outage');
  }));
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

  const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}/blog/article`);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'The requested page is temporarily unavailable.');
});
