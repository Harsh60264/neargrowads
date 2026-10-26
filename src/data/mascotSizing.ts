import type { MascotSettings } from './siteContent';

export const MASCOT_SCALE_MIN = 60;
export const MASCOT_SCALE_MAX = 150;
export const MASCOT_MOBILE_BREAKPOINT = 700;

export function normalizeMascotSettings(value: unknown): MascotSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_MASCOT_SETTINGS };
  }
  const input = value as Partial<MascotSettings>;
  return {
    renderer: input.renderer === '2d' ? '2d' : '3d',
    desktopScalePercent: input.desktopScalePercent === undefined ? 100 : normalizeMascotScale(input.desktopScalePercent),
    mobileScalePercent: input.mobileScalePercent === undefined ? 100 : normalizeMascotScale(input.mobileScalePercent),
  };
}

export function normalizeMascotScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(MASCOT_SCALE_MAX, Math.max(MASCOT_SCALE_MIN, value)))
    : 100;
}

export function resolveMascotMultiplier(
  settings: Pick<MascotSettings, 'desktopScalePercent' | 'mobileScalePercent'>,
  viewportWidth: number,
): number {
  return normalizeMascotScale(
    viewportWidth < MASCOT_MOBILE_BREAKPOINT
      ? settings.mobileScalePercent
      : settings.desktopScalePercent,
  ) / 100;
}

export interface MascotGeometry {
  size: number;
  relativeSize: number;
  unit: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  hitWidth: number;
  hitHeight: number;
}

export function calculateMascotGeometry(
  width: number,
  height: number,
  baseSize: number,
  multiplier: number,
  floating: boolean,
  visualViewportOffsetTop = 0,
  visualViewportHeight = height,
): MascotGeometry {
  const size = Math.min(baseSize * multiplier, Math.min(width, height) * 0.94);
  const relativeSize = baseSize > 0 ? size / baseSize : 1;
  const unit = size / 6;
  const horizontalInset = 14 * relativeSize;
  const minX = floating ? 0.3 * size + horizontalInset : width / 2;
  const maxX = floating ? Math.max(minX, width - 0.3 * size - horizontalInset) : width / 2;
  const safeBottom = Math.max(
    12 * relativeSize,
    height - (visualViewportOffsetTop + visualViewportHeight) + 12 * relativeSize,
  );
  const maxY = floating ? height - 4.3 * unit - safeBottom : height / 2;
  const minY = floating ? Math.min(2.1 * unit + 72 * relativeSize, maxY) : height / 2;
  return {
    size,
    relativeSize,
    unit,
    minX,
    maxX,
    minY,
    maxY,
    hitWidth: 3 * unit,
    hitHeight: 4.6 * unit,
  };
}

export const DEFAULT_MASCOT_SETTINGS: MascotSettings = {
  renderer: '3d',
  desktopScalePercent: 100,
  mobileScalePercent: 100,
};
