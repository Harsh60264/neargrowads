import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlogPost } from './blogData';
import { resolveBlogImage } from './blogData';
import {
  BLOG_ARTICLE_IMAGE_MINIMUM_SIZE,
  BLOG_ARTICLE_IMAGE_RATIO,
  BLOG_IMAGE_CONTROL_LABELS,
  getBlogImageAdjustmentStyle,
  normalizeBlogImageAdjustment,
} from './blogImageAdjustments';
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

test('crop settings survive article save and reload for both themes and render on the published image', () => {
  const article: BlogPost = {
    slug: 'crop-settings-round-trip',
    title: 'Crop settings',
    author: { name: 'Author', role: '', imageUrl: '' },
    publishedDate: '2026-11-01',
    category: 'Guides',
    readTime: '1 min read',
    excerpt: 'Crop persistence test.',
    contentSections: [],
    inlineImages: [sectionImage],
    featuredImage: 'https://cdn.example.test/featured.jpg',
    relatedServiceSlug: '',
    metaDescription: '',
    featuredImageVariants: {
      light: { imageSize: 'cover', imagePositionX: 18, imagePositionY: 66, imageZoom: 140 },
      dark: { imageSize: 'contain', imagePositionX: 40, imagePositionY: 55, imageZoom: 125 },
    },
  };
  const reloaded = JSON.parse(JSON.stringify(article)) as BlogPost;

  for (const theme of ['light', 'dark'] as const) {
    const inline = reloaded.inlineImages?.[0];
    assert.ok(inline);
    const featured = resolveBlogImage(
      reloaded.featuredImage,
      reloaded.featuredImageAltText ?? '',
      reloaded.featuredImageVariants,
      theme,
    ).image;
    const featuredStyle = getBlogImageAdjustmentStyle(normalizeBlogImageAdjustment(featured, 'cover'));
    const resolved = resolveBlogImage(inline.url, inline.altText, inline.imageVariants, theme).image;
    const adjustment = normalizeBlogImageAdjustment(resolved);
    const style = getBlogImageAdjustmentStyle(adjustment);
    const markup = renderBlogInlineImage(inline, theme);

    assert.deepEqual(featuredStyle, theme === 'light' ? {
      objectFit: 'cover',
      objectPosition: '18% 66%',
      transform: 'scale(1.4)',
      transformOrigin: '18% 66%',
    } : {
      objectFit: 'contain',
      objectPosition: '40% 55%',
      transform: 'scale(1.25)',
      transformOrigin: '40% 55%',
    });
    assert.deepEqual(style, {
      objectFit: theme === 'light' ? 'cover' : 'contain',
      objectPosition: theme === 'light' ? '25% 70%' : '50% 50%',
      transform: theme === 'light' ? 'scale(1.5)' : 'scale(1)',
      transformOrigin: theme === 'light' ? '25% 70%' : '50% 50%',
    });
    assert.ok(markup.includes(`src="https://cdn.example.test/${theme}.jpg"`));
    if (theme === 'light') {
      assert.match(markup, /object-fit:cover/);
      assert.match(markup, /object-position:25% 70%/);
      assert.match(markup, /transform:scale\(1\.5\)/);
    } else {
      assert.doesNotMatch(markup, /blog-inline-image-viewport/);
      assert.equal(reloaded.featuredImageVariants?.dark?.imagePositionX, 40);
      assert.equal(reloaded.featuredImageVariants?.dark?.imagePositionY, 55);
      assert.equal(reloaded.featuredImageVariants?.dark?.imageZoom, 125);
    }
  }
});

test('legacy inline images render saved crop adjustments and keep the first-image editor hook', () => {
  const legacyImage = {
    ...sectionImage,
    id: undefined,
    imageVariants: {
      light: { imageSize: 'cover' as const, imagePositionX: 30, imagePositionY: 65, imageZoom: 125 },
    },
  };
  const markup = renderBlogInlineImage(legacyImage, 'light', 0);

  assert.match(markup, /data-blog-image-index="0"/);
  assert.match(markup, /object-fit:cover/);
  assert.match(markup, /object-position:30% 65%/);
  assert.match(markup, /transform:scale\(1\.25\)/);
});
