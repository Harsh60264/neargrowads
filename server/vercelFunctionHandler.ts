import type { Express, Request, Response } from 'express';
import { createVercelApplication } from '../serverless-build/serverless-app.mjs';
import { getPreviewConfigurationVariable } from './adminOwnerConfig';

const ORIGINAL_API_PATH_PARAMETER = '__vercel_original_api_path';

let applicationPromise: Promise<Express> | undefined;

export function getVercelInitializationDiagnostic(error: unknown): {
  errorName: string;
  errorCategory: 'preview_configuration' | 'application_initialization';
  configurationVariable?: string;
} {
  const configurationVariable = getPreviewConfigurationVariable(error);
  if (configurationVariable) {
    return {
      errorName: 'PreviewConfigurationError',
      errorCategory: 'preview_configuration',
      configurationVariable,
    };
  }
  return {
    errorName: error instanceof Error ? 'Error' : 'UnknownError',
    errorCategory: 'application_initialization',
  };
}

export function restoreOriginalApiUrl(req: Pick<Request, 'url'>): boolean {
  const rewrittenUrl = new URL(req.url, 'http://vercel.internal');
  const originalApiPath = rewrittenUrl.searchParams.get(ORIGINAL_API_PATH_PARAMETER);
  if (!originalApiPath || !originalApiPath.startsWith('/api/') ||
    originalApiPath.includes('?') || originalApiPath.includes('#')) return false;

  const queryStart = req.url.indexOf('?');
  if (queryStart === -1) return false;
  const originalQuery = req.url.slice(queryStart + 1).split('&').filter((parameter) => {
    const rawKey = parameter.split('=', 1)[0] || '';
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      return true;
    }
    return key !== ORIGINAL_API_PATH_PARAMETER;
  });

  req.url = `${originalApiPath}${originalQuery.length ? `?${originalQuery.join('&')}` : ''}`;
  return true;
}

export async function vercelFunctionHandler(req: Request, res: Response): Promise<void> {
  if (!restoreOriginalApiUrl(req)) {
    res.status(404).json({ message: 'This API endpoint was not found.' });
    return;
  }

  try {
    applicationPromise ??= createVercelApplication();
    const app = await applicationPromise;
    app(req, res);
  } catch (error) {
    console.error('[NearGrow Ads] Vercel API initialization failed.', {
      ...getVercelInitializationDiagnostic(error),
    });
    if (!res.headersSent) {
      res.status(503).json({ message: 'The API is temporarily unavailable.' });
    }
  }
}
