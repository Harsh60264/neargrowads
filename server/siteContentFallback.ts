export async function resolveSiteContentState<T>(
  draft: T | undefined,
  published: T | undefined,
  readLegacy: () => Promise<T>,
): Promise<{ draft: T; published: T }> {
  if (draft !== undefined && published !== undefined) return { draft, published };

  const legacy = await readLegacy();
  return {
    draft: draft ?? published ?? legacy,
    published: published ?? legacy,
  };
}
