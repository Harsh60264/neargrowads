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
  normalizeBlogImageAdjustment,
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
