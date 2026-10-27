import type { Express, Request, Response } from 'express';
import { createVercelApplication } from '../serverless-build/serverless-app.mjs';

let applicationPromise: Promise<Express> | undefined;

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    applicationPromise ??= createVercelApplication();
    const app = await applicationPromise;
    app(req, res);
  } catch (error) {
    console.error('[NearGrow Ads] Vercel API initialization failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    if (!res.headersSent) {
      res.status(503).json({ message: 'The API is temporarily unavailable.' });
    }
  }
}
