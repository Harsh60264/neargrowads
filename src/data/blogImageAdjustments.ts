export const BLOG_ARTICLE_IMAGE_RATIO = '16:8';
export const BLOG_ARTICLE_IMAGE_ASPECT_RATIO = 16 / 8;
export const BLOG_ARTICLE_IMAGE_MINIMUM_SIZE = '1600 × 800 px';
export const BLOG_ARTICLE_IMAGE_RATIO_HELPER = `Recommended ratio: ${BLOG_ARTICLE_IMAGE_RATIO}`;
export const BLOG_ARTICLE_IMAGE_SIZE_HELPER = `Recommended minimum size: ${BLOG_ARTICLE_IMAGE_MINIMUM_SIZE}`;

export const BLOG_IMAGE_CONTROL_LABELS = {
  crop: 'Crop image',
  adjust: 'Adjust image',
  reset: 'Reset',
} as const;

export interface BlogImageAdjustment {
  imageSize?: 'cover' | 'contain';
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
}

export interface NormalizedBlogImageAdjustment {
  fit: 'cover' | 'contain';
  positionX: number;
  positionY: number;
  zoom: number;
}

export interface BlogImageAdjustmentStyle {
  objectFit: NormalizedBlogImageAdjustment['fit'];
  objectPosition: string;
  transform: string;
  transformOrigin: string;
}

export type BlogImageEditMode = 'crop' | 'adjust';

export function normalizeBlogImageAdjustment(
  input: object | undefined,
  defaultFit: 'cover' | 'contain' = 'contain',
): NormalizedBlogImageAdjustment {
  const value = input as BlogImageAdjustment | undefined;
  const fit = value?.imageSize === 'cover' || value?.imageSize === 'contain'
    ? value.imageSize
    : defaultFit;
  const positionX = typeof value?.imagePositionX === 'number' && Number.isFinite(value.imagePositionX)
    ? Math.max(0, Math.min(100, value.imagePositionX))
    : 50;
  const positionY = typeof value?.imagePositionY === 'number' && Number.isFinite(value.imagePositionY)
    ? Math.max(0, Math.min(100, value.imagePositionY))
    : 50;
  const zoom = typeof value?.imageZoom === 'number' && Number.isFinite(value.imageZoom)
    ? Math.max(100, Math.min(300, value.imageZoom))
    : 100;
  return { fit, positionX, positionY, zoom };
}

export function createBlogImageAdjustmentDraft(
  input: object | undefined,
  defaultFit: 'cover' | 'contain',
  mode: BlogImageEditMode,
): NormalizedBlogImageAdjustment {
  const adjustment = normalizeBlogImageAdjustment(input, defaultFit);
  return mode === 'crop' ? { ...adjustment, fit: 'cover' } : adjustment;
}

export function serializeBlogImageAdjustment(
  adjustment: NormalizedBlogImageAdjustment,
): BlogImageAdjustment {
  return {
    imageSize: adjustment.fit,
    imagePositionX: adjustment.positionX,
    imagePositionY: adjustment.positionY,
    imageZoom: adjustment.zoom,
  };
}

export function hasBlogImageCropFrame(adjustment: NormalizedBlogImageAdjustment): boolean {
  return adjustment.fit === 'cover' || adjustment.zoom > 100 ||
    adjustment.positionX !== 50 || adjustment.positionY !== 50;
}

export function getBlogImageAdjustmentStyle(
  adjustment: NormalizedBlogImageAdjustment,
): BlogImageAdjustmentStyle {
  const position = `${adjustment.positionX}% ${adjustment.positionY}%`;
  return {
    objectFit: adjustment.fit,
    objectPosition: position,
    transform: `scale(${adjustment.zoom / 100})`,
    transformOrigin: position,
  };
}

export function getBlogImagePanOverflow(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
): { x: number; y: number } {
  if ([frameWidth, frameHeight, imageWidth, imageHeight, zoom].some((value) => !Number.isFinite(value) || value <= 0)) {
    return { x: 0, y: 0 };
  }
  const coverScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  return {
    x: Math.max(0, imageWidth * coverScale * zoom / 100 - frameWidth),
    y: Math.max(0, imageHeight * coverScale * zoom / 100 - frameHeight),
  };
}
