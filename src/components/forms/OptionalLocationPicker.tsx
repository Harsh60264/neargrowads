import { MapPin, X } from 'lucide-react';
import { useState } from 'react';
import type { CustomerLocation } from '../../data/customerLocation';

interface OptionalLocationPickerProps {
  value?: CustomerLocation;
  onChange: (value: CustomerLocation | undefined) => void;
}

export function OptionalLocationPicker({ value, onChange }: OptionalLocationPickerProps) {
  const [status, setStatus] = useState('');

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setStatus('Location is unavailable on this device. You can continue without sharing it.');
      return;
    }
    setStatus('Requesting your permission…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
          consent: true,
        });
        setStatus('Location added to this submission. You can remove it before continuing.');
      },
      (error) => {
        setStatus(error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. You can continue without sharing it.'
          : 'Location could not be read. You can continue without sharing it.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div className="rounded-xl border border-[var(--brand-border)] p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Share your location (optional)</p>
          <p className="mt-1 text-[var(--brand-text-muted)]">Your location is optional and is included only if you choose to share it. You can remove it before submitting.</p>
        </div>
        {value ? (
          <button type="button" onClick={() => { onChange(undefined); setStatus('Location removed from this submission.'); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 font-semibold" style={{ borderColor: 'var(--brand-border)' }}>
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
          </button>
        ) : (
          <button type="button" onClick={requestLocation} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 font-semibold" style={{ borderColor: 'var(--brand-border)' }}>
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Share My Location
          </button>
        )}
      </div>
      {value && <p className="mt-2 text-[var(--brand-text-muted)]">Location ready · accuracy about {Math.round(value.accuracyMeters)} m</p>}
      {status && <p className="mt-2 text-[var(--brand-text-muted)]" role="status">{status}</p>}
    </div>
  );
}
