export function isSameOriginHost(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin || !requestHost) return false;
  try {
    const parsedOrigin = new URL(origin);
    return (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
      parsedOrigin.host === requestHost;
  } catch {
    return false;
  }
}
