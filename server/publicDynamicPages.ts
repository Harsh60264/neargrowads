import type { RequestHandler } from 'express';

export const PUBLIC_DYNAMIC_PAGE_ROUTE_PATTERNS = [
  '/services/*',
  '/catalogue/*',
  '/blog/*',
] as const;

export interface RenderedPublicDynamicPage {
  found: boolean;
  html: string;
}

export function isPublicDynamicPagePath(pathname: string): boolean {
  return /^\/(?:services|catalogue|blog)\/.+$/.test(pathname);
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
