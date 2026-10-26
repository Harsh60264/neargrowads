import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlogPost } from './blogData';
import { analyzeBlogSeo, BLOG_SEO_CHECK_WEIGHTS, blogSeoGrade, blogSeoNeedsAttention } from './blogSeoHealth';

function article(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    id: 'article-0001',
    slug: 'healthy-article',
    status: 'published',
    title: 'A useful article title',
    excerpt: 'A specific summary for this article.',
    category: 'Growth',
    readTime: '2 min read',
    publishedDate: '2026-10-25',
    author: { name: 'Author Name', role: 'Editor' },
    contentSections: [{ id: 'section-1', heading: 'Useful section', paragraphs: ['Readable article text with a practical point.'] }],
    relatedServiceSlug: '/about',
    metaDescription: 'A distinct search description for this useful article.',
    metaTitle: 'A useful article title',
    socialTitle: 'A useful article title',
    socialImage: 'https://images.example.test/article.png',
    ...overrides,
  };
}

function analyze(post: BlogPost, allPosts: BlogPost[] = [post], missingLocalImageSources = new Set<string>()) {
  return analyzeBlogSeo(post, allPosts, {
    articleId: post.id || `legacy-${post.slug}`,
    sourceRevision: 'revision-1',
    scannedAt: '2026-10-25T12:00:00.000Z',
    canonicalOrigin: 'https://neargrowads.in',
    knownInternalPaths: new Set(['/about', '/blog/healthy-article']),
    missingLocalImageSources,
  });
}

test('uses effective renderer metadata fallbacks rather than requiring optional SEO fields', () => {
  const post = article({ metaTitle: '', metaDescription: '' });
  const result = analyze(post);
  assert.equal(result.checks.find((check) => check.id === 'title')?.status, 'passed');
  assert.equal(result.checks.find((check) => check.id === 'description')?.status, 'passed');
  assert.equal(result.findings.some((finding) => finding.checkId === 'title' || finding.checkId === 'description'), false);
});

test('marks empty saved body as critical and computes a deterministic score and coverage', () => {
  const post = article({ contentSections: [{ heading: '', paragraphs: [''] }] });
  const first = analyze(post);
  const second = analyze(post);
  assert.equal(first.findings.some((finding) => finding.checkId === 'body' && finding.severity === 'critical'), true);
  assert.equal(first.score, second.score);
  assert.equal(first.coverage, second.coverage);
  assert.equal(first.provisional, true);
});

test('detects duplicate effective titles and descriptions against the full article list', () => {
  const post = article({ metaTitle: '', metaDescription: '' });
  const duplicate = article({
    id: 'article-0002',
    slug: 'another-article',
    title: post.title,
    excerpt: post.excerpt,
    metaTitle: post.title,
    metaDescription: post.excerpt,
  });
  const result = analyze(post, [post, duplicate]);
  assert.equal(result.findings.some((finding) => finding.checkId === 'duplicate-title'), true);
  assert.equal(result.findings.some((finding) => finding.checkId === 'duplicate-description'), true);
});

test('reports exact informative-image alt issues and honors explicitly decorative images', () => {
  const post = article({
    inlineImages: [
      { id: 'inline-1', url: '/uploads/blog/11111111-1111-4111-8111-111111111111.png', altText: '', caption: '' },
      { id: 'inline-2', url: '/uploads/blog/22222222-2222-4222-8222-222222222222.png', altText: '', caption: '', decorative: true },
    ],
  });
  const result = analyze(post);
  const altFindings = result.findings.filter((finding) => finding.checkId === 'image-alt');
  assert.equal(altFindings.length, 1);
  assert.equal(altFindings[0].field, 'Article image 1');
  assert.equal(altFindings[0].editorAnchor, 'image-inline-1');
});

test('only reports confirmed missing first-party image files and leaves remote URLs unchecked', () => {
  const missing = '/uploads/blog/11111111-1111-4111-8111-111111111111.png';
  const post = article({
    inlineImages: [
      { id: 'inline-1', url: missing, altText: 'A chart', caption: '' },
      { id: 'inline-2', url: 'https://remote.example.test/chart.png', altText: 'A second chart', caption: '' },
    ],
  });
  const result = analyze(post, [post], new Set([missing]));
  assert.equal(result.findings.some((finding) => finding.checkId === 'image-sources' && finding.evidence.includes(missing)), true);
  assert.equal(result.checks.find((check) => check.id === 'image-sources')?.status, 'critical');
  assert.equal(result.provisional, true);
});

test('does not claim embedded image sources were verified', () => {
  const post = article({
    inlineImages: [{ id: 'inline-1', url: 'data:image/png;base64,AAAA', altText: 'A chart', caption: '' }],
  });
  const result = analyze(post);
  assert.equal(result.checks.find((check) => check.id === 'image-sources')?.status, 'not_checked');
  assert.equal(result.provisional, true);
});

test('checks theme-specific social image sources without treating them as article alt-text images', () => {
  const missing = '/uploads/blog/33333333-3333-4333-8333-333333333333.png';
  const post = article({
    socialImageVariants: { light: { url: missing } },
  });
  const result = analyze(post, [post], new Set([missing]));
  assert.equal(result.findings.some((finding) => finding.checkId === 'image-sources' && finding.evidence.includes(missing)), true);
  assert.equal(result.findings.some((finding) => finding.checkId === 'image-alt' && finding.field.includes('Social-sharing')), false);
});

test('checks known internal links, identifies unknown same-site routes and defers managed dynamic routes', () => {
  const post = article({
    contentSections: [{
      heading: 'Links',
      paragraphs: [
        '<p><a href="/about">Known route</a></p>',
        '<p><a href="/blog/missing-article">Missing route</a></p>',
        '<p><a href="/catalogue/managed-package">Managed package</a></p>',
        '<p><a href="https://external.example.test/page">External</a></p>',
      ],
    }],
  });
  const result = analyze(post);
  const linkFindings = result.findings.filter((finding) => finding.checkId === 'internal-links');
  assert.equal(linkFindings.length, 1);
  assert.equal(linkFindings[0].evidence.includes('/blog/missing-article'), true);
  assert.equal(result.checks.find((check) => check.id === 'internal-links')?.status, 'critical');
  assert.equal(result.provisional, true);
});

test('uses published route directives and sitemap rules while drafts are not applicable', () => {
  const published = analyze(article());
  assert.equal(published.checks.find((check) => check.id === 'robots')?.status, 'passed');
  assert.equal(published.checks.find((check) => check.id === 'sitemap')?.status, 'passed');
  const draft = analyze(article({ status: 'draft' }));
  assert.equal(draft.checks.find((check) => check.id === 'robots')?.status, 'not_applicable');
  assert.equal(draft.checks.find((check) => check.id === 'sitemap')?.status, 'not_applicable');
});

test('documents all weights and applies the agreed checklist score grades', () => {
  assert.equal(Object.values(BLOG_SEO_CHECK_WEIGHTS).reduce((total, value) => total + value, 0), 100);
  assert.equal(blogSeoGrade(59), 'Needs improvement');
  assert.equal(blogSeoGrade(60), 'Fair');
  assert.equal(blogSeoGrade(79), 'Fair');
  assert.equal(blogSeoGrade(80), 'Good');
});

test('does not classify missing or stale scan results as confirmed SEO issues', () => {
  assert.equal(blogSeoNeedsAttention(undefined), false);
  const healthyArticle = article();
  const result = analyze(healthyArticle, [healthyArticle]);
  assert.equal(blogSeoNeedsAttention(result, true), false);
  assert.equal(blogSeoNeedsAttention(result), false);
  assert.equal(blogSeoNeedsAttention(analyze(article({ contentSections: [] }))), true);
});
