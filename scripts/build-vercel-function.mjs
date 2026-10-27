import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'serverless-build', 'serverless-app.mjs');
const result = await build({
  entryPoints: [path.join(root, 'server.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  legalComments: 'none',
  metafile: true,
});

const bundledOutput = Object.values(result.metafile.outputs).find((output) => output.entryPoint);
const unresolvedLocalImports = bundledOutput?.imports.filter((item) =>
  item.path.startsWith('.') || item.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item.path),
) ?? [];
if (unresolvedLocalImports.length) {
  throw new Error(`Function bundle contains unresolved local imports: ${unresolvedLocalImports.map((item) => item.path).join(', ')}`);
}
const eagerViteImports = bundledOutput?.imports.filter((item) =>
  item.path === 'vite' && item.kind !== 'dynamic-import',
) ?? [];
if (eagerViteImports.length) {
  throw new Error('Vite must remain a lazy development-only import in the Vercel Function bundle.');
}

console.log(`Bundled Express Function for Node.js 22: ${path.relative(root, outfile)}`);
