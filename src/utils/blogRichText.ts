import { resolveBlogImage, type BlogPost } from '../data/blogData';
import type { PublicImageTheme } from '../data/themeImages';
import { isSupportedBlogImageWidth } from '../data/blogImagePlacement';

const allowedTags = new Set([
  'a', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'div', 'em', 'figure', 'figcaption', 'h2', 'h3', 'h4',
  'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'table', 'tbody', 'td',
  'th', 'thead', 'tr', 'u', 'ul',
]);
const discardedTags = new Set(['iframe', 'object', 'script', 'style', 'svg', 'math', 'template']);

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function safeHref(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value, window.location.origin).protocol);
  } catch {
    return false;
  }
}

function safeImageSource(value: string): boolean {
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) return true;
  try {
    return ['http:', 'https:'].includes(new URL(value, window.location.origin).protocol);
  } catch {
    return false;
  }
}

type InlineImage = NonNullable<BlogPost['inlineImages']>[number];

export function blogImageMarker(id: string): string {
  return `<span data-blog-image-id="${escapeHtml(id)}"></span>`;
}

export function sanitizeBlogHtml(value: string, inlineImages?: InlineImage[], theme: PublicImageTheme = 'dark'): string {
  const document = new DOMParser().parseFromString(value, 'text/html');
  const renderedImageIds = new Set<string>();
  if (inlineImages?.length) {
    Array.from(document.body.querySelectorAll<HTMLElement>('span[data-blog-image-id], figure[data-blog-image-id]')).forEach((marker) => {
      const id = marker.dataset.blogImageId || '';
      const image = inlineImages.find((candidate) => candidate.id === id);
      if (!image) return;
      if (renderedImageIds.has(id)) {
        marker.remove();
        return;
      }
      renderedImageIds.add(id);
      const block = marker.closest('p, h2, h3, h4, blockquote, li');
      const placeholder = document.createElement('figure');
      placeholder.setAttribute('data-blog-image-id', id);
      if (!block?.parentNode) {
        marker.replaceWith(placeholder);
        return;
      }
      const leftRange = document.createRange();
      leftRange.selectNodeContents(block);
      leftRange.setEndBefore(marker);
      const rightRange = document.createRange();
      rightRange.selectNodeContents(block);
      rightRange.setStartAfter(marker);
      const leftContent = leftRange.cloneContents();
      const rightContent = rightRange.cloneContents();
      const createFragmentBlock = (content: DocumentFragment) => {
        if (!content.textContent && !content.querySelector('br, img, table, ul, ol')) return null;
        const fragmentBlock = block.cloneNode(false) as Element;
        fragmentBlock.append(content);
        return fragmentBlock;
      };
      const leftBlock = createFragmentBlock(leftContent);
      const rightBlock = createFragmentBlock(rightContent);
      const parent = block.parentNode;
      if (leftBlock) parent.insertBefore(leftBlock, block);
      parent.insertBefore(placeholder, block);
      if (rightBlock) parent.insertBefore(rightBlock, block);
      block.remove();
    });
  }

  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (discardedTags.has(tag)) return '';

    if ((tag === 'figure' || tag === 'span') && node.getAttribute('data-blog-image-id')) {
      const id = node.getAttribute('data-blog-image-id') || '';
      const image = inlineImages?.find((candidate) => candidate.id === id);
      if (image) return renderInlineImage(image, theme);
      return `<span data-blog-image-id="${escapeHtml(id)}"></span>`;
    }
    const children = Array.from(node.childNodes).map(serialize).join('');
    if (!allowedTags.has(tag)) return children;

    const attributes: string[] = [];
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (safeHref(href)) attributes.push(`href="${escapeHtml(href)}"`);
      const title = node.getAttribute('title');
      if (title) attributes.push(`title="${escapeHtml(title.slice(0, 200))}"`);
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (!safeImageSource(src)) return '';
      attributes.push(`src="${escapeHtml(src)}"`);
      attributes.push(`alt="${escapeHtml((node.getAttribute('alt') || '').slice(0, 300))}"`);
      attributes.push('loading="lazy"');
      attributes.push('style="width:auto;max-width:100%;height:auto"');
    }
    if (tag === 'figure' || tag === 'span') {
      const id = node.getAttribute('data-blog-image-id');
      if (id && /^[a-zA-Z0-9-]{1,80}$/.test(id)) attributes.push(`data-blog-image-id="${escapeHtml(id)}"`);
    }
    const alignment = node instanceof HTMLElement ? node.style.textAlign : '';
    if (['left', 'center', 'right'].includes(alignment)) {
      attributes.push(`style="text-align:${alignment}"`);
    }
    if (tag === 'ol') {
      const start = Number(node.getAttribute('start'));
      if (Number.isInteger(start) && start > 1 && start < 10000) attributes.push(`start="${start}"`);
    }
    const attrs = attributes.length ? ` ${attributes.join(' ')}` : '';
    if (tag === 'br' || tag === 'img') return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${children}</${tag}>`;
  };

  return Array.from(document.body.childNodes).map(serialize).join('');
}

function renderInlineImage(image: InlineImage, theme: PublicImageTheme): string {
  const resolved = resolveBlogImage(image.url, image.altText, image.imageVariants, theme).image;
  if (!safeImageSource(resolved.url)) return '';
  const width = isSupportedBlogImageWidth(image.width)
    ? image.width
    : '50%';
  const alignment = image.alignment || 'center';
  const layout = image.layout || 'standalone';
  const above = Number.isInteger(image.spacingAbove) ? Math.max(0, Math.min(120, image.spacingAbove!)) : 16;
  const below = Number.isInteger(image.spacingBelow) ? Math.max(0, Math.min(120, image.spacingBelow!)) : 16;
  const flow = layout === 'wrap-left' ? 'float:left;margin-right:1rem' : layout === 'wrap-right' ? 'float:right;margin-left:1rem' : '';
  const alignMargins = layout === 'standalone'
    ? alignment === 'left' ? 'margin-left:0;margin-right:auto'
      : alignment === 'right' ? 'margin-left:auto;margin-right:0'
        : 'margin-left:auto;margin-right:auto'
    : '';
  const figureStyle = `width:fit-content;max-width:min(${width},100%);margin-top:${above}px;margin-bottom:${below}px;${flow};${alignMargins}`;
  const caption = image.caption.trim()
    ? `<figcaption class="blog-inline-image-caption">${escapeHtml(image.caption.trim().slice(0, 500))}</figcaption>`
    : '';
  return `<figure class="blog-inline-image" data-blog-image-id="${escapeHtml(image.id || '')}" style="${figureStyle}"><img src="${escapeHtml(resolved.url)}" alt="${escapeHtml(resolved.altText || '')}" loading="lazy" style="display:block;width:auto;max-width:100%;height:auto;object-fit:contain">${caption}</figure>`;
}

function markdownInline(value: string): string {
  let result = escapeHtml(value);
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
  result = result.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return result;
}

export function blogTextToEditorHtml(value: string): string {
  if (/<(?:a|b|blockquote|br|code|del|div|em|figure|figcaption|h[2-4]|i|img|li|ol|p|pre|s|span|strike|strong|table|u|ul)\b/i.test(value)) {
    return sanitizeBlogHtml(value);
  }
  const alignment = value.match(/^:::align-(left|center|right)\n([\s\S]*?)\n:::$/);
  if (alignment) return `<p style="text-align:${alignment[1]}">${markdownInline(alignment[2]).replaceAll('\n', '<br>')}</p>`;
  const lines = value.split('\n');
  const heading = lines.length === 1 ? lines[0].match(/^(#{2,4})\s+(.+)$/) : null;
  if (heading) return `<h${heading[1].length}>${markdownInline(heading[2])}</h${heading[1].length}>`;
  const listItems = lines.map((line) => line.match(/^\s*([-*]|\d+\.)\s+(.+)$/));
  if (listItems.every(Boolean) && listItems.length) {
    const ordered = /^\d/.test(listItems[0]![1]);
    return `<${ordered ? 'ol' : 'ul'}>${listItems.map((item) => `<li>${markdownInline(item![2])}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  }
  if (lines.every((line) => /^>\s?/.test(line))) {
    return `<blockquote>${lines.map((line) => markdownInline(line.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
  }
  const separator = lines[1]?.replaceAll('|', '').trim();
  if (lines.length >= 2 && lines[0].includes('|') && separator && /^:?-{3,}:?$/.test(separator)) {
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    const [header, ...rows] = lines;
    return `<table><thead><tr>${cells(header).map((cell) => `<th>${markdownInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).filter((line) => line.includes('|')).map((line) => `<tr>${cells(line).map((cell) => `<td>${markdownInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  return `<p>${markdownInline(value).replaceAll('\n', '<br>')}</p>`;
}
