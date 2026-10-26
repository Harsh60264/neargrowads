export interface LeadTracking {
  sourcePage: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
const storagePrefix = 'neargrow-first-touch-';

export function captureFirstTouchCampaign(search: string): void {
  const params = new URLSearchParams(search);
  for (const key of campaignKeys) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    try {
      const storageKey = `${storagePrefix}${key}`;
      if (!window.sessionStorage.getItem(storageKey)) {
        window.sessionStorage.setItem(storageKey, value.slice(0, 100));
      }
    } catch {
      // Attribution is best-effort and contains no contact details.
    }
  }
}

export function getLeadTracking(sourcePage: string, search: string): LeadTracking {
  const params = new URLSearchParams(search);
  const values = campaignKeys.map((key) => {
    const currentValue = params.get(key)?.trim();
    if (currentValue) return currentValue.slice(0, 100);
    try {
      return window.sessionStorage.getItem(`${storagePrefix}${key}`) || undefined;
    } catch {
      return undefined;
    }
  });
  return {
    sourcePage,
    ...(values[0] ? { utmSource: values[0] } : {}),
    ...(values[1] ? { utmMedium: values[1] } : {}),
    ...(values[2] ? { utmCampaign: values[2] } : {}),
  };
}
