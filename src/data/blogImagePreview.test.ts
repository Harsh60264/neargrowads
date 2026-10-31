import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlogPost } from './blogData';
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
    light: { url: 'https://cdn.example.test/light.jpg', altText: 'Light storefront' },
    dark: { url: 'https://cdn.example.test/dark.jpg', altText: 'Dark storefront' },
  },
};

test('featured image preview shares the published aspect ratio, crop and size', () => {
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
  assert.match(light, /max-width:min\(50%,100%\)/);
  assert.match(light, /float:right;margin-left:1rem/);
  assert.match(light, /object-fit:contain/);
  assert.match(light, /class="blog-inline-image-caption"/);
  assert.match(dark, /src="https:\/\/cdn\.example\.test\/dark\.jpg"/);
  assert.match(dark, /alt="Dark storefront"/);
});
