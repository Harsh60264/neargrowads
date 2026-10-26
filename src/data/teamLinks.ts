export function normalizeTeamUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 300 || /\s/.test(trimmed)) return null;

  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  if (!hasHttpScheme && trimmed.startsWith('//')) return null;
  if (
    !hasHttpScheme &&
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) &&
    !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/i.test(trimmed)
  ) return null;
  const candidate = hasHttpScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    if (!hasHttpScheme && !parsed.hostname.includes('.')) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function teamUrlKind(value: string): 'linkedin' | 'web' | 'none' {
  const normalized = normalizeTeamUrl(value);
  if (!normalized) return 'none';
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com') ? 'linkedin' : 'web';
  } catch {
    return 'none';
  }
}
