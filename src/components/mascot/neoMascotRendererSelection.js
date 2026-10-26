export function resolveMascotRendererVariant(renderer, canvasFallback = false) {
  if (canvasFallback) return 'canvasFallback';
  return renderer === '2d' ? 'reference2d' : 'current3d';
}
