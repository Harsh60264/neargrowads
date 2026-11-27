import { useEffect, useState } from 'react';
import { LocateFixed, MapPin, RefreshCw } from 'lucide-react';
import type { PartnerLocation, PartnerLocationComponents, PartnerLocationSubmission } from '../../../shared/partnerLocation';
import { normalizeDetectedIndianState } from '../../../shared/indianStates';

interface PartnerLocationCaptureProps {
  idPrefix: string;
  title: string;
  endpoint: string;
  value: PartnerLocation | null;
  onChange: (location: PartnerLocationSubmission | null) => void;
  consentRequired?: boolean;
  onDetectedState?: (state: string) => void;
  addressLabel?: string;
  addressRequired?: boolean;
  detectButtonLabel?: string;
  refreshButtonLabel?: string;
  helperText?: string;
  className?: string;
}

interface GeocodeResponse {
  address?: unknown;
  components?: unknown;
  locationToken?: unknown;
  message?: unknown;
}

interface CapturedGps {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}

const COMPONENTS: Array<[keyof PartnerLocationComponents, string]> = [
  ['locality', 'Locality'],
  ['city', 'City'],
  ['district', 'District'],
  ['state', 'State'],
  ['postalCode', 'PIN code'],
  ['country', 'Country'],
];

function isLocationComponents(value: unknown): value is PartnerLocationComponents {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return COMPONENTS.every(([key]) => record[key] === null || typeof record[key] === 'string');
}

export function PartnerLocationCapture({
  idPrefix,
  title,
  endpoint,
  value,
  onChange,
  consentRequired = false,
  onDetectedState,
  addressLabel = 'Location / address (optional)',
  addressRequired = false,
  detectButtonLabel = 'Detect my location',
  refreshButtonLabel = 'Retry / refresh location',
  helperText = 'GPS is optional. If detection is unavailable, you may enter an address manually or leave this blank.',
  className,
}: PartnerLocationCaptureProps) {
  const [address, setAddress] = useState(value?.address ?? '');
  const [capturedGps, setCapturedGps] = useState<CapturedGps | null>(() =>
    value && value.latitude !== null && value.longitude !== null &&
      value.accuracyMeters !== null && value.capturedAt !== null
      ? {
          latitude: value.latitude,
          longitude: value.longitude,
          accuracyMeters: value.accuracyMeters,
          capturedAt: value.capturedAt,
        }
      : null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setAddress(value?.address ?? '');
    setCapturedGps(value && value.latitude !== null && value.longitude !== null &&
      value.accuracyMeters !== null && value.capturedAt !== null
      ? {
          latitude: value.latitude,
          longitude: value.longitude,
          accuracyMeters: value.accuracyMeters,
          capturedAt: value.capturedAt,
        }
      : null);
  }, [value?.address, value?.latitude, value?.longitude, value?.accuracyMeters, value?.capturedAt]);

  const updateManualAddress = (nextAddress: string) => {
    setAddress(nextAddress);
    setError('');
    const trimmed = nextAddress.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    onChange({
      address: trimmed,
      latitude: capturedGps?.latitude ?? null,
      longitude: capturedGps?.longitude ?? null,
      accuracyMeters: capturedGps?.accuracyMeters ?? null,
      capturedAt: capturedGps?.capturedAt ?? null,
      source: capturedGps ? 'gps_manual' : 'manual_no_gps',
      components: null,
    });
  };

  const detectLocation = () => {
    setError('');
    if (consentRequired && !consent) {
      setError('Agree to share your location once before detection.');
      return;
    }
    if (!navigator.geolocation) {
      setError('Location detection is unavailable in this browser. Enter your location manually instead.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      if (![position.timestamp, position.coords.latitude, position.coords.longitude, position.coords.accuracy]
        .every(Number.isFinite)) {
        setBusy(false);
        setError('Your device returned invalid GPS data. Retry or enter your location manually.');
        return;
      }
      const capture: CapturedGps = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      };
      setCapturedGps(capture);
      if (capture.accuracyMeters <= 0 || capture.accuracyMeters > 50_000) {
        setBusy(false);
        setError('The GPS accuracy is too low to use. Retry from a clearer location or enter your address manually.');
        return;
      }
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: capture.latitude,
            longitude: capture.longitude,
            accuracy: capture.accuracyMeters,
            capturedAt: capture.capturedAt,
          }),
        });
        const data = await response.json() as GeocodeResponse;
        if (!response.ok) {
          throw new Error(typeof data.message === 'string'
            ? data.message
            : 'Address detection failed. Retry or enter your location manually.');
        }
        if (typeof data.address !== 'string' || !isLocationComponents(data.components) ||
          typeof data.locationToken !== 'string') {
          throw new Error('The address service returned incomplete location details. Retry or enter your location manually.');
        }
        const detected: PartnerLocationSubmission = {
          address: data.address,
          ...capture,
          source: 'gps_reverse_geocoded',
          components: data.components,
          locationToken: data.locationToken,
        };
        setAddress(detected.address);
        onChange(detected);
        const detectedState = normalizeDetectedIndianState(detected.components?.state);
        if (detectedState) onDetectedState?.(detectedState);
      } catch (reason) {
        setError(reason instanceof Error
          ? reason.message
          : 'Address detection failed. Retry or enter your location manually.');
      } finally {
        setBusy(false);
      }
    }, (reason) => {
      setBusy(false);
      setError(reason.code === reason.PERMISSION_DENIED
        ? 'Location permission was denied. Enable location access in your browser settings or enter your location manually.'
        : reason.code === reason.TIMEOUT
          ? 'Location detection timed out. Retry or enter your location manually.'
          : 'Your location could not be detected. Check your device settings or enter it manually.');
    }, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
  };

  const details = value?.components
    ? COMPONENTS.flatMap(([key, label]) => value.components?.[key]
      ? [`${label}: ${value.components[key]}`]
      : [])
    : [];
  const detectedByGps = value?.source === 'gps_reverse_geocoded';
  const hasGps = value?.latitude !== null && value?.latitude !== undefined &&
    value.longitude !== null && value.longitude !== undefined;

  return (
    <section className={`partner-location-capture${className ? ` ${className}` : ''}`} aria-labelledby={`${idPrefix}-heading`}>
      <h3 id={`${idPrefix}-heading`}>{title}</h3>
      {consentRequired && (
        <label className="partner-location-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>I agree to share my location once to detect and prefill my registration location. It will not be tracked in the background.</span>
        </label>
      )}
      <label className="partner-location-address" htmlFor={`${idPrefix}-address`}>
        {addressLabel}
        <input
          id={`${idPrefix}-address`}
          autoComplete="street-address"
          maxLength={500}
          required={addressRequired}
          value={address}
          onChange={(event) => updateManualAddress(event.target.value)}
          placeholder="Detected address or enter your locality, city, and PIN code"
        />
      </label>
      <button
        className="partner-location-detect"
        type="button"
        disabled={busy || (consentRequired && !consent)}
        onClick={detectLocation}
      >
        {busy ? <RefreshCw size={15} className="is-spinning" aria-hidden="true" /> : <LocateFixed size={15} aria-hidden="true" />}
        {busy ? 'Detecting location…' : detectedByGps ? refreshButtonLabel : detectButtonLabel}
      </button>
      <small className="partner-location-help">
        {helperText}
      </small>
      {error && <p className="partner-location-error" role="alert">{error}</p>}
      {value && (
        <div className="partner-location-result" role="status">
          <strong><MapPin size={15} aria-hidden="true" />{detectedByGps ? 'Location detected' : 'Location entered manually'}</strong>
          <span>{value.address}</span>
          {details.length > 0 && <small>{details.join(' · ')}</small>}
          {hasGps && value.accuracyMeters !== null && (
            <small>GPS: {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)} · Accuracy ±{Math.round(value.accuracyMeters)} m</small>
          )}
        </div>
      )}
    </section>
  );
}
