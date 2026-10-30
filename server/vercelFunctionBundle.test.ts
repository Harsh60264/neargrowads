import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionBundle = path.join(root, 'serverless-build', 'vercel-function.mjs');

test('builds and loads the self-contained Vercel handler bundle under the current Node runtime', async () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-vercel-function.mjs')], {
    cwd: root,
    stdio: 'pipe',
  });

  await access(functionBundle);
  const moduleUrl = `${pathToFileURL(functionBundle).href}?test=${Date.now()}`;
  const handlerModule: unknown = await import(moduleUrl);

  assert.equal(typeof handlerModule, 'object');
  assert.notEqual(handlerModule, null);
  assert.equal(
    typeof (handlerModule as { vercelFunctionHandler?: unknown }).vercelFunctionHandler,
    'function',
    'generated Vercel handler bundle must expose its request handler',
  );
});
