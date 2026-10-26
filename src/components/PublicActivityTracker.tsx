import { useEffect } from 'react';

const VISITOR_STORAGE_KEY = 'neargrow-anonymous-visitor';
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_ID_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECENT_ACTIVITY_WINDOW_MS = 2 * 60_000;
const MINIMUM_SEND_INTERVAL_MS = 5_500;

const lastSentByVisitor = new Map<string, number>();

function newVisitorId(): string | undefined {
  if (!window.crypto?.getRandomValues) return undefined;
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getVisitorId(): Promise<string | undefined> {
  const readOrCreate = (): string | undefined => {
    try {
      const saved = window.localStorage.getItem(VISITOR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { id?: unknown; expiresAt?: unknown };
        if (typeof parsed.id === 'string' && VISITOR_ID_PATTERN.test(parsed.id) &&
          typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) return parsed.id;
      }
      const id = newVisitorId();
      if (!id) return undefined;
      window.localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify({
        id,
        expiresAt: Date.now() + VISITOR_ID_TTL_MS,
      }));
      return id;
    } catch {
      return undefined;
    }
  };
  if (!navigator.locks) return readOrCreate();
  try {
    return await navigator.locks.request(VISITOR_STORAGE_KEY, readOrCreate);
  } catch {
    return undefined;
  }
}

export function PublicActivityTracker({
  pathname,
  enabled,
}: {
  pathname: string;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled || pathname.startsWith('/admin')) return;
    let visitorId: string | undefined;
    let lastInteractionAt = Date.now();
    let heartbeatInProgress = false;
    let active = true;
    let retryTimeout: number | undefined;
    const route = pathname || '/';

    const sendHeartbeat = async () => {
      if (!active || heartbeatInProgress || document.visibilityState !== 'visible' ||
        Date.now() - lastInteractionAt > RECENT_ACTIVITY_WINDOW_MS) return;
      heartbeatInProgress = true;
      try {
        visitorId ||= await getVisitorId();
        if (!active || !visitorId || document.visibilityState !== 'visible' ||
          Date.now() - lastInteractionAt > RECENT_ACTIVITY_WINDOW_MS) return;
        const now = Date.now();
        const lastSent = lastSentByVisitor.get(visitorId) || 0;
        if (now - lastSent < MINIMUM_SEND_INTERVAL_MS) {
          if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
          retryTimeout = window.setTimeout(() => {
            retryTimeout = undefined;
            void sendHeartbeat();
          }, MINIMUM_SEND_INTERVAL_MS - (now - lastSent));
          return;
        }
        lastSentByVisitor.set(visitorId, now);
        if (lastSentByVisitor.size > 1000) {
          const oldestId = lastSentByVisitor.keys().next().value;
          if (oldestId) lastSentByVisitor.delete(oldestId);
        }
        await fetch('/api/website-activity', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId, path: route }),
          keepalive: true,
        }).catch(() => undefined);
      } finally {
        heartbeatInProgress = false;
      }
    };

    const markInteraction = () => {
      lastInteractionAt = Date.now();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void sendHeartbeat();
    };

    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('scroll', markInteraction, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);
    void sendHeartbeat();
    const interval = window.setInterval(() => { void sendHeartbeat(); }, HEARTBEAT_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('scroll', markInteraction);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, pathname]);

  return null;
}
