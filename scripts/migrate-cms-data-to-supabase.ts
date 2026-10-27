import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const bucket = 'cms-uploads';
const documentFiles = [
  ['blog-posts', 'blog-posts.json'],
  ['blog-categories', 'blog-categories.json'],
  ['blog-seo-health', 'blog-seo-health.json'],
  ['site-content', 'site-content.json'],
  ['team', 'team.json'],
] as const;
const uploadFolders = ['blog', 'team', 'service-store'] as const;
const mimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function requestSupabase(baseUrl: string, serviceKey: string, pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/${pathname.replace(/^\/+/, '')}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(300_000),
  });
}

async function main() {
  const rawUrl = requiredEnvironment('SUPABASE_URL');
  const serviceKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password ||
    parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS project origin without credentials or a path.');
  }
  const baseUrl = parsedUrl.origin;
  const root = process.cwd();
  const uploads: Array<{ folder: string; filename: string; fullPath: string; mimeType: string }> = [];
  for (const folder of uploadFolders) {
    const directory = path.join(root, 'data', 'uploads', folder);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const extension = path.extname(entry.name).slice(1).toLowerCase();
      if (!entry.isFile() || !mimeTypes[extension] || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(entry.name)) {
        throw new Error(`Unsupported file found in data/uploads/${folder}; review it before migrating.`);
      }
      uploads.push({
        folder,
        filename: entry.name,
        fullPath: path.join(directory, entry.name),
        mimeType: mimeTypes[extension],
      });
    }
  }

  let uploaded = 0;
  let alreadyPresent = 0;
  for (const asset of uploads) {
    const objectPath = `${asset.folder}/${asset.filename}`;
    const response = await requestSupabase(baseUrl, serviceKey, `storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: { 'Content-Type': asset.mimeType, 'x-upsert': 'false' },
      body: await readFile(asset.fullPath),
    });
    if (response.ok) {
      uploaded += 1;
      continue;
    }
    if (response.status === 409) {
      const existing = await requestSupabase(baseUrl, serviceKey, `storage/v1/object/${bucket}/${objectPath}`, {
        method: 'HEAD',
      });
      if (existing.ok) {
        alreadyPresent += 1;
        continue;
      }
    }
    throw new Error(`Supabase Storage upload failed for a CMS asset (${response.status}).`);
  }

  let insertedDocuments = 0;
  for (const [key, filename] of documentFiles) {
    const documentValue = JSON.parse(await readFile(path.join(root, 'data', filename), 'utf8')) as unknown;
    const response = await requestSupabase(baseUrl, serviceKey, 'rest/v1/serverless_cms_documents?on_conflict=document_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({ document_key: key, document_value: documentValue }),
    });
    if (!response.ok) {
      throw new Error(`Supabase CMS document import failed for ${key} (${response.status}).`);
    }
    const inserted = await response.json() as Array<{ document_key: string }>;
    if (inserted.some((row) => row.document_key === key)) insertedDocuments += 1;
  }

  console.log(`CMS migration complete: ${uploaded} assets uploaded, ${alreadyPresent} already present, ${insertedDocuments} documents inserted.`);
  console.log('Existing Supabase document rows were preserved; no database rows or assets were deleted.');
}

main().catch((error: unknown) => {
  console.error('[NearGrow Ads] CMS migration failed:', error instanceof Error ? error.message : 'Unknown error.');
  process.exitCode = 1;
});
