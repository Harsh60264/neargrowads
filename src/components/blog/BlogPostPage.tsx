import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveBlogImage, type BlogPost } from '../../data/blogData';
import type { PublicImageTheme } from '../../data/themeImages';
import { ArrowLeft, ArrowRight, Calendar, Check, ChevronRight, Clock, Copy, ListTree, Share2, User } from 'lucide-react';
import { blogImageMarker, sanitizeBlogHtml } from '../../utils/blogRichText';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';

interface BlogPostPageProps {
  post: BlogPost;
  onNavigate: (path: string) => void;
  theme: PublicImageTheme;
  previewEditing?: {
    onPosition: (sectionIndex: number, destination: 'before-heading' | 'after-heading' | 'section-end' | `paragraph-start:${number}` | `paragraph-end:${number}`) => void;
    onSelectImage: (imageId: string) => void;
  };
}

const headingId = (heading: string, index: number) =>
  `article-section-${index}-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

const inlinePattern = /(\*\*.+?\*\*|~~.+?~~|\+\+.+?\+\+|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;

function FormattedText({ text }: { text: string }) {
  return text.split(inlinePattern).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('~~') && part.endsWith('~~')) return <del key={index}>{part.slice(2, -2)}</del>;
    if (part.startsWith('++') && part.endsWith('++')) return <u key={index}>{part.slice(2, -2)}</u>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[0.9em] text-[#A8EBD6]">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      try {
        const url = new URL(link[2], window.location.origin);
        if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return <a key={index} href={link[2]} target={url.origin === window.location.origin ? undefined : '_blank'} rel="noreferrer" className="text-[#8FE1A0] underline underline-offset-4">{link[1]}</a>;
      } catch { /* Invalid URLs remain plain text. */ }
    }
    return <span key={index}>{part}</span>;
  });
}

function FormattedParagraph({ text }: { text: string }) {
  const alignment = text.match(/^:::align-(left|center|right)\n([\s\S]*?)\n:::$/);
  const content = alignment ? alignment[2] : text;
  const align = (alignment?.[1] || 'left') as 'left' | 'center' | 'right';
  const lines = content.split('\n');
  const heading = lines.length === 1 ? lines[0].match(/^(#{2,4})\s+(.+)$/) : null;
  if (heading) {
    const className = 'font-bold leading-tight tracking-tight text-white';
    if (heading[1].length === 2) return <h2 className={`${className} text-2xl sm:text-3xl`}><FormattedText text={heading[2]} /></h2>;
    if (heading[1].length === 3) return <h3 className={`${className} text-xl sm:text-2xl`}><FormattedText text={heading[2]} /></h3>;
    return <h4 className={`${className} text-lg sm:text-xl`}><FormattedText text={heading[2]} /></h4>;
  }
  const tableSeparator = lines[1]?.replaceAll('|', '').trim();
  if (lines.length >= 2 && lines[0].includes('|') && tableSeparator && /^:?-{3,}:?$/.test(tableSeparator)) {
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    return (
      <div className="blog-rich-table overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-white/[0.06]"><tr>{cells(lines[0]).map((cell, index) => <th key={index} className="border-b border-white/10 px-3 py-2 font-semibold text-white"><FormattedText text={cell} /></th>)}</tr></thead>
          <tbody>{lines.slice(2).filter((line) => line.includes('|')).map((line, rowIndex) => <tr key={rowIndex}>{cells(line).map((cell, cellIndex) => <td key={cellIndex} className="border-b border-white/[0.06] px-3 py-2 text-white/65"><FormattedText text={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (lines.every((line) => /^>\s?/.test(line))) return <blockquote className="border-l-2 border-[#67D8B7] pl-4 text-[#C4E9DB]">{lines.map((line, index) => <span key={index}>{index > 0 && <br />}{line.replace(/^>\s?/, '')}</span>)}</blockquote>;
  const listMarker = lines[0]?.match(/^(\s*)([-*]|\d+\.)\s+/)?.[2];
  if (listMarker && lines.every((line) => /^(\s*)([-*]|\d+\.)\s+/.test(line))) {
    const items = lines.map((line) => line.replace(/^(\s*)([-*]|\d+\.)\s+/, ''));
    const ItemList = /^\d/.test(listMarker) ? 'ol' : 'ul';
    return <ItemList className={`space-y-2 pl-6 text-[15px] leading-8 text-white/65 ${ItemList === 'ol' ? 'list-decimal' : 'list-disc'}`} style={{ textAlign: align }}>{items.map((item, index) => <li key={index}><FormattedText text={item} /></li>)}</ItemList>;
  }
  return <p className="text-[15px] leading-8 text-white/65 sm:text-base sm:leading-8" style={{ textAlign: align }}>{lines.map((line, index) => <span key={index}>{index > 0 && <br />}<FormattedText text={line} /></span>)}</p>;
}

function ContentParagraph({ text, images, theme }: { text: string; images: NonNullable<BlogPost['inlineImages']>; theme: PublicImageTheme }) {
  const codeBlock = text.match(/^```([a-zA-Z0-9+#.-]*)\s*\n([\s\S]*?)\n```$/);
  if (codeBlock) {
    return (
      <div className="blog-code-block overflow-hidden rounded-2xl border border-white/10 bg-[#060B12]">
        {codeBlock[1] && <div className="blog-code-language border-b border-white/[0.07] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8FE1A0]">{codeBlock[1]}</div>}
        <pre className="overflow-x-auto p-4 text-xs leading-6 text-[#D2E4DE] sm:p-5 sm:text-sm"><code>{codeBlock[2]}</code></pre>
      </div>
    );
  }
  if (/<(?:a|b|blockquote|br|code|div|em|figure|figcaption|h[2-4]|i|img|li|ol|p|pre|s|span|strike|strong|table|u|ul)\b/i.test(text)) {
    return <div className="blog-rich-content space-y-3 text-[15px] leading-8 text-white/65 sm:text-base sm:leading-8 [&_a]:text-[#8FE1A0] [&_blockquote]:border-l-2 [&_blockquote]:border-[#67D8B7] [&_blockquote]:pl-4 [&_figcaption]:px-2 [&_figcaption]:pt-2 [&_figcaption]:text-center [&_figcaption]:text-xs [&_figcaption]:leading-5 [&_figcaption]:text-white/55 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-white [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-white [&_h4]:text-lg [&_h4]:font-bold [&_h4]:text-white [&_li]:ml-6 [&_ol]:list-decimal [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-white/10 [&_td]:p-2 [&_th]:border [&_th]:border-white/10 [&_th]:p-2 [&_th]:font-bold [&_th]:text-white [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: sanitizeBlogHtml(text, images, theme) }} />;
  }
  return <FormattedParagraph text={text} />;
}

export const BlogPostPage = ({ post, onNavigate, theme, previewEditing }: BlogPostPageProps) => {
  const [copied, setCopied] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(
    () => post.contentSections.map((section, index) => ({ ...section, id: headingId(section.heading, index), contentId: section.id })),
    [post.contentSections],
  );
  const inlineImages = post.inlineImages || [];
  const placedImage = (sectionId: string | undefined, placement: 'before-heading' | 'after-heading' | 'section-end') =>
    inlineImages.filter((image) => image.sectionId === sectionId && image.placement === placement);
  const renderPlacedImages = (images: typeof inlineImages) => images.map((image, index) => image.id
    ? <div key={image.id} style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: sanitizeBlogHtml(blogImageMarker(image.id), inlineImages, theme) }} />
    : <figure key={`${image.url}-${index}`} data-blog-image-index={inlineImages.indexOf(image)} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0D1724]">
      <img src={resolveBlogImage(image.url, image.altText, image.imageVariants, theme).image.url} alt={resolveBlogImage(image.url, image.altText, image.imageVariants, theme).image.altText ?? ''} loading="lazy" className="max-h-[620px] w-full object-cover" />
      {image.caption && <figcaption className="px-4 py-3 text-center text-xs leading-5 text-white/55 sm:px-6">{image.caption}</figcaption>}
    </figure>);

  useEffect(() => {
    let frame = 0;
    const updateProgress = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0;
        progressRef.current?.setAttribute('aria-valuenow', String(Math.round(progress)));
        progressFillRef.current?.style.setProperty('transform', `scaleX(${progress / 100})`);
      });
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('resize', updateProgress);
    };
  }, [post.slug]);

  useEffect(() => {
    if (previewEditing) return;
    const originalTitle = document.title;
    document.title = post.metaTitle || post.title;
    const canonicalOrigin = import.meta.env.VITE_SITE_URL || window.location.origin;
    const canonicalUrl = new URL(window.location.pathname, `${canonicalOrigin.replace(/\/+$/, '')}/`).href;
    const metaValues = [
      ['name', 'description', post.metaDescription || post.excerpt],
      ['property', 'og:type', 'article'],
      ['property', 'og:url', canonicalUrl],
      ['property', 'og:title', post.socialTitle || post.metaTitle || post.title],
      ['property', 'og:description', post.metaDescription || post.excerpt],
      ['property', 'og:image', resolveBlogImage(post.socialImage, '', post.socialImageVariants, theme).image.url || resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', post.socialTitle || post.metaTitle || post.title],
      ['name', 'twitter:description', post.metaDescription || post.excerpt],
      ['name', 'twitter:image', resolveBlogImage(post.socialImage, '', post.socialImageVariants, theme).image.url || resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url],
    ] as const;
    const previousMeta = metaValues.map(([attribute, name, content]) => {
      const selector = `meta[${attribute}="${name}"]`;
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      const created = !element;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, name);
        document.head.append(element);
      }
      const previousContent = element.getAttribute('content');
      element.setAttribute('content', content);
      return { element, created, previousContent };
    });
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.href;
    canonical?.setAttribute('href', canonicalUrl);

    return () => {
      document.title = originalTitle;
      previousMeta.forEach(({ element, created, previousContent }) => {
        if (created) element.remove();
        else if (previousContent === null) element.removeAttribute('content');
        else element.setAttribute('content', previousContent);
      });
      if (canonical && previousCanonical) canonical.href = previousCanonical;
    };
  }, [post.excerpt, post.featuredImage, post.featuredImageAltText, post.featuredImageVariants, post.metaDescription, post.metaTitle, post.socialImage, post.socialImageVariants, post.socialTitle, post.title, theme, previewEditing]);

  const shareArticle = async () => {
    const canonicalOrigin = import.meta.env.VITE_SITE_URL || window.location.origin;
    const url = new URL(window.location.pathname, `${canonicalOrigin.replace(/\/+$/, '')}/`).href;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, text: post.excerpt, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setCopied(false);
    }
  };

  const initials = post.author.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NG';
  const serviceValue = post.relatedServiceSlug.trim();
  let relatedServiceUrl = `/services/${encodeURIComponent(serviceValue)}`;
  let relatedServiceExternal = false;
  try {
    const parsed = new URL(serviceValue, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.origin === window.location.origin && serviceValue.startsWith('/')) relatedServiceUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      else if (/^https?:\/\//i.test(serviceValue)) {
        relatedServiceUrl = parsed.href;
        relatedServiceExternal = true;
      }
    }
  } catch {
    relatedServiceUrl = `/services/${encodeURIComponent(serviceValue)}`;
  }
  if (serviceValue.startsWith('/') && !relatedServiceExternal) {
    try {
      const parsed = new URL(serviceValue, window.location.origin);
      relatedServiceUrl = parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/services';
    } catch {
      relatedServiceUrl = '/services';
    }
  }

  return (
    <div className="blog-post-page min-h-screen overflow-hidden bg-[#080E16] text-white" data-public-theme={theme}>
      <div ref={progressRef} role="progressbar" aria-label="Article reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className="fixed inset-x-0 top-0 z-[60] h-1 bg-white/5">
        <div ref={progressFillRef} className="h-full origin-left bg-gradient-to-r from-[#008A55] to-[#8FE1A0]" style={{ transform: 'scaleX(0)' }} />
      </div>

      <div className="border-b border-white/[0.06] bg-[#0A121D]">
        <nav aria-label="Breadcrumb" className="mx-auto flex max-w-7xl items-center gap-2 overflow-hidden px-4 py-3 text-xs text-white/45 sm:px-6 lg:px-8">
          <button type="button" onClick={() => onNavigate('/')} className="shrink-0 transition-colors hover:text-white">Home</button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/25" />
          <button type="button" onClick={() => onNavigate('/blog')} className="shrink-0 transition-colors hover:text-white">Insights</button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/25" />
          <span className="truncate text-white/75">{post.title}</span>
        </nav>
      </div>

      <header className="relative isolate overflow-hidden border-b border-white/[0.06]">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_5%,rgba(0,138,85,0.16),transparent_42%),linear-gradient(180deg,#0B1420,#080E16)]" />
        <HeroOrbitBackground ambient />
        <div className="relative z-10 mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-white/55">
              <span className="rounded-full border border-[#67D8B7]/20 bg-[#67D8B7]/[0.07] px-3 py-1.5 font-bold uppercase tracking-[0.12em] text-[#A8EBD6]">{post.category}</span>
              <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-[#8FE1A0]" />{post.publishedDate}</span>
              <span aria-hidden="true" className="text-white/25">·</span>
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#8FE1A0]" />{post.readTime}</span>
            </div>
            <h1 className="mt-6 max-w-4xl text-3xl font-extrabold leading-[1.12] tracking-tight text-white [text-wrap:balance] sm:text-4xl md:text-5xl lg:text-6xl">{post.title}</h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-white/60 sm:text-lg sm:leading-8">{post.excerpt}</p>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-5 border-t border-white/10 pt-6">
              <div className="flex min-w-0 items-center gap-3">
                {resolveBlogImage(post.author.imageUrl, post.author.name, post.author.imageVariants, theme).image.url
                  ? <img src={resolveBlogImage(post.author.imageUrl, post.author.name, post.author.imageVariants, theme).image.url} alt="" className="h-11 w-11 shrink-0 rounded-full border border-white/10 object-cover" />
                  : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#67D8B7]/20 bg-[#67D8B7]/10 text-xs font-bold text-[#A8EBD6]"><User className="h-5 w-5" /></span>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{post.author.name || initials}</p>
                  <p className="mt-0.5 truncate text-xs text-white/45">{post.author.role || 'NearGrow Ads'} · NearGrow Ads</p>
                </div>
              </div>
              <button type="button" onClick={() => void shareArticle()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-xs font-semibold text-white/75 transition-colors hover:border-[#67D8B7]/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]">
                {copied ? <Check className="h-4 w-4 text-[#8FE1A0]" /> : <Share2 className="h-4 w-4" />}
                {copied ? 'Link copied' : 'Share article'}
                {!navigator.share && <Copy className="h-3.5 w-3.5 text-white/35" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url && (
        <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
          <img src={resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url} alt={resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.altText ?? ''} fetchPriority="high" className="aspect-[16/8] max-h-[620px] w-full rounded-2xl border border-white/10 object-cover shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:rounded-3xl" />
        </div>
      )}

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[220px_minmax(0,760px)] lg:justify-center lg:gap-14 lg:px-8 lg:py-20">
        <aside className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start">
          {sections.length > 0 && (
            <nav aria-label="Table of contents" className="rounded-2xl border border-white/[0.08] bg-[#0D1724] p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-white/75">
                <ListTree className="h-4 w-4 text-[#8FE1A0]" /> In this article
              </div>
              <ol className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
                {sections.map((section, index) => (
                  <li key={section.id} className="shrink-0 lg:shrink">
                    <a href={`#${section.id}`} className="block max-w-56 rounded-lg px-2.5 py-2 text-xs leading-relaxed text-white/50 transition-colors hover:bg-white/[0.04] hover:text-[#A8EBD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]">
                      <span className="mr-2 text-[#8FE1A0]/70">{String(index + 1).padStart(2, '0')}</span>{section.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </aside>

        <article
          className="min-w-0"
          onClick={(event) => {
            if (!previewEditing || !(event.target instanceof HTMLElement)) return;
            const image = event.target.closest<HTMLElement>('[data-blog-image-id], [data-blog-image-index]');
            const selectedId = image?.dataset.blogImageId || (image?.dataset.blogImageIndex ? `legacy:${image.dataset.blogImageIndex}` : '');
            if (selectedId) {
              event.preventDefault();
              previewEditing.onSelectImage(selectedId);
            }
          }}
        >
          <div className="space-y-12">
            {sections.map((section, sectionIndex) => (
              <section key={section.id} id={section.id} className={`scroll-mt-8 space-y-5 ${inlineImages.some((image) => image.sectionId === section.contentId && (image.layout === 'wrap-left' || image.layout === 'wrap-right')) ? 'flow-root' : ''}`}>
                {renderPlacedImages(placedImage(section.contentId, 'before-heading'))}
                {previewEditing && <button type="button" onClick={() => previewEditing.onPosition(sectionIndex, 'before-heading')} className="w-full rounded-lg border border-dashed border-[#67D8B7]/50 bg-[#67D8B7]/5 px-3 py-2 text-left text-[11px] font-semibold text-[#67D8B7]">＋ Insert before heading · {section.heading}</button>}
                <h2 className="border-b border-white/[0.08] pb-4 text-2xl font-bold leading-tight tracking-tight text-white [text-wrap:balance] sm:text-3xl">{section.heading}</h2>
                {renderPlacedImages(placedImage(section.contentId, 'after-heading'))}
                {previewEditing && <button type="button" onClick={() => previewEditing.onPosition(sectionIndex, 'after-heading')} className="w-full rounded-lg border border-dashed border-[#67D8B7]/50 bg-[#67D8B7]/5 px-3 py-2 text-left text-[11px] font-semibold text-[#67D8B7]">＋ Insert after heading · {section.heading}</button>}
                <div className="space-y-5">
                  {section.paragraphs.map((paragraph, paragraphIndex) => (
                    <div key={paragraphIndex}>
                      {previewEditing && <button type="button" onClick={() => previewEditing.onPosition(sectionIndex, `paragraph-start:${paragraphIndex}`)} className="mb-2 w-full rounded-lg border border-dashed border-[#67D8B7]/40 px-3 py-1.5 text-left text-[10px] font-semibold text-[#67D8B7]">＋ Insert before: {paragraph.replace(/<[^>]*>/g, '').slice(0, 90) || 'Empty content block'}</button>}
                      <ContentParagraph text={paragraph} images={inlineImages} theme={theme} />
                      {previewEditing && <button type="button" onClick={() => previewEditing.onPosition(sectionIndex, `paragraph-end:${paragraphIndex}`)} className="mt-2 w-full rounded-lg border border-dashed border-[#67D8B7]/40 px-3 py-1.5 text-left text-[10px] font-semibold text-[#67D8B7]">＋ Insert after content block</button>}
                    </div>
                  ))}
                </div>
                {section.callout && (
                  <aside className="relative overflow-hidden rounded-r-2xl border-l-2 border-[#67D8B7] bg-[#0D1C20] px-5 py-5 sm:px-7 sm:py-6">
                    <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-0 w-40 bg-gradient-to-r from-[#008A55]/10 to-transparent" />
                    <p className="relative text-sm leading-7 text-[#C4E9DB] sm:text-base">{section.callout}</p>
                  </aside>
                )}
                {renderPlacedImages([
                  ...placedImage(section.contentId, 'section-end'),
                  ...inlineImages.filter((image) => image.placement === undefined && image.afterSection === sectionIndex),
                ])}
                {previewEditing && <button type="button" onClick={() => previewEditing.onPosition(sectionIndex, 'section-end')} className="w-full rounded-lg border border-dashed border-[#67D8B7]/50 bg-[#67D8B7]/5 px-3 py-2 text-left text-[11px] font-semibold text-[#67D8B7]">＋ Insert at end of section · {section.heading}</button>}
              </section>
            ))}
          </div>

          {post.faqs && post.faqs.length > 0 && (
            <section className="mt-14 space-y-4" aria-labelledby="article-faq-heading">
              <h2 id="article-faq-heading" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Frequently asked questions</h2>
              <div className="divide-y divide-white/[0.08] rounded-2xl border border-white/[0.08] bg-[#0D1724] px-5 sm:px-7">
                {post.faqs.map((faq, index) => (
                  <details key={`${faq.question}-${index}`} className="group py-5">
                    <summary className="cursor-pointer list-none pr-6 text-base font-semibold text-white marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]">
                      {faq.question}
                    </summary>
                    <p className="pt-3 text-sm leading-7 text-white/60">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <section className="mt-14 rounded-3xl border border-white/10 bg-[#101A2A] p-6 sm:mt-20 sm:p-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8FE1A0]">Put the insight into action</p>
            <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white sm:text-2xl">Need help applying this strategy?</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">Explore practical support from the NearGrow Ads growth team.</p>
              </div>
              {relatedServiceExternal ? (
                <a href={relatedServiceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#45A849] px-5 text-xs font-bold text-white transition-colors hover:bg-[#378E3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]">
                  Explore service <ArrowRight className="h-4 w-4" />
                </a>
              ) : (
                <button type="button" onClick={() => onNavigate(relatedServiceUrl)} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#45A849] px-5 text-xs font-bold text-white transition-colors hover:bg-[#378E3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]">
                  Explore service <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </section>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] pt-6">
            <button type="button" onClick={() => onNavigate('/blog')} className="inline-flex items-center gap-2 text-xs font-semibold text-white/55 transition-colors hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Back to insights
            </button>
            <button type="button" onClick={() => onNavigate('/get-started')} className="inline-flex items-center gap-2 text-xs font-semibold text-[#8FE1A0] transition-colors hover:text-white">
              Request a consultation <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
};
