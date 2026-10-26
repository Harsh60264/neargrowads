import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BLOG_POSTS, blogAuthorDisplayName, resolveBlogImage, type BlogPost } from '../../data/blogData';
import { SERVICES } from '../../data/servicesData';
import { BLOG_CATEGORIES } from '../../data/blogCategories';
import type { BlogCategory } from '../../data/blogCategories';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Bold, CalendarDays, Check, CircleCheck, Clock3, Code2, Eye, FileText, Heading2, Heading3, Heading4, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, LoaderCircle, PenLine, Plus, Quote, Redo2, Search, Send, Strikethrough, Table2, Tag, Trash2, Underline, Undo2 } from 'lucide-react';
import { blogImageMarker, blogTextToEditorHtml, sanitizeBlogHtml } from '../../utils/blogRichText';
import { ImageThemeTabs } from './ImageThemeTabs';
import type { PublicImageTheme } from '../../data/themeImages';
import { isSupportedBlogImageWidth } from '../../data/blogImagePlacement';
import { BlogPostPage } from '../blog/BlogPostPage';
import { AdminBlogSeoHealth } from './AdminBlogSeoHealth';

interface BlogRecord extends BlogPost {
  status: 'draft' | 'published';
  featuredImage?: string;
  updatedAt: string;
}

interface Props {
  mode: 'list' | 'editor';
  onBack: () => void;
  onNavigate: (path: string) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canPublish?: boolean;
  canViewCategories?: boolean;
}

const seedPosts = (): BlogRecord[] => BLOG_POSTS.map((post) => ({
  ...post,
  status: post.status || 'published',
  metaDescription: post.metaDescription || '',
  author: { ...post.author, imageUrl: post.author.imageUrl || '' },
  featuredImage: post.featuredImage || '',
  metaTitle: post.metaTitle || '',
  focusKeywords: post.focusKeywords || [],
  socialTitle: post.socialTitle || '',
  socialImage: post.socialImage || '',
  faqs: post.faqs || [],
  inlineImages: post.inlineImages || [],
  updatedAt: post.updatedAt || post.publishedDate,
}));

const normalizePost = (post: BlogRecord): BlogRecord => ({
  ...post,
  metaDescription: post.metaDescription || '',
  author: {
    name: typeof post.author?.name === 'string' ? post.author.name : '',
    role: typeof post.author?.role === 'string' ? post.author.role : '',
    imageUrl: post.author?.imageUrl || '',
    ...(post.author?.imageVariants ? { imageVariants: post.author.imageVariants } : {}),
  },
  featuredImage: post.featuredImage || '',
  metaTitle: post.metaTitle || '',
  focusKeywords: post.focusKeywords || [],
  socialTitle: post.socialTitle || '',
  socialImage: post.socialImage || '',
  faqs: post.faqs || [],
  inlineImages: post.inlineImages || [],
});

const emptyPost = (): BlogRecord => ({
  slug: '',
  title: '',
  excerpt: '',
  category: 'Digital Marketing',
  readTime: '1 min read',
  publishedDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
  author: { name: '', role: '' },
  contentSections: [{ heading: '', paragraphs: [''], callout: '' }],
  relatedServiceSlug: 'google-business-profile',
  metaDescription: '',
  status: 'draft',
  featuredImage: '',
  metaTitle: '',
  focusKeywords: [],
  socialTitle: '',
  socialImage: '',
  faqs: [],
  inlineImages: [],
  updatedAt: new Date().toISOString(),
});

const formattingTools = [
  { label: 'Undo', icon: Undo2, action: 'undo' },
  { label: 'Redo', icon: Redo2, action: 'redo' },
  { label: 'Heading 2', icon: Heading2, action: 'h2' },
  { label: 'Heading 3', icon: Heading3, action: 'h3' },
  { label: 'Heading 4', icon: Heading4, action: 'h4' },
  { label: 'Bold', icon: Bold, action: 'bold' },
  { label: 'Italic', icon: Italic, action: 'italic' },
  { label: 'Underline', icon: Underline, action: 'underline' },
  { label: 'Strikethrough', icon: Strikethrough, action: 'strike' },
  { label: 'Align left', icon: AlignLeft, action: 'left' },
  { label: 'Align center', icon: AlignCenter, action: 'center' },
  { label: 'Align right', icon: AlignRight, action: 'right' },
  { label: 'Bulleted list', icon: List, action: 'bullet' },
  { label: 'Numbered list', icon: ListOrdered, action: 'numbered' },
  { label: 'Insert link', icon: LinkIcon, action: 'link' },
  { label: 'Auto-link selected URLs', icon: undefined, action: 'autoLink' },
  { label: 'Insert image', icon: ImagePlus, action: 'image' },
  { label: 'Block quote', icon: Quote, action: 'quote' },
  { label: 'Inline code', icon: Code2, action: 'code' },
  { label: 'Insert table', icon: Table2, action: 'table' },
] as const;

type InlineImage = NonNullable<BlogPost['inlineImages']>[number];
type ImageDestination = 'cursor' | 'before-heading' | 'after-heading' | 'section-end' | `paragraph-start:${number}` | `paragraph-end:${number}`;

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const readTime = (post: BlogRecord) => {
  const content = post.contentSections.flatMap((section) => [section.heading, ...section.paragraphs])
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ');
  return `${Math.max(1, Math.ceil(content.split(/\s+/).filter(Boolean).length / 200))} min read`;
};

async function apiMessage(response: Response) {
  let result: { message?: string } = {};
  try {
    result = await response.clone().json() as { message?: string };
  } catch {
    const contentType = response.headers.get('content-type') || 'no Content-Type header';
    return `Request failed (${response.status}) at ${response.url || '/api/admin/blogs'} (${contentType}). This response is not from the NearGrow Express API. Start the app with "npm run dev" and open the exact URL printed by the server; avoid a Vite-only or stale server.`;
  }
  return result.message || `Request failed (${response.status}).`;
}

async function apiData<T>(response: Response): Promise<T> {
  try {
    return await response.clone().json() as T;
  } catch {
    const contentType = response.headers.get('content-type') || 'no Content-Type header';
    throw new Error(`The blog API at ${response.url || '/api/admin/blogs'} returned ${response.status} ${response.statusText} (${contentType}), not JSON. Use the URL printed by the Express server started with "npm run dev"; a Vite-only or stale server does not provide the admin API.`);
  }
}

function requestError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return 'Could not connect to the NearGrow Ads server. Check that the server is running and try again.';
  return error instanceof Error ? error.message : fallback;
}

export function AdminBlogManager({ mode, onBack, onNavigate, canCreate = true, canEdit = true, canDelete = true, canPublish = true, canViewCategories = true }: Props) {
  const [posts, setPosts] = useState<BlogRecord[]>(seedPosts);
  const blogRevisionRef = useRef('');
  const [categories, setCategories] = useState<BlogCategory[]>(BLOG_CATEGORIES);
  const [post, setPost] = useState<BlogRecord>(emptyPost);
  const [originalSlug, setOriginalSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [customSlug, setCustomSlug] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadingImage, setUploadingImage] = useState<{
    kind: 'featured' | 'author' | 'social' | 'inline' | 'pending-inline';
    sectionIndex?: number;
    imageIndex?: number;
  } | null>(null);
  const [imageTheme, setImageTheme] = useState<PublicImageTheme>('dark');
  const activeEditor = useRef<{ sectionIndex: number; paragraphIndex: number; element: HTMLDivElement } | null>(null);
  const pendingImageRange = useRef<{ sectionIndex: number; paragraphIndex: number; element: HTMLDivElement; range: Range } | null>(null);
  const [imageDialog, setImageDialog] = useState<{
    sectionIndex: number;
    imageId?: string;
    imageIndex?: number;
    source: string;
    altText: string;
    decorative: boolean;
    caption: string;
    destination: ImageDestination;
    width: string;
    alignment: 'left' | 'center' | 'right';
    layout: 'standalone' | 'wrap-left' | 'wrap-right';
    spacingAbove: number;
    spacingBelow: number;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<PublicImageTheme>('dark');
  const [previewMobile, setPreviewMobile] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<string | null>(null);
  const draftHistoryRef = useRef<{ past: BlogRecord[]; future: BlogRecord[] }>({ past: [], future: [] });
  const suppressEditorHistoryRef = useRef(false);
  const featuredImagePreview = resolveBlogImage(
    post.featuredImage,
    post.featuredImageAltText ?? '',
    post.featuredImageVariants,
    imageTheme,
  );
  const socialImagePreview = resolveBlogImage(post.socialImage, '', post.socialImageVariants, imageTheme);
  const authorImagePreview = resolveBlogImage(
    post.author.imageUrl,
    post.author.imageVariants?.[imageTheme]?.altText ?? post.author.name,
    post.author.imageVariants,
    imageTheme,
  );

  const dark = true;
  const text = dark ? 'text-[#ECF3EE]' : 'text-[#1B261D]';
  const muted = dark ? 'text-[#A9B8AD]' : 'text-[#778178]';
  const panel = `rounded-3xl border p-5 shadow-sm sm:p-7 ${dark ? 'border-[#304135] bg-[#19241D]' : 'border-[#E2E8E1] bg-white'}`;
  const field = `w-full rounded-xl border px-3.5 py-3 text-sm outline-none transition focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15 disabled:cursor-not-allowed disabled:opacity-60 ${dark ? 'border-[#33453A] bg-[#101913] text-[#EAF1EB] placeholder:text-[#76867B]' : 'border-[#DFE6DF] bg-[#FAFBF9] text-[#1B261D] placeholder:text-[#9AA59B]'}`;
  const fieldLabel = `mb-2 block text-xs font-semibold ${dark ? 'text-[#B8C7BC]' : 'text-[#526056]'}`;
  const wordCount = post.contentSections.flatMap((section) => [section.heading, ...section.paragraphs]).join(' ').split(/\s+/).filter(Boolean).length;
  const seoChecks = [
    { label: 'Title added', done: (post.metaTitle || post.title).trim().length > 0 },
    { label: 'Effective meta description available', done: (post.metaDescription || post.excerpt).trim().length > 0 },
    { label: 'Category selected', done: post.category.trim().length > 0 },
    { label: 'Readable article body', done: wordCount > 0 },
  ];
  const mediaPreviews = [
    ...(post.featuredImage ? [{ label: 'Featured image', url: post.featuredImage }] : []),
    ...Object.entries(post.featuredImageVariants ?? {}).flatMap(([theme, image]) => image?.url ? [{ label: `Featured image · ${theme} mode`, url: image.url }] : []),
    ...(post.author.imageUrl ? [{ label: 'Author image', url: post.author.imageUrl }] : []),
    ...Object.entries(post.author.imageVariants ?? {}).flatMap(([theme, image]) => image?.url ? [{ label: `Author image · ${theme} mode`, url: image.url }] : []),
    ...(post.socialImage ? [{ label: 'Social / OG image', url: post.socialImage }] : []),
    ...Object.entries(post.socialImageVariants ?? {}).flatMap(([theme, image]) => image?.url ? [{ label: `Social image · ${theme} mode`, url: image.url }] : []),
    ...(post.inlineImages || []).flatMap((image, index) => [
      { label: `Article image ${index + 1} · ${image.sectionId ? `Section ${post.contentSections.findIndex((section) => section.id === image.sectionId) + 1}` : image.afterSection !== undefined ? `Section ${image.afterSection + 1}` : 'Article body'}`, url: image.url },
      ...Object.entries(image.imageVariants ?? {}).flatMap(([theme, variant]) => variant?.url ? [{ label: `Article image ${index + 1} · ${theme} mode`, url: variant.url }] : []),
    ]),
  ];
  const previewSelectedImageIndex = previewSelection
    ? previewSelection.startsWith('legacy:')
      ? Number(previewSelection.slice('legacy:'.length))
      : (post.inlineImages || []).findIndex((image) => image.id === previewSelection)
    : -1;

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/blogs', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiMessage(response));
        return apiData<{ posts: BlogRecord[]; revision: string }>(response);
      })
      .then(({ posts: data, revision }) => {
        if (!alive) return;
        if (!Array.isArray(data)) throw new Error('The blog API response did not include an article list.');
        if (!revision) throw new Error('The blog API response did not include a revision token.');
        blogRevisionRef.current = revision;
        const list = data.map(normalizePost);
        setPosts(list);
        const slug = mode === 'editor' && window.location.pathname !== '/admin/blog/new'
          ? decodeURIComponent(window.location.pathname.slice('/admin/blog/'.length).replace(/\/$/, ''))
          : '';
        if (slug) {
          const found = list.find((item) => item.slug === slug);
          if (found) {
            setPost(found);
            setOriginalSlug(found.slug);
            setCustomSlug(true);
          } else {
            setError('That article could not be found.');
          }
        }
      })
      .catch((reason: unknown) => {
        if (alive) setError(requestError(reason, 'Could not load articles.'));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!canViewCategories) return;
    let alive = true;
    fetch('/api/admin/blog-categories', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiMessage(response));
        return apiData<{ categories: BlogCategory[] }>(response);
      })
      .then(({ categories: data }) => {
        if (!Array.isArray(data) || !data.every((category) => typeof category.name === 'string')) {
          throw new Error('The blog category API did not return a valid category list.');
        }
        if (alive) setCategories(data);
      })
      .catch((reason: unknown) => {
        if (alive) setError(requestError(reason, 'Could not load blog categories.'));
      });
    return () => { alive = false; };
  }, [canViewCategories]);

  const filteredPosts = useMemo(
    () => posts.filter((item) =>
      (filter === 'all' || item.status === filter) &&
      (!query.trim() || [item.title, item.category, item.author.name, item.excerpt]
        .some((value) => value.toLowerCase().includes(query.trim().toLowerCase())))),
    [posts, filter, query],
  );

  const setField = <K extends keyof BlogRecord>(key: K, value: BlogRecord[K]) => {
    setPost((current) => ({ ...current, [key]: value, updatedAt: new Date().toISOString() }));
  };

  const recordDraftHistory = () => {
    draftHistoryRef.current.past.push(post);
    if (draftHistoryRef.current.past.length > 50) draftHistoryRef.current.past.shift();
    draftHistoryRef.current.future = [];
  };

  const syncArticleEditors = (sections: BlogRecord['contentSections']) => {
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLDivElement>('.admin-blog-rich-editor[data-section-index][data-paragraph-index]').forEach((element) => {
        const sectionIndex = Number(element.dataset.sectionIndex);
        const paragraphIndex = Number(element.dataset.paragraphIndex);
        const paragraph = sections[sectionIndex]?.paragraphs[paragraphIndex];
        if (paragraph !== undefined) element.innerHTML = blogTextToEditorHtml(paragraph);
      });
    });
  };

  const restoreDraftHistory = (direction: 'undo' | 'redo'): boolean => {
    const history = draftHistoryRef.current;
    const source = direction === 'undo' ? history.past : history.future;
    const destination = direction === 'undo' ? history.future : history.past;
    if (!source.length) return false;
    destination.push(post);
    const snapshot = source.pop()!;
    setPost(snapshot);
    syncArticleEditors(snapshot.contentSections);
    return true;
  };

  const saveEditorSelection = (sectionIndex: number, paragraphIndex: number, element: HTMLDivElement) => {
    activeEditor.current = { sectionIndex, paragraphIndex, element };
    pendingImageRange.current = null;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (element.contains(range.commonAncestorContainer)) {
      pendingImageRange.current = { sectionIndex, paragraphIndex, element, range: range.cloneRange() };
    }
  };

  const openImageConfiguration = (sectionIndex: number, imageIndex?: number, destination?: ImageDestination) => {
    setUploadError('');
    const image = imageIndex === undefined ? undefined : post.inlineImages?.[imageIndex];
    const selection = window.getSelection();
    const active = activeEditor.current;
    if (imageIndex === undefined && active && selection?.rangeCount && active.element.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      pendingImageRange.current = { ...active, range: selection.getRangeAt(0).cloneRange() };
    }
    const initialDestination = destination || image?.placement || (image ? 'section-end' : 'cursor');
    if (imageIndex === undefined && initialDestination === 'cursor' && (!pendingImageRange.current || !pendingImageRange.current.element.isConnected)) {
      setError('Choose an insertion position by clicking in an article paragraph or using a preview insertion marker.');
      setPreviewOpen(true);
      return;
    }
    setImageDialog({
      sectionIndex,
      imageId: image?.id,
      imageIndex,
      source: image?.url || '',
      altText: image?.altText || '',
      decorative: image?.decorative === true,
      caption: image?.caption || '',
      destination: initialDestination,
      width: image?.width || '50%',
      alignment: image?.alignment || 'center',
      layout: image?.layout || 'standalone',
      spacingAbove: image?.spacingAbove ?? 16,
      spacingBelow: image?.spacingBelow ?? 16,
    });
  };

  const removeImageMarker = (paragraph: string, id: string) => {
    const parsed = new DOMParser().parseFromString(paragraph, 'text/html');
    parsed.body.querySelectorAll(`[data-blog-image-id="${CSS.escape(id)}"]`).forEach((marker) => marker.remove());
    return sanitizeBlogHtml(parsed.body.innerHTML);
  };

  const addImageMarkerAtBoundary = (paragraph: string, id: string, atEnd: boolean) => {
    const parsed = new DOMParser().parseFromString(blogTextToEditorHtml(paragraph), 'text/html');
    const marker = parsed.createElement('span');
    marker.setAttribute('data-blog-image-id', id);
    if (atEnd) parsed.body.append(marker);
    else parsed.body.insertBefore(marker, parsed.body.firstChild);
    return sanitizeBlogHtml(parsed.body.innerHTML);
  };

  const confirmImageConfiguration = (insertAndPreview = false) => {
    if (!imageDialog || !imageDialog.source.trim()) {
      setUploadError('Upload an image or enter an image URL before continuing.');
      return;
    }
    const source = imageDialog.source.trim();
    let parsedUrl: URL;
    try { parsedUrl = new URL(source, window.location.origin); }
    catch { setUploadError('Enter a valid image URL.'); return; }
    if (parsedUrl.protocol !== 'https:' && !source.startsWith('/uploads/blog/')) {
      setUploadError('Use an https:// image URL or upload a supported image file.');
      return;
    }
    if (!isSupportedBlogImageWidth(imageDialog.width)) {
      setUploadError('Width must be a percentage from 1–100% or a pixel value from 1–1600px.');
      return;
    }
    if (![imageDialog.spacingAbove, imageDialog.spacingBelow].every((value) => Number.isInteger(value) && value >= 0 && value <= 120)) {
      setUploadError('Image spacing must be an integer from 0 to 120 pixels.');
      return;
    }

    const images = [...(post.inlineImages || [])];
    const currentImage = imageDialog.imageIndex === undefined ? undefined : images[imageDialog.imageIndex];
    const id = currentImage?.id || imageDialog.imageId || crypto.randomUUID();
    const targetSection = post.contentSections[imageDialog.sectionIndex];
    if (!targetSection) {
      setUploadError('The selected article section no longer exists.');
      return;
    }
    const sectionId = targetSection.id || crypto.randomUUID();
    const sections = post.contentSections.map((section, index) => index === imageDialog.sectionIndex
      ? { ...section, id: sectionId }
      : section);
    let placement: InlineImage['placement'] = 'cursor';
    let afterSection: number | undefined;
    let anchorSectionIndex = imageDialog.sectionIndex;
    let anchorSectionId = sectionId;
    let markerParagraphIndex: number | null = null;
    let markerAtEnd = false;
    if (imageDialog.destination.startsWith('paragraph-start:') || imageDialog.destination.startsWith('paragraph-end:')) {
      const [kind, rawIndex] = imageDialog.destination.split(':');
      markerParagraphIndex = Number(rawIndex);
      markerAtEnd = kind === 'paragraph-end';
    } else if (imageDialog.destination === 'before-heading' || imageDialog.destination === 'after-heading' || imageDialog.destination === 'section-end') {
      placement = imageDialog.destination;
      afterSection = imageDialog.sectionIndex;
    } else if (imageDialog.imageIndex !== undefined) {
      placement = currentImage?.placement || 'cursor';
      afterSection = currentImage?.afterSection;
    }

    let nextSections = sections;
    let editorContentChanged = false;
    let insertedAtCaret = false;
    const oldId = currentImage?.id;
    const currentImageSectionIndex = currentImage?.sectionId
      ? sections.findIndex((section) => section.id === currentImage.sectionId)
      : currentImage?.afterSection;
    if (oldId && (imageDialog.destination !== 'cursor' || (
      currentImageSectionIndex !== undefined &&
      currentImageSectionIndex >= 0 &&
      currentImageSectionIndex !== imageDialog.sectionIndex
    ))) {
      editorContentChanged = true;
      nextSections = sections.map((section) => ({
        ...section,
        paragraphs: section.paragraphs.map((paragraph) => removeImageMarker(paragraph, oldId)),
      }));
    }
    const insertAtCaret = (): boolean => {
      const pending = pendingImageRange.current;
      if (!pending || !pending.element.isConnected) {
        setUploadError('Choose a current position in the article or preview before inserting this image.');
        return false;
      }
      const selection = window.getSelection();
      const range = pending.range.cloneRange();
      if (!pending.element.contains(range.commonAncestorContainer)) {
        setUploadError('The saved insertion position is no longer available. Choose a position again.');
        return false;
      }
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      pending.element.focus();
      suppressEditorHistoryRef.current = true;
      try { document.execCommand('insertHTML', false, blogImageMarker(id)); }
      finally { suppressEditorHistoryRef.current = false; }
      insertedAtCaret = true;
      editorContentChanged = true;
      const updatedHtml = sanitizeBlogHtml(pending.element.innerHTML);
      const stableSectionId = sections[pending.sectionIndex]?.id || (pending.sectionIndex === imageDialog.sectionIndex ? sectionId : crypto.randomUUID());
      anchorSectionId = stableSectionId;
      nextSections = nextSections.map((section, sectionIndex) => sectionIndex === pending.sectionIndex
        ? { ...section, id: stableSectionId, paragraphs: section.paragraphs.map((paragraph, index) => index === pending.paragraphIndex ? updatedHtml : paragraph) }
        : section);
      anchorSectionIndex = pending.sectionIndex;
      afterSection = undefined;
      placement = 'cursor';
      return true;
    };
    if (markerParagraphIndex !== null) {
      const paragraph = nextSections[anchorSectionIndex]?.paragraphs[markerParagraphIndex];
      if (paragraph === undefined) {
        setUploadError('The selected paragraph no longer exists.');
        return;
      }
      nextSections = nextSections.map((section, sectionIndex) => sectionIndex === anchorSectionIndex
        ? { ...section, paragraphs: section.paragraphs.map((value, index) => index === markerParagraphIndex ? addImageMarkerAtBoundary(value, id, markerAtEnd) : value) }
        : section);
      editorContentChanged = true;
      placement = 'cursor';
      afterSection = undefined;
      anchorSectionId = sections[anchorSectionIndex]?.id || sectionId;
    } else if (imageDialog.destination === 'cursor' && imageDialog.imageIndex === undefined) {
      if (!insertAtCaret()) return;
    } else if (imageDialog.destination === 'cursor' && imageDialog.imageIndex !== undefined) {
      const hasMarker = post.contentSections.some((section) => section.paragraphs.some((paragraph) => paragraph.includes(`data-blog-image-id="${id}"`)));
      if (!hasMarker && !insertAtCaret()) return;
      if (hasMarker) {
        anchorSectionId = currentImage?.sectionId || sectionId;
        anchorSectionIndex = post.contentSections.findIndex((section) => section.id === anchorSectionId);
        if (anchorSectionIndex < 0) anchorSectionIndex = imageDialog.sectionIndex;
      }
    }

    const updatedImage: InlineImage = {
      ...currentImage,
      id,
      url: source,
      altText: imageDialog.altText.trim(),
      decorative: imageDialog.decorative,
      caption: imageDialog.caption.trim(),
      sectionId: anchorSectionId,
      placement,
      ...(afterSection !== undefined ? { afterSection } : {}),
      width: imageDialog.width,
      alignment: imageDialog.alignment,
      layout: imageDialog.layout,
      spacingAbove: imageDialog.spacingAbove,
      spacingBelow: imageDialog.spacingBelow,
    };
    if (imageDialog.imageIndex === undefined) images.push(updatedImage);
    else images[imageDialog.imageIndex] = updatedImage;

    recordDraftHistory();
    setPost((current) => ({
      ...current,
      contentSections: nextSections,
      inlineImages: images,
      updatedAt: new Date().toISOString(),
    }));
    if (editorContentChanged && !insertedAtCaret) syncArticleEditors(nextSections);
    setImageDialog(null);
    pendingImageRange.current = null;
    setError('');
    if (insertAndPreview) {
      setPreviewOpen(true);
      setPreviewSelection(id);
    }
  };

  const applyFormatting = (format: 'h2' | 'h3' | 'h4' | 'bold' | 'italic' | 'underline' | 'strike' | 'left' | 'center' | 'right' | 'bullet' | 'numbered' | 'link' | 'autoLink' | 'quote' | 'code' | 'table' | 'undo' | 'redo') => {
    if ((format === 'undo' || format === 'redo') && restoreDraftHistory(format)) return;
    const active = activeEditor.current;
    if (!active) {
      setError('Click into an article paragraph first, then choose a formatting tool.');
      return;
    }
    const { element } = active;
    element.focus();
    switch (format) {
      case 'h2': case 'h3': case 'h4': document.execCommand('formatBlock', false, format); break;
      case 'bold': document.execCommand('bold'); break;
      case 'italic': document.execCommand('italic'); break;
      case 'underline': document.execCommand('underline'); break;
      case 'strike': document.execCommand('strikeThrough'); break;
      case 'left': document.execCommand('justifyLeft'); break;
      case 'center': document.execCommand('justifyCenter'); break;
      case 'right': document.execCommand('justifyRight'); break;
      case 'bullet': document.execCommand('insertUnorderedList'); break;
      case 'numbered': document.execCommand('insertOrderedList'); break;
      case 'link': {
        const href = window.prompt('Enter the link URL (https://, http://, or mailto:)');
        if (!href) return;
        let parsed: URL;
        try { parsed = new URL(href.trim(), window.location.origin); }
        catch { setError('Enter a valid link address.'); return; }
        if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) { setError('Links must use https://, http:// or mailto:.'); return; }
        document.execCommand('createLink', false, href.trim());
        break;
      }
      case 'autoLink': {
        const selected = window.getSelection()?.toString().trim() || '';
        if (!selected || !/^https?:\/\/\S+$/.test(selected)) {
          setError('Select one or more URLs in the paragraph before using Auto-Link.');
          return;
        }
        document.execCommand('createLink', false, selected);
        break;
      }
      case 'quote': document.execCommand('formatBlock', false, 'blockquote'); break;
      case 'code': {
        const selection = window.getSelection();
        const selected = selection?.toString() || '';
        document.execCommand('insertHTML', false, `<code>${selected || 'Code'}</code>`);
        break;
      }
      case 'table':
        document.execCommand('insertHTML', false, '<table><thead><tr><th>Heading 1</th><th>Heading 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table><p><br></p>');
        break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
    }
    const { sectionIndex, paragraphIndex } = active;
    const updatedHtml = sanitizeBlogHtml(element.innerHTML);
    setField('contentSections', post.contentSections.map((section, index) => index === sectionIndex
      ? { ...section, paragraphs: section.paragraphs.map((paragraph, paragraphIndexValue) => paragraphIndexValue === paragraphIndex ? updatedHtml : paragraph) }
      : section));
    requestAnimationFrame(() => {
      element.focus();
      activeEditor.current = { sectionIndex, paragraphIndex, element };
    });
  };

  const moveInlineImage = (imageIndex: number, direction: -1 | 1) => {
    const images = [...(post.inlineImages || [])];
    const image = images[imageIndex];
    if (!image) return;
    const sameSection = images.flatMap((candidate, candidateIndex) =>
      (candidate.sectionId ? candidate.sectionId === image.sectionId : candidate.afterSection === image.afterSection) &&
      (candidate.placement || 'legacy') === (image.placement || 'legacy') ? [candidateIndex] : []);
    const currentPosition = sameSection.indexOf(imageIndex);
    const swapIndex = sameSection[currentPosition + direction];
    if (swapIndex === undefined) return;
    const other = images[swapIndex];
    if (image.id && other.id && image.placement === 'cursor' && other.placement === 'cursor') {
      const placeholder = `swap-${crypto.randomUUID()}`;
      const contentSections = post.contentSections.map((section) => ({
        ...section,
        paragraphs: section.paragraphs.map((paragraph) => paragraph
          .replaceAll(`data-blog-image-id="${image.id}"`, `data-blog-image-id="${placeholder}"`)
          .replaceAll(`data-blog-image-id="${other.id}"`, `data-blog-image-id="${image.id}"`)
          .replaceAll(`data-blog-image-id="${placeholder}"`, `data-blog-image-id="${other.id}"`)),
      }));
      recordDraftHistory();
      setPost((current) => ({ ...current, contentSections, inlineImages: images, updatedAt: new Date().toISOString() }));
      syncArticleEditors(contentSections);
      return;
    }
    [images[imageIndex], images[swapIndex]] = [images[swapIndex], images[imageIndex]];
    recordDraftHistory();
    setField('inlineImages', images);
  };

  const removeInlineImage = (imageIndex: number) => {
    const image = post.inlineImages?.[imageIndex];
    const id = image?.id;
    const contentSections = id
      ? post.contentSections.map((section) => ({ ...section, paragraphs: section.paragraphs.map((paragraph) => removeImageMarker(paragraph, id)) }))
      : post.contentSections;
    recordDraftHistory();
    setPost((current) => ({
      ...current,
      inlineImages: (current.inlineImages || []).filter((_, index) => index !== imageIndex),
      contentSections,
      updatedAt: new Date().toISOString(),
    }));
    if (id) syncArticleEditors(contentSections);
  };

  const removeSection = (sectionIndex: number) => {
    if (post.contentSections.length < 2) return;
    const removed = post.contentSections[sectionIndex];
    const remaining = post.contentSections.filter((_, index) => index !== sectionIndex);
    const destinationIndex = Math.min(sectionIndex, remaining.length - 1);
    const destination = remaining[destinationIndex];
    const destinationId = destination.id || crypto.randomUUID();
    remaining[destinationIndex] = { ...destination, id: destinationId };
    const images = (post.inlineImages || []).map((image) => {
      const anchoredHere = (removed.id !== undefined && image.sectionId === removed.id) || image.afterSection === sectionIndex;
      if (anchoredHere) {
        if (image.placement === undefined) {
          return { ...image, afterSection: destinationIndex };
        }
        return { ...image, sectionId: destinationId, placement: 'section-end' as const, afterSection: destinationIndex };
      }
      if (image.afterSection !== undefined && image.afterSection > sectionIndex) return { ...image, afterSection: image.afterSection - 1 };
      return image;
    });
    recordDraftHistory();
    setPost((current) => ({ ...current, contentSections: remaining, inlineImages: images, updatedAt: new Date().toISOString() }));
    syncArticleEditors(remaining);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const publish = submitter instanceof HTMLButtonElement
      ? submitter.name === 'publish'
      : post.status === 'published';
    setSaving(true);
    setError('');
    setNotice('');
    const payload: BlogRecord = { ...post, status: publish ? 'published' : 'draft', readTime: readTime(post) };
    const existing = originalSlug !== null;
    try {
      const response = await fetch(`/api/admin/blogs${existing ? `/${encodeURIComponent(originalSlug)}` : ''}`, {
        method: existing ? 'PUT' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'If-Match': blogRevisionRef.current },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      const result = await apiData<{ post: BlogRecord; revision: string }>(response);
      blogRevisionRef.current = result.revision;
      setPost(result.post);
      setOriginalSlug(result.post.slug);
      setPosts((current) => [result.post, ...current.filter((item) => item.slug !== originalSlug && item.slug !== result.post.slug)]);
      setNotice(publish ? 'Article published successfully.' : 'Draft saved.');
      try {
        const scanResponse = await fetch('/api/admin/blogs/seo-health/scan', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: [result.post.slug], includeDrafts: true }),
        });
        if (!scanResponse.ok) throw new Error(await apiMessage(scanResponse));
      } catch {
        setNotice(`${publish ? 'Article published successfully.' : 'Draft saved.'} SEO Health needs a rescan.`);
      }
      if (publish) onNavigate('/admin/blog');
      else if (existing && originalSlug !== result.post.slug) onNavigate(`/admin/blog/${encodeURIComponent(result.post.slug)}`);
    } catch (reason) {
      setError(requestError(reason, 'Could not save the article.'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (mode !== 'editor' || busy || !window.location.hash) return;
    const target = window.location.hash.slice(1);
    const timer = window.setTimeout(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.focus({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [busy, mode, post.slug]);

  const removePost = async (item: BlogRecord) => {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    setError('');
    try {
      const response = await fetch(`/api/admin/blogs/${encodeURIComponent(item.slug)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'If-Match': blogRevisionRef.current },
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      const result = await apiData<{ revision: string }>(response);
      blogRevisionRef.current = result.revision;
      setPosts((current) => current.filter((value) => value.slug !== item.slug));
    } catch (reason) {
      setError(requestError(reason, 'Could not delete the article.'));
    }
  };

  const uploadImage = async (
    file: File | undefined,
    kind: 'featured' | 'author' | 'social' | 'inline' | 'pending-inline',
    sectionIndex?: number,
    theme?: PublicImageTheme,
    imageIndex?: number,
  ) => {
    if (!file) return;
    setUploadError('');
    const imageExtension = file.name.match(/\.(png|jpe?g|webp)$/i)?.[1];
    if (!['image/jpeg', 'image/pjpeg', 'image/png', 'image/x-png', 'image/webp'].includes(file.type.toLowerCase()) && !(!file.type && imageExtension)) {
      setUploadError('Choose a JPG, JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('Image must be smaller than 15 MB.');
      return;
    }
    setUploadingImage(kind === 'inline' || kind === 'pending-inline' ? { kind, sectionIndex: sectionIndex ?? -1, imageIndex } : { kind });
    try {
      const formData = new FormData();
      formData.append('image', file, file.name);
      const response = await fetch('/api/admin/blogs/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      const result = await apiData<{ url: string }>(response);
      if (kind === 'featured' && theme) setField('featuredImageVariants', {
        ...post.featuredImageVariants,
        [theme]: { ...post.featuredImageVariants?.[theme], url: result.url },
      });
      else if (kind === 'featured') setField('featuredImage', result.url);
      else if (kind === 'social' && theme) setField('socialImageVariants', {
        ...post.socialImageVariants,
        [theme]: { ...post.socialImageVariants?.[theme], url: result.url },
      });
      else if (kind === 'social') setField('socialImage', result.url);
      else if (kind === 'pending-inline') setImageDialog((current) => current ? { ...current, source: result.url } : current);
      else if (kind === 'inline' && sectionIndex !== undefined) {
        if (theme !== undefined && imageIndex !== undefined) {
          recordDraftHistory();
          setField('inlineImages', (post.inlineImages || []).map((image, index) => index === imageIndex
            ? { ...image, imageVariants: { ...image.imageVariants, [theme]: { ...image.imageVariants?.[theme], url: result.url } } }
            : image));
        } else {
          setField('inlineImages', [...(post.inlineImages || []), { url: result.url, altText: '', caption: '', afterSection: sectionIndex }]);
        }
      }
      else if (theme !== undefined) setPost((current) => ({
        ...current,
        author: { ...current.author, imageVariants: { ...current.author.imageVariants, [theme]: { ...current.author.imageVariants?.[theme], url: result.url } } },
        updatedAt: new Date().toISOString(),
      }));
      else setPost((current) => ({ ...current, author: { ...current.author, imageUrl: result.url }, updatedAt: new Date().toISOString() }));
    } catch (reason) {
      setUploadError(requestError(reason, 'Could not upload the image.'));
    } finally {
      setUploadingImage(null);
    }
  };

  return (
    <main className="admin-portal admin-blog-manager min-h-screen" data-admin-theme="dark">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <button type="button" onClick={onBack} className={`mb-4 inline-flex items-center gap-2 text-xs font-semibold ${muted} transition hover:text-[#67D8B7]`}>
              <ArrowLeft className="h-4 w-4" /> {mode === 'editor' ? 'Back to articles' : 'Back to dashboard'}
            </button>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#67D8B7]">Editorial studio</p>
            <h1 className={`mt-1 text-3xl font-bold tracking-tight ${text}`}>
              {mode === 'editor'
                ? (originalSlug ? 'Compose Article' : 'Compose New Article')
                : 'Blog management'}
            </h1>
            <p className={`mt-2 text-sm ${muted}`}>
              {mode === 'editor' ? 'Author and publish high-ranking digital marketing articles and insights.' : 'Create, edit, and publish your team’s growth insights.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'list' && canCreate && (
              <button type="button" onClick={() => onNavigate('/admin/blog/new')} className="admin-blog-primary inline-flex h-11 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#205C31]">
                <Plus className="h-4 w-4" /> Create article
              </button>
            )}
          </div>
        </header>

        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-400/30 bg-rose-950/25 px-4 py-3 text-sm text-rose-200">{error}</p>}
        {notice && <p role="status" className="mb-5 rounded-xl border border-emerald-400/25 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">{notice}</p>}

        {mode === 'editor' ? (
          <>
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              <section className={`${panel} !rounded-2xl !p-4`}>
                <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${muted}`}>Publication status</p>
                <p className={`mt-2 text-xl font-bold ${text}`}>{post.status === 'published' ? 'Published' : 'Draft'}</p>
                <p className="mt-1 text-[11px] text-[#72D28B]">Draft workflow active</p>
              </section>
              <section className={`${panel} !rounded-2xl !p-4`}>
                <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${muted}`}>Taxonomy cluster</p>
                <p className={`mt-2 truncate text-xl font-bold ${text}`}>{post.category || 'Uncategorized'}</p>
                <p className="mt-1 text-[11px] text-amber-300">Category and audience grouping</p>
              </section>
              <section className={`${panel} !rounded-2xl !p-4`}>
                <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${muted}`}>Draft preflight</p>
                <p className={`mt-2 text-xl font-bold ${text}`}>{post.title.trim() ? 'Ready to review' : 'Awaiting title'}</p>
                <p className="mt-1 text-[11px] text-[#67D8B7]">{seoChecks.filter((check) => check.done).length} of {seoChecks.length} draft checks complete</p>
              </section>
            </div>
            {busy ? (
              <div className={`grid min-h-60 place-items-center ${muted}`}><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading article…</div>
            ) : (
              <form id="blog-editor-form" onSubmit={(event) => void submit(event)} className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5">
                  <section id="article-content" tabIndex={-1} className={panel}>
                    <div className={`mb-4 border-b pb-4 ${dark ? 'border-[#304135]' : 'border-[#E8ECE7]'}`}>
                      <h2 className={`font-bold ${text}`}>Article Content</h2>
                      <p className={`mt-1 text-xs ${muted}`}>Craft your post with clear formatting, a strong hierarchy, and useful media.</p>
                    </div>
                    <label className="mb-4 block">
                      <span className={fieldLabel}>Post title <span className="text-emerald-400">*</span></span>
                      <input required maxLength={160} value={post.title} onChange={(event) => {
                        const title = event.target.value;
                        setPost((current) => ({ ...current, title, metaTitle: !current.metaTitle || current.metaTitle === current.title ? title : current.metaTitle, socialTitle: !current.socialTitle || current.socialTitle === current.title ? title : current.socialTitle, slug: customSlug ? current.slug : slugify(title) }));
                      }} placeholder="Enter an engaging title…" className={`${field} text-base font-semibold`} />
                    </label>
                    <div className="mb-5 grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
                      <span className={`flex items-center rounded-xl border px-3 text-xs ${dark ? 'border-[#304135] bg-[#131D16] text-[#A9B8AD]' : 'border-[#DFE6DF] bg-[#FAFBF9] text-[#829084]'}`}>neargrowads.in/blog/</span>
                      <input required aria-label="Article URL slug" value={post.slug} onChange={(event) => { setCustomSlug(true); setField('slug', slugify(event.target.value)); }} className={field} placeholder="e.g. local-seo-strategies" />
                      <button type="button" onClick={() => { setCustomSlug(false); setField('slug', slugify(post.title)); }} className="inline-flex items-center justify-center rounded-xl border border-[#304135] px-3 py-2 text-xs font-semibold text-[#72D28B] hover:bg-[#202D24]">
                        Optimize slug
                      </button>
                    </div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className={fieldLabel}>Article body</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-[#33453A] px-3 py-1.5 text-xs font-semibold text-[#EAF1EB] hover:border-[#67D8B7]">
                          <Eye className="h-4 w-4" /> Preview article
                        </button>
                        <button type="button" onClick={() => setField('contentSections', [...post.contentSections, { heading: '', paragraphs: [''], callout: '' }])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#72D28B] hover:bg-[#202D24]">
                          <Plus className="h-4 w-4" /> Add section
                        </button>
                      </div>
                    </div>
                    <div role="toolbar" aria-label="Article text formatting" className={`admin-blog-formatting-toolbar sticky top-2 z-30 mb-3 flex flex-wrap items-center gap-1 rounded-xl border p-2 ${dark ? 'border-[#304135] bg-[#101713]' : 'border-[#E8ECE7] bg-[#FAFBF9]'}`}>
                      {formattingTools.map(({ label: actionLabel, icon: Icon, action }) => (
                        <button
                          key={action}
                          type="button"
                          title={actionLabel}
                          aria-label={actionLabel}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            if (action === 'image') {
                              const sectionIndex = activeEditor.current?.sectionIndex ?? 0;
                              openImageConfiguration(sectionIndex);
                            } else {
                              applyFormatting(action);
                            }
                          }}
                          className={`rounded-lg text-[#A9B8AD] transition hover:bg-[#26372B] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7] ${
                            action === 'autoLink' ? 'inline-flex h-8 items-center px-2 text-[11px] font-semibold' : 'grid h-8 w-8 place-items-center'
                          }`}
                        >
                          {action === 'autoLink' ? 'Auto-link URLs' : Icon && <Icon className="h-4 w-4" />}
                        </button>
                      ))}
                    </div>
                    <p className={`mb-3 text-[10px] ${muted}`}>Place the caret in the article before inserting an image. Use Preview article to choose a heading or paragraph position visually.</p>
                    <div className="space-y-3">
                      {post.contentSections.map((section, index) => (
                        <article key={index} className={`overflow-hidden rounded-xl border ${dark ? 'border-[#304135] bg-[#131D16]' : 'border-[#E8ECE7] bg-[#FAFBF9]'}`}>
                          <div className={`flex items-center justify-between border-b px-3 py-2 ${dark ? 'border-[#304135] bg-[#101713]' : 'border-[#E8ECE7] bg-[#F5F7F4]'}`}>
                            <span className="text-[11px] font-bold text-[#72D28B]">Section {index + 1}</span>
                            {post.contentSections.length > 1 && (
                              <button type="button" onClick={() => removeSection(index)} aria-label={`Remove section ${index + 1}`} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          <div className="space-y-3 p-3">
                            <input required maxLength={180} aria-label={`Section ${index + 1} heading`} value={section.heading} onChange={(event) => setField('contentSections', post.contentSections.map((item, itemIndex) => itemIndex === index ? { ...item, heading: event.target.value } : item))} placeholder="Section heading" className={field} />
                            {section.paragraphs.map((paragraph, paragraphIndex) => (
                              <div
                                key={`${originalSlug || 'new'}-${index}-${paragraphIndex}`}
                                ref={(element) => {
                                  if (element && element.dataset.blogEditorInitialized !== 'true') {
                                    element.innerHTML = blogTextToEditorHtml(paragraph);
                                    element.dataset.blogEditorInitialized = 'true';
                                  }
                                }}
                                contentEditable
                                suppressContentEditableWarning
                                role="textbox"
                                aria-multiline="true"
                                aria-label={`Section ${index + 1}, paragraph ${paragraphIndex + 1}`}
                                data-section-index={index}
                                data-paragraph-index={paragraphIndex}
                                onKeyDown={(event) => {
                                  if (!(event.ctrlKey || event.metaKey)) return;
                                  const undo = event.key.toLowerCase() === 'z' && !event.shiftKey;
                                  const redo = event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey);
                                  if ((undo && restoreDraftHistory('undo')) || (redo && restoreDraftHistory('redo'))) event.preventDefault();
                                }}
                                onFocus={(event) => saveEditorSelection(index, paragraphIndex, event.currentTarget)}
                                onMouseUp={(event) => saveEditorSelection(index, paragraphIndex, event.currentTarget)}
                                onKeyUp={(event) => saveEditorSelection(index, paragraphIndex, event.currentTarget)}
                                onInput={(event) => {
                                  const html = sanitizeBlogHtml(event.currentTarget.innerHTML);
                                  saveEditorSelection(index, paragraphIndex, event.currentTarget);
                                  if (!suppressEditorHistoryRef.current) recordDraftHistory();
                                  setPost((current) => {
                                    const section = current.contentSections[index];
                                    const prior = section?.paragraphs[paragraphIndex] || '';
                                    const removedIds = [...prior.matchAll(/data-blog-image-id="([a-zA-Z0-9-]{1,80})"/g)]
                                      .map((match) => match[1])
                                      .filter((id) => !html.includes(`data-blog-image-id="${id}"`));
                                    const sectionId = section?.id || (removedIds.length ? crypto.randomUUID() : undefined);
                                    return {
                                      ...current,
                                      contentSections: current.contentSections.map((item, itemIndex) => itemIndex === index
                                        ? { ...item, ...(sectionId ? { id: sectionId } : {}), paragraphs: item.paragraphs.map((value, valueIndex) => valueIndex === paragraphIndex ? html : value) }
                                        : item),
                                      inlineImages: (current.inlineImages || []).map((image) => removedIds.includes(image.id || '')
                                        ? { ...image, sectionId, placement: 'section-end', afterSection: index }
                                        : image),
                                      updatedAt: new Date().toISOString(),
                                    };
                                  });
                                }}
                                data-placeholder="Write your article content here…"
                                className={`admin-blog-rich-editor ${field} min-h-36 resize-y overflow-auto leading-7 empty:before:pointer-events-none empty:before:text-[#76867B] empty:before:content-[attr(data-placeholder)] [&_a]:text-[#8FE1A0] [&_blockquote]:border-l-2 [&_blockquote]:border-[#67D8B7] [&_blockquote]:pl-4 [&_h2]:my-3 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:my-3 [&_h3]:text-xl [&_h3]:font-bold [&_h4]:my-3 [&_h4]:text-lg [&_h4]:font-bold [&_li]:ml-6 [&_ol]:list-decimal [&_p]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#304135] [&_td]:p-2 [&_th]:border [&_th]:border-[#304135] [&_th]:p-2 [&_th]:font-bold [&_ul]:list-disc`}
                              />
                            ))}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button type="button" onClick={() => setField('contentSections', post.contentSections.map((item, itemIndex) => itemIndex === index ? { ...item, paragraphs: [...item.paragraphs, ''] } : item))} className="text-xs font-semibold text-[#72D28B] hover:underline">+ Add paragraph</button>
                              <span className={`text-[10px] ${muted}`}>{wordCount} words · {post.contentSections.reduce((count, item) => count + item.paragraphs.join(' ').length, 0)} characters</span>
                            </div>
                            <input aria-label={`Section ${index + 1} takeaway`} value={section.callout || ''} onChange={(event) => setField('contentSections', post.contentSections.map((item, itemIndex) => itemIndex === index ? { ...item, callout: event.target.value } : item))} placeholder="Optional highlighted takeaway" className={field} />
                            <div className={`space-y-3 border-t pt-3 ${dark ? 'border-[#304135]' : 'border-[#E8ECE7]'}`}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className={`text-xs font-semibold ${text}`}>Images in this section</p>
                                  <p className={`mt-1 text-[10px] ${muted}`}>These appear inline after this section in the published article.</p>
                                </div>
                                <button type="button" disabled={(post.inlineImages || []).length >= 30} onClick={() => openImageConfiguration(index, undefined, 'after-heading')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#33453A] bg-[#101913] px-3 text-[11px] font-semibold text-[#EAF1EB] transition hover:border-[#67D8B7] disabled:opacity-50">
                                  <ImagePlus className="h-3.5 w-3.5 text-[#72D28B]" /> Add image in this section
                                </button>
                              </div>
                              {(post.inlineImages || []).map((image, imageIndex) => image.sectionId === section.id || image.afterSection === index ? (
                                <div key={image.id || `${image.url}-${imageIndex}`} className={`flex items-center gap-3 rounded-xl border p-2.5 ${dark ? 'border-[#304135] bg-[#101713]' : 'border-[#E8ECE7] bg-white'}`}>
                                  <img src={resolveBlogImage(image.url, image.altText, image.imageVariants, imageTheme).image.url} alt="" className="h-16 w-24 shrink-0 rounded-lg border border-[#304135] bg-black/20 object-contain" />
                                  <div className="min-w-0 flex-1">
                                    <ImageThemeTabs theme={imageTheme} source={resolveBlogImage(image.url, image.altText, image.imageVariants, imageTheme).source} onChange={setImageTheme} />
                                    <p className="truncate text-[11px] font-semibold text-[#EAF1EB]">{image.caption || image.altText || `Image ${imageIndex + 1}`}</p>
                                    <p className={`mt-0.5 truncate text-[10px] ${muted}`}>{image.placement ? image.placement.replace('-', ' ') : `After section ${index + 1}`} · {image.width || 'legacy size'}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                      <button type="button" onClick={() => openImageConfiguration(index, imageIndex)} className="rounded-md border border-[#33453A] px-2 py-1 text-[10px] font-semibold text-[#EAF1EB] hover:border-[#67D8B7]">Edit placement</button>
                                      <button type="button" aria-label={`Move image ${imageIndex + 1} earlier`} title="Move earlier" onClick={() => moveInlineImage(imageIndex, -1)} className="rounded-md p-1 text-[#A9B8AD] hover:bg-[#26372B]"><ArrowUp className="h-3.5 w-3.5" /></button>
                                      <button type="button" aria-label={`Move image ${imageIndex + 1} later`} title="Move later" onClick={() => moveInlineImage(imageIndex, 1)} className="rounded-md p-1 text-[#A9B8AD] hover:bg-[#26372B]"><ArrowDown className="h-3.5 w-3.5" /></button>
                                      <button type="button" onClick={() => openImageConfiguration(index, imageIndex)} className="rounded-md border border-[#33453A] px-2 py-1 text-[10px] font-semibold text-[#EAF1EB] hover:border-[#67D8B7]">Replace</button>
                                      <label className="cursor-pointer rounded-md border border-[#33453A] px-2 py-1 text-[10px] font-semibold text-[#EAF1EB] hover:border-[#67D8B7]">
                                        Set {imageTheme} variant
                                        <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/pjpeg,image/png,image/x-png,image/webp" disabled={uploadingImage !== null} className="sr-only" onChange={(event) => { void uploadImage(event.target.files?.[0], 'inline', image.afterSection ?? index, imageTheme, imageIndex); event.currentTarget.value = ''; }} />
                                      </label>
                                      <button type="button" onClick={() => removeInlineImage(imageIndex)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/10">Remove</button>
                                    </div>
                                    <details className="mt-2 text-[10px] text-[#A9B8AD]">
                                      <summary className="cursor-pointer">Edit {imageTheme} theme variant URL and alt text</summary>
                                      <label className="mt-2 block">
                                        <span className="mb-1 block">Variant URL</span>
                                        <input value={image.imageVariants?.[imageTheme]?.url || ''} onChange={(event) => {
                                          recordDraftHistory();
                                          setField('inlineImages', (post.inlineImages || []).map((item, candidateIndex) => candidateIndex === imageIndex
                                            ? { ...item, imageVariants: { ...item.imageVariants, [imageTheme]: { ...item.imageVariants?.[imageTheme], url: event.target.value } } }
                                            : item));
                                        }} className={field} placeholder="https://…" />
                                      </label>
                                      <label className="mt-2 block">
                                        <span className="mb-1 block">Variant alt text</span>
                                        <input maxLength={200} value={image.imageVariants?.[imageTheme]?.altText || ''} onChange={(event) => {
                                          recordDraftHistory();
                                          setField('inlineImages', (post.inlineImages || []).map((item, candidateIndex) => candidateIndex === imageIndex
                                            ? { ...item, imageVariants: { ...item.imageVariants, [imageTheme]: { ...item.imageVariants?.[imageTheme], altText: event.target.value } } }
                                            : item));
                                        }} className={field} />
                                      </label>
                                    </details>
                                  </div>
                                </div>
                              ) : null)}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <label className="mt-5 block">
                      <span className={fieldLabel}>Summary excerpt <span className="font-normal">(required)</span></span>
                      <textarea required maxLength={320} rows={3} value={post.excerpt} onChange={(event) => setField('excerpt', event.target.value)} placeholder="A concise summary for article listings and social previews…" className={`${field} resize-y`} />
                    </label>
                  </section>

                  <section className={panel}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className={`font-bold ${text}`}>FAQ structured snippets</h2>
                        <p className={`mt-1 text-xs ${muted}`}>Add useful questions and answers for article readers.</p>
                      </div>
                      <button type="button" disabled={(post.faqs || []).length >= 30} onClick={() => setField('faqs', [...(post.faqs || []), { question: '', answer: '' }])} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#3EA259]/10 px-3 py-2 text-xs font-semibold text-[#72D28B] disabled:opacity-40">
                        <Plus className="h-4 w-4" /> Add question
                      </button>
                    </div>
                    {(post.faqs || []).length === 0 ? (
                      <div className={`rounded-xl border border-dashed p-6 text-center text-xs ${dark ? 'border-[#304135] bg-[#131D16] text-[#A9B8AD]' : 'border-[#DFE6DF] text-[#829084]'}`}>
                        No FAQs added yet. Add a question and answer to expand the article.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(post.faqs || []).map((faq, index) => (
                          <div key={index} className={`rounded-xl border p-3 ${dark ? 'border-[#304135] bg-[#131D16]' : 'border-[#E8ECE7] bg-[#FAFBF9]'}`}>
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-xs font-semibold text-[#72D28B]">Question {index + 1}</span>
                              <button type="button" aria-label={`Remove question ${index + 1}`} onClick={() => setField('faqs', (post.faqs || []).filter((_, faqIndex) => faqIndex !== index))} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                            </div>
                            <input required maxLength={240} aria-label={`FAQ ${index + 1} question`} value={faq.question} onChange={(event) => setField('faqs', (post.faqs || []).map((item, faqIndex) => faqIndex === index ? { ...item, question: event.target.value } : item))} placeholder="Question" className={`${field} mb-3`} />
                            <textarea required maxLength={3000} rows={3} aria-label={`FAQ ${index + 1} answer`} value={faq.answer} onChange={(event) => setField('faqs', (post.faqs || []).map((item, faqIndex) => faqIndex === index ? { ...item, answer: event.target.value } : item))} placeholder="Answer" className={`${field} resize-y`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section id="seo-settings" tabIndex={-1} className={panel}>
                    <div className={`mb-4 border-b pb-4 ${dark ? 'border-[#304135]' : 'border-[#E8ECE7]'}`}>
                      <h2 className={`font-bold ${text}`}>Search Engine Optimization (SEO)</h2>
                      <p className={`mt-1 text-xs ${muted}`}>Prepare the title and description shown in search results.</p>
                    </div>
                    <label className="mb-4 block">
                      <span className={fieldLabel}>Meta title</span>
                      <input id="seo-title" maxLength={160} value={post.metaTitle || ''} onChange={(event) => setField('metaTitle', event.target.value)} placeholder={post.title || 'Defaults to post title'} className={field} />
                    </label>
                    <label className="block">
                      <span className={fieldLabel}>Meta description</span>
                      <textarea id="seo-description" maxLength={180} rows={3} value={post.metaDescription} onChange={(event) => setField('metaDescription', event.target.value)} placeholder="Write a compelling search result description…" className={`${field} resize-y`} />
                    </label>
                    <label className="mt-4 block">
                      <span className={fieldLabel}>Focus keywords <span className="font-normal">(comma separated)</span></span>
                      <input value={(post.focusKeywords || []).join(', ')} onChange={(event) => setField('focusKeywords', event.target.value.split(',').map((keyword) => keyword.trim()).filter(Boolean).slice(0, 30))} placeholder="local SEO, digital growth, Google Ads" className={field} />
                    </label>
                    <div className={`mt-5 border-t pt-4 ${dark ? 'border-[#304135]' : 'border-[#E8ECE7]'}`}>
                      <h3 id="social-metadata" tabIndex={-1} className={`mb-3 text-sm font-semibold ${text}`}>Open Graph (social media cards)</h3>
                      <label className="block">
                        <span className={fieldLabel}>Social title</span>
                        <input maxLength={160} value={post.socialTitle || ''} onChange={(event) => setField('socialTitle', event.target.value)} placeholder={post.title || 'Defaults to post title'} className={field} />
                      </label>
                      <ImageThemeTabs theme={imageTheme} source={socialImagePreview.source} onChange={setImageTheme} />
                      {socialImagePreview.image.url && (
                        <div className="relative mt-3">
                          <img src={socialImagePreview.image.url} alt={socialImagePreview.image.altText || 'Social share image preview'} className="aspect-video w-full rounded-xl border border-[#304135] object-cover" />
                          {post.socialImageVariants?.[imageTheme]?.url && <button type="button" onClick={() => setField('socialImageVariants', {
                            ...post.socialImageVariants,
                            [imageTheme]: { ...post.socialImageVariants?.[imageTheme], url: '' },
                          })} className="absolute right-2 top-2 rounded-lg bg-[#111C16]/95 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-700">Remove {imageTheme === 'light' ? 'Light' : 'Dark'} Mode image</button>}
                        </div>
                      )}
                      <label className={`mt-3 flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-3 text-xs font-semibold transition ${dark ? 'border-[#33453A] bg-[#101913] text-[#EAF1EB] hover:border-[#67D8B7]' : 'border-[#DFE6DF]'}`}>
                        {uploadingImage?.kind === 'social' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-[#72D28B]" />}
                        {post.socialImageVariants?.[imageTheme]?.url ? `Replace ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode social image` : `Upload ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode social image`}
                        <span className={`text-[10px] font-normal ${muted}`}>JPG, PNG or WebP · Max 15 MB</span>
                        <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={uploadingImage !== null} className="sr-only" onChange={(event) => { void uploadImage(event.target.files?.[0], 'social', undefined, imageTheme); event.currentTarget.value = ''; }} />
                      </label>
                      <label className="mt-3 block">
                        <span className={fieldLabel}>{imageTheme === 'light' ? 'Light' : 'Dark'} Mode social image URL</span>
                        <input value={post.socialImageVariants?.[imageTheme]?.url?.startsWith('/uploads/') ? '' : post.socialImageVariants?.[imageTheme]?.url ?? ''} onChange={(event) => setField('socialImageVariants', {
                          ...post.socialImageVariants,
                          [imageTheme]: { ...post.socialImageVariants?.[imageTheme], url: event.target.value },
                        })} className={field} placeholder="https://…" />
                      </label>
                      <label className="mt-3 block">
                        <span className={fieldLabel}>{imageTheme === 'light' ? 'Light' : 'Dark'} Mode image alt text</span>
                        <input maxLength={300} value={post.socialImageVariants?.[imageTheme]?.altText ?? ''} onChange={(event) => setField('socialImageVariants', {
                          ...post.socialImageVariants,
                          [imageTheme]: { ...post.socialImageVariants?.[imageTheme], altText: event.target.value },
                        })} className={field} />
                      </label>
                    </div>
                  </section>
                </div>

                <aside className="space-y-5">
                  <section className={panel}>
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className={`font-bold ${text}`}>Publishing controls</h2>
                      {originalSlug && <span className="rounded-full bg-[#3EA259]/10 px-2 py-1 text-[10px] font-semibold text-[#72D28B]">Saved article</span>}
                    </div>
                    <label className="mb-4 block">
                      <span className={fieldLabel}>Visibility status</span>
                      <select value={post.status} onChange={(event) => setField('status', event.target.value as BlogRecord['status'])} className={field} disabled={!canPublish}>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                    </label>
                    <button type="submit" name="publish" value="true" disabled={saving || !canPublish || !(originalSlug ? canEdit : canCreate)} className="admin-blog-primary mb-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#286D3B] disabled:opacity-60">
                      {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish live
                    </button>
                    <button type="submit" name="draft" value="true" disabled={saving || !(originalSlug ? canEdit : canCreate)} className={`admin-blog-secondary inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold disabled:opacity-60 ${dark ? 'border-[#304135] bg-[#131D16] text-[#ECF3EE] hover:border-[#55A66A]' : 'border-[#DFE6DF] bg-white text-[#526056]'}`}>
                      <Check className="h-4 w-4" /> Save draft
                    </button>
                    <p className={`mt-3 text-[10px] ${muted}`}>{originalSlug ? `Last modified ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.updatedAt))}` : 'Not saved to server yet'}</p>
                  </section>

                  <section id="article-author" tabIndex={-1} className={panel}>
                    <div className={`mb-4 border-b pb-3 ${dark ? 'border-[#304135]' : 'border-[#E8ECE7]'}`}>
                      <h2 className={`font-bold ${text}`}>Author &amp; Category</h2>
                    </div>
                    <label className="mb-4 block">
                      <span className={fieldLabel}>Category</span>
                      <select value={post.category} onChange={(event) => setField('category', event.target.value)} className={field}>
                        {categories.map((category) => <option key={category.slug} value={category.name}>{category.name}</option>)}
                        {post.category && !categories.some((category) => category.name === post.category) && <option value={post.category}>{post.category} (legacy)</option>}
                      </select>
                    </label>
                    <label className="mb-4 block">
                      <span className={fieldLabel}>Author name</span>
                      <input value={post.author.name} onChange={(event) => setField('author', { ...post.author, name: event.target.value })} className={field} placeholder="Enter author name" />
                    </label>
                    <label className="mb-4 block">
                      <span className={fieldLabel}>Author role</span>
                      <input value={post.author.role} onChange={(event) => setField('author', { ...post.author, role: event.target.value })} className={field} placeholder="Author role" />
                    </label>
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className={fieldLabel}>Author image <span className="font-normal">(optional)</span></span>
                        {post.author.imageVariants?.[imageTheme]?.url && <button type="button" onClick={() => setField('author', {
                          ...post.author,
                          imageVariants: { ...post.author.imageVariants, [imageTheme]: { ...post.author.imageVariants?.[imageTheme], url: '' } },
                        })} className="text-[11px] font-semibold text-rose-400 hover:text-rose-300">Remove {imageTheme === 'light' ? 'Light' : 'Dark'} Mode image</button>}
                      </div>
                      <ImageThemeTabs theme={imageTheme} source={authorImagePreview.source} onChange={setImageTheme} />
                      <div className="flex items-center gap-3">
                        {authorImagePreview.image.url
                          ? <img src={authorImagePreview.image.url} alt={authorImagePreview.image.altText || 'Author avatar preview'} className="h-14 w-14 rounded-full border border-[#304135] object-cover" />
                          : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[#304135] bg-[#101713] text-xs font-bold text-[#8FE1A0]">{post.author.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NG'}</span>}
                        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-[#33453A] bg-[#101913] px-3 text-xs font-semibold text-[#EAF1EB] transition hover:border-[#67D8B7]">
                          {uploadingImage?.kind === 'author' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-[#72D28B]" />}
                          {post.author.imageVariants?.[imageTheme]?.url ? 'Replace' : 'Upload'} {imageTheme === 'light' ? 'Light' : 'Dark'} Mode author photo
                          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/pjpeg,image/png,image/x-png,image/webp" disabled={uploadingImage !== null} className="sr-only" onChange={(event) => { void uploadImage(event.target.files?.[0], 'author', undefined, imageTheme); event.currentTarget.value = ''; }} />
                        </label>
                      </div>
                      <label className="mt-3 block">
                        <span className={fieldLabel}>{imageTheme === 'light' ? 'Light' : 'Dark'} Mode author image URL</span>
                        <input value={post.author.imageVariants?.[imageTheme]?.url?.startsWith('/uploads/') ? '' : post.author.imageVariants?.[imageTheme]?.url ?? ''} onChange={(event) => setField('author', {
                          ...post.author,
                          imageVariants: { ...post.author.imageVariants, [imageTheme]: { ...post.author.imageVariants?.[imageTheme], url: event.target.value } },
                        })} className={field} placeholder="https://…" />
                      </label>
                      <label className="mt-3 block">
                        <span className={fieldLabel}>Legacy/default author image URL</span>
                        <input value={post.author.imageUrl?.startsWith('/uploads/') ? '' : post.author.imageUrl || ''} onChange={(event) => setField('author', { ...post.author, imageUrl: event.target.value })} className={field} placeholder="https://…" />
                      </label>
                      <label className="mt-3 block">
                        <span className={fieldLabel}>{imageTheme === 'light' ? 'Light' : 'Dark'} Mode author image alt text</span>
                        <input maxLength={300} value={post.author.imageVariants?.[imageTheme]?.altText ?? ''} onChange={(event) => setField('author', {
                          ...post.author,
                          imageVariants: { ...post.author.imageVariants, [imageTheme]: { ...post.author.imageVariants?.[imageTheme], altText: event.target.value } },
                        })} className={field} />
                      </label>
                    </div>
                    <label className="block">
                      <span className={fieldLabel}>Related service</span>
                      <select value={SERVICES.some((service) => service.slug === post.relatedServiceSlug) ? post.relatedServiceSlug : '__custom__'} onChange={(event) => setField('relatedServiceSlug', event.target.value === '__custom__' ? (SERVICES.some((service) => service.slug === post.relatedServiceSlug) ? '' : post.relatedServiceSlug) : event.target.value)} className={field}>
                        <option value="">Choose a service page</option>
                        {SERVICES.map((service) => <option key={service.slug} value={service.slug}>{service.title}</option>)}
                        <option value="__custom__">Custom service URL or offering…</option>
                      </select>
                      {!SERVICES.some((service) => service.slug === post.relatedServiceSlug) && (
                        <input maxLength={500} value={post.relatedServiceSlug} onChange={(event) => setField('relatedServiceSlug', event.target.value.trim())} className={`${field} mt-2`} placeholder="/services/your-custom-service or https://…" aria-label="Custom related service URL" />
                      )}
                      <span className={`mt-2 block text-[10px] leading-4 ${muted}`}>Select a NearGrow service or enter a custom service page URL. The article CTA will link here.</span>
                    </label>
                  </section>

                  <section id="featured-image" tabIndex={-1} className={panel}>
                    <h2 className={`mb-3 font-bold ${text}`}>Featured media asset</h2>
                    <p className={`mb-3 text-xs ${muted}`}>Featured image · JPG, PNG or WebP up to 15 MB.</p>
                    <ImageThemeTabs theme={imageTheme} source={featuredImagePreview.source} onChange={setImageTheme} />
                    {featuredImagePreview.image.url && (
                      <div className="relative mb-3">
                        <img src={featuredImagePreview.image.url} alt={featuredImagePreview.image.altText || 'Featured article preview'} className="aspect-video w-full rounded-xl border border-[#304135] object-cover" />
                        {post.featuredImageVariants?.[imageTheme]?.url && (
                          <button type="button" onClick={() => setField('featuredImageVariants', {
                            ...post.featuredImageVariants,
                            [imageTheme]: { ...post.featuredImageVariants?.[imageTheme], url: '' },
                          })} className="absolute right-2 top-2 rounded-lg border border-white/10 bg-[#111C16]/95 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-700">Remove {imageTheme === 'light' ? 'Light' : 'Dark'} Mode image</button>
                        )}
                      </div>
                    )}
                    <label className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center text-xs font-semibold ${dark ? 'border-[#304135] bg-[#131D16] text-[#ECF3EE] hover:border-[#55A66A]' : 'border-[#DFE6DF]'}`}>
                      {uploadingImage?.kind === 'featured' ? <LoaderCircle className="h-5 w-5 animate-spin text-[#72D28B]" /> : <ImagePlus className="h-5 w-5 text-[#72D28B]" />} {post.featuredImageVariants?.[imageTheme]?.url ? `Replace ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode image` : `Upload ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode image`}
                      <span className={`text-[10px] font-normal ${muted}`}>Click to browse · Max 15 MB</span>
                      <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/pjpeg,image/png,image/x-png,image/webp" disabled={uploadingImage !== null} className="sr-only" onChange={(event) => { void uploadImage(event.target.files?.[0], 'featured', undefined, imageTheme); event.currentTarget.value = ''; }} />
                    </label>
                    {uploadError && <p role="alert" className="mt-2 text-xs text-rose-400">{uploadError}</p>}
                    <label className="mt-3 block">
                      <span className={fieldLabel}>{imageTheme === 'light' ? 'Light' : 'Dark'} Mode image URL</span>
                      <input value={post.featuredImageVariants?.[imageTheme]?.url?.startsWith('data:') ? '' : post.featuredImageVariants?.[imageTheme]?.url ?? ''} onChange={(event) => setField('featuredImageVariants', {
                        ...post.featuredImageVariants,
                        [imageTheme]: { ...post.featuredImageVariants?.[imageTheme], url: event.target.value },
                      })} className={field} placeholder="https://…" />
                    </label>
                    <label className="mt-3 block">
                      <span className={fieldLabel}>Image alt text</span>
                      <input maxLength={300} value={featuredImagePreview.image.altText ?? ''} onChange={(event) => setField('featuredImageVariants', {
                        ...post.featuredImageVariants,
                        [imageTheme]: { ...post.featuredImageVariants?.[imageTheme], altText: event.target.value },
                      })} className={field} />
                    </label>
                  </section>

                  <section className={panel}>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className={`font-bold ${text}`}>Image library</h2>
                      <span className={`text-[10px] ${muted}`}>{mediaPreviews.length} {mediaPreviews.length === 1 ? 'image' : 'images'}</span>
                    </div>
                    {mediaPreviews.length ? (
                      <div className="grid grid-cols-2 gap-2">
                        {mediaPreviews.map((image, index) => (
                          <figure key={`${image.label}-${index}`} className="min-w-0 overflow-hidden rounded-xl border border-[#304135] bg-[#101713]">
                            <img src={image.url} alt={image.label} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                            <figcaption className="truncate px-2.5 py-2 text-[10px] font-medium text-[#B8C7BC]" title={image.label}>{image.label}</figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : (
                      <p className={`rounded-xl border border-dashed p-4 text-center text-xs ${dark ? 'border-[#304135] text-[#A9B8AD]' : 'border-[#E8ECE7] text-[#829084]'}`}>Uploaded article images appear here.</p>
                    )}
                  </section>

                  <section className={panel}>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className={`font-bold ${text}`}>Draft preflight</h2>
                      <span className="rounded-full bg-sky-500/15 px-2 py-1 text-[10px] font-semibold text-sky-300">Not a saved scan</span>
                    </div>
                    <ul className="space-y-2">
                      {seoChecks.map((check) => (
                        <li key={check.label} className={`flex items-center gap-2 text-xs ${check.done ? 'text-emerald-300' : muted}`}>
                          <CircleCheck className="h-3.5 w-3.5 shrink-0" /> {check.label}
                        </li>
                      ))}
                    </ul>
                    <div className={`mt-4 rounded-xl border p-3 ${dark ? 'border-[#304135] bg-[#131D16]' : 'border-[#E8ECE7] bg-[#FAFBF9]'}`}>
                      <div className="flex items-center gap-2 text-[10px] font-semibold text-[#72D28B]"><FileText className="h-3.5 w-3.5" /> Search preview</div>
                      <p className="mt-2 truncate text-xs font-semibold text-[#8AB4F8]">{post.metaTitle || post.title || 'Article title'}</p>
                      <p className={`mt-1 line-clamp-2 text-[10px] ${muted}`}>neargrowads.in/blog/{post.slug || 'article-slug'}</p>
                      <p className={`mt-1 line-clamp-2 text-[10px] ${muted}`}>{post.metaDescription || post.excerpt || 'Add an article excerpt for the rendered description.'}</p>
                    </div>
                    <div className={`mt-3 rounded-xl p-3 text-xs ${dark ? 'bg-[#202D24]' : 'bg-[#F1F6F1]'}`}>
                      <span className="inline-flex items-center gap-2"><Tag className="h-3.5 w-3.5" /> Estimated reading time</span><span className="float-right">{readTime(post)}</span>
                    </div>
                  </section>
                </aside>
              </form>
            )}
          </>
        ) : (
          <>
            <section className={`mb-5 rounded-3xl border p-5 shadow-sm ${dark ? 'border-[#304135] bg-[#19241D]' : 'border-[#E2E8E1] bg-white'}`}>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className={`flex h-11 flex-1 items-center gap-2 rounded-xl border px-3 ${dark ? 'border-[#304135] bg-[#131D16]' : 'border-[#DFE6DF] bg-[#FAFBF9]'}`}>
                  <Search className={`h-4 w-4 ${muted}`} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" aria-label="Search blog articles" className={`min-w-0 flex-1 bg-transparent text-xs outline-none ${text}`} />
                </label>
                <div className="flex gap-2">
                  {(['all', 'published', 'draft'] as const).map((value) => (
                    <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`admin-blog-filter rounded-xl border px-3 py-2 text-xs font-semibold capitalize ${filter === value ? 'border-[#3EA259] bg-[#3EA259]/10 text-[#72D28B]' : dark ? 'border-[#304135] text-[#A9B8AD]' : 'border-[#E1E7E0] text-[#526056]'}`}>
                      {value === 'all' ? `All (${posts.length})` : `${value} (${posts.filter((item) => item.status === value).length})`}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <AdminBlogSeoHealth
              posts={posts}
              canEdit={canEdit}
              onEdit={(slug, anchor) => onNavigate(`/admin/blog/${encodeURIComponent(slug)}${anchor ? `#${anchor}` : ''}`)}
            />
            {busy ? (
              <div className={`grid min-h-60 place-items-center ${muted}`}><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading articles…</div>
            ) : filteredPosts.length === 0 ? (
              <section className={`${panel} grid min-h-64 place-items-center text-center`}>
                <div>
                  <BookOpen className="mx-auto h-8 w-8 text-[#83A889]" />
                  <h2 className={`mt-4 font-bold ${text}`}>{posts.length ? 'No articles match your search' : 'Your editorial calendar starts here'}</h2>
                  <p className={`mt-2 text-sm ${muted}`}>Create a useful article and share your team’s expertise.</p>
                  {canCreate && <button type="button" onClick={() => onNavigate('/admin/blog/new')} className="admin-blog-primary mt-4 inline-flex items-center gap-2 rounded-xl bg-[#286D3B] px-4 py-2.5 text-xs font-semibold text-white">
                    <Plus className="h-4 w-4" /> Create article
                  </button>}
                </div>
              </section>
            ) : (
              <section className={`overflow-hidden rounded-3xl border shadow-sm ${dark ? 'border-[#304135] bg-[#19241D]' : 'border-[#E2E8E1] bg-white'}`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left">
                    <thead className={`${dark ? 'bg-[#131D16]' : 'bg-[#FAFBF9]'} text-[10px] uppercase tracking-[0.12em] ${muted}`}>
                      <tr>
                        <th className="px-5 py-4">Article</th><th className="px-4 py-4">Category</th><th className="px-4 py-4">Author name</th><th className="px-4 py-4">Status</th><th className="px-4 py-4">Last updated</th><th className="px-4 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${dark ? 'divide-[#304135]' : 'divide-[#EEF1ED]'}`}>
                      {filteredPosts.map((item) => (
                        <tr key={item.slug} className={dark ? 'hover:bg-[#202D24]' : 'hover:bg-[#FCFDFC]'}>
                          <td className="max-w-md px-5 py-4">
                            <div className="flex items-start gap-3">
                              {resolveBlogImage(item.featuredImage, item.featuredImageAltText ?? '', item.featuredImageVariants, imageTheme).image.url
                                ? <img src={resolveBlogImage(item.featuredImage, item.featuredImageAltText ?? '', item.featuredImageVariants, imageTheme).image.url} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                                : <span className={`grid h-12 w-16 shrink-0 place-items-center rounded-lg ${dark ? 'bg-[#202D24] text-[#83A889]' : 'bg-[#EFF5EF] text-[#6F9977]'}`}><BookOpen className="h-5 w-5" /></span>}
                              <div className="min-w-0">
                                <p className={`truncate text-sm font-semibold ${text}`}>{item.title}</p>
                                <p className={`mt-1 line-clamp-2 text-[11px] ${muted}`}>{item.excerpt}</p>
                                <span className={`mt-2 inline-flex items-center gap-1 text-[10px] ${muted}`}><Clock3 className="h-3 w-3" /> {item.readTime}</span>
                              </div>
                            </div>
                          </td>
                          <td className={`px-4 py-4 text-xs ${text}`}>{item.category}</td>
                          <td className={`max-w-48 px-4 py-4 text-xs ${text}`}>
                            <span className="block truncate" title={blogAuthorDisplayName(item.author)} aria-label={`Author name: ${blogAuthorDisplayName(item.author)}`}>
                              {blogAuthorDisplayName(item.author)}
                            </span>
                          </td>
                          <td className="px-4 py-4"><span className={`admin-blog-status admin-blog-status-${item.status} rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.status === 'published' ? (dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700') : (dark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-800')}`}>{item.status === 'published' ? 'Published' : 'Draft'}</span></td>
                          <td className={`whitespace-nowrap px-4 py-4 text-xs ${muted}`}>
                            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(item.updatedAt))}</span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-1">
                              {canEdit && <button type="button" title="Edit article" onClick={() => onNavigate(`/admin/blog/${encodeURIComponent(item.slug)}`)} className={`rounded-lg p-2 ${dark ? 'text-[#A9B8AD] hover:bg-[#26372B] hover:text-[#72D28B]' : 'text-[#6F7C71] hover:bg-[#EEF5EF] hover:text-[#286D3B]'}`}><PenLine className="h-4 w-4" /></button>}
                              {item.status === 'published' && <a href={`/blog/${encodeURIComponent(item.slug)}`} target="_blank" rel="noreferrer" title="Preview article" className={`rounded-lg p-2 ${dark ? 'text-[#A9B8AD] hover:bg-[#26372B] hover:text-[#72D28B]' : 'text-[#6F7C71] hover:bg-[#EEF5EF] hover:text-[#286D3B]'}`}><Eye className="h-4 w-4" /></a>}
                              {canDelete && <button type="button" title="Delete article" onClick={() => void removePost(item)} className="rounded-lg p-2 text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"><Trash2 className="h-4 w-4" /></button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {imageDialog && (
        <div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/75 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setImageDialog(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="blog-image-dialog-title" className="my-auto max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#304135] bg-[#19241D] p-5 text-[#ECF3EE] shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="blog-image-dialog-title" className="text-lg font-bold">{imageDialog.imageIndex === undefined ? 'Configure article image' : 'Edit article image'}</h2>
                <p className="mt-1 text-xs text-[#A9B8AD]">The preview uses the published article renderer. Changes stay in this draft until you save.</p>
              </div>
              <button type="button" aria-label="Cancel image configuration" onClick={() => setImageDialog(null)} className="rounded-lg px-2 py-1 text-sm text-[#A9B8AD] hover:bg-[#26372B]">Close</button>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel}>Image URL</span>
                    <input value={imageDialog.source} onChange={(event) => setImageDialog((current) => current ? { ...current, source: event.target.value } : current)} className={field} placeholder="https://…" />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Choose existing media</span>
                    <select value="" onChange={(event) => { if (event.target.value) setImageDialog((current) => current ? { ...current, source: event.target.value } : current); }} className={field}>
                      <option value="">Select media from this article…</option>
                      {Array.from(new Map(mediaPreviews.map((item) => [item.url, item.label])).entries()).map(([url, label]) => <option key={url} value={url}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#33453A] bg-[#101913] px-3 py-2 text-xs font-semibold hover:border-[#67D8B7]">
                  {uploadingImage?.kind === 'pending-inline' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-[#72D28B]" />}
                  Upload JPG, PNG or WebP
                  <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/pjpeg,image/png,image/x-png,image/webp" disabled={uploadingImage !== null} className="sr-only" onChange={(event) => { void uploadImage(event.target.files?.[0], 'pending-inline'); event.currentTarget.value = ''; }} />
                </label>

                <label className="block">
                  <span className={fieldLabel}>Section</span>
                  <select value={imageDialog.sectionIndex} onChange={(event) => setImageDialog((current) => current ? { ...current, sectionIndex: Number(event.target.value) } : current)} className={field}>
                    {post.contentSections.map((section, index) => <option key={section.id || index} value={index}>Section {index + 1}: {section.heading || 'Untitled section'}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className={fieldLabel}>Placement</span>
                  <select value={imageDialog.destination} onChange={(event) => setImageDialog((current) => current ? { ...current, destination: event.target.value as ImageDestination } : current)} className={field}>
                    {imageDialog.destination === 'cursor' && <option value="cursor">{imageDialog.imageIndex === undefined ? 'At saved caret position' : 'Keep current in-body position'}</option>}
                    {post.contentSections[imageDialog.sectionIndex]?.paragraphs.map((paragraph, index) => {
                      const summary = paragraph.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Empty content block';
                      return <option key={`start-${index}`} value={`paragraph-start:${index}`}>Before paragraph {index + 1}: {summary}</option>;
                    })}
                    {post.contentSections[imageDialog.sectionIndex]?.paragraphs.map((paragraph, index) => {
                      const summary = paragraph.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Empty content block';
                      return <option key={`end-${index}`} value={`paragraph-end:${index}`}>After paragraph {index + 1}: {summary}</option>;
                    })}
                    <option value="before-heading">Before section heading</option>
                    <option value="after-heading">After section heading</option>
                    <option value="section-end">At the end of the section</option>
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel}>Width preset</span>
                    <select value={['25%', '50%', '75%', '100%'].includes(imageDialog.width) ? imageDialog.width : 'custom'} onChange={(event) => {
                      const value = event.target.value;
                      if (value !== 'custom') setImageDialog((current) => current ? { ...current, width: value } : current);
                    }} className={field}>
                      <option value="25%">Small · 25%</option><option value="50%">Medium · 50%</option><option value="75%">Large · 75%</option><option value="100%">Full content width · 100%</option><option value="custom">Custom width</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Custom width (%) or (px)</span>
                    <input value={imageDialog.width} onChange={(event) => setImageDialog((current) => current ? { ...current, width: event.target.value.trim() } : current)} className={field} placeholder="50% or 480px" />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Alignment</span>
                    <select value={imageDialog.alignment} onChange={(event) => setImageDialog((current) => current ? { ...current, alignment: event.target.value as 'left' | 'center' | 'right' } : current)} className={field}>
                      <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Layout</span>
                    <select value={imageDialog.layout} onChange={(event) => setImageDialog((current) => current ? { ...current, layout: event.target.value as 'standalone' | 'wrap-left' | 'wrap-right' } : current)} className={field}>
                      <option value="standalone">Standalone image</option><option value="wrap-left">Image left · text wraps right</option><option value="wrap-right">Image right · text wraps left</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Spacing above (px)</span>
                    <input type="number" min={0} max={120} value={imageDialog.spacingAbove} onChange={(event) => setImageDialog((current) => current ? { ...current, spacingAbove: Number(event.target.value) } : current)} className={field} />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>Spacing below (px)</span>
                    <input type="number" min={0} max={120} value={imageDialog.spacingBelow} onChange={(event) => setImageDialog((current) => current ? { ...current, spacingBelow: Number(event.target.value) } : current)} className={field} />
                  </label>
                </div>
                <label className="block">
                  <span className={fieldLabel}>Alt text</span>
                  <input maxLength={200} value={imageDialog.altText} onChange={(event) => setImageDialog((current) => current ? { ...current, altText: event.target.value } : current)} className={field} placeholder="Describe the image for accessibility" />
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-[#B8C7BC]">
                  <input type="checkbox" checked={imageDialog.decorative} onChange={(event) => setImageDialog((current) => current ? { ...current, decorative: event.target.checked, altText: event.target.checked ? '' : current.altText } : current)} />
                  Decorative image (empty alt text is intentional)
                </label>
                <label className="block">
                  <span className={fieldLabel}>Caption (optional)</span>
                  <input maxLength={500} value={imageDialog.caption} onChange={(event) => setImageDialog((current) => current ? { ...current, caption: event.target.value } : current)} className={field} placeholder="Add an image caption" />
                </label>
                {uploadError && <p role="alert" className="text-xs text-rose-300">{uploadError}</p>}
              </div>
              <div>
                <p className={fieldLabel}>Live preview · medium by default</p>
                <div className="flow-root min-h-56 rounded-xl border border-[#304135] bg-[#101713] p-3">
                  {imageDialog.source
                    ? <figure style={{
                      width: 'fit-content',
                      maxWidth: `min(${imageDialog.width},100%)`,
                      marginTop: `${imageDialog.spacingAbove}px`,
                      marginBottom: `${imageDialog.spacingBelow}px`,
                      marginLeft: imageDialog.layout === 'standalone' && imageDialog.alignment !== 'left' ? 'auto' : imageDialog.layout === 'wrap-right' ? 'auto' : 0,
                      marginRight: imageDialog.layout === 'standalone' && imageDialog.alignment !== 'right' ? 'auto' : imageDialog.layout === 'wrap-left' ? 'auto' : 0,
                      float: imageDialog.layout === 'wrap-left' ? 'left' : imageDialog.layout === 'wrap-right' ? 'right' : undefined,
                    }}>
                      <img src={imageDialog.source} alt={imageDialog.altText} style={{ display: 'block', width: 'auto', maxWidth: '100%', height: 'auto', objectFit: 'contain' }} />
                      {imageDialog.caption && <figcaption className="pt-2 text-center text-xs text-[#A9B8AD]">{imageDialog.caption}</figcaption>}
                    </figure>
                    : <p className="text-center text-xs text-[#76867B]">Upload or select an image to preview its natural proportions and configured maximum width.</p>}
                  {imageDialog.source && imageDialog.layout !== 'standalone' && <p className="text-xs leading-5 text-[#A9B8AD]">This sample text shows how the selected wrap direction will flow beside the image in the article.</p>}
                </div>
                <p className="mt-2 text-[10px] leading-5 text-[#A9B8AD]">Images keep their aspect ratio and natural size; the selected width is a maximum and is clamped to the article container.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#304135] pt-4">
              <button type="button" onClick={() => { setImageDialog(null); setUploadError(''); }} className="rounded-lg border border-[#33453A] px-4 py-2 text-xs font-semibold text-[#A9B8AD] hover:bg-[#202D24]">Cancel</button>
              {imageDialog.imageIndex === undefined && <button type="button" disabled={!imageDialog.source || uploadingImage !== null} onClick={() => confirmImageConfiguration(true)} className="rounded-lg border border-[#67D8B7]/50 px-4 py-2 text-xs font-semibold text-[#A8EBD6] disabled:opacity-50">Insert &amp; preview</button>}
              <button type="button" disabled={!imageDialog.source || uploadingImage !== null} onClick={() => confirmImageConfiguration(false)} className="rounded-lg bg-[#286D3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#347E49] disabled:opacity-50">{imageDialog.imageIndex === undefined ? 'Insert image' : 'Save image changes'}</button>
            </div>
          </section>
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-[110] overflow-y-auto bg-black/80 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label="Unsaved article preview">
          <div className="mx-auto flex min-h-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-[#304135] bg-[#080E16]">
            <div className="sticky top-0 z-[2] flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] bg-[#101713] px-4 py-3 text-[#ECF3EE]">
              <div>
                <p className="text-sm font-bold">Article preview <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200">UNSAVED · NOT PUBLISHED</span></p>
                <p className="mt-1 text-[10px] text-[#A9B8AD]">Insertion markers are editing controls only; published output uses the same article renderer without markers.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={!previewMobile} onClick={() => setPreviewMobile(false)} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Desktop</button>
                <button type="button" aria-pressed={previewMobile} onClick={() => setPreviewMobile(true)} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Mobile</button>
                <button type="button" aria-pressed={previewTheme === 'light'} onClick={() => setPreviewTheme('light')} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Light</button>
                <button type="button" aria-pressed={previewTheme === 'dark'} onClick={() => setPreviewTheme('dark')} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Dark</button>
                {previewSelection && (() => {
                  const imageIndex = previewSelectedImageIndex;
                  const image = post.inlineImages?.[imageIndex];
                  const sectionIndex = image?.sectionId
                    ? Math.max(0, post.contentSections.findIndex((section) => section.id === image.sectionId))
                    : image?.afterSection ?? 0;
                  return imageIndex >= 0 ? <>
                    <button type="button" onClick={() => { setPreviewOpen(false); openImageConfiguration(sectionIndex, imageIndex); }} className="rounded-lg bg-[#286D3B] px-3 py-1.5 text-[11px] font-semibold text-white">Edit selected image</button>
                    <button type="button" title="Move selected image earlier" onClick={() => moveInlineImage(imageIndex, -1)} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Move earlier</button>
                    <button type="button" title="Move selected image later" onClick={() => moveInlineImage(imageIndex, 1)} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Move later</button>
                  </> : null;
                })()}
                <button type="button" onClick={() => { setPreviewOpen(false); setPreviewSelection(null); }} className="rounded-lg border border-[#33453A] px-3 py-1.5 text-[11px] font-semibold text-[#EAF1EB]">Close preview</button>
              </div>
            </div>
            <div className={`admin-blog-preview mx-auto min-h-full w-full ${previewMobile ? 'max-w-[390px]' : 'max-w-[1400px]'}`} data-preview-theme={previewTheme}>
              {previewSelection && (previewSelection.startsWith('legacy:')
                ? <style>{`.admin-blog-preview [data-blog-image-index="${previewSelection.slice('legacy:'.length)}"]{outline:2px solid #67D8B7;outline-offset:4px;border-radius:8px}`}</style>
                : <style>{`.admin-blog-preview [data-blog-image-id="${CSS.escape(previewSelection)}"]{outline:2px solid #67D8B7;outline-offset:4px;border-radius:8px}`}</style>)}
              <BlogPostPage
                post={post}
                onNavigate={() => undefined}
                theme={previewTheme}
                previewEditing={{
                  onPosition: (sectionIndex, destination) => {
                    setPreviewOpen(false);
                    setPreviewSelection(null);
                    openImageConfiguration(sectionIndex, undefined, destination);
                  },
                  onSelectImage: setPreviewSelection,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
