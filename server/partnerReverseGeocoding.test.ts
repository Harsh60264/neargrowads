import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatReverseGeocodedAddress,
  PartnerReverseGeocoding,
  ReverseGeocodeError,
} from './partnerReverseGeocoding';

test('formats only address components supplied by reverse geocoding', () => {
  assert.equal(formatReverseGeocodedAddress({
    house_number: '12',
    road: 'Main Road',
    suburb: 'Sector 5',
    city: 'Noida',
    state: 'Uttar Pradesh',
    postcode: '201301',
    country: 'India',
  }), '12, Main Road, Sector 5, Noida, Uttar Pradesh, 201301, India');
  assert.equal(formatReverseGeocodedAddress({ city: 'Noida', state: 'Uttar Pradesh' }), 'Noida, Uttar Pradesh');
  assert.equal(formatReverseGeocodedAddress({}), '');
});

test('reverse geocoding retains only returned locality, city, district, state, postal code, and country', async () => {
  const service = new PartnerReverseGeocoding(async () => new Response(JSON.stringify({
    address: {
      road: 'Main Road',
      suburb: 'Sector 5',
      city: 'Noida',
      state_district: 'Gautam Buddha Nagar',
      state: 'Uttar Pradesh',
      postcode: '201301',
      country: 'India',
    },
  }), { status: 200 }), () => 1_000, async () => undefined);

  assert.deepEqual(await service.reverseDetailed('registration-ip', 28.5, 77.3), {
    address: 'Main Road, Sector 5, Noida, Gautam Buddha Nagar, Uttar Pradesh, 201301, India',
    components: {
      locality: 'Sector 5',
      city: 'Noida',
      district: 'Gautam Buddha Nagar',
      state: 'Uttar Pradesh',
      postalCode: '201301',
      country: 'India',
    },
  });
});

test('reverse geocoding uses fixed Nominatim endpoint, timeout, identity and cache', async () => {
  let calls = 0;
  let requestedUrl = '';
  let requestedHeaders: HeadersInit | undefined;
  const service = new PartnerReverseGeocoding(async (input, init) => {
    calls += 1;
    requestedUrl = String(input);
    requestedHeaders = init?.headers;
    return new Response(JSON.stringify({ address: { road: 'Main Road', city: 'Noida', country: 'India' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }, () => 1_000, async () => undefined);

  const first = await service.reverse('partner-1', 28.5, 77.3);
  const cached = await service.reverse('partner-2', 28.5, 77.3);
  assert.equal(first, 'Main Road, Noida, India');
  assert.equal(cached, first);
  assert.equal(calls, 1);
  assert.match(requestedUrl, /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
  assert.equal((requestedHeaders as Record<string, string>)['User-Agent'], 'NearGrowAds-PartnerWorkspace/1.0 (info@neargrowads.in)');
});

test('reverse geocoding limits repeated partner lookups', async () => {
  const service = new PartnerReverseGeocoding(async () => new Response(JSON.stringify({
    address: { city: 'Noida' },
  }), { status: 200 }), () => 1_000, async () => undefined);

  for (let index = 0; index < 4; index += 1) {
    await service.reverse('partner-1', 28.5 + index / 1000, 77.3);
  }
  await assert.rejects(
    service.reverse('partner-1', 28.51, 77.3),
    (error: unknown) => error instanceof ReverseGeocodeError && error.status === 429,
  );
});

test('reverse geocoding reports provider failure without fabricating an address', async () => {
  const service = new PartnerReverseGeocoding(async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(
    service.reverse('partner-1', 28.5, 77.3),
    (error: unknown) => error instanceof ReverseGeocodeError && error.status === 502,
  );
});

test('reverse geocoding fails closed when the global provider rate slot is unavailable', async () => {
  let providerCalls = 0;
  const service = new PartnerReverseGeocoding(
    async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ address: { city: 'Noida' } }), { status: 200 });
    },
    Date.now,
    async () => undefined,
    async () => { throw new Error('rate slot unavailable'); },
  );

  await assert.rejects(service.reverse('partner-1', 28.5, 77.3), /rate slot unavailable/);
  assert.equal(providerCalls, 0);
});

test('reverse geocoding rejects invalid coordinates before contacting the provider', async () => {
  let calls = 0;
  const service = new PartnerReverseGeocoding(async () => {
    calls += 1;
    return new Response('{}');
  });
  await assert.rejects(service.reverse('partner-1', 91, 77.3), ReverseGeocodeError);
  assert.equal(calls, 0);
});
