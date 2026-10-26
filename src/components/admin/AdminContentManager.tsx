import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, History, Image, LoaderCircle, Monitor, RotateCcw, Save, Send, Smartphone, Tablet, Upload, Video, X } from 'lucide-react';
import { DEFAULT_SITE_CONTENT, type GlobeLightAppearance, type ManagedPage, type SiteContent } from '../../data/siteContent';
import { PUBLIC_COPY_FIELDS, type CopyPage } from '../../data/publicCopy';
import {
  HOME_HERO_DARK_VIDEO_ID,
  HOME_HERO_LIGHT_VIDEO_ID,
  PUBLIC_MEDIA,
  resolvePublicMedia,
} from '../../data/publicMedia';
import { ImageThemeTabs } from './ImageThemeTabs';
import type { PublicImageTheme } from '../../data/themeImages';
import { isSafePublicDestination } from '../../data/publicLinks';
import storefrontImage from '../../assets/images/local_business_storefront_1792080226091.jpg';
import workspaceImage from '../../assets/images/hero_agency_workspace_1792080209028.jpg';
import bundledHeroVideo from '../../assets/media/neargrow_ads_kinetic_4x3.mp4';

interface Props {
  onBack: () => void;
  onSaved: (content: SiteContent) => void;
  embedded?: boolean;
  canEdit?: boolean;
  canPublish?: boolean;
}

const groups = [
  {
    page: 'home',
    key: 'hero',
    title: 'Hero Section',
    description: 'The first message and primary actions visitors see on the Home page.',
    fields: [
      ['eyebrow', 'Eyebrow / location line', 'text'],
      ['headlineBefore', 'Headline before highlight', 'text'],
      ['headlineHighlight', 'Highlighted headline word', 'text'],
      ['headlineAfter', 'Headline after highlight', 'text'],
      ['description', 'Supporting description', 'textarea'],
      ['primaryCta', 'Primary button label', 'text'],
      ['secondaryCta', 'Secondary button label', 'text'],
      ['videoUrl', 'Hero video URL (blank uses the built-in video)', 'url'],
    ],
  },
  {
    page: 'home',
    key: 'philosophy',
    title: 'Philosophy · People, Ideas, Growth',
    description: 'Edit the introductory message and each of the three principle cards.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Section heading', 'text'],
      ['description', 'Section description', 'textarea'],
      ['peopleTitle', 'People card heading', 'text'],
      ['peopleDescription', 'People card description', 'textarea'],
      ['ideasTitle', 'Ideas card heading', 'text'],
      ['ideasDescription', 'Ideas card description', 'textarea'],
      ['growthTitle', 'Growth card heading', 'text'],
      ['growthDescription', 'Growth card description', 'textarea'],
    ],
  },
  {
    page: 'home',
    key: 'missionVision',
    title: 'Mission & Vision',
    description: 'Update the two purpose statements shown beneath the philosophy cards.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Section heading', 'text'],
      ['missionTitle', 'Mission heading', 'text'],
      ['missionDescription', 'Mission statement', 'textarea'],
      ['visionTitle', 'Vision heading', 'text'],
      ['visionDescription', 'Vision statement', 'textarea'],
    ],
  },
  {
    page: 'home',
    key: 'services',
    title: 'Core Services Introduction',
    description: 'Change the services-section intro and its link button on the Home page.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Section heading', 'text'],
      ['description', 'Section description', 'textarea'],
      ['cta', 'Services button label', 'text'],
    ],
  },
  {
    page: 'home',
    key: 'methodology',
    title: 'Methodology',
    description: 'Edit the methodology section heading and introductory copy.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Section heading', 'text'],
      ['description', 'Section description', 'textarea'],
    ],
  },
  {
    page: 'services',
    key: 'servicesPage',
    title: 'Services Page',
    description: 'Manage the main services-page headline, intro, and audit CTA.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['headlineBefore', 'Headline before highlight', 'text'],
      ['headlineHighlight', 'Highlighted headline text', 'text'],
      ['description', 'Page description', 'textarea'],
      ['primaryCta', 'Audit button label', 'text'],
      ['supportingText', 'Supporting CTA text', 'text'],
    ],
  },
  {
    page: 'about',
    key: 'aboutPage',
    title: 'About Page',
    description: 'Manage the About page introduction.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Page heading', 'text'],
      ['description', 'Page introduction', 'textarea'],
      ['primaryCta', 'Primary button label', 'text'],
      ['secondaryCta', 'Secondary button label', 'text'],
    ],
  },
  {
    page: 'work',
    key: 'workPage',
    title: 'Work & Case Studies Page',
    description: 'Manage the portfolio page introduction.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Page heading', 'text'],
      ['description', 'Page introduction', 'textarea'],
      ['primaryCta', 'Primary button label', 'text'],
    ],
  },
  {
    page: 'contact',
    key: 'contactPage',
    title: 'Contact Page',
    description: 'Manage the Contact page introduction above the enquiry form.',
    fields: [
      ['eyebrow', 'Eyebrow', 'text'],
      ['title', 'Page heading', 'text'],
      ['description', 'Page introduction', 'textarea'],
      ['primaryCta', 'Inquiry form button label', 'text'],
    ],
  },
] as const;

const pageTabs: { id: ManagedPage; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'blog', label: 'Blog' },
  { id: 'contact', label: 'Contact' },
];

function isManagedPage(page: CopyPage): page is ManagedPage {
  return pageTabs.some((tab) => tab.id === page);
}

function getCtaLabel(content: SiteContent, id: string): string {
  const copy = content.copy;
  switch (id) {
    case 'header.consultation': return copy['header.consultation'] ?? '';
    case 'header.whatsapp': return copy['header.chat'] ?? '';
    case 'home.hero.primary': return content.hero.primaryCta;
    case 'home.hero.secondary': return content.hero.secondaryCta;
    case 'home.hero.caseStudies': return copy['home.hero.caseStudiesLink'] ?? '';
    case 'home.services.browse': return content.services.cta;
    case 'home.hospitality': return copy['home.hospitality.cta'] ?? '';
    case 'home.faqs': return copy['home.faqs.cta'] ?? '';
    case 'home.closing.primary': return copy['home.closing.primaryCta'] ?? '';
    case 'home.closing.secondary': return copy['home.closing.secondaryCta'] ?? '';
    case 'services.primary': return content.servicesPage.primaryCta;
    case 'about.primary': return content.aboutPage.primaryCta;
    case 'about.secondary': return content.aboutPage.secondaryCta;
    case 'work.primary': return content.workPage.primaryCta;
    case 'contact.primary': return content.contactPage.primaryCta;
    case 'contact.whatsapp': return copy['contact.whatsapp.cta'] ?? '';
    case 'thankYou.whatsapp': return copy['thankYou.whatsapp'] ?? '';
    default: return '';
  }
}

const bundledMediaFallbacks: Record<string, string> = {
  [HOME_HERO_DARK_VIDEO_ID]: bundledHeroVideo,
  'home.portfolio.1': storefrontImage,
  'home.portfolio.2': workspaceImage,
};

const copyPageTabs: { id: CopyPage; label: string }[] = [
  ...pageTabs,
  { id: 'getStarted', label: 'Get Started' },
  { id: 'thankYou', label: 'Thank You' },
  { id: 'legal', label: 'Legal' },
  { id: 'footer', label: 'Footer' },
  { id: 'siteLinks', label: 'Navigation & SEO' },
  { id: 'media', label: 'Images & Media' },
  { id: 'animations', label: 'Animations & Effects' },
];

const dedicatedModuleLinks: Partial<Record<CopyPage, { label: string; href: string }[]>> = {
  services: [
    { label: 'Manage service records and images', href: '/admin/services' },
    { label: 'Manage service categories', href: '/admin/categories' },
  ],
  catalogue: [
    { label: 'Manage packages, prices, inclusions and FAQs', href: '/admin/service-store' },
    { label: 'Manage categories', href: '/admin/categories' },
  ],
  work: [{ label: 'Manage case-study records', href: '/admin/case-studies' }],
  about: [{ label: 'Manage team and mentor profiles', href: '/admin/team' }],
  blog: [{ label: 'Manage posts and article content', href: '/admin/blog' }],
};

interface ContentResponse {
  content?: SiteContent;
  draft?: SiteContent;
  published?: SiteContent;
  publishedAt?: string | null;
  draftUpdatedAt?: string | null;
  draftUpdatedBy?: string | null;
  revisions?: ContentRevision[];
  message?: string;
  url?: string;
}

interface ContentRevision {
  id: number;
  action: 'draft_saved' | 'published' | 'restored_as_draft' | 'discarded' | string;
  actorLabel: string;
  createdAt: string;
}

async function readResponse(response: Response): Promise<ContentResponse> {
  try {
    return await response.json() as ContentResponse;
  } catch {
    throw new Error(`Page Content Manager received a non-JSON response (${response.status}). Confirm the app is running with Express using "npm run dev".`);
  }
}

export function AdminContentManager({ onBack, onSaved, embedded = false, canEdit = true, canPublish = canEdit }: Props) {
  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [savedDraft, setSavedDraft] = useState<SiteContent | null>(null);
  const [publishedContent, setPublishedContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [activePage, setActivePage] = useState<CopyPage>('home');
  const [globeAppearanceMode, setGlobeAppearanceMode] = useState<'light' | 'dark'>('dark');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [draftUpdatedBy, setDraftUpdatedBy] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewPath, setPreviewPath] = useState('/');
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewFrameLoaded, setPreviewFrameLoaded] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const dirty = savedDraft !== null && JSON.stringify(content) !== JSON.stringify(savedDraft);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [uploadingMediaId, setUploadingMediaId] = useState<string | null>(null);
  const [imageThemes, setImageThemes] = useState<Record<string, PublicImageTheme>>({});

  useEffect(() => {
    let active = true;
    fetch('/api/admin/site-content', { credentials: 'same-origin' })
      .then(async (response) => {
        const data = await readResponse(response);
        if (!response.ok) throw new Error(data.message || `Could not load page content (${response.status}).`);
        const draft = data.draft || data.content;
        if (!draft) throw new Error('The server returned no page content configuration.');
        const published = data.published || draft;
        if (active) {
          setContent(draft);
          setSavedDraft(draft);
          setPublishedContent(published);
          setPublishedAt(data.publishedAt || null);
          setDraftUpdatedAt(data.draftUpdatedAt || null);
          setDraftUpdatedBy(data.draftUpdatedBy || null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoadFailed(true);
          setError(reason instanceof Error ? reason.message : 'Could not load page content.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!showPreview || !previewFrameLoaded) return;
    previewFrame.current?.contentWindow?.postMessage(
      { type: 'ng-cms-preview-content', content },
      window.location.origin,
    );
  }, [content, previewFrameLoaded, showPreview]);

  useEffect(() => {
    const handlePreviewReady = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== previewFrame.current?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object' ||
        (event.data as { type?: unknown }).type !== 'ng-cms-preview-ready') return;
      previewFrame.current?.contentWindow?.postMessage(
        { type: 'ng-cms-preview-content', content },
        window.location.origin,
      );
    };
    window.addEventListener('message', handlePreviewReady);
    return () => window.removeEventListener('message', handlePreviewReady);
  }, [content]);

  const updateField = (section: keyof SiteContent, key: string, value: string) => {
    setContent((current) => ({
      ...current,
      [section]: { ...(current[section] as Record<string, string>), [key]: value },
    }));
    setNotice('');
  };

  const updateSeoField = (page: ManagedPage, key: keyof SiteContent['seo'][ManagedPage], value: string) => {
    setContent((current) => ({
      ...current,
      seo: { ...current.seo, [page]: { ...current.seo[page], [key]: value } },
    }));
    setNotice('');
  };

  const updateAnimation = <K extends keyof SiteContent['animations']>(
    key: K,
    value: SiteContent['animations'][K],
  ) => {
    setContent((current) => ({
      ...current,
      animations: { ...current.animations, [key]: value },
    }));
    setNotice('');
  };

  const updateGlobeLightAppearance = <K extends keyof GlobeLightAppearance>(
    key: K,
    value: GlobeLightAppearance[K],
  ) => {
    setContent((current) => ({
      ...current,
      animations: {
        ...current.animations,
        globeLightAppearance: { ...current.animations.globeLightAppearance, [key]: value },
      },
    }));
    setNotice('');
  };

  const updateNavigation = (index: number, patch: Partial<SiteContent['navigation'][number]>) => {
    setContent((current) => {
      const navigation = current.navigation.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
      const changed = navigation[index];
      const copyKey = `header.nav.${changed.id}`;
      return {
        ...current,
        navigation,
        copy: { ...current.copy, [copyKey]: changed.label },
      };
    });
    setNotice('');
  };

  const moveNavigation = (index: number, offset: -1 | 1) => {
    setContent((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.navigation.length) return current;
      const navigation = [...current.navigation];
      [navigation[index], navigation[target]] = [navigation[target], navigation[index]];
      return { ...current, navigation };
    });
    setNotice('');
  };

  const updateCtaLabel = (id: string, label: string) => {
    setContent((current) => {
      switch (id) {
        case 'header.consultation': return { ...current, copy: { ...current.copy, 'header.consultation': label } };
        case 'header.whatsapp': return { ...current, copy: { ...current.copy, 'header.chat': label } };
        case 'home.hero.primary': return { ...current, hero: { ...current.hero, primaryCta: label } };
        case 'home.hero.secondary': return { ...current, hero: { ...current.hero, secondaryCta: label } };
        case 'home.hero.caseStudies': return { ...current, copy: { ...current.copy, 'home.hero.caseStudiesLink': label } };
        case 'home.services.browse': return { ...current, services: { ...current.services, cta: label } };
        case 'home.hospitality': return { ...current, copy: { ...current.copy, 'home.hospitality.cta': label } };
        case 'home.faqs': return { ...current, copy: { ...current.copy, 'home.faqs.cta': label } };
        case 'home.closing.primary': return { ...current, copy: { ...current.copy, 'home.closing.primaryCta': label } };
        case 'home.closing.secondary': return { ...current, copy: { ...current.copy, 'home.closing.secondaryCta': label } };
        case 'contact.whatsapp': return { ...current, copy: { ...current.copy, 'contact.whatsapp.cta': label } };
        case 'thankYou.whatsapp': return { ...current, copy: { ...current.copy, 'thankYou.whatsapp': label } };
        case 'services.primary': return { ...current, servicesPage: { ...current.servicesPage, primaryCta: label } };
        case 'about.primary': return { ...current, aboutPage: { ...current.aboutPage, primaryCta: label } };
        case 'about.secondary': return { ...current, aboutPage: { ...current.aboutPage, secondaryCta: label } };
        case 'work.primary': return { ...current, workPage: { ...current.workPage, primaryCta: label } };
        case 'contact.primary': return { ...current, contactPage: { ...current.contactPage, primaryCta: label } };
        default: return current;
      }
    });
    setNotice('');
  };

  const updateFooter = (patch: Partial<SiteContent['footerSettings']>) => {
    setContent((current) => ({ ...current, footerSettings: { ...current.footerSettings, ...patch } }));
    setNotice('');
  };

  const updateSeo = (page: ManagedPage, patch: Partial<SiteContent['seo'][ManagedPage]>) => {
    setContent((current) => ({ ...current, seo: { ...current.seo, [page]: { ...current.seo[page], ...patch } } }));
    setNotice('');
  };

  const updateCopyField = (key: string, value: string) => {
    setContent((current) => {
      const footerField: Record<string, keyof SiteContent['footerSettings']> = {
        'footer.phone': 'phone',
        'footer.email': 'email',
        'footer.location': 'location',
        'footer.hours': 'hours',
      };

      const socialLabels: Record<string, SiteContent['footerSettings']['socialLinks'][number]['id']> = {
        'footer.socialInstagram': 'instagram',
        'footer.socialFacebook': 'facebook',
        'footer.socialLinkedIn': 'linkedin',
      };
      const footerSettings = footerField[key]
        ? {
            ...current.footerSettings,
            [footerField[key]]: value,
            ...(key === 'footer.phone' && /^[+0-9(). -]{5,30}$/.test(value)
              ? { phoneDestination: `tel:${value.replace(/[^+0-9]/g, '')}` }
              : {}),
            ...(key === 'footer.email' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
              ? { emailDestination: `mailto:${value}` }
              : {}),
            ...(key === 'footer.location'
              ? { mapDestination: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}` }
              : {}),
          }
        : socialLabels[key]
          ? {
              ...current.footerSettings,
              socialLinks: current.footerSettings.socialLinks.map((link) =>
                link.id === socialLabels[key] ? { ...link, label: value } : link),
            }
          : current.footerSettings;
      return {
        ...current,
        copy: { ...current.copy, [key]: value },
        navigation: current.navigation.map((item) =>
          key === `header.nav.${item.id}` ? { ...item, label: value } : item),
        footerSettings,
      };
    });
    setNotice('');
  };

  const updateFaq = (id: string, patch: Partial<SiteContent['faqs'][number]>) => {
    setContent((current) => ({
      ...current,
      faqs: current.faqs.map((faq) => faq.id === id ? { ...faq, ...patch } : faq),
    }));
    setNotice('');
  };

  const moveFaq = (index: number, offset: -1 | 1) => {
    setContent((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.faqs.length) return current;
      const faqs = [...current.faqs];
      [faqs[index], faqs[target]] = [faqs[target], faqs[index]];
      return { ...current, faqs };
    });
    setNotice('');
  };

  const addFaq = () => {
    const id = `faq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    setContent((current) => ({
      ...current,
      faqs: [...current.faqs, { id, question: '', answer: '' }],
    }));
    setNotice('');
  };

  const removeFaq = (id: string) => {
    setContent((current) => ({ ...current, faqs: current.faqs.filter((faq) => faq.id !== id) }));
    setNotice('');
  };

  const updateMedia = (id: string, patch: Partial<SiteContent['media'][string]>, theme?: PublicImageTheme) => {
    setContent((current) => {
      const previous = current.media[id] ?? DEFAULT_SITE_CONTENT.media[id];
      const asset = theme
        ? {
          ...previous,
          imageVariants: {
            ...previous.imageVariants,
            [theme]: { ...previous.imageVariants?.[theme], ...patch },
          },
        }
        : { ...previous, ...patch };
      const next: SiteContent = { ...current, media: { ...current.media, [id]: asset } };
      const seoPage = id.match(/^seo\.(home|services|catalogue|work|about|blog|contact)\.ogImage$/)?.[1] as ManagedPage | undefined;
      if (seoPage && !theme) {
        next.seo = { ...current.seo, [seoPage]: { ...current.seo[seoPage], ogImage: asset.url } };
      }
      return next;
    });
    setNotice('');
  };

  const uploadMedia = async (id: string, file?: File, theme?: PublicImageTheme) => {
    if (!file) return;
    setUploadingMediaId(id);
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      body.set('assetId', id);
      body.set('media', file);
      const response = await fetch('/api/admin/site-content/media/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || `Could not upload media (${response.status}).`);
      if (!data.url) throw new Error('The server stored no media URL.');
      updateMedia(id, { url: data.url }, theme);
      setNotice('Media uploaded. Save the draft and publish to make it live.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload media.');
    } finally {
      setUploadingMediaId(null);
    }
  };

  const saveDraft = async () => {
    if (content.faqs.length > 20 || content.faqs.some((faq) =>
      !faq.question.trim() || faq.question.length > 500 || !faq.answer.trim() || faq.answer.length > 3000,
    )) {
      setError('Each FAQ needs a question (up to 500 characters) and answer (up to 3,000 characters). A maximum of 20 FAQs is allowed.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/site-content/draft', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Draft-Updated-At': draftUpdatedAt ?? 'none',
        },
        body: JSON.stringify(content),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || `Could not save page content (${response.status}).`);
      if (!data.content) throw new Error('The server saved no page content configuration.');
      setContent(data.content);
      setSavedDraft(data.content);
      setDraftUpdatedAt(data.draftUpdatedAt || null);
      setNotice('Draft saved. Public pages remain unchanged until you publish.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save page content.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (dirty) {
      setError('Save your current edits as a draft before publishing.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/site-content/publish', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || `Could not publish page content (${response.status}).`);
      if (!data.content) throw new Error('The server published no page content configuration.');
      setContent(data.content);
      setSavedDraft(data.content);
      setPublishedContent(data.content);
      setPublishedAt(data.publishedAt || new Date().toISOString());
      onSaved(data.content);
      setNotice('Page content published and now live on the website.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Page content could not be published.');
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async () => {
    setShowHistory((current) => !current);
    if (showHistory) return;
    setHistoryLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/site-content/revisions', { credentials: 'same-origin' });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || `Could not load revision history (${response.status}).`);
      setRevisions(data.revisions || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load revision history.');
      setShowHistory(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreRevision = async (revision: ContentRevision) => {
    if (!window.confirm(`Restore the version saved by ${revision.actorLabel} on ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.createdAt))} as a draft? The live website will not change until you publish.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/site-content/restore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId: revision.id }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || `Could not restore version (${response.status}).`);
      if (!data.content) throw new Error('The server returned no restored draft.');
      setContent(data.content);
      setSavedDraft(data.content);
      setDraftUpdatedAt(data.draftUpdatedAt || null);
      setDraftUpdatedBy(null);
      setShowHistory(false);
      setNotice('Version restored as a draft. The published website remains unchanged.');
      setRevisions([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not restore the selected version.');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = async () => {
    if (!window.confirm('Discard the saved draft and all unsaved edits? This restores the current published version as the draft; the live website will not change.')) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/site-content/discard', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.message || `Could not discard draft changes (${response.status}).`);
      if (!data.content) throw new Error('The server returned no published version to restore.');
      setContent(data.content);
      setSavedDraft(data.content);
      setDraftUpdatedAt(data.draftUpdatedAt || null);
      setDraftUpdatedBy(null);
      setNotice('Draft changes discarded. The published version remains live.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not discard draft changes.');
    } finally {
      setSaving(false);
    }
  };

  const previewWidth = previewDevice === 'desktop' ? 1280 : previewDevice === 'tablet' ? 768 : 390;

  return (
    <main className={`admin-portal admin-content-manager ${embedded ? '' : 'min-h-screen'}`} data-admin-theme="dark">
      <div className={embedded ? '' : 'mx-auto max-w-7xl px-4 py-6 sm:px-7 lg:px-10 lg:py-9'}>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            {!embedded && <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-[#A9B8AD] hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </button>}
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#72D28B]">Website CMS</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#ECF3EE]">Page Content Manager</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#A9B8AD]">Manage page copy, calls to action, and search/social metadata for your main website pages.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowPreview((current) => !current)} disabled={loading || loadFailed} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-bold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
              {showPreview ? <X className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {showPreview ? 'Close preview' : 'Live preview'}
            </button>
            <button type="button" onClick={() => void loadHistory()} disabled={loading || loadFailed || historyLoading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-bold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
              {historyLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />} {showHistory ? 'Close history' : 'Restore previous version'}
            </button>
            {canEdit && <button type="button" onClick={() => void discardChanges()} disabled={loading || loadFailed || saving || !(dirty || JSON.stringify(savedDraft) !== JSON.stringify(publishedContent))} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-400/30 px-3 text-xs font-bold text-rose-200 hover:bg-rose-500/10 disabled:opacity-40">
              <RotateCcw className="h-4 w-4" /> Discard changes
            </button>}
            {canEdit && <button type="button" onClick={() => void saveDraft()} disabled={loading || loadFailed || saving} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-bold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
            </button>}
            {canPublish && <button type="button" onClick={() => void publish()} disabled={loading || loadFailed || saving || dirty || !draftUpdatedAt} title={dirty ? 'Save your edits as a draft before publishing.' : !draftUpdatedAt ? 'Save a draft before publishing.' : undefined} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#205C31] disabled:opacity-50">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish
            </button>}
          </div>
        </header>

        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}
        {notice && <p role="status" className="mb-5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"><Check className="mr-2 inline h-4 w-4" />{notice}</p>}
        {!loading && !loadFailed && (
          <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-xs ${dirty ? 'border-amber-300/25 bg-amber-400/10 text-amber-100' : 'border-[#304135] bg-[#131D16] text-[#A9B8AD]'}`}>
            <span className="font-bold">{dirty ? 'Unsaved edits' : JSON.stringify(savedDraft) !== JSON.stringify(publishedContent) ? 'Draft saved · unpublished' : 'No unsaved changes'}</span>
            <span> · {draftUpdatedAt ? `Last saved ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draftUpdatedAt))}` : 'No draft has been saved yet'}</span>
            {draftUpdatedBy && <span> · Editor ID {draftUpdatedBy}</span>}
            <span> · Published version {publishedAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(publishedAt)) : 'not set'}</span>
          </div>
        )}

        {showPreview && !loading && !loadFailed && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] p-4">
              <div>
                <h2 className="text-sm font-bold text-[#ECF3EE]">Unpublished live preview</h2>
                <p className="mt-1 text-xs text-[#A9B8AD]">This isolated preview uses your current editor state. Visitors continue to see the published version.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="content-preview-page">Preview page</label>
                <select id="content-preview-page" value={previewPath} onChange={(event) => { setPreviewPath(event.target.value); setPreviewFrameLoaded(false); }} className="h-9 rounded-lg border border-[#47594C] bg-[#131D16] px-2 text-xs text-[#ECF3EE]">
                  <option value="/">Home</option><option value="/services">Services</option><option value="/catalogue">Catalogue</option><option value="/work">Work</option><option value="/about">About</option><option value="/blog">Blog</option><option value="/contact">Contact</option>
                </select>
                {([
                  ['desktop', Monitor, 'Desktop preview'],
                  ['tablet', Tablet, 'Tablet preview'],
                  ['mobile', Smartphone, 'Mobile preview'],
                ] as const).map(([device, Icon, label]) => (
                  <button key={device} type="button" aria-label={label} aria-pressed={previewDevice === device} onClick={() => { setPreviewDevice(device); setPreviewFrameLoaded(false); }} className={`grid h-9 w-9 place-items-center rounded-lg border ${previewDevice === device ? 'border-[#72D28B] bg-[#286D3B] text-white' : 'border-[#47594C] text-[#A9B8AD]'}`}>
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto bg-[#0D1510] p-3 sm:p-5">
              <iframe
                key={`${previewPath}-${previewDevice}`}
                ref={previewFrame}
                title={`${previewDevice} preview of ${previewPath === '/' ? 'Home' : previewPath.slice(1)}`}
                src={`${previewPath}?ng-cms-preview=1`}
                onLoad={() => setPreviewFrameLoaded(true)}
                style={{ width: previewWidth, maxWidth: 'none', height: 680 }}
                className="mx-auto border-0 bg-white shadow-xl"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </section>
        )}

        {showHistory && (
          <section className="mb-5 rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h2 className="text-sm font-bold text-[#ECF3EE]">Revision history</h2><p className="mt-1 text-xs text-[#A9B8AD]">Restoring creates a draft only; publication is a separate action.</p></div>
              <button type="button" onClick={() => setShowHistory(false)} aria-label="Close revision history" className="rounded-lg p-2 text-[#A9B8AD] hover:bg-white/5"><X className="h-4 w-4" /></button>
            </div>
            {historyLoading ? <p className="text-xs text-[#A9B8AD]">Loading revisions…</p> : revisions.length === 0 ? <p className="text-xs text-[#A9B8AD]">No saved revisions are available yet.</p> : (
              <ul className="divide-y divide-[#304135]">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-xs font-semibold text-[#ECF3EE]">{revision.action.replaceAll('_', ' ')}</p>
                      <p className="mt-1 text-[11px] text-[#A9B8AD]">{revision.actorLabel} · {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.createdAt))}</p>
                    </div>
                    {canEdit && <button type="button" disabled={saving} onClick={() => void restoreRevision(revision)} className="rounded-lg border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">Restore as draft</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {loading ? (
          <div className="grid min-h-56 place-items-center text-sm text-[#A9B8AD]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading page content…</div>
        ) : (
          <div className="space-y-5">
            <p className="text-xs text-[#A9B8AD]">Last published: {publishedAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(publishedAt)) : 'Built-in website content'} · Changes are drafts until published.</p>
            <nav aria-label="Choose page to edit" className="flex flex-wrap gap-2 rounded-2xl border border-[#304135] bg-[#19241D] p-2">
              {copyPageTabs.map((tab) => (
                <button key={tab.id} type="button" onClick={() => setActivePage(tab.id)} aria-pressed={activePage === tab.id} className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${activePage === tab.id ? 'bg-[#286D3B] text-white' : 'text-[#A9B8AD] hover:bg-white/5 hover:text-white'}`}>
                  {tab.label}
                </button>
              ))}
            </nav>

            {dedicatedModuleLinks[activePage] && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#304135] bg-[#19241D] p-4">
                <div>
                  <h2 className="text-sm font-bold text-[#ECF3EE]">Dedicated content module</h2>
                  <p className="mt-1 text-xs text-[#A9B8AD]">Page Content Manager controls page-level copy; dynamic records remain in their existing source-of-truth module.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dedicatedModuleLinks[activePage]?.map((link) => (
                    <a key={link.href} href={link.href} className="inline-flex min-h-10 items-center rounded-lg border border-[#47594C] px-3 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5">{link.label}</a>
                  ))}
                </div>
              </section>
            )}

            {activePage === 'siteLinks' ? (
              <div className="space-y-5">
                <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                  <div className="mb-5 border-b border-[#304135] pb-4">
                    <h2 className="font-bold text-[#ECF3EE]">Public navigation</h2>
                    <p className="mt-1 text-xs text-[#A9B8AD]">Reorder the existing header links and edit labels and destinations. Destinations are restricted to public routes or safe HTTPS links; CMS routes are blocked.</p>
                  </div>
                  <div className="space-y-3">
                    {content.navigation.map((item, index) => (
                      <div key={item.id} className="grid gap-3 rounded-xl border border-[#304135] bg-[#131D16] p-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="flex gap-1 sm:flex-col">
                          <button type="button" aria-label={`Move ${item.label} up`} disabled={!canEdit || saving || index === 0} onClick={() => moveNavigation(index, -1)} className="rounded-lg border border-[#47594C] p-2 text-[#D7E3D9] disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" aria-label={`Move ${item.label} down`} disabled={!canEdit || saving || index === content.navigation.length - 1} onClick={() => moveNavigation(index, 1)} className="rounded-lg border border-[#47594C] p-2 text-[#D7E3D9] disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        </div>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Link label</span>
                          <input disabled={!canEdit || saving} maxLength={60} value={item.label} onChange={(event) => updateNavigation(index, { label: event.target.value })} className="w-full rounded-xl border border-[#304135] bg-[#101713] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Destination</span>
                          <input disabled={!canEdit || saving} maxLength={2000} value={item.destination} aria-invalid={!isSafePublicDestination(item.destination)} onChange={(event) => updateNavigation(index, { destination: event.target.value })} className="w-full rounded-xl border border-[#304135] bg-[#101713] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] aria-[invalid=true]:border-rose-500" />
                          {!isSafePublicDestination(item.destination) && <span className="mt-1 block text-[11px] text-rose-300">Use an allowed public route or an HTTPS URL. Unsafe schemes and CMS routes are not accepted.</span>}
                        </label>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                  <div className="mb-5 border-b border-[#304135] pb-4">
                    <h2 className="font-bold text-[#ECF3EE]">Public call-to-action links</h2>
                    <p className="mt-1 text-xs text-[#A9B8AD]">Labels stay connected to their existing page copy fields. Update each destination here; safe URL validation runs in the browser and again on the server.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.keys(content.ctaDestinations).map((id) => (
                      <div key={id} className="space-y-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">{id.replaceAll('.', ' · ')} label</span>
                          <input disabled={!canEdit || saving} maxLength={80} value={getCtaLabel(content, id)} onChange={(event) => updateCtaLabel(id, event.target.value)} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Destination</span>
                          <input disabled={!canEdit || saving} maxLength={2000} value={content.ctaDestinations[id]} aria-invalid={!isSafePublicDestination(content.ctaDestinations[id])} onChange={(event) => setContent((current) => ({ ...current, ctaDestinations: { ...current.ctaDestinations, [id]: event.target.value } }))} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] aria-[invalid=true]:border-rose-500" />
                          {!isSafePublicDestination(content.ctaDestinations[id]) && <span className="mt-1 block text-[11px] text-rose-300">Enter an allowed route, HTTPS, mailto, tel, or page-anchor URL.</span>}
                        </label>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                  <div className="mb-5 border-b border-[#304135] pb-4">
                    <h2 className="font-bold text-[#ECF3EE]">Footer contact and social links</h2>
                    <p className="mt-1 text-xs text-[#A9B8AD]">These values update existing footer content without changing its layout or styling.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      ['phone', 'Phone display'],
                      ['phoneDestination', 'Phone link (tel:)'],
                      ['email', 'Email display'],
                      ['emailDestination', 'Email link (mailto:)'],
                      ['secondaryEmail', 'Secondary email display'],
                      ['secondaryEmailDestination', 'Secondary email link (mailto:)'],
                      ['location', 'Location'],
                      ['hours', 'Business hours'],
                      ['mapDestination', 'Map destination (HTTPS)'],
                      ['whatsappDestination', 'WhatsApp destination (HTTPS)'],
                    ] as const).map(([field, label]) => (
                      <label key={field} className="block">
                        <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">{label}</span>
                        <input disabled={!canEdit || saving} maxLength={field === 'location' ? 500 : 2000} value={content.footerSettings[field]} aria-invalid={field.toLowerCase().includes('destination') && !isSafePublicDestination(content.footerSettings[field])} onChange={(event) => updateFooter({ [field]: event.target.value })} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                      </label>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    {content.footerSettings.socialLinks.map((link, index) => (
                      <div key={link.id} className="space-y-3 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                        <label className="block"><span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">{link.id} label</span><input disabled={!canEdit || saving} maxLength={40} value={link.label} onChange={(event) => updateFooter({ socialLinks: content.footerSettings.socialLinks.map((current, i) => i === index ? { ...current, label: event.target.value } : current) })} className="w-full rounded-xl border border-[#304135] bg-[#101713] px-3 py-2.5 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" /></label>
                        <label className="block"><span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">HTTPS profile URL</span><input disabled={!canEdit || saving} maxLength={2000} value={link.destination} aria-invalid={!isSafePublicDestination(link.destination)} onChange={(event) => updateFooter({ socialLinks: content.footerSettings.socialLinks.map((current, i) => i === index ? { ...current, destination: event.target.value } : current) })} className="w-full rounded-xl border border-[#304135] bg-[#101713] px-3 py-2.5 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" /></label>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                  <div className="mb-5 border-b border-[#304135] pb-4">
                    <h2 className="font-bold text-[#ECF3EE]">Page SEO and social previews</h2>
                    <p className="mt-1 text-xs text-[#A9B8AD]">The social preview image can also be replaced in Images & Media. Metadata is applied from published content.</p>
                  </div>
                  <div className="space-y-5">
                    {(Object.keys(content.seo) as ManagedPage[]).map((page) => (
                      <div key={page} className="grid gap-4 rounded-xl border border-[#304135] bg-[#131D16] p-4 sm:grid-cols-2">
                        <h3 className="text-sm font-bold capitalize text-[#ECF3EE] sm:col-span-2">{page} page</h3>
                        <label className="block"><span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">SEO title</span><input disabled={!canEdit || saving} maxLength={180} value={content.seo[page].title} onChange={(event) => updateSeo(page, { title: event.target.value })} className="w-full rounded-xl border border-[#304135] bg-[#101713] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" /></label>
                        <label className="block"><span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Meta description</span><textarea disabled={!canEdit || saving} rows={2} maxLength={320} value={content.seo[page].description} onChange={(event) => updateSeo(page, { description: event.target.value })} className="w-full resize-y rounded-xl border border-[#304135] bg-[#101713] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" /></label>
                        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#B8C7BC]">Social preview image</p>
                            <p className="mt-1 break-all text-[11px] text-[#819087]">{content.media[`seo.${page}.ogImage`]?.url || content.seo[page].ogImage || 'Using the current default preview image.'}</p>
                          </div>
                          <button type="button" disabled={!canEdit || saving} onClick={() => setActivePage('media')} className="rounded-lg border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
                            Manage in Images & Media
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : activePage === 'animations' ? (
              <div className="space-y-5">
                <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[#304135] pb-4">
                    <div>
                      <h2 className="font-bold text-[#ECF3EE]">Earth & Global Reach</h2>
                      <p className="mt-1 text-xs text-[#A9B8AD]">Adjust the existing globe and country highlight. Country names and click totals continue to come from the current website data.</p>
                    </div>
                    <button type="button" disabled={!canEdit || saving} onClick={() => {
                      setContent((current) => ({ ...current, animations: DEFAULT_SITE_CONTENT.animations }));
                      setNotice('');
                    }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#47594C] px-3 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
                      <RotateCcw className="h-3.5 w-3.5" /> Reset all animation defaults
                    </button>
                  </div>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#304135] bg-[#131D16] p-3">
                    <div>
                      <p className="text-xs font-semibold text-[#ECF3EE]">Globe appearance profile</p>
                      <p className="mt-1 text-[11px] text-[#819087]">Choose which website theme’s appearance to edit. This does not change the admin theme.</p>
                    </div>
                    <div className="flex gap-2" role="group" aria-label="Globe appearance profile">
                      {(['light', 'dark'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={!canEdit || saving}
                          aria-pressed={globeAppearanceMode === mode}
                          onClick={() => setGlobeAppearanceMode(mode)}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors disabled:opacity-50 ${
                            globeAppearanceMode === mode
                              ? 'border-[#72D28B] bg-[#1D3527] text-[#ECF3EE]'
                              : 'border-[#47594C] text-[#A9B8AD] hover:bg-white/5'
                          }`}
                        >
                          {mode} appearance
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                      <span><span className="block text-sm font-semibold text-[#ECF3EE]">Enable globe motion</span><span className="mt-1 block text-xs text-[#819087]">Stops auto rotation, route particles and marker pulsing when off.</span></span>
                      <input type="checkbox" checked={content.animations.globeEnabled} disabled={!canEdit || saving} onChange={(event) => updateAnimation('globeEnabled', event.target.checked)} className="h-5 w-5 accent-[#72D28B]" />
                    </label>
                    {([
                      ['globeRotationSpeed', 'Rotation speed', 0, 200, '% of current speed'],
                      ['globeSize', 'Globe size', 70, 110, '%'],
                      ['globePositionX', 'Horizontal position', -5, 5, '% offset'],
                      ['globePositionY', 'Vertical position', -5, 5, '% offset'],
                    ] as const).map(([key, label, min, max, unit]) => (
                      <label key={key} className="rounded-xl border border-[#304135] bg-[#131D16] p-4">
                        <span className="mb-3 flex justify-between gap-2 text-xs font-semibold text-[#B8C7BC]"><span>{label}</span><span>{content.animations[key]}{unit === '%' ? '%' : ` ${unit}`}</span></span>
                        <input type="range" min={min} max={max} step="1" value={content.animations[key]} disabled={!canEdit || saving} onChange={(event) => updateAnimation(key, Number(event.target.value))} className="w-full accent-[#72D28B]" />
                      </label>
                    ))}
                    <div className="sm:col-span-2 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold capitalize text-[#ECF3EE]">{globeAppearanceMode} appearance</h3>
                        <div className="flex flex-wrap gap-2">
                          {globeAppearanceMode === 'light' && (
                            <button
                              type="button"
                              disabled={!canEdit || saving}
                              onClick={() => {
                                updateAnimation('globeLightAppearance', DEFAULT_SITE_CONTENT.animations.globeLightAppearance);
                                setNotice('Approved light appearance preset applied as a draft.');
                              }}
                              className="rounded-lg border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50"
                            >
                              Apply reference preset
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!canEdit || saving}
                            onClick={() => {
                              if (globeAppearanceMode === 'light') {
                                updateAnimation('globeLightAppearance', DEFAULT_SITE_CONTENT.animations.globeLightAppearance);
                              } else {
                                setContent((current) => ({
                                  ...current,
                                  animations: {
                                    ...current.animations,
                                    globeLandColor: DEFAULT_SITE_CONTENT.animations.globeLandColor,
                                    globeHighlightColor: DEFAULT_SITE_CONTENT.animations.globeHighlightColor,
                                    globeHighlightGlowColor: DEFAULT_SITE_CONTENT.animations.globeHighlightGlowColor,
                                  },
                                }));
                                setNotice('');
                              }
                            }}
                            className="rounded-lg border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50"
                          >
                            Reset {globeAppearanceMode} appearance
                          </button>
                        </div>
                      </div>
                      {globeAppearanceMode === 'dark' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {([
                            ['globeLandColor', 'Country color'],
                            ['globeHighlightColor', 'Selected country outline'],
                            ['globeHighlightGlowColor', 'Selected country glow'],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[#304135] bg-[#101713] p-4">
                              <span className="text-xs font-semibold text-[#B8C7BC]">{label}</span>
                              <input type="color" value={content.animations[key]} disabled={!canEdit || saving} onChange={(event) => updateAnimation(key, event.target.value)} aria-label={label} className="h-10 w-14 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed" />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {([
                            {
                              title: 'Surface',
                              colors: [
                                ['oceanColor', 'Ocean color'],
                                ['landColor', 'Land color'],
                                ['countryBorderColor', 'Country-border color'],
                              ],
                              sliders: [
                                ['countryBorderOpacity', 'Country-border opacity', 0, 1, 0.01],
                                ['gridOpacity', 'Grid opacity', 0, 0.5, 0.01],
                              ],
                            },
                            {
                              title: 'Routes & Markers',
                              colors: [
                                ['routeColor', 'Route color'],
                                ['markerColor', 'Marker color'],
                              ],
                              sliders: [['routeOpacity', 'Route opacity', 0, 1, 0.01]],
                            },
                            {
                              title: 'Selection',
                              colors: [
                                ['selectionOutlineColor', 'Selected-country outline'],
                                ['selectionGlowColor', 'Selected-country glow'],
                              ],
                              sliders: [
                                ['selectionGlowIntensity', 'Selection-glow intensity', 0, 1, 0.01],
                                ['atmosphereIntensity', 'Atmosphere intensity', 0, 0.5, 0.01],
                              ],
                            },
                          ] as const).map((group) => (
                            <div key={group.title}>
                              <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#A9B8AD]">{group.title}</h4>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {group.colors.map(([key, label]) => (
                                  <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[#304135] bg-[#101713] p-4">
                                    <span className="text-xs font-semibold text-[#B8C7BC]">{label}</span>
                                    <input
                                      type="color"
                                      value={content.animations.globeLightAppearance[key]}
                                      disabled={!canEdit || saving}
                                      onChange={(event) => updateGlobeLightAppearance(key, event.target.value)}
                                      aria-label={label}
                                      className="h-10 w-14 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
                                    />
                                  </label>
                                ))}
                                {group.sliders.map(([key, label, min, max, step]) => (
                                  <label key={key} className="rounded-xl border border-[#304135] bg-[#101713] p-4">
                                    <span className="mb-3 flex justify-between gap-2 text-xs font-semibold text-[#B8C7BC]">
                                      <span>{label}</span>
                                      <span>{Math.round(content.animations.globeLightAppearance[key] * 100)}%</span>
                                    </span>
                                    <input
                                      type="range"
                                      min={min}
                                      max={max}
                                      step={step}
                                      value={content.animations.globeLightAppearance[key]}
                                      disabled={!canEdit || saving}
                                      onChange={(event) => updateGlobeLightAppearance(key, Number(event.target.value))}
                                      aria-label={label}
                                      className="w-full accent-[#72D28B]"
                                    />
                                  </label>
                                ))}
                                {group.title === 'Surface' && (
                                  <label className="flex items-center justify-between gap-4 rounded-xl border border-[#304135] bg-[#101713] p-4">
                                    <span className="text-xs font-semibold text-[#B8C7BC]">Show latitude/longitude grid</span>
                                    <input
                                      type="checkbox"
                                      checked={content.animations.globeLightAppearance.gridEnabled}
                                      disabled={!canEdit || saving}
                                      onChange={(event) => updateGlobeLightAppearance('gridEnabled', event.target.checked)}
                                      className="h-5 w-5 accent-[#72D28B]"
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Country popup title <span className="font-normal text-[#819087]">Use {'{country}'}</span></span>
                      <input type="text" maxLength={80} value={content.animations.globePopupTitle} disabled={!canEdit || saving} onChange={(event) => updateAnimation('globePopupTitle', event.target.value)} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Country popup detail <span className="font-normal text-[#819087]">Use {'{clicks}'} or {'{country}'}</span></span>
                      <input type="text" maxLength={120} value={content.animations.globePopupDetail} disabled={!canEdit || saving} onChange={(event) => updateAnimation('globePopupDetail', event.target.value)} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                    </label>
                  </div>
                </section>
                <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                  <div className="mb-5 border-b border-[#304135] pb-4">
                    <h2 className="font-bold text-[#ECF3EE]">Home hero orbit</h2>
                    <p className="mt-1 text-xs text-[#A9B8AD]">Controls the existing nebula, stars and orbit motion behind the Home page hero. Other page backgrounds and Team & Mentors effects are unchanged.</p>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                      <span><span className="block text-sm font-semibold text-[#ECF3EE]">Enable hero motion</span><span className="mt-1 block text-xs text-[#819087]">Keeps the current scene but pauses its animations.</span></span>
                      <input type="checkbox" checked={content.animations.heroEnabled} disabled={!canEdit || saving} onChange={(event) => updateAnimation('heroEnabled', event.target.checked)} className="h-5 w-5 accent-[#72D28B]" />
                    </label>
                    <label className="rounded-xl border border-[#304135] bg-[#131D16] p-4">
                      <span className="mb-3 flex justify-between text-xs font-semibold text-[#B8C7BC]"><span>Hero animation speed</span><span>{content.animations.heroSpeed}%</span></span>
                      <input type="range" min="50" max="150" step="1" value={content.animations.heroSpeed} disabled={!canEdit || saving} onChange={(event) => updateAnimation('heroSpeed', Number(event.target.value))} className="w-full accent-[#72D28B]" />
                    </label>
                  </div>
                </section>
                <p className="rounded-xl border border-[#304135] bg-[#131D16] p-4 text-xs leading-relaxed text-[#A9B8AD]">These settings are drafts until published. The visitor’s device reduced-motion preference always takes precedence over animation settings.</p>
              </div>
            ) : activePage === 'media' ? (
              <section className="space-y-5">
                <div className="rounded-2xl border border-[#304135] bg-[#19241D] p-4 text-sm text-[#A9B8AD] sm:p-5">
                  Uploads are stored in the website’s public-read Supabase media bucket; they are not used by live pages until you save the draft and publish. Images accept JPG, PNG or WebP up to 15 MB; videos accept MP4 or WebM up to 100 MB.
                </div>
                {PUBLIC_MEDIA.map((definition) => {
                  const imageTheme = imageThemes[definition.id] ?? 'dark';
                  const resolvedMedia = resolvePublicMedia(content.media, definition.id, definition.fallbackUrl, imageTheme);
                  const asset = resolvedMedia.asset;
                  const hasDedicatedImage = Boolean(content.media[definition.id]?.imageVariants?.[imageTheme]?.url);
                  const hasRemovableImage = definition.kind === 'video' ? Boolean(asset.url) : hasDedicatedImage;
                  const updateImageVariant = (patch: Partial<SiteContent['media'][string]>) =>
                    updateMedia(definition.id, patch, imageTheme);
                  const previewUrl = asset.url || definition.fallbackUrl ||
                    (definition.id === HOME_HERO_DARK_VIDEO_ID ? content.hero.videoUrl : '') ||
                    bundledMediaFallbacks[definition.id] || '';
                  const isUploading = uploadingMediaId === definition.id;
                  if (definition.id === HOME_HERO_LIGHT_VIDEO_ID) return null;
                  if (definition.id === HOME_HERO_DARK_VIDEO_ID) {
                    const heroVideoPanels = [
                      {
                        id: HOME_HERO_DARK_VIDEO_ID,
                        title: 'Dark mode hero video',
                        asset: content.media[HOME_HERO_DARK_VIDEO_ID] ?? DEFAULT_SITE_CONTENT.media[HOME_HERO_DARK_VIDEO_ID],
                        previewUrl: content.media[HOME_HERO_DARK_VIDEO_ID]?.url ||
                          content.hero.videoUrl ||
                          bundledMediaFallbacks[HOME_HERO_DARK_VIDEO_ID],
                        emptyMessage: 'Using the built-in NearGrow hero video.',
                      },
                      {
                        id: HOME_HERO_LIGHT_VIDEO_ID,
                        title: 'Light mode hero video',
                        asset: content.media[HOME_HERO_LIGHT_VIDEO_ID] ?? DEFAULT_SITE_CONTENT.media[HOME_HERO_LIGHT_VIDEO_ID],
                        previewUrl: content.media[HOME_HERO_LIGHT_VIDEO_ID]?.url || '',
                        emptyMessage: 'No light video uploaded. The existing hero video will be used.',
                      },
                    ];

                    return (
                      <article key={definition.id} className="rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:p-5">
                        <div className="mb-4 flex items-center gap-2 text-xs font-bold text-[#ECF3EE]">
                          <Video className="h-4 w-4 text-[#72D28B]" />
                          <span>Hero background video<span className="ml-2 font-normal text-[#819087]">Home · Hero</span></span>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          {heroVideoPanels.map((panel) => {
                            const panelIsUploading = uploadingMediaId === panel.id;
                            const hasConfiguredVideo = Boolean(panel.asset.url ||
                              (panel.id === HOME_HERO_DARK_VIDEO_ID && content.hero.videoUrl));
                            return (
                              <section key={panel.id} data-media-id={panel.id} className="min-w-0 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#ECF3EE]">
                                  <Video className="h-4 w-4 shrink-0 text-[#72D28B]" />
                                  {panel.title}
                                </h3>
                                <div className="overflow-hidden rounded-xl border border-[#304135] bg-[#101713]">
                                  {panel.previewUrl ? (
                                    <video
                                      key={panel.previewUrl}
                                      src={panel.previewUrl}
                                      poster={panel.id === HOME_HERO_DARK_VIDEO_ID
                                        ? content.media['home.hero.poster']?.url || undefined
                                        : undefined}
                                      controls
                                      muted
                                      playsInline
                                      className="aspect-video w-full object-cover"
                                      style={{ objectPosition: `${panel.asset.focalX}% ${panel.asset.focalY}%` }}
                                    />
                                  ) : (
                                    <div className="grid aspect-video place-items-center px-5 text-center text-xs leading-relaxed text-[#A9B8AD]">
                                      {panel.emptyMessage}
                                    </div>
                                  )}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#286D3B] px-3.5 text-xs font-bold text-white hover:bg-[#205C31] has-[:disabled]:cursor-wait has-[:disabled]:opacity-60">
                                    {panelIsUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                    {hasConfiguredVideo ? 'Replace video' : 'Upload video'}
                                    <input
                                      type="file"
                                      accept="video/mp4,video/webm,.mp4,.webm"
                                      aria-label={`${hasConfiguredVideo ? 'Replace' : 'Upload'} ${panel.title}`}
                                      disabled={!canEdit || panelIsUploading || saving}
                                      className="sr-only"
                                      onChange={(event) => { void uploadMedia(panel.id, event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
                                    />
                                  </label>
                                  {panel.asset.url && (
                                    <button
                                      type="button"
                                      disabled={!canEdit || saving || panelIsUploading}
                                      onClick={() => updateMedia(panel.id, { url: '' })}
                                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      {panel.id === HOME_HERO_LIGHT_VIDEO_ID ? 'Use dark mode video' : 'Restore original'}
                                    </button>
                                  )}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      </article>
                    );
                  }
                  return (
                    <article key={definition.id} className="grid gap-4 rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:p-5">
                      <div className="min-w-0">
                        <div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#ECF3EE]">
                          {definition.kind === 'video' ? <Video className="h-4 w-4 text-[#72D28B]" /> : <Image className="h-4 w-4 text-[#72D28B]" />}
                          <span>{definition.label}<span className="ml-2 font-normal text-[#819087]">{definition.page} · {definition.section}</span></span>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-[#304135] bg-[#101713]">
                          {definition.kind === 'video' ? (
                            previewUrl
                              ? <video key={previewUrl} src={previewUrl} poster={content.media['home.hero.poster']?.url || undefined} controls muted playsInline className="aspect-video w-full object-cover" style={{ objectPosition: `${asset.focalX}% ${asset.focalY}%` }} />
                              : <div className="grid aspect-video place-items-center px-4 text-center text-xs text-[#8A9A8F]">Using the built-in NearGrow hero video</div>
                          ) : (
                            previewUrl
                              ? definition.background && asset.backgroundEnabled
                                ? (
                                  <div className={`relative aspect-video w-full overflow-hidden ${definition.background.overlay === 'light' ? 'bg-white' : 'bg-[#171A17]'}`}>
                                    <div className="absolute inset-0" style={{ opacity: asset.backgroundOpacity / 100 }}>
                                      <img
                                        src={previewUrl}
                                        alt=""
                                        aria-hidden="true"
                                        className="absolute inset-0 h-full w-full"
                                        style={{
                                          objectFit: asset.backgroundFit,
                                          objectPosition: `${asset.backgroundPositionX}% ${asset.backgroundPositionY}%`,
                                        }}
                                      />
                                      <div className={`absolute inset-0 ${definition.background.overlay === 'light' ? 'bg-white/65' : 'bg-[#101824]/65'}`} />
                                    </div>
                                    <div className={`relative z-10 flex h-full flex-col justify-center gap-2 p-4 ${definition.background.overlay === 'light' ? 'text-[#171A17]' : 'text-white'}`}>
                                      <span className="h-2 w-2/5 rounded bg-current opacity-80" />
                                      <span className="h-2 w-4/5 rounded bg-current opacity-60" />
                                      <span className="h-2 w-3/5 rounded bg-current opacity-40" />
                                      <span className="mt-1 h-5 w-16 rounded-full bg-[#3EA259]" />
                                    </div>
                                  </div>
                                )
                                : <img src={previewUrl} alt={asset.altText} className="aspect-video w-full object-cover" style={{ objectPosition: `${asset.focalX}% ${asset.focalY}%` }} />
                              : <div className="grid aspect-video place-items-center px-4 text-center text-xs text-[#8A9A8F]">Using the existing bundled website image</div>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#286D3B] px-3.5 text-xs font-bold text-white hover:bg-[#205C31] has-[:disabled]:cursor-wait has-[:disabled]:opacity-60">
                            {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            {definition.kind === 'image'
                              ? hasDedicatedImage
                                ? 'Replace image'
                                : `Upload ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode image`
                              : asset.url ? `Replace ${definition.kind}` : `Upload ${definition.kind}`}
                            <input
                              type="file"
                              accept={definition.kind === 'video' ? 'video/mp4,video/webm,.mp4,.webm' : 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'}
                              disabled={!canEdit || isUploading || saving}
                              className="sr-only"
                              onChange={(event) => { void uploadMedia(definition.id, event.currentTarget.files?.[0], definition.kind === 'image' ? imageTheme : undefined); event.currentTarget.value = ''; }}
                            />
                          </label>
                          {hasRemovableImage && (
                            <button
                              type="button"
                              disabled={!canEdit || saving || isUploading}
                              onClick={() => definition.kind === 'image'
                                ? updateImageVariant({ url: '' })
                                : updateMedia(definition.id, { url: '', ...(definition.background ? { backgroundEnabled: false } : {}) })}
                              title={definition.kind === 'image'
                                ? `Removes only the ${imageTheme} image and restores its inherited fallback.`
                                : definition.background ? 'Clears the uploaded reference, disables background mode, and restores the original website image.' : undefined}
                              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> {definition.kind === 'image' ? `Remove ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode image` : definition.background ? 'Remove image' : 'Restore original'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-4">
                        {definition.kind === 'image' && (
                          <>
                            <ImageThemeTabs
                              theme={imageTheme}
                              source={resolvedMedia.source}
                              onChange={(theme) => setImageThemes((current) => ({ ...current, [definition.id]: theme }))}
                            />
                            <label className="block">
                              <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Alt text</span>
                              <input type="text" disabled={!canEdit || saving} maxLength={300} value={asset.altText} onChange={(event) => updateImageVariant({ altText: event.target.value })} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                            </label>
                            {definition.background && (
                              <div className="space-y-4 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                                <label className="flex items-center justify-between gap-4">
                                  <span>
                                    <span className="block text-xs font-semibold text-[#ECF3EE]">Enable background image</span>
                                    <span className="mt-1 block text-[11px] text-[#819087]">{definition.background.description}</span>
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={asset.backgroundEnabled}
                                    disabled={!canEdit || saving}
                                    onChange={(event) => updateImageVariant({ backgroundEnabled: event.target.checked })}
                                    aria-label={`Enable background image for ${definition.label}`}
                                    className="h-5 w-5 shrink-0 accent-[#72D28B]"
                                  />
                                </label>
                                {asset.backgroundEnabled && (
                                  <>
                                    <label className="block">
                                      <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Image fit</span>
                                      <select
                                        value={asset.backgroundFit}
                                        disabled={!canEdit || saving}
                                        onChange={(event) => updateImageVariant({ backgroundFit: event.target.value as 'cover' | 'contain' })}
                                        className="w-full rounded-xl border border-[#304135] bg-[#19241D] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]"
                                      >
                                        <option value="cover">Cover</option>
                                        <option value="contain">Contain</option>
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="mb-2 flex justify-between text-xs font-semibold text-[#B8C7BC]">
                                        <span>Background opacity</span><span>{asset.backgroundOpacity}%</span>
                                      </span>
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={asset.backgroundOpacity}
                                        disabled={!canEdit || saving}
                                        onChange={(event) => updateImageVariant({ backgroundOpacity: Number(event.target.value) })}
                                        className="w-full accent-[#72D28B]"
                                      />
                                    </label>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                      {([
                                        ['backgroundPositionX', 'Horizontal position'],
                                        ['backgroundPositionY', 'Vertical position'],
                                      ] as const).map(([field, label]) => (
                                        <label key={field} className="block">
                                          <span className="mb-2 flex justify-between text-xs font-semibold text-[#B8C7BC]">
                                            <span>{label}</span><span>{asset[field]}%</span>
                                          </span>
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={asset[field]}
                                            disabled={!canEdit || saving}
                                            onChange={(event) =>                                             updateImageVariant({ [field]: Number(event.target.value) })}
                                            className="w-full accent-[#72D28B]"
                                          />
                                        </label>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            <div className="grid gap-4 sm:grid-cols-2">
                              {([['focalX', 'Horizontal focal point'], ['focalY', 'Vertical focal point']] as const).map(([field, label]) => (
                                <label key={field} className="block">
                                  <span className="mb-2 flex justify-between text-xs font-semibold text-[#B8C7BC]"><span>{label}</span><span>{asset[field]}%</span></span>
                                  <input type="range" min="0" max="100" value={asset[field]} disabled={!canEdit || saving} onChange={(event) =>                                   updateImageVariant({ [field]: Number(event.target.value) })} className="w-full accent-[#72D28B]" />
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                        <p className="break-all text-[11px] text-[#819087]">{asset.url ? asset.url : 'Current website asset remains unchanged until a replacement is published.'}</p>
                      </div>
                    </article>
                  );
                })}
              </section>
            ) : groups.filter((group) => group.page === activePage).map((group) => (
              <section key={group.key} className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                <div className="mb-5 border-b border-[#304135] pb-4">
                  <h2 className="font-bold text-[#ECF3EE]">{group.title}</h2>
                  <p className="mt-1 text-xs text-[#A9B8AD]">{group.description}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {group.fields.map(([fieldKey, label, fieldType]) => {
                    const value = (content[group.key] as Record<string, string>)[fieldKey];
                    const isWide = fieldType === 'textarea' || fieldKey === 'videoUrl';
                    return (
                      <label key={fieldKey} className={isWide ? 'sm:col-span-2' : ''}>
                        <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">{label}</span>
                        {fieldType === 'textarea' ? (
                          <textarea disabled={!canEdit} rows={3} maxLength={1200} value={value} onChange={(event) => updateField(group.key, fieldKey, event.target.value)} className="w-full resize-y rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none placeholder:text-[#718077] focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                        ) : (
                          <input type="text" disabled={!canEdit} maxLength={fieldType === 'url' ? 2000 : 180} value={value} onChange={(event) => updateField(group.key, fieldKey, event.target.value)} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none placeholder:text-[#718077] focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                        )}
                      </label>
                    );
                  })}
                </div>
                {group.key === 'hero' && (
                  <div className="mt-5 rounded-2xl border border-[#304135] bg-[#131D16] p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#B8C7BC]"><Video className="h-4 w-4 text-[#72D28B]" /> Hero video preview</div>
                    {content.hero.videoUrl ? (
                      <video key={content.hero.videoUrl} src={content.hero.videoUrl} controls muted playsInline onError={() => setPreviewError(true)} onLoadedData={() => setPreviewError(false)} className="max-h-72 w-full rounded-xl bg-black object-contain" />
                    ) : (
                      <div className="flex items-center gap-3 text-xs text-[#8A9A8F]"><Image className="h-5 w-5 text-[#72D28B]" /> Using the built-in NearGrow hero video.</div>
                    )}
                    {previewError && <p role="alert" className="mt-2 text-xs text-rose-300">The video preview could not load. Check the URL and confirm the server allows video playback from this origin.</p>}
                    <p className="mt-3 text-[10px] leading-5 text-[#718077]">Use an HTTPS video URL or a same-site path. Leave blank to restore the built-in hero asset.</p>
                  </div>
                )}
              </section>
            ))}

            {activePage === 'home' && (
              <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[#304135] pb-4">
                  <div>
                    <h2 className="font-bold text-[#ECF3EE]">FAQs</h2>
                    <p className="mt-1 text-xs text-[#A9B8AD]">Questions appear in this order on the Home page. Each entry needs a question and answer.</p>
                  </div>
                  <button type="button" disabled={!canEdit || saving || content.faqs.length >= 20} onClick={addFaq} className="rounded-lg bg-[#286D3B] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add FAQ</button>
                </div>
                {content.faqs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#47594C] p-5 text-sm text-[#A9B8AD]">No FAQs added. Use “Add FAQ” to create the first entry.</p>
                ) : (
                  <div className="space-y-4">
                    {content.faqs.map((faq, index) => (
                      <article key={faq.id} className="rounded-xl border border-[#304135] bg-[#131D16] p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-xs font-bold text-[#ECF3EE]">FAQ {index + 1}</h3>
                          <div className="flex gap-2">
                            <button type="button" aria-label={`Move FAQ ${index + 1} up`} disabled={!canEdit || saving || index === 0} onClick={() => moveFaq(index, -1)} className="rounded-md border border-[#47594C] p-2 text-[#D7E3D9] disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
                            <button type="button" aria-label={`Move FAQ ${index + 1} down`} disabled={!canEdit || saving || index === content.faqs.length - 1} onClick={() => moveFaq(index, 1)} className="rounded-md border border-[#47594C] p-2 text-[#D7E3D9] disabled:opacity-40"><ArrowDown className="h-4 w-4" /></button>
                            <button type="button" disabled={!canEdit || saving} onClick={() => removeFaq(faq.id)} className="rounded-md border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-40">Remove</button>
                          </div>
                        </div>
                        <div className="grid gap-3">
                          <label>
                            <span className="mb-1.5 block text-xs font-semibold text-[#B8C7BC]">Question</span>
                            <input required maxLength={500} disabled={!canEdit || saving} value={faq.question} onChange={(event) => updateFaq(faq.id, { question: event.target.value })} className="w-full rounded-xl border border-[#304135] bg-[#101713] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                          </label>
                          <label>
                            <span className="mb-1.5 block text-xs font-semibold text-[#B8C7BC]">Answer</span>
                            <textarea required rows={3} maxLength={3000} disabled={!canEdit || saving} value={faq.answer} onChange={(event) => updateFaq(faq.id, { answer: event.target.value })} className="w-full resize-y rounded-xl border border-[#304135] bg-[#101713] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A]" />
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {PUBLIC_COPY_FIELDS.filter((field) => field.page === activePage && !(activePage === 'home' && field.section === 'FAQs')).reduce<Array<{ section: string; fields: typeof PUBLIC_COPY_FIELDS }>>((sections, field) => {
              let section = sections.find((candidate) => candidate.section === field.section);
              if (!section) {
                section = { section: field.section, fields: [] };
                sections.push(section);
              }
              section.fields.push(field);
              return sections;
            }, []).map(({ section, fields }) => (
              <section key={section} className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
                <div className="mb-5 border-b border-[#304135] pb-4">
                  <h2 className="font-bold text-[#ECF3EE]">{section}</h2>
                  <p className="mt-1 text-xs text-[#A9B8AD]">Edit the public copy for this section. Layout and styling are unchanged.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((field) => (
                    <label key={field.key} className={field.multiline ? 'sm:col-span-2' : ''}>
                      <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">{field.label}</span>
                      {field.multiline ? (
                        <textarea disabled={!canEdit} rows={3} maxLength={3000} value={content.copy[field.key] ?? field.value} onChange={(event) => updateCopyField(field.key, event.target.value)} className="w-full resize-y rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                      ) : (
                        <input disabled={!canEdit} maxLength={500} value={content.copy[field.key] ?? field.value} onChange={(event) => updateCopyField(field.key, event.target.value)} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}

            {isManagedPage(activePage) && <section className="rounded-3xl border border-[#304135] bg-[#19241D] p-5 shadow-sm sm:p-7">
              <div className="mb-5 border-b border-[#304135] pb-4">
                <h2 className="font-bold text-[#ECF3EE]">Search & social preview</h2>
                <p className="mt-1 text-xs text-[#A9B8AD]">Set the browser/search title, page description, and Open Graph sharing image for {pageTabs.find((tab) => tab.id === activePage)?.label}.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Page Title</span>
                  <input type="text" disabled={!canEdit} maxLength={180} value={content.seo[activePage].title} onChange={(event) => updateSeoField(activePage, 'title', event.target.value)} className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Meta Description</span>
                  <textarea disabled={!canEdit} rows={3} maxLength={320} value={content.seo[activePage].description} onChange={(event) => updateSeoField(activePage, 'description', event.target.value)} className="w-full resize-y rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                  <span className="mt-1 block text-right text-[10px] text-[#718077]">{content.seo[activePage].description.length}/320</span>
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-2 block text-xs font-semibold text-[#B8C7BC]">Open Graph Image URL</span>
                  <input type="text" disabled={!canEdit} maxLength={2000} value={content.seo[activePage].ogImage} onChange={(event) => updateSeoField(activePage, 'ogImage', event.target.value)} placeholder="https://example.com/social-preview.jpg" className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3.5 py-3 text-sm text-[#ECF3EE] outline-none placeholder:text-[#718077] focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10" />
                </label>
                {content.seo[activePage].ogImage && (
                  <div className="sm:col-span-2">
                    <img src={content.seo[activePage].ogImage} alt="Open Graph preview" className="max-h-56 rounded-xl border border-[#304135] object-contain" onError={(event) => { event.currentTarget.hidden = true; }} onLoad={(event) => { event.currentTarget.hidden = false; }} />
                  </div>
                )}
              </div>
            </section>}
            <p className="text-[10px] text-[#718077]">SEO tags are updated in the browser when visitors navigate to each page. Search and social crawlers can require a new crawl to reflect published metadata.</p>
          </div>
        )}
      </div>
    </main>
  );
}
