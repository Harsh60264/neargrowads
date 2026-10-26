import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlogPost } from './blogData';
import { isSupportedBlogImageWidth, isValidBlogImagePlacement } from './blogImagePlacement';
import { blogImageMarker } from '../utils/blogRichText';

test('accepts the supported preset and custom image widths only', () => {
  for (const width of ['25%', '50%', '75%', '100%', '1%', '1600px', '480px']) {
    assert.equal(isSupportedBlogImageWidth(width), true, `${width} should be supported`);
  }
  for (const width of ['0%', '101%', '12em', 'auto', 'url(javascript:alert(1))', '1601px']) {
    assert.equal(isSupportedBlogImageWidth(width), false, `${width} should be rejected`);
  }
});

test('retains compatibility with unedited legacy section images', () => {
  assert.equal(isValidBlogImagePlacement(
    { url: '/uploads/blog/12345678-1234-1234-1234-123456789012.jpg', afterSection: 0, caption: '', altText: '' },
    new Set(),
    1,
    false,
  ), true);
});

test('requires stable section and body marker anchors for new image placements', () => {
  const sections = new Set(['section-1']);
  const cursorImage = { id: 'img-1', sectionId: 'section-1', placement: 'cursor', width: '50%' };
  assert.equal(isValidBlogImagePlacement(cursorImage, sections, 1, true), true);
  assert.equal(isValidBlogImagePlacement(cursorImage, sections, 1, false), false);
  assert.equal(isValidBlogImagePlacement({ ...cursorImage, sectionId: 'missing' }, sections, 1, true), false);
  assert.equal(isValidBlogImagePlacement({ ...cursorImage, spacingAbove: 121 }, sections, 1, true), false);
  assert.equal(isValidBlogImagePlacement({ ...cursorImage, layout: 'absolute' }, sections, 1, true), false);
});

test('image markers survive paragraph text edits and full image settings round-trip', () => {
  const image: NonNullable<BlogPost['inlineImages']>[number] = {
    id: 'image-1',
    url: '/uploads/blog/12345678-1234-1234-1234-123456789012.jpg',
    altText: 'A storefront',
    caption: 'Local storefront',
    sectionId: 'section-1',
    placement: 'cursor',
    width: '480px',
    alignment: 'right',
    layout: 'wrap-right',
    spacingAbove: 12,
    spacingBelow: 24,
    imageVariants: {
      light: { url: 'https://cdn.example.test/light.jpg', altText: 'Light storefront' },
      dark: { url: 'https://cdn.example.test/dark.jpg', altText: 'Dark storefront' },
    },
  };
  const marker = blogImageMarker('image-1');
  const editedParagraph = `<p><strong>Edited start</strong>${marker}<br>Text after the image</p>`;
  assert.equal((editedParagraph.match(/data-blog-image-id="image-1"/g) || []).length, 1);

  const persisted = JSON.parse(JSON.stringify({ contentSections: [{ id: 'section-1', paragraphs: [editedParagraph] }], inlineImages: [image] })) as {
    contentSections: { id: string; paragraphs: string[] }[];
    inlineImages: NonNullable<BlogPost['inlineImages']>;
  };
  assert.equal(persisted.contentSections[0].paragraphs[0], editedParagraph);
  assert.deepEqual(persisted.inlineImages[0], image);
});
