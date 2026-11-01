export type TeamPhotoFit = 'contain' | 'cover';
export type TeamPhotoBackground = 'blurred' | 'solid';

export interface TeamPhotoSettings {
  fit: TeamPhotoFit;
  zoom: number;
  positionX: number;
  positionY: number;
  background: TeamPhotoBackground;
}

export interface TeamPhotoSettingsInput {
  fit?: TeamPhotoFit;
  zoom?: number;
  positionX?: number;
  positionY?: number;
  background?: TeamPhotoBackground;
}

export const DEFAULT_TEAM_PHOTO_SETTINGS: TeamPhotoSettings = {
  fit: 'contain',
  zoom: 100,
  positionX: 50,
  positionY: 50,
  background: 'blurred',
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function normalizeTeamPhotoSettings(input?: unknown): TeamPhotoSettings {
  const value = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<TeamPhotoSettingsInput>
    : {};
  const fit: TeamPhotoFit = value.fit === 'cover' ? 'cover' : 'contain';
  return {
    fit,
    zoom: boundedNumber(value.zoom, 100, fit === 'contain' ? 50 : 100, fit === 'contain' ? 100 : 200),
    positionX: boundedNumber(value.positionX, 50, 0, 100),
    positionY: boundedNumber(value.positionY, 50, 0, 100),
    background: value.background === 'solid' ? 'solid' : 'blurred',
  };
}

export function validateTeamPhotoSettings(input: unknown):
  | { valid: true; value?: TeamPhotoSettings }
  | { valid: false } {
  if (input === undefined) return { valid: true };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false };
  const value = input as Record<string, unknown>;
  const allowedKeys = new Set(['fit', 'zoom', 'positionX', 'positionY', 'background']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return { valid: false };
  if (value.fit !== undefined && value.fit !== 'contain' && value.fit !== 'cover') return { valid: false };
  if (value.background !== undefined && value.background !== 'blurred' && value.background !== 'solid') return { valid: false };
  const fit = value.fit === 'cover' ? 'cover' : 'contain';
  for (const [key, min, max] of [
    ['zoom', fit === 'cover' ? 100 : 50, fit === 'contain' ? 100 : 200],
    ['positionX', 0, 100],
    ['positionY', 0, 100],
  ] as const) {
    const setting = value[key];
    if (setting !== undefined && (typeof setting !== 'number' || !Number.isFinite(setting) || setting < min || setting > max)) {
      return { valid: false };
    }
  }
  return { valid: true, value: normalizeTeamPhotoSettings(value) };
}

export function getTeamPhotoImageStyle(settings?: unknown): {
  objectFit: TeamPhotoFit;
  objectPosition: string;
  transform: string;
  transformOrigin: string;
} {
  const normalized = normalizeTeamPhotoSettings(settings);
  const position = `${normalized.positionX}% ${normalized.positionY}%`;
  return {
    objectFit: normalized.fit,
    objectPosition: position,
    transform: `scale(${normalized.zoom / 100})`,
    transformOrigin: position,
  };
}
