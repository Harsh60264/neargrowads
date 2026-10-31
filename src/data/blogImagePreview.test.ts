import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlogPost } from './blogData';
import { BLOG_ARTICLE_IMAGE_MINIMUM_SIZE, BLOG_ARTICLE_IMAGE_RATIO, BLOG_IMAGE_CONTROL_LABELS } from './blogImageAdjustments';
import { BLOG_FEATURED_IMAGE_CLASS_NAME } from '../components/blog/blogImagePresentation';
import { renderBlogInlineImage } from '../utils/blogRichText';

const sectionImage: NonNullable<BlogPost['inlineImages']>[number] = {
  id: 'section-image',
  url: 'https://cdn.example.test/default.jpg',
  altText: 'A storefront',
  caption: 'Storefront',
  width: '50%',
  alignment: 'right',
  layout: 'wrap-right',
  spacingAbove: 12,
  spacingBelow: 24,
  imageVariants: {
    light: { url: 'https://cdn.example.test/light.jpg', altText: 'Light storefront', imageSize: 'cover', imagePositionX: 25, imagePositionY: 70, imageZoom: 150 },
    dark: { url: 'https://cdn.example.test/dark.jpg', altText: 'Dark storefront', imageSize: 'contain', imagePositionX: 50, imagePositionY: 50, imageZoom: 100 },
  },
};

test('featured image preview shares the published aspect ratio, crop and size', () => {
  assert.equal(BLOG_ARTICLE_IMAGE_RATIO, '16:8');
  assert.equal(BLOG_ARTICLE_IMAGE_MINIMUM_SIZE, '1600 × 800 px');
  assert.deepEqual(BLOG_IMAGE_CONTROL_LABELS, { crop: 'Crop image', adjust: 'Adjust image', reset: 'Reset' });
  assert.match(BLOG_FEATURED_IMAGE_CLASS_NAME, /aspect-\[16\/8\]/);
  assert.match(BLOG_FEATURED_IMAGE_CLASS_NAME, /max-h-\[620px\]/);
  assert.match(BLOG_FEATURED_IMAGE_CLASS_NAME, /object-cover/);
});

test('section image preview uses the published markup and selected theme variant', () => {
  const light = renderBlogInlineImage(sectionImage, 'light');
  const dark = renderBlogInlineImage(sectionImage, 'dark');

  assert.match(light, /class="blog-inline-image"/);
  assert.match(light, /src="https:\/\/cdn\.example\.test\/light\.jpg"/);
  assert.match(light, /alt="Light storefront"/);
  assert.match(light, /width:min\(50%,100%\)/);
  assert.match(light, /float:right;margin-left:1rem/);
  assert.match(dark, /object-fit:contain/);
  assert.match(light, /class="blog-inline-image-caption"/);
  assert.match(light, /class="blog-inline-image-viewport"/);
  assert.match(light, /aspect-ratio:16\/8/);
  assert.match(light, /object-fit:cover/);
  assert.match(light, /object-position:25% 70%/);
  assert.match(light, /transform:scale\(1\.5\)/);
  assert.match(dark, /src="https:\/\/cdn\.example\.test\/dark\.jpg"/);
  assert.match(dark, /alt="Dark storefront"/);
  assert.doesNotMatch(dark, /blog-inline-image-viewport/);
  assert.match(dark, /max-width:min\(50%,100%\)/);
});
