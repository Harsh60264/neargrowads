import type { RequestHandler } from 'express';

export const PARTNER_AUTH_PAGE_PATHS = [
  '/partners/portal-preview',
  '/partners/dashboard',
  '/partners/recovery',
  '/partners/register',
  '/partners/login',
] as const;

const partnerAuthPagePaths = new Set<string>(PARTNER_AUTH_PAGE_PATHS);

export const PUBLIC_DYNAMIC_PAGE_ROUTE_PATTERNS = [
  '/partners/localdrop',
  ...PARTNER_AUTH_PAGE_PATHS,
  '/services/*',
  '/catalogue/*',
  '/blog/*',
] as const;

export interface RenderedPublicDynamicPage {
  found: boolean;
  html: string;
}

export function isPublicDynamicPagePath(pathname: string): boolean {
  return pathname === '/partners/localdrop' || partnerAuthPagePaths.has(pathname) ||
    /^\/(?:services|catalogue|blog)\/.+$/.test(pathname);
}

export function createPublicDynamicPageHandler(
  renderPage: (pathname: string) => Promise<RenderedPublicDynamicPage>,
): RequestHandler {
  return async (request, response): Promise<void> => {
    try {
      const page = await renderPage(request.path);
      response.status(page.found ? 200 : 404).type('html').send(page.html);
    } catch (error) {
      console.error('[NearGrow Ads] Public dynamic page could not be resolved.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      response.status(503).type('text/plain').send('The requested page is temporarily unavailable.');
    }
  };
}
