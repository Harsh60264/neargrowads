import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlogImageAdjustControls } from '../components/admin/BlogImageAdjustControls';
import {
  BLOG_ARTICLE_IMAGE_ASPECT_RATIO,
  BLOG_ARTICLE_IMAGE_MINIMUM_SIZE,
  BLOG_ARTICLE_IMAGE_RATIO,
  BLOG_ARTICLE_IMAGE_RATIO_HELPER,
  BLOG_ARTICLE_IMAGE_SIZE_HELPER,
  BLOG_IMAGE_CONTROL_LABELS,
  createBlogImageAdjustmentDraft,
  getBlogImageAdjustmentStyle,
  getBlogImagePanOverflow,
  hasBlogImageCropFrame,
  normalizeBlogImageAdjustment,
  serializeBlogImageAdjustment,
} from './blogImageAdjustments';

test('exposes the published article image ratio and recommended minimum', () => {
  assert.equal(BLOG_ARTICLE_IMAGE_RATIO, '16:8');
  assert.equal(BLOG_ARTICLE_IMAGE_ASPECT_RATIO, 2);
  assert.equal(BLOG_ARTICLE_IMAGE_MINIMUM_SIZE, '1600 × 800 px');
  assert.equal(BLOG_ARTICLE_IMAGE_RATIO_HELPER, 'Recommended ratio: 16:8');
  assert.equal(BLOG_ARTICLE_IMAGE_SIZE_HELPER, 'Recommended minimum size: 1600 × 800 px');
});

test('renders crop, adjust, and reset actions in the editor controls', () => {
  const markup = renderToStaticMarkup(
    createElement(BlogImageAdjustControls, {
      src: '/image.jpg',
      alt: 'Article image',
      value: {},
      defaultFit: 'cover',
      onChange: () => undefined,
    }),
  );
  assert.match(markup, /Crop image/);
  assert.match(markup, /Adjust image/);
  assert.match(markup, />Reset</);
});

test('exposes crop, adjust, and reset controls with safe adjustment bounds', () => {
  assert.deepEqual(BLOG_IMAGE_CONTROL_LABELS, {
    crop: 'Crop image',
    adjust: 'Adjust image',
    reset: 'Reset',
  });
  assert.deepEqual(normalizeBlogImageAdjustment({
    imageSize: 'cover',
    imagePositionX: -10,
    imagePositionY: 115,
    imageZoom: 350,
  }), {
    fit: 'cover',
    positionX: 0,
    positionY: 100,
    zoom: 300,
  });
  assert.deepEqual(normalizeBlogImageAdjustment(undefined, 'cover'), {
    fit: 'cover',
    positionX: 50,
    positionY: 50,
    zoom: 100,
  });
});

test('opens the crop editor through an accessible crop action', () => {
  const markup = renderToStaticMarkup(
    createElement(BlogImageAdjustControls, {
      src: '/image.jpg',
      alt: 'Article image',
      value: {},
      defaultFit: 'cover',
      onChange: () => undefined,
    }),
  );
  assert.match(markup, /aria-controls="[^"]+"/);
  assert.match(markup, /aria-expanded="false"/);
});

test('uses the same crop frame and transform values for editor and published rendering', () => {
  const adjustment = normalizeBlogImageAdjustment({
    imageSize: 'cover',
    imagePositionX: 24,
    imagePositionY: 72,
    imageZoom: 175,
  });
  assert.equal(hasBlogImageCropFrame(adjustment), true);
  assert.deepEqual(getBlogImageAdjustmentStyle(adjustment), {
    objectFit: 'cover',
    objectPosition: '24% 72%',
    transform: 'scale(1.75)',
    transformOrigin: '24% 72%',
  });
  assert.equal(hasBlogImageCropFrame(normalizeBlogImageAdjustment(undefined)), false);
});

test('calculates crop-pan overflow from the image and published frame dimensions', () => {
  const overflow = getBlogImagePanOverflow(800, 400, 1200, 800, 150);
  assert.equal(overflow.x, 400);
  assert.ok(Math.abs(overflow.y - 400) < 0.001);
  const coverOverflow = getBlogImagePanOverflow(800, 400, 1200, 800, 100);
  assert.equal(coverOverflow.x, 0);
  assert.ok(Math.abs(coverOverflow.y - 133.3333333333) < 0.001);
  assert.deepEqual(getBlogImagePanOverflow(800, 400, 1600, 800, 100), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(getBlogImagePanOverflow(0, 400, 1600, 800, 100), {
    x: 0,
    y: 0,
  });
});

test('crop edits are staged separately from persisted image adjustments until Apply', () => {
  const original = {
    imageSize: 'contain' as const,
    imagePositionX: 30,
    imagePositionY: 60,
    imageZoom: 125,
  };
  const draft = createBlogImageAdjustmentDraft(original, 'contain', 'crop');

  assert.deepEqual(original, {
    imageSize: 'contain',
    imagePositionX: 30,
    imagePositionY: 60,
    imageZoom: 125,
  });
  assert.deepEqual(draft, { fit: 'cover', positionX: 30, positionY: 60, zoom: 125 });
  assert.deepEqual(serializeBlogImageAdjustment(draft), {
    imageSize: 'cover',
    imagePositionX: 30,
    imagePositionY: 60,
    imageZoom: 125,
  });
});
