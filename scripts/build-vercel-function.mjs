import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'serverless-build');
const applicationBundle = path.join(outputDirectory, 'serverless-app.mjs');
const functionBundle = path.join(outputDirectory, 'vercel-function.mjs');
const buildOptions = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  legalComments: 'none',
  metafile: true,
};

const applicationResult = await build({
  ...buildOptions,
  entryPoints: [path.join(root, 'server.ts')],
  outfile: applicationBundle,
});

function assertNoUnresolvedLocalImports(result, bundleName) {
  const bundledOutput = Object.values(result.metafile.outputs).find((output) => output.entryPoint);
  const unresolvedLocalImports = bundledOutput?.imports.filter((item) =>
    item.path.startsWith('.') || item.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item.path),
  ) ?? [];
  if (unresolvedLocalImports.length) {
    throw new Error(
      `${bundleName} contains unresolved local imports: ${unresolvedLocalImports.map((item) => item.path).join(', ')}`,
    );
  }
  return bundledOutput;
}

const applicationOutput = assertNoUnresolvedLocalImports(applicationResult, 'Application bundle');
const eagerViteImports = applicationOutput?.imports.filter((item) =>
  item.path === 'vite' && item.kind !== 'dynamic-import',
) ?? [];
if (eagerViteImports.length) {
  throw new Error('Vite must remain a lazy development-only import in the Vercel Function bundle.');
}

const functionResult = await build({
  ...buildOptions,
  entryPoints: [path.join(root, 'server', 'vercelFunctionHandler.ts')],
  outfile: functionBundle,
});
assertNoUnresolvedLocalImports(functionResult, 'Vercel handler bundle');

console.log(`Bundled Vercel Function for Node.js 22: ${path.relative(root, functionBundle)}`);
