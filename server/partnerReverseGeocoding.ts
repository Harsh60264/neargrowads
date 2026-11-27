interface NominatimResponse {
  address?: Record<string, unknown>;
}

export class ReverseGeocodeError extends Error {
  constructor(message: string, readonly status: 429 | 502 | 504 = 502) {
    super(message);
    this.name = 'ReverseGeocodeError';
  }
}

function component(address: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = address[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function formatReverseGeocodedAddress(address: Record<string, unknown>): string {
  const building = component(address, 'building', 'house_name', 'house_number');
  const street = component(address, 'road', 'pedestrian', 'footway', 'path', 'residential');
  const locality = component(address, 'neighbourhood', 'suburb', 'city_district', 'quarter', 'hamlet');
  const city = component(address, 'city', 'town', 'village', 'municipality');
  const district = component(address, 'county', 'state_district');
  const state = component(address, 'state');
  const postalCode = component(address, 'postcode');
  const country = component(address, 'country');
  const values = [building, street, locality, city, district, state, postalCode, country]
    .map((value) => value.trim())
    .filter((value, index, list) => value && list.indexOf(value) === index);
  return values.join(', ');
}

export class PartnerReverseGeocoding {
  private readonly partnerRequests = new Map<string, number[]>();
  private readonly cache = new Map<string, { address: string; expiresAt: number }>();
  private lastProviderRequestAt = 0;
  private providerQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly delay: (milliseconds: number) => Promise<void> =
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly reserveProviderSlot: () => Promise<void> = async () => undefined,
  ) {}

  async reverse(partnerId: string, latitude: number, longitude: number): Promise<string> {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ReverseGeocodeError('The requested location coordinates are invalid.', 502);
    }

    const now = this.now();
    const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.address;
    this.cache.delete(cacheKey);

    const recent = (this.partnerRequests.get(partnerId) || []).filter((timestamp) => now - timestamp < 5 * 60_000);
    if (recent.length >= 4) {
      this.partnerRequests.set(partnerId, recent);
      throw new ReverseGeocodeError('Location lookup is temporarily rate-limited. Wait before retrying.', 429);
    }
    recent.push(now);
    this.partnerRequests.set(partnerId, recent);

    let releaseQueue!: () => void;
    const previousQueue = this.providerQueue;
    this.providerQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
    await previousQueue;
    try {
      const waitMs = Math.max(0, 1100 - (this.now() - this.lastProviderRequestAt));
      if (waitMs) await this.delay(waitMs);
      await this.reserveProviderSlot();
      this.lastProviderRequestAt = this.now();

      let response: Response;
      try {
        response = await this.fetcher(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
          {
            headers: {
              Accept: 'application/json',
              'Accept-Language': 'en',
              'User-Agent': 'NearGrowAds-PartnerWorkspace/1.0 (info@neargrowads.in)',
            },
            signal: AbortSignal.timeout(6000),
          },
        );
      } catch {
        throw new ReverseGeocodeError('The address service timed out or is unavailable. Retry or enter the address manually.', 504);
      }

      if (!response.ok) {
        throw new ReverseGeocodeError('The address service is temporarily unavailable. Retry or enter the address manually.', 502);
      }
      let result: NominatimResponse;
      try {
        result = await response.json() as NominatimResponse;
      } catch {
        throw new ReverseGeocodeError('The address service returned an unreadable response. Retry or enter the address manually.', 502);
      }
      const address = result.address && formatReverseGeocodedAddress(result.address);
      if (!address) {
        throw new ReverseGeocodeError('No readable address was returned for this location. Enter the address manually.', 502);
      }
      this.cache.set(cacheKey, { address, expiresAt: this.now() + 15 * 60_000 });
      while (this.cache.size > 200) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey === undefined) break;
        this.cache.delete(oldestKey);
      }
      return address;
    } finally {
      releaseQueue();
    }
  }
}
