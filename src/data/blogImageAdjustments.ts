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
