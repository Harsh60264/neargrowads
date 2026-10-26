export type BlogImagePlacement = 'before-heading' | 'after-heading' | 'cursor' | 'section-end';
export type BlogImageAlignment = 'left' | 'center' | 'right';
export type BlogImageLayout = 'standalone' | 'wrap-left' | 'wrap-right';

const imageWidthPattern = /^(?:[1-9]\d?|100)%$|^(?:[1-9]\d{0,2}|1[0-5]\d{2}|1600)px$/;

export function isSupportedBlogImageWidth(value: unknown): value is string {
  return typeof value === 'string' && imageWidthPattern.test(value);
}

export function isValidBlogImagePlacement(
  value: unknown,
  sectionIds: ReadonlySet<string>,
  sectionCount: number,
  hasCursorMarker: boolean,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  if (image.id !== undefined && (typeof image.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(image.id))) return false;
  if (image.sectionId !== undefined && (typeof image.sectionId !== 'string' || !sectionIds.has(image.sectionId))) return false;
  if (image.placement !== undefined && !['before-heading', 'after-heading', 'cursor', 'section-end'].includes(String(image.placement))) return false;
  if (image.placement && !image.sectionId) return false;
  if (image.placement === 'cursor' && (!image.id || !hasCursorMarker)) return false;
  if (image.width !== undefined && !isSupportedBlogImageWidth(image.width)) return false;
  if (image.alignment !== undefined && !['left', 'center', 'right'].includes(String(image.alignment))) return false;
  if (image.layout !== undefined && !['standalone', 'wrap-left', 'wrap-right'].includes(String(image.layout))) return false;
  for (const spacing of [image.spacingAbove, image.spacingBelow]) {
    if (spacing !== undefined && (typeof spacing !== 'number' || !Number.isInteger(spacing) || spacing < 0 || spacing > 120)) return false;
  }
  return image.afterSection === undefined ||
    (Number.isInteger(image.afterSection) && typeof image.afterSection === 'number' && image.afterSection >= 0 && image.afterSection < sectionCount);
}
