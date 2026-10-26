import type { BlogPost } from './blogData';

export const BLOG_SEO_ANALYZER_VERSION = 1;

export type BlogSeoCheckStatus = 'passed' | 'warning' | 'critical' | 'not_applicable' | 'not_checked';
export type BlogSeoSeverity = 'critical' | 'warning';

export interface BlogSeoCheck {
  id: string;
  label: string;
  status: BlogSeoCheckStatus;
  weight: number;
  evidence: string;
}

export interface BlogSeoFinding {
  id: string;
  checkId: string;
  severity: BlogSeoSeverity;
  title: string;
  field: string;
  evidence: string;
  suggestion: string;
  editorAnchor?: string;
}

export interface BlogSeoAnalysis {
  articleId: string;
  slug: string;
  sourceRevision: string;
  analyzerVersion: number;
  scannedAt: string;
  score: number;
  coverage: number;
  provisional: boolean;
  checks: BlogSeoCheck[];
  findings: BlogSeoFinding[];
}

export interface BlogSeoArticle extends BlogPost {
  id?: string;
}

export interface BlogSeoAnalysisContext {
  articleId: string;
  sourceRevision: string;
  scannedAt: string;
  canonicalOrigin: string;
  knownInternalPaths: ReadonlySet<string>;
  missingLocalImageSources?: ReadonlySet<string>;
}

const checks = [
  { id: 'title', label: 'Effective page title', weight: 12 },
  { id: 'description', label: 'Effective meta description', weight: 11 },
  { id: 'duplicate-title', label: 'Duplicate title', weight: 8 },
  { id: 'duplicate-description', label: 'Duplicate description', weight: 4 },
  { id: 'body', label: 'Article body', weight: 10 },
  { id: 'headings', label: 'Heading structure', weight: 6 },
  { id: 'author', label: 'Author information', weight: 4 },
  { id: 'internal-links', label: 'Internal links', weight: 8 },
  { id: 'image-sources', label: 'Image sources', weight: 10 },
  { id: 'image-alt', label: 'Image alternative text', weight: 5 },
  { id: 'image-dimensions', label: 'Image dimensions / layout shift', weight: 5 },
  { id: 'canonical', label: 'Canonical URL', weight: 5 },
  { id: 'robots', label: 'Indexing directives', weight: 5 },
  { id: 'sitemap', label: 'Sitemap inclusion', weight: 5 },
  { id: 'social', label: 'Social-sharing metadata', weight: 2 },
] as const;

export const BLOG_SEO_CHECK_WEIGHTS = Object.freeze(Object.fromEntries(checks.map(({ id, weight }) => [id, weight])));

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function addFinding(
  findings: BlogSeoFinding[],
  checkId: string,
  severity: BlogSeoSeverity,
  title: string,
  field: string,
  evidence: string,
  suggestion: string,
  editorAnchor?: string,
): void {
  findings.push({
    id: `${checkId}-${findings.length + 1}`,
    checkId,
    severity,
    title,
    field,
    evidence,
    suggestion,
    ...(editorAnchor ? { editorAnchor } : {}),
  });
}

function extractLinks(post: BlogSeoArticle): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  const collect = (value: string) => {
    for (const match of value.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      links.push({ href: match[1].trim(), label: plainText(match[2]).slice(0, 100) || match[1].trim() });
    }
    for (const match of value.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      links.push({ href: match[2].trim(), label: match[1].trim() });
    }
  };
  post.contentSections.forEach((section) => section.paragraphs.forEach(collect));
  if (post.relatedServiceSlug) {
    const value = post.relatedServiceSlug.trim();
    if (value.startsWith('/')) links.push({ href: value, label: 'Related service' });
    else if (/^https?:\/\//i.test(value)) links.push({ href: value, label: 'Related service' });
    else links.push({ href: `/services/${value}`, label: 'Related service' });
  }
  return links;
}

interface ImageReference {
  label: string;
  source: string;
  altText: string;
  decorative: boolean;
  checkAlt: boolean;
  editorAnchor: string;
}

function imageReferences(post: BlogSeoArticle): ImageReference[] {
  const result: ImageReference[] = [];
  const addVariant = (
    label: string,
    source: string | undefined,
    altText: string,
    anchor: string,
    decorative = false,
    checkAlt = true,
  ) => {
    if (source) result.push({ label, source, altText, decorative, checkAlt, editorAnchor: anchor });
  };
  addVariant('Featured image', post.featuredImage, post.featuredImageAltText || '', 'featured-image');
  for (const [theme, variant] of Object.entries(post.featuredImageVariants || {})) {
    addVariant(`Featured image · ${theme} mode`, variant?.url, variant?.altText || post.featuredImageAltText || '', 'featured-image');
  }
  for (const [index, image] of (post.inlineImages || []).entries()) {
    const anchor = image.id ? `image-${image.id}` : 'article-images';
    addVariant(`Article image ${index + 1}`, image.url, image.altText || '', anchor, image.decorative === true);
    for (const [theme, variant] of Object.entries(image.imageVariants || {})) {
      addVariant(`Article image ${index + 1} · ${theme} mode`, variant?.url, variant?.altText || image.altText || '', anchor, image.decorative === true);
    }
  }
  addVariant('Social-sharing image', post.socialImage, '', 'social-metadata', false, false);
  for (const [theme, variant] of Object.entries(post.socialImageVariants || {})) {
    addVariant(`Social-sharing image · ${theme} mode`, variant?.url, '', 'social-metadata', false, false);
  }
  return result;
}

function normalizedUrl(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function analyzeBlogSeo(
  post: BlogSeoArticle,
  allPosts: readonly BlogSeoArticle[],
  context: BlogSeoAnalysisContext,
): BlogSeoAnalysis {
  const findings: BlogSeoFinding[] = [];
  const evaluated: BlogSeoCheck[] = [];
  const record = (
    id: typeof checks[number]['id'],
    status: BlogSeoCheckStatus,
    evidence: string,
  ) => {
    const definition = checks.find((check) => check.id === id)!;
    evaluated.push({ ...definition, status, evidence });
  };

  const effectiveTitle = (post.metaTitle || post.title || '').trim();
  if (!effectiveTitle) {
    record('title', 'critical', 'The rendered article has no effective page title.');
    addFinding(findings, 'title', 'critical', 'Missing effective page title', 'Page title', 'Both the SEO title and article title are empty.', 'Add an article title or an explicit SEO title.', 'seo-title');
  } else {
    record('title', 'passed', `The public renderer uses “${effectiveTitle}”.`);
  }

  const effectiveDescription = (post.metaDescription || post.excerpt || '').trim();
  if (!effectiveDescription) {
    record('description', 'critical', 'The public renderer has no effective description.');
    addFinding(findings, 'description', 'critical', 'Missing effective meta description', 'Meta description', 'The meta description and renderer fallback excerpt are empty.', 'Add a concise meta description or an article excerpt.', 'seo-description');
  } else {
    record('description', 'passed', `The public renderer uses the saved description${post.metaDescription?.trim() ? '' : ' fallback excerpt'}.`);
  }

  const titleMatches = effectiveTitle ? allPosts.filter((item) => item.id !== post.id && item.slug !== post.slug &&
    normalizedUrl(item.metaTitle || item.title || '') === normalizedUrl(effectiveTitle)) : [];
  if (titleMatches.length) {
    record('duplicate-title', 'warning', `Matches ${titleMatches.map((item) => item.title).join('; ')}.`);
    addFinding(findings, 'duplicate-title', 'warning', 'Duplicate effective page title', 'SEO title', `The effective title also appears on ${titleMatches.map((item) => `“${item.title}”`).join(', ')}.`, 'Differentiate the page title so each article has a distinct search result.', 'seo-title');
  } else if (effectiveTitle) record('duplicate-title', 'passed', 'No other saved blog has the same effective title.');
  else record('duplicate-title', 'not_checked', 'A title is required before duplicate-title comparison is meaningful.');

  const descriptionMatches = effectiveDescription ? allPosts.filter((item) => item.id !== post.id && item.slug !== post.slug &&
    normalizedUrl(item.metaDescription || item.excerpt || '') === normalizedUrl(effectiveDescription)) : [];
  if (descriptionMatches.length) {
    record('duplicate-description', 'warning', `Matches ${descriptionMatches.map((item) => item.title).join('; ')}.`);
    addFinding(findings, 'duplicate-description', 'warning', 'Duplicate effective meta description', 'Meta description', `The effective description also appears on ${descriptionMatches.map((item) => `“${item.title}”`).join(', ')}.`, 'Write a description that reflects this article specifically.', 'seo-description');
  } else if (effectiveDescription) record('duplicate-description', 'passed', 'No other saved blog has the same effective description.');
  else record('duplicate-description', 'not_checked', 'A description is required before duplicate-description comparison is meaningful.');

  const bodyText = post.contentSections.flatMap((section) => [section.heading, ...section.paragraphs])
    .map((value) => plainText(value.replace(/data-blog-image-id=["'][^"']+["']/g, '')))
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!bodyText) {
    record('body', 'critical', 'No readable heading or body text is saved.');
    addFinding(findings, 'body', 'critical', 'Article body is empty', 'Article body', 'No readable text was found in the saved article sections.', 'Add the intended article content. Image markers alone are not article text.', 'article-content');
  } else record('body', 'passed', 'Readable text exists in the saved article body.');

  const emptyHeadings = post.contentSections.flatMap((section, index) =>
    !plainText(section.heading) ? [`Section ${index + 1}`] : []);
  const placeholders = post.contentSections.flatMap((section, index) =>
    /\b(?:todo|tbd|lorem ipsum|untitled|heading here|add content here)\b/i.test(section.heading)
      ? [`Section ${index + 1}: ${section.heading}`]
      : []);
  if (emptyHeadings.length || placeholders.length) {
    const evidence = [...emptyHeadings, ...placeholders].join('; ');
    record('headings', 'warning', evidence);
    addFinding(findings, 'headings', 'warning', 'Heading structure needs editorial review', 'Article headings', evidence, 'Review the listed headings for missing or unfinished text.', 'article-content');
  } else if (post.contentSections.length) record('headings', 'passed', 'Saved section headings are present and contain no recognized placeholder text.');
  else record('headings', 'not_checked', 'No article sections are available to evaluate.');

  if (!post.author?.name?.trim() || !post.author?.role?.trim()) {
    record('author', 'warning', 'The article template expects an author name and role.');
    addFinding(findings, 'author', 'warning', 'Author information is incomplete', 'Author details', `Author name: ${post.author?.name?.trim() ? 'present' : 'missing'}; role: ${post.author?.role?.trim() ? 'present' : 'missing'}.`, 'Complete the author name and role shown in the article template.', 'article-author');
  } else record('author', 'passed', 'The rendered article has an author name and role.');

  const brokenInternalLinks: { href: string; label: string }[] = [];
  const uncheckedExternalLinks: { href: string; label: string }[] = [];
  const uncheckedInternalLinks: { href: string; label: string }[] = [];
  for (const link of extractLinks(post)) {
    try {
      const url = new URL(link.href, context.canonicalOrigin);
      if (url.origin !== context.canonicalOrigin) {
        if (url.protocol === 'http:' || url.protocol === 'https:') uncheckedExternalLinks.push(link);
        continue;
      }
      const normalizedPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
      if (context.knownInternalPaths.has(normalizedPath)) continue;
      if (/^\/(?:services|catalogue)\/[a-z0-9-]+$/.test(normalizedPath)) uncheckedInternalLinks.push(link);
      else brokenInternalLinks.push(link);
    } catch {
      brokenInternalLinks.push(link);
    }
  }
  if (brokenInternalLinks.length) {
    record('internal-links', 'critical', brokenInternalLinks.map((link) => `${link.label}: ${link.href}`).join('; '));
    for (const link of brokenInternalLinks) {
      addFinding(findings, 'internal-links', 'critical', 'Broken internal link', 'Article link', `${link.label}: ${link.href}`, 'Correct the URL or remove the link. Only a destination missing from the current saved route inventory is reported as broken.', 'article-content');
    }
  } else if (uncheckedExternalLinks.length || uncheckedInternalLinks.length) {
    record('internal-links', 'not_checked', `No broken known internal destinations found. ${uncheckedExternalLinks.length} external and ${uncheckedInternalLinks.length} managed service/catalogue destination(s) were not fetched.`);
  } else record('internal-links', 'passed', 'All detected same-site links match a known site route.');

  const images = imageReferences(post);
  const brokenImages = images.filter((image) => context.missingLocalImageSources?.has(image.source));
  const uncheckedImages = images.filter((image) => !image.source.startsWith('/uploads/blog/'));
  if (brokenImages.length) {
    record('image-sources', 'critical', brokenImages.map((image) => `${image.label}: ${image.source}`).join('; '));
    for (const image of brokenImages) {
      addFinding(findings, 'image-sources', 'critical', 'Missing first-party image file', image.label, `${image.source} is a first-party upload reference whose file is not present in the configured upload store.`, 'Restore the asset or replace it with an available image.', image.editorAnchor);
    }
  } else if (uncheckedImages.length) {
    record('image-sources', 'not_checked', `${images.length - uncheckedImages.length} uploaded image source(s) checked; ${uncheckedImages.length} remote or embedded image source(s) were not verified.`);
  } else if (images.length) record('image-sources', 'passed', 'All first-party uploaded image files referenced by the article exist.');
  else record('image-sources', 'not_applicable', 'No article image sources are configured.');

  const missingAlt = images.filter((image) => image.checkAlt && !image.decorative && !image.altText.trim());
  if (missingAlt.length) {
    record('image-alt', 'warning', missingAlt.map((image) => image.label).join('; '));
    for (const image of missingAlt) {
      addFinding(findings, 'image-alt', 'warning', 'Image alternative text is missing', image.label, `${image.label} has an empty effective alt value and is not marked decorative.`, 'Add concise alt text for an informative image, or mark it decorative if it conveys no content.', image.editorAnchor);
    }
  } else if (images.length) record('image-alt', 'passed', 'Every configured image has effective alt text or is explicitly decorative.');
  else record('image-alt', 'not_applicable', 'No article images are configured.');
  if (images.length) record('image-dimensions', 'not_checked', 'Intrinsic dimensions were not measured; image dimension attributes and layout-shift risk are not asserted.');
  else record('image-dimensions', 'not_applicable', 'No article images are configured.');

  const canonicalPath = `/blog/${post.slug}`;
  if (post.status === 'published') {
    const expected = `${context.canonicalOrigin}${canonicalPath}`;
    record('canonical', 'passed', `The server renderer emits ${expected} as the canonical URL for this article route.`);
    record('robots', 'passed', 'The public renderer marks a published article indexable; indexing by search engines is unknown.');
    record('sitemap', 'passed', 'The generated sitemap includes all saved articles whose status is published.');
  } else {
    record('canonical', 'not_applicable', 'Drafts do not have a public canonical article URL.');
    record('robots', 'not_applicable', 'Drafts are not public and are excluded from indexing checks.');
    record('sitemap', 'not_applicable', 'Draft articles are excluded from the public sitemap.');
  }

  if (post.socialTitle?.trim() || post.socialImage?.trim() ||
    Object.values(post.socialImageVariants || {}).some((variant) => Boolean(variant?.url?.trim()))) {
    record('social', 'passed', 'At least one article-specific social-sharing value is configured.');
  } else {
    record('social', 'warning', 'No article-specific social title or image is configured; the renderer may fall back to site defaults.');
    addFinding(findings, 'social', 'warning', 'Social-sharing metadata could be more specific', 'Social sharing', 'No article-specific social title or image is configured.', 'Optionally add a social title or image to improve how this article is presented when shared.', 'social-metadata');
  }

  const checkedWeight = evaluated
    .filter((check) => check.status !== 'not_applicable' && check.status !== 'not_checked')
    .reduce((total, check) => total + check.weight, 0);
  const earnedWeight = evaluated.reduce((total, check) => total + (
    check.status === 'passed' ? check.weight : check.status === 'warning' ? check.weight / 2 : 0
  ), 0);
  const totalApplicableWeight = evaluated
    .filter((check) => check.status !== 'not_applicable')
    .reduce((total, check) => total + check.weight, 0);

  return {
    articleId: context.articleId,
    slug: post.slug,
    sourceRevision: context.sourceRevision,
    analyzerVersion: BLOG_SEO_ANALYZER_VERSION,
    scannedAt: context.scannedAt,
    score: checkedWeight ? Math.round((earnedWeight / checkedWeight) * 100) : 0,
    coverage: totalApplicableWeight ? Math.round((checkedWeight / totalApplicableWeight) * 100) : 0,
    provisional: evaluated.some((check) => check.status === 'not_checked') ||
      uncheckedExternalLinks.length > 0 || uncheckedInternalLinks.length > 0 || uncheckedImages.length > 0,
    checks: evaluated,
    findings,
  };
}

export function blogSeoGrade(score: number): 'Needs improvement' | 'Fair' | 'Good' {
  if (score < 60) return 'Needs improvement';
  if (score < 80) return 'Fair';
  return 'Good';
}

export function blogSeoNeedsAttention(analysis: BlogSeoAnalysis | undefined, stale = false): boolean {
  if (!analysis || stale || analysis.analyzerVersion !== BLOG_SEO_ANALYZER_VERSION) return false;
  return analysis.score < 80 || analysis.findings.some((finding) =>
    finding.severity === 'critical' || finding.severity === 'warning');
}
