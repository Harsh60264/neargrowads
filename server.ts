import express, { type Request, type Response } from 'express';
import { createServer as createNetServer } from 'node:net';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'path';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import dotenv from 'dotenv';
import { BLOG_CATEGORIES as defaultBlogCategories } from './src/data/blogCategories';
import { SERVICES as staticServices } from './src/data/servicesData';
import { DEFAULT_SITE_CONTENT as frontendDefaultSiteContent, type MascotSettings } from './src/data/siteContent';
import { DEFAULT_MASCOT_SETTINGS, MASCOT_SCALE_MAX, MASCOT_SCALE_MIN } from './src/data/mascotSizing';
import { normalizeGlobeLightAppearance } from './src/data/globeAppearance';
import { isSafePublicDestination } from './src/data/publicLinks';
import { normalizeTeamUrl } from './src/data/teamLinks';
import { isSupportedTeamPhotoReference } from './src/data/teamPhoto';
import { normalizeCatalogueCategoryName, publicCataloguePackages, serviceCatalogueSlug, uniqueServiceCatalogueSlug, validServiceCatalogueSlug } from './src/data/serviceCatalogueCategories';
import { decideAdminInvitationCompletion } from './server/adminInvitation';
import type { ServiceCatalogueCategory } from './src/data/serviceCatalogue';
import type { ThemeImageVariants } from './src/data/themeImages';
import { isValidBlogImagePlacement } from './src/data/blogImagePlacement';
import {
  analyzeBlogSeo,
  BLOG_SEO_ANALYZER_VERSION,
  type BlogSeoAnalysis,
  type BlogSeoArticle,
} from './src/data/blogSeoHealth';
import { DEFAULT_PUBLIC_COPY, PUBLIC_COPY_FIELDS } from './src/data/publicCopy';
import { DEFAULT_PUBLIC_MEDIA, PUBLIC_MEDIA } from './src/data/publicMedia';
import {
  AUDIT_CSV_COLUMNS,
  AUDIT_EXPORT_PAGE_SIZE,
  AUDIT_EXPORT_TIME_ZONE,
  buildAuditLogCursorFilter,
  iterateAuditLogRecords,
  normalizeAuditExportRecord,
  resolveAuditDateRange,
  sanitizeAuditRecord,
  serializeAuditRecordCsv,
} from './server/auditLogExport';
import {
  formatLeadExportDate,
  LEAD_EXPORT_COLUMNS,
  LEAD_EXPORT_PAGE_SIZE,
  LEAD_EXPORT_TIME_ZONE,
  leadExportDateRange,
  leadSourceLabel,
  protectLeadCsvCell,
  type LeadExportColumn,
  type LeadExportFilters,
  type LeadExportFormat,
  type LeadExportScope,
} from './server/leadExport';
import {
  canAccessSecurityMonitoring,
  detectSecurityIndicators,
  sanitizeSecurityDetails,
  securityMonitoringFailureMessage,
  securityEventPageOffset,
  validateSecurityRules,
  type SecurityAlertStatus,
  type SecurityRuleSettings,
  type SecuritySourceEvent,
} from './server/securityMonitoring';
import { resolveSiteContentState } from './server/siteContentFallback';
import { blogSeoAdminPermission } from './server/blogSeoPermissions';
import {
  isWebsiteVisitorId,
  normalizeWebsiteActivityPath,
  websiteDeviceFromUserAgent,
  WebsiteActivityRateLimiter,
} from './server/websiteActivity';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory rate limiting map: IP -> timestamp[]
const rateLimitMap = new Map<string, number[]>();
const websiteActivityIpLimiter = new WebsiteActivityRateLimiter();
const websiteActivityVisitorLimiter = new WebsiteActivityRateLimiter();
let lastWebsiteActivityCleanupAt = 0;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const DEFAULT_PORT = 3000;
const DEFAULT_HMR_PORT = 24678;
const ADMIN_SESSION_COOKIE = 'neargrow_admin_session';
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const adminLoginAttempts = new Map<string, number[]>();
const adminReauthAttempts = new Map<string, number[]>();
const adminRecoveryAttempts = new Map<string, number[]>();
const adminAccountCreateAttempts = new Map<string, number[]>();
const adminManagedRecoveryAttempts = new Map<string, number[]>();
const serviceEnquiryAttempts = new Map<string, number[]>();
const serviceOrderAttempts = new Map<string, number[]>();
const securityEventWriteAttempts = new Map<string, number[]>();
const SERVICE_ENQUIRY_WINDOW_MS = 60 * 1000;
const SERVICE_ENQUIRY_MAX_ATTEMPTS = 5;
let warnedAdminAccountMigrationMissing = false;
let warnedSiteContentMigrationMissing = false;

// In-memory lead buffer (for local inspection and logging)
interface StoredLead {
  id: string;
  name: string;
  businessName: string;
  email: string;
  phone?: string;
  websiteUrl?: string;
  serviceInterest: string;
  budgetRange?: string;
  message: string;
  preferredContactMethod?: string;
  consentStatus: boolean;
  notificationStatus: 'pending' | 'not_configured' | 'delivered' | 'failed';
  sourcePage: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  createdAt: string;
  updatedAt?: string;
  status: 'new' | 'reviewed' | 'contacted';
}

const memoryLeads: StoredLead[] = [];

type LeadStorageFailureKind = 'configuration' | 'schema' | 'permission' | 'unavailable' | 'request';

class LeadStorageFailure extends Error {
  constructor(
    readonly kind: LeadStorageFailureKind,
    readonly operation: string,
    readonly code?: string,
    readonly status?: number,
    readonly diagnostic?: { message?: string; hint?: string },
  ) {
    super(`Lead storage ${operation} failed (${kind}${code ? `, ${code}` : ''}${status ? `, ${status}` : ''}).`);
    this.name = 'LeadStorageFailure';
  }
}

interface ManagedBlogPost {
  id?: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  publishedDate: string;
  author: { name: string; role: string; imageUrl?: string; imageVariants?: ThemeImageVariants };
  contentSections: { id?: string; heading: string; paragraphs: string[]; callout?: string }[];
  relatedServiceSlug: string;
  metaDescription: string;
  metaTitle?: string;
  focusKeywords?: string[];
  socialTitle?: string;
  socialImage?: string;
  socialImageVariants?: ThemeImageVariants;
  faqs?: { question: string; answer: string }[];
  inlineImages?: {
    id?: string;
    url: string;
    altText: string;
    decorative?: boolean;
    caption: string;
    afterSection?: number;
    sectionId?: string;
    placement?: 'before-heading' | 'after-heading' | 'cursor' | 'section-end';
    width?: string;
    alignment?: 'left' | 'center' | 'right';
    layout?: 'standalone' | 'wrap-left' | 'wrap-right';
    spacingAbove?: number;
    spacingBelow?: number;
    imageVariants?: ThemeImageVariants;
  }[];
  status: 'draft' | 'published';
  featuredImage?: string;
  featuredImageAltText?: string;
  featuredImageVariants?: ThemeImageVariants;
  updatedAt: string;
}

type LeadStatus = StoredLead['status'];

type ServiceBillingType = 'monthly' | 'one_time' | 'per_session';
type ServicePackageKind = 'service' | 'add_on';
type ServicePackageStatus = 'draft' | 'published';
type ServiceCatalogueBadge = 'featured' | 'recommended' | 'most_popular';

interface ServicePackage {
  id: string;
  slug: string;
  categoryId?: string;
  packageCode: string;
  title: string;
  category: string;
  packageKind: ServicePackageKind;
  summary: string;
  description: string;
  priceInr: number;
  discountedPriceInr: number | null;
  billingType: ServiceBillingType;
  imageUrl: string;
  deliverables: string[];
  exclusions: string[];
  clientRequirements: string[];
  targetAudience: string;
  deliveryTimeline: string;
  faqs: { question: string; answer: string }[];
  featured: boolean;
  catalogueBadge: ServiceCatalogueBadge | null;
  quantitySupported: boolean;
  status: ServicePackageStatus;
  createdAt: string;
  updatedAt: string;
}

type CaseStudyStatus = 'draft' | 'published' | 'archived';

interface ManagedCaseStudy {
  id: string;
  slug: string;
  title: string;
  category: string;
  clientDescriptor: string;
  approvedClientName: string;
  timeframe: string;
  location: string;
  summary: string;
  challenge: string;
  strategy: string;
  deliverablesExecuted: string[];
  resultsContext: string;
  metrics: { label: string; value: string; period: string; evidence: string }[];
  toolsUsed: string[];
  testimonialQuote?: { quote: string; author: string; role: string };
  testimonialApproved: boolean;
  serviceSlug: string;
  ctaLabel: string;
  ctaLink: string;
  featured: boolean;
  displayOrder: number;
  status: CaseStudyStatus;
  hasUnpublishedChanges?: boolean;
  imageUrl: string;
  imageAlt: string;
  imagePositionX: number;
  imagePositionY: number;
  imageSize: 'cover' | 'contain';
  imagePlacement: 'top' | 'background-cover' | 'background-watermark';
  imageOpacity: number;
}

type CaseStudyInput = Omit<ManagedCaseStudy, 'id' | 'hasUnpublishedChanges'>;

const validServiceSlug = (value: string): boolean =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;

interface WebsiteServiceContent {
  slug: string;
  title: string;
  badge: string;
  shortDescription: string;
  icon: string;
  deliverables: string[];
  primaryCtaLabel: string;
  primaryCtaLink: string;
  secondaryCtaLabel: string;
  secondaryCtaLink: string;
  backgroundImageUrl: string;
  backgroundImageVariants?: ThemeImageVariants;
  backgroundEnabled: boolean;
  backgroundFit: 'cover' | 'contain';
  backgroundOpacity: number;
  backgroundPositionX: number;
  backgroundPositionY: number;
  displayOrder: number;
}

interface ManagedWebsiteService extends WebsiteServiceContent {
  id: string;
  status: 'draft' | 'published' | 'archived';
  publishedContent?: WebsiteServiceContent;
  hasUnpublishedChanges: boolean;
}

const WEBSITE_SERVICE_ICONS = new Set(['MapPin', 'Compass', 'TrendingUp', 'Share2', 'Laptop', 'FileText', 'Cpu']);
const WEBSITE_SERVICE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateWebsiteServiceImageVariants(value: unknown): ThemeImageVariants | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const variants: ThemeImageVariants = {};
  for (const theme of ['light', 'dark'] as const) {
    const raw = input[theme];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const item = raw as Record<string, unknown>;
    const variant: NonNullable<ThemeImageVariants['light']> = {};
    if (item.url !== undefined) {
      if (typeof item.url !== 'string' || item.url.length > 2048) return undefined;
      if (item.url) {
        try {
          const parsedUrl = new URL(item.url);
          const supabaseOrigin = new URL(process.env.SUPABASE_URL || '').origin;
          if (parsedUrl.origin !== supabaseOrigin ||
            !parsedUrl.pathname.startsWith('/storage/v1/object/public/site-media/website-services/')) return undefined;
        } catch {
          return undefined;
        }
      }
      variant.url = item.url;
    }
    if (item.altText !== undefined) {
      if (typeof item.altText !== 'string' || item.altText.length > 300) return undefined;
      variant.altText = item.altText.trim();
    }
    if (item.backgroundEnabled !== undefined) {
      if (typeof item.backgroundEnabled !== 'boolean') return undefined;
      variant.backgroundEnabled = item.backgroundEnabled;
    }
    if (item.backgroundFit !== undefined) {
      if (item.backgroundFit !== 'cover' && item.backgroundFit !== 'contain') return undefined;
      variant.backgroundFit = item.backgroundFit;
    }
    for (const key of ['backgroundOpacity', 'backgroundPositionX', 'backgroundPositionY'] as const) {
      const field = item[key];
      if (field === undefined) continue;
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 100) return undefined;
      variant[key] = field;
    }
    variants[theme] = variant;
  }
  return variants;
}

function validateWebsiteServiceContent(value: unknown): WebsiteServiceContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const stringField = (key: string, max: number, required = false): string | undefined => {
    const raw = item[key];
    if (typeof raw !== 'string' || raw.length > max || (required && !raw.trim())) return undefined;
    return raw.trim();
  };
  const slug = stringField('slug', 100);
  const title = stringField('title', 160, true);
  const badge = stringField('badge', 100, true);
  const shortDescription = stringField('shortDescription', 600, true);
  const icon = stringField('icon', 40);
  const primaryCtaLabel = stringField('primaryCtaLabel', 100, true);
  const primaryCtaLink = stringField('primaryCtaLink', 2048, true);
  const secondaryCtaLabel = stringField('secondaryCtaLabel', 100);
  const secondaryCtaLink = stringField('secondaryCtaLink', 2048);
  const backgroundImageUrl = stringField('backgroundImageUrl', 2048);
  const backgroundEnabled = item.backgroundEnabled;
  const backgroundFit = item.backgroundFit;
  const backgroundOpacity = item.backgroundOpacity;
  const backgroundPositionX = item.backgroundPositionX;
  const backgroundPositionY = item.backgroundPositionY;
  const backgroundImageVariants = validateWebsiteServiceImageVariants(item.backgroundImageVariants);
  const displayOrder = item.displayOrder;
  if (!slug || !validServiceSlug(slug) || !title || !badge || !shortDescription ||
    icon === undefined || (icon !== '' && !WEBSITE_SERVICE_ICONS.has(icon) && icon !== 'Sparkles') ||
    !primaryCtaLabel || !primaryCtaLink ||
    !primaryCtaLink.startsWith('/') || secondaryCtaLabel === undefined || secondaryCtaLink === undefined ||
    Boolean(secondaryCtaLabel) !== Boolean(secondaryCtaLink) ||
    (secondaryCtaLink && !secondaryCtaLink.startsWith('/')) || backgroundImageUrl === undefined ||
    (item.backgroundImageVariants !== undefined && backgroundImageVariants === undefined) ||
    typeof backgroundEnabled !== 'boolean' ||
    (backgroundFit !== 'cover' && backgroundFit !== 'contain') ||
    typeof backgroundOpacity !== 'number' || !Number.isFinite(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 100 ||
    typeof backgroundPositionX !== 'number' || !Number.isFinite(backgroundPositionX) || backgroundPositionX < 0 || backgroundPositionX > 100 ||
    typeof backgroundPositionY !== 'number' || !Number.isFinite(backgroundPositionY) || backgroundPositionY < 0 || backgroundPositionY > 100 ||
    typeof displayOrder !== 'number' || !Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10000) return undefined;
  if (backgroundEnabled && !backgroundImageUrl) return undefined;
  if (backgroundImageUrl) {
    try {
      const parsedUrl = new URL(backgroundImageUrl);
      const supabaseOrigin = new URL(process.env.SUPABASE_URL || '').origin;
      if (parsedUrl.origin !== supabaseOrigin ||
        !parsedUrl.pathname.startsWith('/storage/v1/object/public/site-media/website-services/')) return undefined;
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(item.deliverables) || item.deliverables.length > 20 ||
    item.deliverables.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 300)) return undefined;
  return {
    slug,
    title,
    badge,
    shortDescription,
    icon,
    deliverables: item.deliverables.map((entry: string) => entry.trim()),
    primaryCtaLabel,
    primaryCtaLink,
    secondaryCtaLabel,
    secondaryCtaLink,
    backgroundImageUrl,
    ...(backgroundImageVariants ? { backgroundImageVariants } : {}),
    backgroundEnabled,
    backgroundFit,
    backgroundOpacity,
    backgroundPositionX,
    backgroundPositionY,
    displayOrder,
  };
}

function validServiceImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  if (!value) return true;
  if (value.startsWith('/uploads/service-store/')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateStringList(value: unknown, maxItems = 20): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  if (value.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > 500)) return undefined;
  return value.map((item: string) => item.trim());
}

function validateServicePackage(value: unknown): Omit<ServicePackage, 'id' | 'createdAt' | 'updatedAt'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.slug !== 'string' || !validServiceCatalogueSlug(item.slug) ||
    typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 ||
    (item.categoryId !== undefined && (typeof item.categoryId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.categoryId))) ||
    typeof item.packageCode !== 'string' || item.packageCode.length > 40 ||
    typeof item.category !== 'string' || !item.category.trim() || item.category.length > 100 ||
    !['service', 'add_on'].includes(String(item.packageKind)) ||
    typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 500 ||
    typeof item.description !== 'string' || item.description.length > 12000 ||
    typeof item.priceInr !== 'number' || !Number.isFinite(item.priceInr) || item.priceInr < 0 || item.priceInr > 1_000_000_000 ||
    (item.discountedPriceInr !== undefined && item.discountedPriceInr !== null &&
      (typeof item.discountedPriceInr !== 'number' || !Number.isFinite(item.discountedPriceInr) ||
        item.discountedPriceInr < 0 ||
        Math.round(item.discountedPriceInr * 100) >= Math.round(item.priceInr * 100))) ||
    !['monthly', 'one_time', 'per_session'].includes(String(item.billingType)) ||
    !validServiceImageUrl(item.imageUrl) ||
    typeof item.targetAudience !== 'string' || item.targetAudience.length > 500 ||
    typeof item.deliveryTimeline !== 'string' || item.deliveryTimeline.length > 240 ||
    typeof item.featured !== 'boolean' || typeof item.quantitySupported !== 'boolean' ||
    (item.catalogueBadge != null && !['featured', 'recommended', 'most_popular'].includes(String(item.catalogueBadge))) ||
    (item.featured && item.catalogueBadge !== 'featured') ||
    (item.status !== 'draft' && item.status !== 'published')) return undefined;
  const deliverables = validateStringList(item.deliverables);
  const exclusions = validateStringList(item.exclusions);
  const clientRequirements = validateStringList(item.clientRequirements);
  if (!deliverables || !exclusions || !clientRequirements ||
    !Array.isArray(item.faqs) || item.faqs.length > 30 ||
    item.faqs.some((faq) => !faq || typeof faq !== 'object' || typeof faq.question !== 'string' ||
      !faq.question.trim() || faq.question.length > 240 || typeof faq.answer !== 'string' ||
      !faq.answer.trim() || faq.answer.length > 3000)) return undefined;
  return {
    slug: item.slug,
    ...(typeof item.categoryId === 'string' ? { categoryId: item.categoryId } : {}),
    packageCode: item.packageCode.trim(),
    title: item.title.trim(),
    category: item.category.trim(),
    packageKind: item.packageKind as ServicePackageKind,
    summary: item.summary.trim(),
    description: item.description.trim(),
    priceInr: Math.round(item.priceInr * 100) / 100,
    discountedPriceInr: typeof item.discountedPriceInr === 'number'
      ? Math.round(item.discountedPriceInr * 100) / 100
      : null,
    billingType: item.billingType as ServiceBillingType,
    imageUrl: item.imageUrl,
    deliverables,
    exclusions,
    clientRequirements,
    targetAudience: item.targetAudience.trim(),
    deliveryTimeline: item.deliveryTimeline.trim(),
    faqs: (item.faqs as { question: string; answer: string }[]).map((faq) => ({
      question: faq.question.trim(),
      answer: faq.answer.trim(),
    })),
    featured: item.featured,
    catalogueBadge: item.catalogueBadge as ServiceCatalogueBadge | null,
    quantitySupported: item.quantitySupported,
    status: item.status,
  };
}

function fromSupabaseServicePackage(row: Record<string, unknown>): ServicePackage {
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  const faqs = Array.isArray(row.faqs)
    ? row.faqs.filter((faq): faq is { question: string; answer: string } =>
      Boolean(faq && typeof faq === 'object' && typeof (faq as Record<string, unknown>).question === 'string' &&
        typeof (faq as Record<string, unknown>).answer === 'string'))
    : [];
  return {
    id: String(row.id),
    slug: String(row.slug),
    ...(typeof row.category_id === 'string' ? { categoryId: row.category_id } : {}),
    packageCode: typeof row.package_code === 'string' ? row.package_code : '',
    title: String(row.title),
    category: String(row.category),
    packageKind: row.package_kind === 'add_on' ? 'add_on' : 'service',
    summary: String(row.summary),
    description: typeof row.description === 'string' ? row.description : '',
    priceInr: Number(row.price_inr),
    discountedPriceInr: row.discounted_price === null || row.discounted_price === undefined
      ? null
      : Number(row.discounted_price),
    billingType: row.billing_type === 'monthly' || row.billing_type === 'per_session' ? row.billing_type : 'one_time',
    imageUrl: typeof row.image_url === 'string' ? row.image_url : '',
    deliverables: asStrings(row.deliverables),
    exclusions: asStrings(row.exclusions),
    clientRequirements: asStrings(row.client_requirements),
    targetAudience: typeof row.target_audience === 'string' ? row.target_audience : '',
    deliveryTimeline: typeof row.delivery_timeline === 'string' ? row.delivery_timeline : '',
    faqs,
    featured: row.catalogue_badge === 'featured' || row.featured === true,
    catalogueBadge: ['featured', 'recommended', 'most_popular'].includes(String(row.catalogue_badge))
      ? row.catalogue_badge as ServiceCatalogueBadge
      : row.featured === true ? 'featured' : null,
    quantitySupported: row.quantity_supported === true,
    status: row.status === 'published' ? 'published' : 'draft',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toSupabaseServicePackage(item: Omit<ServicePackage, 'id' | 'createdAt' | 'updatedAt'>): Record<string, unknown> {
  return {
    slug: item.slug,
    category_id: item.categoryId || null,
    package_code: item.packageCode || null,
    title: item.title,
    category: item.category,
    package_kind: item.packageKind,
    summary: item.summary,
    description: item.description,
    price_inr: item.priceInr,
    discounted_price: item.discountedPriceInr,
    billing_type: item.billingType,
    image_url: item.imageUrl,
    deliverables: item.deliverables,
    exclusions: item.exclusions,
    client_requirements: item.clientRequirements,
    target_audience: item.targetAudience,
    delivery_timeline: item.deliveryTimeline,
    faqs: item.faqs,
    featured: item.catalogueBadge === 'featured',
    catalogue_badge: item.catalogueBadge,
    quantity_supported: item.quantitySupported,
    status: item.status,
    updated_at: new Date().toISOString(),
  };
}

class ServicePackageStorageError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Service package storage request failed (${status}${code ? `, ${code}` : ''}).`);
    this.name = 'ServicePackageStorageError';
  }
}

function serviceCatalogueStorageMessage(error: unknown, fallback: string): string {
  if (error instanceof ServicePackageStorageError &&
    ['PGRST204', 'PGRST205', '42P01', '42703'].includes(error.code || '')) {
    return 'The Service Store database is missing catalogue category support. Apply supabase/migrations/20261025210000_add_service_catalogue_categories.sql in Supabase, then reload the database API schema and retry.';
  }
  if (error instanceof TypeError) {
    return 'The Service Store could not connect to Supabase. Check the server-side Supabase URL and network connection, then retry.';
  }
  return fallback;
}

async function servicePackageResponse<T>(response: globalThis.Response): Promise<T> {
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = await response.json() as { code?: unknown };
      if (typeof body.code === 'string') code = body.code;
    } catch {
      // Retain status-only diagnostics if PostgREST did not return JSON.
    }
    throw new ServicePackageStorageError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new ServicePackageStorageError(response.status, 'invalid_json');
  }
}

function websiteServiceContentFromRow(value: unknown, displayOrder?: unknown): WebsiteServiceContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const content = value as Record<string, unknown>;
  const compatibleContent = content.displayOrder === undefined && typeof displayOrder === 'number'
    ? { ...content, displayOrder }
    : content;
  return validateWebsiteServiceContent(compatibleContent);
}

function websiteServiceFromRow(row: Record<string, unknown>): ManagedWebsiteService {
  const draftContent = websiteServiceContentFromRow(row.draft_content, row.display_order);
  const publishedContent = websiteServiceContentFromRow(row.published_content, row.display_order);
  if (!draftContent) throw new ServicePackageStorageError(500, 'invalid_website_service');
  return {
    id: String(row.id),
    ...draftContent,
    status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
    ...(publishedContent ? { publishedContent } : {}),
    hasUnpublishedChanges: Boolean(publishedContent && JSON.stringify(draftContent) !== JSON.stringify(publishedContent)),
  };
}

async function readWebsiteServices(adminView: boolean): Promise<ManagedWebsiteService[]> {
  const params = new URLSearchParams({ select: '*', order: 'display_order.asc,created_at.asc' });
  if (!adminView) params.set('status', 'eq.published');
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/website_services?${params.toString()}`),
  );
  return rows.map(websiteServiceFromRow).sort((left, right) => {
    const leftOrder = adminView ? left.displayOrder : left.publishedContent?.displayOrder ?? left.displayOrder;
    const rightOrder = adminView ? right.displayOrder : right.publishedContent?.displayOrder ?? right.displayOrder;
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });
}

async function readWebsiteServiceById(id: string): Promise<ManagedWebsiteService | undefined> {
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/website_services?id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
  );
  return rows[0] ? websiteServiceFromRow(rows[0]) : undefined;
}

async function readServicePackages(publishedOnly: boolean): Promise<ServicePackage[]> {
  const params = new URLSearchParams({
    select: '*',
    order: 'featured.desc,title.asc',
  });
  if (publishedOnly) params.set('status', 'eq.published');
  const [rows, categories] = await Promise.all([
    servicePackageResponse<Record<string, unknown>[]>(
      await supabaseAdminRequest(`rest/v1/service_packages?${params.toString()}`),
    ),
    readCatalogueCategories(),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const packages = rows.map((row) => {
    const item = fromSupabaseServicePackage(row);
    const category = item.categoryId ? categoryById.get(item.categoryId) : undefined;
    return category ? { ...item, category: category.name } : item;
  });
  return publishedOnly ? publicCataloguePackages(packages, categories) : packages;
}

function fromSupabaseCatalogueCategory(row: Record<string, unknown>, packageCount = 0): ServiceCatalogueCategory {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: typeof row.description === 'string' ? row.description : '',
    displayOrder: Number.isSafeInteger(row.display_order) ? Number(row.display_order) : 0,
    active: row.active === true,
    showInCatalogue: row.show_in_catalogue === true,
    packageCount,
  };
}

async function readCatalogueCategories(includePackageCounts = false): Promise<ServiceCatalogueCategory[]> {
  const [rows, packageRows] = await Promise.all([
    servicePackageResponse<Record<string, unknown>[]>(
      await supabaseAdminRequest('rest/v1/service_catalogue_categories?select=*&order=display_order.asc,name.asc'),
    ),
    includePackageCounts
      ? servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest('rest/v1/service_packages?select=category_id'),
      )
      : Promise.resolve([]),
  ]);
  const counts = new Map<string, number>();
  packageRows.forEach((row) => {
    if (typeof row.category_id === 'string') counts.set(row.category_id, (counts.get(row.category_id) || 0) + 1);
  });
  return rows.map((row) => fromSupabaseCatalogueCategory(row, counts.get(String(row.id)) || 0));
}

async function resolveServiceCategory(value: Omit<ServicePackage, 'id' | 'createdAt' | 'updatedAt'>): Promise<Omit<ServicePackage, 'id' | 'createdAt' | 'updatedAt'> | undefined> {
  const categories = await readCatalogueCategories();
  const match = value.categoryId
    ? categories.find((category) => category.id === value.categoryId)
    : categories.find((category) =>
      normalizeCatalogueCategoryName(category.name).toLocaleLowerCase() ===
      normalizeCatalogueCategoryName(value.category).toLocaleLowerCase());
  return match ? { ...value, categoryId: match.id, category: match.name } : undefined;
}

function validateCatalogueCategory(value: unknown): Omit<ServiceCatalogueCategory, 'id' | 'packageCount'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === 'string' ? normalizeCatalogueCategoryName(item.name) : '';
  const slug = typeof item.slug === 'string' ? serviceCatalogueSlug(item.slug) : '';
  if (!name || name.length > 100 || !validServiceCatalogueSlug(slug) ||
    typeof item.description !== 'string' || item.description.length > 500 ||
    !Number.isInteger(item.displayOrder) || Number(item.displayOrder) < 0 || Number(item.displayOrder) > 10000 ||
    typeof item.active !== 'boolean' || typeof item.showInCatalogue !== 'boolean') return undefined;
  return { name, slug, description: item.description.trim(), displayOrder: Number(item.displayOrder), active: item.active, showInCatalogue: item.showInCatalogue };
}

async function createCatalogueCategory(value: Omit<ServiceCatalogueCategory, 'id' | 'packageCount'>): Promise<ServiceCatalogueCategory> {
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/service_catalogue_categories?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name: value.name,
        slug: value.slug,
        description: value.description,
        display_order: value.displayOrder,
        active: value.active,
        show_in_catalogue: value.showInCatalogue,
      }),
    }),
  );
  if (!rows[0]) throw new ServicePackageStorageError(500, 'empty_category_insert_result');
  return fromSupabaseCatalogueCategory(rows[0]);
}

async function updateCatalogueCategory(id: string, value: Omit<ServiceCatalogueCategory, 'id' | 'packageCount'>): Promise<ServiceCatalogueCategory | undefined> {
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/service_catalogue_categories?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name: value.name,
        slug: value.slug,
        description: value.description,
        display_order: value.displayOrder,
        active: value.active,
        show_in_catalogue: value.showInCatalogue,
        updated_at: new Date().toISOString(),
      }),
    }),
  );
  return rows[0] ? fromSupabaseCatalogueCategory(rows[0]) : undefined;
}

async function deleteCatalogueCategory(id: string): Promise<boolean> {
  const rows = await servicePackageResponse<{ id: string }[]>(
    await supabaseAdminRequest(`rest/v1/service_catalogue_categories?id=eq.${encodeURIComponent(id)}&select=id`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    }),
  );
  return rows.length > 0;
}

async function createServicePackage(value: Omit<ServicePackage, 'id' | 'createdAt' | 'updatedAt'>): Promise<ServicePackage> {
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/service_packages?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(toSupabaseServicePackage(value)),
    }),
  );
  if (!rows[0]) throw new ServicePackageStorageError(500, 'empty_insert_result');
  return fromSupabaseServicePackage(rows[0]);
}

async function updateServicePackage(id: string, value: Omit<ServicePackage, 'id' | 'createdAt' | 'updatedAt'>): Promise<ServicePackage | undefined> {
  const params = new URLSearchParams({ id: `eq.${id}`, select: '*' });
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/service_packages?${params.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(toSupabaseServicePackage(value)),
    }),
  );
  return rows[0] ? fromSupabaseServicePackage(rows[0]) : undefined;
}

async function readServicePackageById(id: string): Promise<ServicePackage | undefined> {
  const params = new URLSearchParams({ id: `eq.${id}`, select: '*', limit: '1' });
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/service_packages?${params.toString()}`),
  );
  return rows[0] ? fromSupabaseServicePackage(rows[0]) : undefined;
}

async function deleteServicePackage(id: string): Promise<boolean> {
  const params = new URLSearchParams({ id: `eq.${id}`, select: 'id' });
  const rows = await servicePackageResponse<{ id: string }[]>(
    await supabaseAdminRequest(`rest/v1/service_packages?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    }),
  );
  return rows.length > 0;
}

async function uniquePackageSlug(base: string): Promise<string> {
  const rows = await servicePackageResponse<{ slug?: unknown }[]>(
    await supabaseAdminRequest('rest/v1/service_packages?select=slug'),
  );
  const used = new Set(rows.flatMap((row) => typeof row.slug === 'string' ? [row.slug] : []));
  return uniqueServiceCatalogueSlug(base, used);
}

class CaseStudyStorageError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Case study storage request failed (${status}${code ? `, ${code}` : ''}).`);
    this.name = 'CaseStudyStorageError';
  }
}

async function caseStudyResponse<T>(response: globalThis.Response): Promise<T> {
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = await response.json() as { code?: unknown; message?: unknown };
      if (typeof body.code === 'string') code = body.code;
    } catch {
      // Keep status-only diagnostics when PostgREST does not return JSON.
    }
    throw new CaseStudyStorageError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new CaseStudyStorageError(response.status, 'invalid_json');
  }
}

function caseStudyStorageMessage(error: unknown, fallback: string): string {
  if (error instanceof CaseStudyStorageError &&
    ['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'].includes(error.code || '')) {
    return 'Apply the Case Studies published-snapshot and category-sync migrations, then reload the Supabase API schema.';
  }
  return fallback;
}

function caseStudyObjectKey(value: string): string | undefined {
  const prefixes = ['/api/admin/case-studies/media/', '/api/case-study-images/'];
  const objectKey = prefixes.reduce((key, prefix) => key.startsWith(prefix) ? key.slice(prefix.length) : key, value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|webp)$/i.test(objectKey)
    ? objectKey
    : undefined;
}

function fromSupabaseCaseStudy(row: Record<string, unknown>, publicImage = false): ManagedCaseStudy {
  const publishedContent = row.published_content && typeof row.published_content === 'object' &&
    !Array.isArray(row.published_content)
    ? row.published_content as Record<string, unknown>
    : undefined;
  const content = publicImage && publishedContent ? publishedContent : row;
  const read = (snakeCase: string, camelCase = snakeCase) => content[camelCase] ?? content[snakeCase];
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  const rawMetrics = read('metrics');
  const metrics = Array.isArray(rawMetrics)
    ? rawMetrics.filter((metric): metric is Record<string, unknown> =>
      Boolean(metric && typeof metric === 'object' && !Array.isArray(metric) &&
        typeof (metric as Record<string, unknown>).label === 'string' &&
        typeof (metric as Record<string, unknown>).value === 'string' &&
        typeof (metric as Record<string, unknown>).period === 'string'))
      .map((metric) => ({
        label: metric.label as string,
        value: metric.value as string,
        period: metric.period as string,
        evidence: typeof metric.evidence === 'string' ? metric.evidence : '',
      }))
    : [];
  const rawTestimonial = read('testimonial_quote', 'testimonialQuote');
  const testimonial = rawTestimonial && typeof rawTestimonial === 'object' && !Array.isArray(rawTestimonial)
    ? rawTestimonial as Record<string, unknown>
    : undefined;
  const managed: ManagedCaseStudy = {
    id: String(row.id),
    slug: String(read('slug') || ''),
    title: String(read('title') || ''),
    category: String(read('category') || ''),
    clientDescriptor: typeof read('client_descriptor', 'clientDescriptor') === 'string' ? String(read('client_descriptor', 'clientDescriptor')) : '',
    approvedClientName: typeof read('approved_client_name', 'approvedClientName') === 'string' ? String(read('approved_client_name', 'approvedClientName')) : '',
    timeframe: typeof read('timeframe') === 'string' ? String(read('timeframe')) : '',
    location: typeof read('location') === 'string' ? String(read('location')) : '',
    summary: typeof read('summary') === 'string' ? String(read('summary')) : '',
    challenge: typeof read('challenge') === 'string' ? String(read('challenge')) : '',
    strategy: typeof read('strategy') === 'string' ? String(read('strategy')) : '',
    deliverablesExecuted: asStrings(read('deliverables_executed', 'deliverablesExecuted')),
    resultsContext: typeof read('results_context', 'resultsContext') === 'string' ? String(read('results_context', 'resultsContext')) : '',
    metrics,
    toolsUsed: asStrings(read('tools_used', 'toolsUsed')),
    ...(testimonial && typeof testimonial.quote === 'string' && typeof testimonial.author === 'string' &&
      typeof testimonial.role === 'string'
      ? { testimonialQuote: { quote: testimonial.quote, author: testimonial.author, role: testimonial.role } }
      : {}),
    testimonialApproved: read('testimonial_approved', 'testimonialApproved') === true,
    serviceSlug: typeof read('service_slug', 'serviceSlug') === 'string' ? String(read('service_slug', 'serviceSlug')) : '',
    ctaLabel: typeof read('cta_label', 'ctaLabel') === 'string' ? String(read('cta_label', 'ctaLabel')) : '',
    ctaLink: typeof read('cta_link', 'ctaLink') === 'string' ? String(read('cta_link', 'ctaLink')) : '',
    featured: read('featured') === true,
    displayOrder: Number.isInteger(read('display_order', 'displayOrder')) ? Number(read('display_order', 'displayOrder')) : 0,
    status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
    imageUrl: typeof read('image_url', 'imageUrl') === 'string' && caseStudyObjectKey(String(read('image_url', 'imageUrl')))
      ? `${publicImage ? '/api/case-study-images/' : '/api/admin/case-studies/media/'}${caseStudyObjectKey(String(read('image_url', 'imageUrl')))}`
      : '',
    imageAlt: typeof read('image_alt', 'imageAlt') === 'string' ? String(read('image_alt', 'imageAlt')) : '',
    imagePositionX: Number.isInteger(read('image_position_x', 'imagePositionX')) ? Number(read('image_position_x', 'imagePositionX')) : 50,
    imagePositionY: Number.isInteger(read('image_position_y', 'imagePositionY')) ? Number(read('image_position_y', 'imagePositionY')) : 50,
    imageSize: read('image_size', 'imageSize') === 'contain' ? 'contain' : 'cover',
    imagePlacement: read('image_placement', 'imagePlacement') === 'background-cover' ||
      read('image_placement', 'imagePlacement') === 'background-watermark'
      ? read('image_placement', 'imagePlacement') as ManagedCaseStudy['imagePlacement']
      : 'top',
    imageOpacity: Number.isInteger(read('image_opacity', 'imageOpacity'))
      ? Number(read('image_opacity', 'imageOpacity'))
      : 18,
  };
  if (!publicImage && row.status === 'published' && publishedContent) {
    const comparablePublishedContent = { ...publishedContent };
    if (Array.isArray(publishedContent.metrics)) {
      comparablePublishedContent.metrics = publishedContent.metrics.map((metric) => {
        const value = metric && typeof metric === 'object' && !Array.isArray(metric)
          ? metric as Record<string, unknown>
          : {};
        return {
          label: typeof value.label === 'string' ? value.label : '',
          value: typeof value.value === 'string' ? value.value : '',
          period: typeof value.period === 'string' ? value.period : '',
          evidence: typeof value.evidence === 'string' ? value.evidence : '',
        };
      });
    }
    managed.hasUnpublishedChanges = stableCaseStudyValue(toPublishedCaseStudyContent(managed)) !==
      stableCaseStudyValue(comparablePublishedContent);
  }
  return managed;
}

function stableCaseStudyValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCaseStudyValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableCaseStudyValue(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function toPublishedCaseStudyContent(item: CaseStudyInput): Record<string, unknown> {
  return {
    slug: item.slug,
    title: item.title,
    category: item.category,
    clientDescriptor: item.clientDescriptor,
    approvedClientName: item.approvedClientName,
    timeframe: item.timeframe,
    location: item.location,
    summary: item.summary,
    challenge: item.challenge,
    strategy: item.strategy,
    deliverablesExecuted: item.deliverablesExecuted,
    resultsContext: item.resultsContext,
    metrics: item.metrics,
    toolsUsed: item.toolsUsed,
    testimonialQuote: item.testimonialQuote || null,
    testimonialApproved: item.testimonialApproved,
    serviceSlug: item.serviceSlug,
    ctaLabel: item.ctaLabel,
    ctaLink: item.ctaLink,
    featured: item.featured,
    displayOrder: item.displayOrder,
    imageUrl: item.imageUrl ? caseStudyObjectKey(item.imageUrl) || '' : '',
    imageAlt: item.imageAlt,
    imagePositionX: item.imagePositionX,
    imagePositionY: item.imagePositionY,
    imageSize: item.imageSize,
    imagePlacement: item.imagePlacement,
    imageOpacity: item.imageOpacity,
  };
}

function toSupabaseCaseStudy(item: CaseStudyInput): Record<string, unknown> {
  return {
    slug: item.slug,
    title: item.title,
    category: item.category,
    client_descriptor: item.clientDescriptor,
    approved_client_name: item.approvedClientName,
    timeframe: item.timeframe,
    location: item.location,
    summary: item.summary,
    challenge: item.challenge,
    strategy: item.strategy,
    deliverables_executed: item.deliverablesExecuted,
    results_context: item.resultsContext,
    metrics: item.metrics,
    tools_used: item.toolsUsed,
    testimonial_quote: item.testimonialQuote || null,
    testimonial_approved: item.testimonialApproved,
    service_slug: item.serviceSlug,
    cta_label: item.ctaLabel,
    cta_link: item.ctaLink,
    featured: item.featured,
    display_order: item.displayOrder,
    status: item.status,
    image_url: item.imageUrl ? caseStudyObjectKey(item.imageUrl) || '' : '',
    image_alt: item.imageAlt,
    image_position_x: item.imagePositionX,
    image_position_y: item.imagePositionY,
    image_size: item.imageSize,
    image_placement: item.imagePlacement,
    image_opacity: item.imageOpacity,
    published_at: item.status === 'published' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

function validCaseStudyImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  return value === '' || caseStudyObjectKey(value) !== undefined;
}

function validateCaseStudy(value: unknown): CaseStudyInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const stringFields: [keyof CaseStudyInput, number][] = [
    ['title', 180], ['category', 100], ['clientDescriptor', 160], ['approvedClientName', 120],
    ['timeframe', 100], ['location', 120], ['summary', 1000], ['challenge', 5000], ['strategy', 5000],
    ['resultsContext', 1500], ['serviceSlug', 100], ['ctaLabel', 80], ['ctaLink', 500],
    ['imageAlt', 200],
  ];
  if (typeof item.slug !== 'string' || !validServiceSlug(item.slug) ||
    stringFields.some(([key, max]) => typeof item[key] !== 'string' || (item[key] as string).length > max) ||
    !String(item.title).trim() || !String(item.category).trim() || !String(item.clientDescriptor).trim() ||
    (item.status !== 'draft' && item.status !== 'published' && item.status !== 'archived') ||
    typeof item.featured !== 'boolean' ||
    !Number.isInteger(item.displayOrder) || Number(item.displayOrder) < 0 || Number(item.displayOrder) > 100_000 ||
    !Number.isInteger(item.imagePositionX) || Number(item.imagePositionX) < 0 || Number(item.imagePositionX) > 100 ||
    !Number.isInteger(item.imagePositionY) || Number(item.imagePositionY) < 0 || Number(item.imagePositionY) > 100 ||
    (item.imageSize !== 'cover' && item.imageSize !== 'contain') ||
    (item.imagePlacement !== 'top' && item.imagePlacement !== 'background-cover' &&
      item.imagePlacement !== 'background-watermark') ||
    !Number.isInteger(item.imageOpacity) || Number(item.imageOpacity) < 0 || Number(item.imageOpacity) > 100 ||
    typeof item.testimonialApproved !== 'boolean' || !validCaseStudyImageUrl(item.imageUrl) ||
    (String(item.ctaLink) !== '' &&
      !(String(item.ctaLink).startsWith('/') && !String(item.ctaLink).startsWith('//') ||
        (() => { try { const url = new URL(String(item.ctaLink)); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } })()))) {
    return undefined;
  }
  const deliverables = validateStringList(item.deliverablesExecuted, 30);
  const tools = validateStringList(item.toolsUsed, 30);
  if (!deliverables || !tools || !Array.isArray(item.metrics) || item.metrics.length > 12 ||
    item.metrics.some((metric) => !metric || typeof metric !== 'object' || Array.isArray(metric) ||
      typeof (metric as Record<string, unknown>).label !== 'string' ||
      !(metric as Record<string, unknown>).label || (metric as Record<string, unknown>).label!.toString().length > 120 ||
      typeof (metric as Record<string, unknown>).value !== 'string' ||
      !(metric as Record<string, unknown>).value || (metric as Record<string, unknown>).value!.toString().length > 80 ||
      typeof (metric as Record<string, unknown>).period !== 'string' ||
      (metric as Record<string, unknown>).period!.toString().length > 120 ||
      typeof (metric as Record<string, unknown>).evidence !== 'string' ||
      (metric as Record<string, unknown>).evidence!.toString().length > 1500)) return undefined;
  const testimonial = item.testimonialQuote;
  if (testimonial !== undefined && testimonial !== null &&
    (!testimonial || typeof testimonial !== 'object' || Array.isArray(testimonial) ||
      typeof (testimonial as Record<string, unknown>).quote !== 'string' ||
      (testimonial as Record<string, unknown>).quote!.toString().length > 2000 ||
      typeof (testimonial as Record<string, unknown>).author !== 'string' ||
      (testimonial as Record<string, unknown>).author!.toString().length > 120 ||
      typeof (testimonial as Record<string, unknown>).role !== 'string' ||
      (testimonial as Record<string, unknown>).role!.toString().length > 120)) return undefined;
  return {
    slug: item.slug,
    title: String(item.title).trim(),
    category: String(item.category).trim(),
    clientDescriptor: String(item.clientDescriptor).trim(),
    approvedClientName: String(item.approvedClientName).trim(),
    timeframe: String(item.timeframe).trim(),
    location: String(item.location).trim(),
    summary: String(item.summary).trim(),
    challenge: String(item.challenge).trim(),
    strategy: String(item.strategy).trim(),
    deliverablesExecuted: deliverables,
    resultsContext: String(item.resultsContext).trim(),
    metrics: (item.metrics as { label: string; value: string; period: string; evidence: string }[])
      .map((metric) => ({ label: metric.label.trim(), value: metric.value.trim(), period: metric.period.trim(), evidence: metric.evidence.trim() })),
    toolsUsed: tools,
    ...(testimonial ? { testimonialQuote: {
      quote: String((testimonial as Record<string, unknown>).quote).trim(),
      author: String((testimonial as Record<string, unknown>).author).trim(),
      role: String((testimonial as Record<string, unknown>).role).trim(),
    } } : {}),
    testimonialApproved: item.testimonialApproved,
    serviceSlug: String(item.serviceSlug).trim(),
    ctaLabel: String(item.ctaLabel).trim(),
    ctaLink: String(item.ctaLink).trim(),
    featured: item.featured,
    displayOrder: Number(item.displayOrder),
    status: item.status,
    imageUrl: String(item.imageUrl),
    imageAlt: String(item.imageAlt).trim(),
    imagePositionX: Number(item.imagePositionX),
    imagePositionY: Number(item.imagePositionY),
    imageSize: item.imageSize,
    imagePlacement: item.imagePlacement as ManagedCaseStudy['imagePlacement'],
    imageOpacity: Number(item.imageOpacity),
  };
}

async function readCaseStudies(publishedOnly = false): Promise<ManagedCaseStudy[]> {
  const params = new URLSearchParams({ select: '*' });
  if (publishedOnly) {
    params.set('status', 'eq.published');
    params.set('published_content', 'not.is.null');
  } else {
    params.set('order', 'display_order.asc,created_at.asc');
  }
  const rows = await caseStudyResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/case_studies?${params.toString()}`),
  );
  if (publishedOnly) {
    rows.sort((left, right) => {
      const leftContent = left.published_content as Record<string, unknown>;
      const rightContent = right.published_content as Record<string, unknown>;
      const orderDifference = Number(leftContent.displayOrder) - Number(rightContent.displayOrder);
      return orderDifference || String(left.created_at).localeCompare(String(right.created_at));
    });
  }
  return rows.map((row) => fromSupabaseCaseStudy(row, publishedOnly));
}

function normalizeCaseStudyCategory(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

const RESERVED_CASE_STUDY_CATEGORY = normalizeCaseStudyCategory('All Engagements');

async function readCaseStudyCategoryData(): Promise<{ categories: string[]; customCategories: string[] }> {
  const params = new URLSearchParams({ select: 'category_name,is_custom', order: 'normalized_name.asc' });
  const rows = await caseStudyResponse<{ category_name: string; is_custom: boolean }[]>(
    await supabaseAdminRequest(`rest/v1/case_study_categories?${params.toString()}`),
  );
  const availableRows = rows.filter((row) =>
    normalizeCaseStudyCategory(row.category_name) !== RESERVED_CASE_STUDY_CATEGORY);
  return {
    categories: availableRows.map((row) => row.category_name),
    customCategories: availableRows.filter((row) => row.is_custom).map((row) => row.category_name),
  };
}

async function readCaseStudyCategories(): Promise<string[]> {
  const params = new URLSearchParams({ select: 'category_name', order: 'normalized_name.asc' });
  const rows = await caseStudyResponse<{ category_name: string }[]>(
    await supabaseAdminRequest(`rest/v1/case_study_categories?${params.toString()}`),
  );
  return rows
    .map((row) => row.category_name)
    .filter((category) => normalizeCaseStudyCategory(category) !== RESERVED_CASE_STUDY_CATEGORY);
}

async function saveCaseStudyCategory(value: string): Promise<string> {
  const categoryName = value.trim().replace(/\s+/g, ' ');
  const normalizedName = normalizeCaseStudyCategory(categoryName);
  if (normalizedName === RESERVED_CASE_STUDY_CATEGORY) {
    throw new CaseStudyStorageError(400, 'reserved_category');
  }
  const params = new URLSearchParams({
    on_conflict: 'normalized_name',
    select: 'category_name',
  });
  const rows = await caseStudyResponse<{ category_name: string }[]>(
    await supabaseAdminRequest(`rest/v1/case_study_categories?${params.toString()}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ category_name: categoryName, normalized_name: normalizedName, is_custom: true }),
    }),
  );
  if (rows[0]) return rows[0].category_name;
  const existing = await caseStudyResponse<{ category_name: string }[]>(
    await supabaseAdminRequest(`rest/v1/case_study_categories?${new URLSearchParams({
      normalized_name: `eq.${normalizedName}`,
      select: 'category_name',
      limit: '1',
    })}`),
  );
  if (!existing[0]) throw new CaseStudyStorageError(500, 'empty_category_insert_result');
  return existing[0].category_name;
}

async function renameCaseStudyCategory(oldValue: string, newValue: string): Promise<string> {
  const response = await supabaseAdminRequest('rest/v1/rpc/rename_case_study_category', {
    method: 'POST',
    body: JSON.stringify({
      p_old_normalized_name: normalizeCaseStudyCategory(oldValue),
      p_category_name: newValue.trim().replace(/\s+/g, ' '),
    }),
  });
  return caseStudyResponse<string>(response);
}

async function deleteCaseStudyCategory(value: string): Promise<boolean> {
  const response = await supabaseAdminRequest('rest/v1/rpc/delete_unused_case_study_category', {
    method: 'POST',
    body: JSON.stringify({ p_normalized_name: normalizeCaseStudyCategory(value) }),
  });
  return caseStudyResponse<boolean>(response);
}

async function getSavedCaseStudyCategory(value: string): Promise<string | undefined> {
  const normalizedCategory = normalizeCaseStudyCategory(value);
  if (normalizedCategory === RESERVED_CASE_STUDY_CATEGORY) return undefined;
  const categories = await readCaseStudyCategories();
  return categories.find((category) => normalizeCaseStudyCategory(category) === normalizedCategory);
}

async function readCaseStudyById(id: string): Promise<ManagedCaseStudy | undefined> {
  const params = new URLSearchParams({ id: `eq.${id}`, select: '*', limit: '1' });
  const rows = await caseStudyResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/case_studies?${params.toString()}`),
  );
  return rows[0] ? fromSupabaseCaseStudy(rows[0]) : undefined;
}

async function createCaseStudy(value: CaseStudyInput): Promise<ManagedCaseStudy> {
  const payload = toSupabaseCaseStudy(value);
  if (value.status === 'published') payload.published_content = toPublishedCaseStudyContent(value);
  const rows = await caseStudyResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/case_studies?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    }),
  );
  if (!rows[0]) throw new CaseStudyStorageError(500, 'empty_insert_result');
  return fromSupabaseCaseStudy(rows[0]);
}

async function updateCaseStudy(
  id: string,
  value: CaseStudyInput,
  existingStatus: CaseStudyStatus,
): Promise<ManagedCaseStudy | undefined> {
  const params = new URLSearchParams({ id: `eq.${id}`, select: '*' });
  const payload = toSupabaseCaseStudy(value);
  if (value.status === 'published') {
    payload.published_content = toPublishedCaseStudyContent(value);
  } else if (existingStatus === 'published') {
    delete payload.status;
    delete payload.published_at;
  } else {
    payload.status = 'draft';
    payload.published_at = null;
  }
  const rows = await caseStudyResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/case_studies?${params.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    }),
  );
  return rows[0] ? fromSupabaseCaseStudy(rows[0]) : undefined;
}

async function updateCaseStudyStatus(id: string, status: CaseStudyStatus): Promise<ManagedCaseStudy | undefined> {
  const rows = await caseStudyResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/rpc/set_case_study_status', {
      method: 'POST',
      body: JSON.stringify({ p_id: id, p_status: status }),
    }),
  );
  return rows[0] ? fromSupabaseCaseStudy(rows[0]) : undefined;
}

async function deleteCaseStudy(id: string): Promise<boolean> {
  const params = new URLSearchParams({ id: `eq.${id}`, select: 'id' });
  const rows = await caseStudyResponse<{ id: string }[]>(
    await supabaseAdminRequest(`rest/v1/case_studies?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    }),
  );
  return rows.length > 0;
}

async function removeCaseStudyImageIfUnused(imageUrl: string): Promise<void> {
  if (!validCaseStudyImageUrl(imageUrl)) return;
  const objectKey = caseStudyObjectKey(imageUrl);
  if (!objectKey) return;
  const params = new URLSearchParams({
    select: 'id',
    limit: '1',
    or: `(image_url.eq.${objectKey},published_content->>imageUrl.eq.${objectKey})`,
  });
  const references = await caseStudyResponse<{ id: string }[]>(
    await supabaseAdminRequest(`rest/v1/case_studies?${params.toString()}`),
  );
  if (references.length) return;
  const response = await supabaseAdminRequest(`storage/v1/object/case-study-media/${encodeURIComponent(objectKey)}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    throw new CaseStudyStorageError(response.status, 'image_cleanup_failed');
  }
}

interface ServiceEnquiryInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  serviceInterest: string;
  requestNote: string;
  consent: true;
  packages: { packageId: string; quantity: number }[];
}

interface ServiceEnquiryRequest {
  id: string;
  requestReference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  serviceInterest: string;
  selectedPackages: {
    packageId: string;
    packageCode: string;
    title: string;
    priceInr: number;
    originalPriceInr: number;
    discountedPriceInr: number | null;
    billingType: ServiceBillingType;
    quantity: number;
    lineSubtotalInr: number;
  }[];
  requestNote: string;
  status: 'received' | 'in_progress' | 'closed';
  createdAt: string;
}

function validateServiceEnquiry(value: unknown): ServiceEnquiryInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const customerName = typeof input.customerName === 'string' ? input.customerName.trim() : '';
  const customerEmail = typeof input.customerEmail === 'string' ? input.customerEmail.trim().toLowerCase() : '';
  const customerPhone = typeof input.customerPhone === 'string' ? input.customerPhone.trim() : '';
  const customerBusinessName = typeof input.customerBusinessName === 'string' ? input.customerBusinessName.trim() : '';
  const serviceInterest = typeof input.serviceInterest === 'string' ? input.serviceInterest.trim() : '';
  const requestNote = typeof input.requestNote === 'string' ? input.requestNote.trim() : '';
  if (customerName.length < 2 || customerName.length > 120 ||
    (customerEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerEmail.length > 255)) ||
    !/^[+0-9().\s-]{7,25}$/.test(customerPhone) || customerBusinessName.length > 160 ||
    serviceInterest.length > 120 || !serviceInterest ||
    requestNote.length > 1000 || input.consent !== true ||
    !Array.isArray(input.packages) || input.packages.length > 12 ||
    (input.packages.length === 0 && !serviceInterest)) return undefined;
  const packages: ServiceEnquiryInput['packages'] = [];
  const seenIds = new Set<string>();
  for (const entry of input.packages) {
    if (!entry || typeof entry !== 'object') return undefined;
    const packageEntry = entry as Record<string, unknown>;
    if (typeof packageEntry.packageId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(packageEntry.packageId) ||
      !Number.isInteger(packageEntry.quantity) || (packageEntry.quantity as number) < 1 || (packageEntry.quantity as number) > 50 ||
      seenIds.has(packageEntry.packageId)) return undefined;
    seenIds.add(packageEntry.packageId);
    packages.push({ packageId: packageEntry.packageId, quantity: packageEntry.quantity as number });
  }
  return { customerName, customerEmail, customerPhone, customerBusinessName, serviceInterest, requestNote, consent: true, packages };
}

function fromSupabaseServiceEnquiry(row: Record<string, unknown>): ServiceEnquiryRequest {
  const selectedPackages = Array.isArray(row.selected_packages)
    ? row.selected_packages.filter((entry): entry is ServiceEnquiryRequest['selectedPackages'][number] =>
      Boolean(entry && typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).packageId === 'string' &&
        typeof (entry as Record<string, unknown>).title === 'string'))
    : [];
  const status = row.status === 'in_progress' || row.status === 'closed' ? row.status : 'received';
  return {
    id: String(row.id),
    requestReference: String(row.request_reference),
    customerName: String(row.customer_name),
    customerEmail: String(row.customer_email || ''),
    customerPhone: String(row.customer_phone || ''),
    customerBusinessName: String(row.customer_business_name || ''),
    serviceInterest: String(row.service_interest || ''),
    selectedPackages,
    requestNote: String(row.request_note || ''),
    status,
    createdAt: String(row.created_at),
  };
}

class InvalidServiceEnquiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidServiceEnquiryError';
  }
}

async function createServiceEnquiry(input: ServiceEnquiryInput): Promise<{ requestReference: string; status: string; createdAt: string }> {
  const published = await readServicePackages(true);
  const selectedPackages: ServiceEnquiryRequest['selectedPackages'] = [];
  for (const requested of input.packages) {
    const servicePackage = published.find((item) => item.id === requested.packageId);
    if (!servicePackage) throw new InvalidServiceEnquiryError('A selected service package is no longer available.');
    if (!servicePackage.quantitySupported && requested.quantity !== 1) {
      throw new InvalidServiceEnquiryError('This service package does not support a quantity greater than one.');
    }
    selectedPackages.push({
      packageId: servicePackage.id,
      packageCode: servicePackage.packageCode,
      title: servicePackage.title,
      priceInr: servicePackage.discountedPriceInr ?? servicePackage.priceInr,
      originalPriceInr: servicePackage.priceInr,
      discountedPriceInr: servicePackage.discountedPriceInr,
      billingType: servicePackage.billingType,
      quantity: requested.quantity,
      lineSubtotalInr: Math.round((servicePackage.discountedPriceInr ?? servicePackage.priceInr) * requested.quantity * 100) / 100,
    });
  }
  const requestReference = `NGQ-${randomUUID().toUpperCase()}`;
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/service_enquiry_requests?select=request_reference,status,created_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        request_reference: requestReference,
        customer_name: input.customerName,
        customer_email: input.customerEmail || null,
        customer_phone: input.customerPhone,
        customer_business_name: input.customerBusinessName,
        service_interest: input.serviceInterest,
        consent: input.consent,
        selected_packages: selectedPackages,
        request_note: input.requestNote,
      }),
    }),
  );
  if (!rows[0]) throw new ServicePackageStorageError(500, 'empty_enquiry_result');
  return {
    requestReference: String(rows[0].request_reference),
    status: typeof rows[0].status === 'string' ? rows[0].status : 'received',
    createdAt: String(rows[0].created_at),
  };
}

async function readServiceEnquiries(): Promise<ServiceEnquiryRequest[]> {
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/service_enquiry_requests?select=*&order=created_at.desc&limit=200'),
  );
  return rows.map(fromSupabaseServiceEnquiry);
}

interface ServiceStorePaymentSettings {
  businessName: string;
  paymentContactPhone: string;
  testGatewayEnabled: boolean;
  testCredentialsVerified: boolean;
  testCredentialsVerifiedAt: string | null;
  testKeyIdMasked: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface ServiceOrderLine {
  packageId: string;
  packageCode: string;
  title: string;
  billingType: ServiceBillingType;
  billingArrangement: 'one_time' | 'single_cycle' | 'single_session';
  quantity: number;
  originalPriceInr: number;
  unitPriceInr: number;
  lineSubtotalInr: number;
}

interface ServiceOrderInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  onboardingNotes: string;
  consent: true;
  packages: { packageId: string; quantity: number }[];
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function getRazorpayTestConfig(): { keyId: string; keySecret: string; webhookSecret: string } | undefined {
  const keyId = process.env.RAZORPAY_TEST_KEY_ID?.trim() || '';
  const keySecret = process.env.RAZORPAY_TEST_KEY_SECRET || '';
  const webhookSecret = process.env.RAZORPAY_TEST_WEBHOOK_SECRET || '';
  if (!/^rzp_test_[A-Za-z0-9]+$/.test(keyId) || keySecret.length < 8 || webhookSecret.length < 8) return undefined;
  return { keyId, keySecret, webhookSecret };
}

function maskPaymentIdentifier(value: string): string {
  const normalized = value.replace(/\s/g, '');
  return normalized ? `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}` : '';
}

function serviceOrderRateLimit(req: Request, res: Response): boolean {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempts = (serviceOrderAttempts.get(clientIp) || []).filter((time) => now - time < SERVICE_ENQUIRY_WINDOW_MS);
  if (attempts.length >= SERVICE_ENQUIRY_MAX_ATTEMPTS) {
    res.status(429).json({ message: 'Too many checkout attempts. Please try again shortly.' });
    return false;
  }
  attempts.push(now);
  serviceOrderAttempts.set(clientIp, attempts);
  return true;
}

function validateServiceOrder(value: unknown): ServiceOrderInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const customerName = typeof input.customerName === 'string' ? input.customerName.trim() : '';
  const customerEmail = typeof input.customerEmail === 'string' ? input.customerEmail.trim().toLowerCase() : '';
  const customerPhone = typeof input.customerPhone === 'string' ? input.customerPhone.trim() : '';
  const customerBusinessName = typeof input.customerBusinessName === 'string' ? input.customerBusinessName.trim() : '';
  const onboardingNotes = typeof input.onboardingNotes === 'string' ? input.onboardingNotes.trim() : '';
  if (customerName.length < 2 || customerName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail) || customerEmail.length > 255 ||
    !/^[+0-9().\s-]{7,25}$/.test(customerPhone) || customerBusinessName.length > 160 ||
    onboardingNotes.length > 2000 || input.consent !== true ||
    !Array.isArray(input.packages) || input.packages.length < 1 || input.packages.length > 12) return undefined;

  const packages: ServiceOrderInput['packages'] = [];
  const seenIds = new Set<string>();
  for (const entry of input.packages) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const item = entry as Record<string, unknown>;
    if (typeof item.packageId !== 'string' || !isUuid(item.packageId) ||
      !Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 50 ||
      seenIds.has(item.packageId)) return undefined;
    seenIds.add(item.packageId);
    packages.push({ packageId: item.packageId, quantity: item.quantity as number });
  }
  return { customerName, customerEmail, customerPhone, customerBusinessName, onboardingNotes, consent: true, packages };
}

async function readServiceStorePaymentSettings(): Promise<ServiceStorePaymentSettings> {
  const query = new URLSearchParams({ select: '*', id: 'eq.true', limit: '1' });
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/service_store_payment_settings?${query}`),
  );
  const row = rows[0];
  const provider = getRazorpayTestConfig();
  const testCredentialsVerified = Boolean(provider && row?.razorpay_test_verified_key_id === provider.keyId);
  return {
    businessName: typeof row?.business_name === 'string' ? row.business_name : '',
    paymentContactPhone: typeof row?.payment_contact_phone === 'string' ? row.payment_contact_phone : '',
    testGatewayEnabled: row?.razorpay_test_enabled === true && testCredentialsVerified,
    testCredentialsVerified,
    testCredentialsVerifiedAt: typeof row?.razorpay_test_verified_at === 'string' ? row.razorpay_test_verified_at : null,
    testKeyIdMasked: provider ? maskPaymentIdentifier(provider.keyId) : '',
    updatedBy: typeof row?.updated_by === 'string' ? row.updated_by : null,
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : null,
  };
}

async function savePaymentAudit(
  actorId: string,
  action: string,
  fieldName: string,
  oldValueMasked = '',
  newValueMasked = '',
  verificationResult = 'not_applicable',
  activationStatus = 'not_activated',
): Promise<void> {
  const response = await supabaseAdminRequest('rest/v1/service_store_payment_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_id: actorId,
      action,
      field_name: fieldName,
      old_value_masked: oldValueMasked,
      new_value_masked: newValueMasked,
      verification_result: verificationResult,
      activation_status: activationStatus,
    }),
  });
  if (!response.ok) throw new ServicePackageStorageError(response.status, 'payment_audit_write_failed');
}

async function readPaymentAuditHistory(): Promise<Record<string, unknown>[]> {
  return await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/service_store_payment_audit?select=id,actor_id,action,field_name,old_value_masked,new_value_masked,verification_result,activation_status,created_at&order=created_at.desc&limit=100'),
  );
}

function buildServiceOrderLines(input: ServiceOrderInput, packages: ServicePackage[]): ServiceOrderLine[] {
  const lines: ServiceOrderLine[] = [];
  let billingArrangement: ServiceOrderLine['billingArrangement'] | undefined;
  for (const requested of input.packages) {
    const servicePackage = packages.find((item) => item.id === requested.packageId);
    if (!servicePackage) throw new InvalidServiceEnquiryError('A selected service package is no longer available.');
    if (!servicePackage.quantitySupported && requested.quantity !== 1) {
      throw new InvalidServiceEnquiryError('This service package does not support a quantity greater than one.');
    }
    const arrangement: ServiceOrderLine['billingArrangement'] = servicePackage.billingType === 'monthly'
      ? 'single_cycle'
      : servicePackage.billingType === 'per_session' ? 'single_session' : 'one_time';
    if (billingArrangement && billingArrangement !== arrangement) {
      throw new InvalidServiceEnquiryError('Purchase monthly, one-time, and per-session services in separate checkouts.');
    }
    billingArrangement = arrangement;
    const unitPriceInr = servicePackage.discountedPriceInr ?? servicePackage.priceInr;
    lines.push({
      packageId: servicePackage.id,
      packageCode: servicePackage.packageCode,
      title: servicePackage.title,
      billingType: servicePackage.billingType,
      billingArrangement: arrangement,
      quantity: requested.quantity,
      originalPriceInr: servicePackage.priceInr,
      unitPriceInr,
      lineSubtotalInr: Math.round(unitPriceInr * requested.quantity * 100) / 100,
    });
  }
  return lines;
}

function razorpayAuthorization(config: { keyId: string; keySecret: string }): string {
  return `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
}

async function verifyRazorpayPayment(
  order: { provider_order_id: string; total_amount_paise: number },
  paymentId: string,
  config: { keyId: string; keySecret: string },
): Promise<boolean> {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: razorpayAuthorization(config), Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const payment = await response.json() as {
    id?: string; order_id?: string; amount?: number; currency?: string;
    status?: string; captured?: boolean;
  };
  return payment.id === paymentId && payment.order_id === order.provider_order_id &&
    payment.amount === order.total_amount_paise && payment.currency === 'INR' &&
    payment.status === 'captured' && payment.captured === true;
}

async function confirmServiceOrderPayment(providerOrderId: string, paymentId: string, amountPaise: number): Promise<boolean> {
  const response = await supabaseAdminRequest('rest/v1/rpc/confirm_service_order_payment', {
    method: 'POST',
    body: JSON.stringify({
      p_provider_order_id: providerOrderId,
      p_provider_payment_id: paymentId,
      p_amount_paise: amountPaise,
    }),
  });
  if (!response.ok) throw new ServicePackageStorageError(response.status, 'payment_confirmation_failed');
  return await response.json() as boolean;
}

async function createServiceOrder(input: ServiceOrderInput): Promise<{
  id: string;
  orderReference: string;
  trackingToken: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
}> {
  const config = getRazorpayTestConfig();
  if (!config) throw new Error('Online payment currently unavailable. Razorpay Test credentials are not configured.');
  const settings = await readServiceStorePaymentSettings();
  if (!settings.testGatewayEnabled) throw new Error('Online payment currently unavailable. The Primary Owner must verify and enable Razorpay Test mode.');

  const packages = await readServicePackages(true);
  const lines = buildServiceOrderLines(input, packages);
  const amountPaise = Math.round(lines.reduce((total, line) => total + line.lineSubtotalInr, 0) * 100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
    throw new InvalidServiceEnquiryError('The checkout total must be at least ₹1.00.');
  }
  const orderReference = `NGO-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`;
  const trackingToken = randomUUID() + randomUUID().replace(/-/g, '');
  const trackingTokenHash = createHash('sha256').update(trackingToken).digest('hex');
  const snapshot = {
    provider: 'razorpay',
    mode: 'test',
    merchantName: settings.businessName,
    merchantAccountIdMasked: settings.testKeyIdMasked,
    settlementVerified: false,
    settlementNote: 'Razorpay Test mode does not route real funds or verify a settlement destination.',
  };

  const providerResponse = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: razorpayAuthorization(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: orderReference,
      notes: { order_reference: orderReference },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const providerBody = await providerResponse.json().catch(() => ({})) as { id?: string; amount?: number; currency?: string };
  if (!providerResponse.ok || !providerBody.id || providerBody.amount !== amountPaise || providerBody.currency !== 'INR') {
    throw new Error('Razorpay Test could not create this payment order. No payment was initiated.');
  }

  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest('rest/v1/service_orders?select=id,order_reference', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        order_reference: orderReference,
        tracking_token_hash: trackingTokenHash,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        customer_business_name: input.customerBusinessName,
        customer_onboarding_notes: input.onboardingNotes,
        line_items: lines,
        total_amount_paise: amountPaise,
        provider_order_id: providerBody.id,
        provider_snapshot: snapshot,
      }),
    }),
  );
  if (!rows[0] || typeof rows[0].id !== 'string') throw new ServicePackageStorageError(500, 'empty_order_insert');
  return {
    id: rows[0].id,
    orderReference,
    trackingToken,
    providerOrderId: providerBody.id,
    amountPaise,
    currency: 'INR',
    keyId: config.keyId,
  };
}

async function readServiceOrderByTracking(reference: string, token: string): Promise<Record<string, unknown> | undefined> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const params = new URLSearchParams({
    select: 'order_reference,customer_name,line_items,total_amount_paise,currency,provider,provider_mode,payment_status,fulfillment_status,created_at,paid_at',
    order_reference: `eq.${reference}`,
    tracking_token_hash: `eq.${tokenHash}`,
    limit: '1',
  });
  const rows = await servicePackageResponse<Record<string, unknown>[]>(
    await supabaseAdminRequest(`rest/v1/service_orders?${params}`),
  );
  return rows[0];
}

function leadStorageMode(): 'memory' | 'supabase' {
  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (hasUrl !== hasKey) {
    throw new LeadStorageFailure('configuration', 'configuration');
  }
  if (hasUrl) return 'supabase';
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') return 'memory';
  throw new LeadStorageFailure('configuration', 'configuration');
}

const defaultBlogPosts: ManagedBlogPost[] = [
  {
    slug: 'google-business-profile-optimization-guide', title: 'The Google Business Profile Optimization Playbook for Growing Brands',
    excerpt: 'A practical guide to profile categories, content, and review operations for brands managing one or more business locations.', category: 'Google Maps & Multi-Location Search', readTime: '6 min read', publishedDate: 'October 10, 2026',
    author: { name: 'NearGrow Ads Growth Team', role: 'Search Growth Specialists' }, relatedServiceSlug: 'google-business-profile',
    metaDescription: 'Learn how to manage Google Business Profiles to strengthen search visibility, maintain accurate location information, and earn customer trust.', status: 'published', updatedAt: '2026-10-10T09:00:00.000Z',
    contentSections: [{ heading: 'Make your profile useful and complete', paragraphs: ['Keep your business details accurate, add genuine photos, choose relevant categories, and respond thoughtfully to customer reviews.'] }],
  },
  {
    slug: 'local-seo-vs-google-ads-guide', title: 'Local SEO vs. Google Ads: Which Strategy Should Your Business Prioritize?',
    excerpt: 'Compare timeline, costs, sustainability and buyer intent to choose the right marketing mix.', category: 'Marketing Strategy', readTime: '7 min read', publishedDate: 'September 28, 2026',
    author: { name: 'NearGrow Ads Strategy Team', role: 'Growth & Acquisition' }, relatedServiceSlug: 'google-ads',
    metaDescription: 'Compare Local SEO and Google Ads, including timelines, costs and the best strategy for your business.', status: 'published', updatedAt: '2026-09-28T09:00:00.000Z',
    contentSections: [{ heading: 'A strategy for your timeline', paragraphs: ['Paid search can bring visibility quickly, while organic search compounds over time. Many businesses benefit from a measured blend of both.'] }],
  },
  {
    slug: 'mobile-website-conversion-mistakes', title: '5 Subtle Website Flaws That Silently Kill Inquiries on Mobile Devices',
    excerpt: 'From intrusive banners to cumbersome forms, discover why mobile visitors leave without enquiring.', category: 'Website Development', readTime: '5 min read', publishedDate: 'September 14, 2026',
    author: { name: 'NearGrow Ads Engineering Team', role: 'Frontend & UX Architects' }, relatedServiceSlug: 'website-development',
    metaDescription: 'Learn how to fix common mobile usability mistakes that hurt website conversions.', status: 'published', updatedAt: '2026-09-14T09:00:00.000Z',
    contentSections: [{ heading: 'Make mobile journeys effortless', paragraphs: ['Design for small screens first. Keep navigation compact, contact options one tap away, and forms short enough to complete on a phone.'] }],
  },
  {
    slug: 'practical-ai-automation-for-small-business', title: 'Pragmatic AI Automation for Small Businesses: What Actually Works Today',
    excerpt: 'Real-world systems that save time, prevent lead drop-off, and streamline daily communication.', category: 'AI & Automation', readTime: '6 min read', publishedDate: 'August 22, 2026',
    author: { name: 'NearGrow Ads Automation Team', role: 'Workflow Engineers' }, relatedServiceSlug: 'ai-automation',
    metaDescription: 'Explore practical automation workflows for small businesses that reduce response times and manual work.', status: 'published', updatedAt: '2026-08-22T09:00:00.000Z',
    contentSections: [{ heading: 'Start with a repeatable workflow', paragraphs: ['Begin with a frequent, structured task such as capturing a form enquiry, routing it to the right person, and sending a timely response.'] }],
  },
];

let memoryBlogPosts = defaultBlogPosts;
const persistentDataRoot = process.env.PERSISTENT_DATA_DIR
  ? path.resolve(process.env.PERSISTENT_DATA_DIR)
  : path.resolve(__dirname, 'data');
const blogDataFile = path.join(persistentDataRoot, 'blog-posts.json');
const blogCategoriesFile = path.join(persistentDataRoot, 'blog-categories.json');
const blogSeoHealthFile = path.join(persistentDataRoot, 'blog-seo-health.json');
const siteContentFile = path.join(persistentDataRoot, 'site-content.json');
const blogUploadDir = path.join(persistentDataRoot, 'uploads', 'blog');
type ServerlessCmsDocumentKey =
  | 'blog-posts'
  | 'blog-categories'
  | 'blog-seo-health'
  | 'site-content'
  | 'team';
const serverlessCmsDocumentVersions = new Map<ServerlessCmsDocumentKey, number>();

class CmsDocumentWriteConflictError extends Error {
  constructor(key: ServerlessCmsDocumentKey) {
    super(`CMS document ${key} changed during this update; reload the latest version before saving again.`);
    this.name = 'CmsDocumentWriteConflictError';
  }
}

async function readCmsDocument<T>(key: ServerlessCmsDocumentKey, localFile: string): Promise<T | undefined> {
  if (process.env.VERCEL !== '1') {
    try {
      return JSON.parse(await fs.readFile(localFile, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  const query = new URLSearchParams({ select: 'document_value,version', document_key: `eq.${key}`, limit: '1' });
  const response = await supabaseAdminRequest(`rest/v1/serverless_cms_documents?${query}`);
  if (!response.ok) throw new Error(`CMS document read failed (${key}, ${response.status}).`);
  const rows = await response.json() as Array<{ document_value: T; version: number }>;
  if (rows[0]) serverlessCmsDocumentVersions.set(key, rows[0].version);
  else serverlessCmsDocumentVersions.delete(key);
  return rows[0]?.document_value;
}

async function writeCmsDocument<T>(key: ServerlessCmsDocumentKey, localFile: string, value: T): Promise<void> {
  if (process.env.VERCEL === '1') {
    const expectedVersion = serverlessCmsDocumentVersions.get(key);
    const updateExisting = expectedVersion !== undefined;
    const query = updateExisting
      ? new URLSearchParams({ document_key: `eq.${key}`, version: `eq.${expectedVersion}` })
      : new URLSearchParams({ on_conflict: 'document_key' });
    const response = await supabaseAdminRequest(
      `rest/v1/serverless_cms_documents?${query}`,
      {
        method: updateExisting ? 'PATCH' : 'POST',
        headers: {
          Prefer: updateExisting ? 'return=representation' : 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify({ ...(updateExisting ? {} : { document_key: key }), document_value: value }),
      },
    );
    if (!response.ok) throw new Error(`CMS document write failed (${key}, ${response.status}).`);
    const rows = await response.json() as Array<{ version: number }>;
    if (rows.length !== 1) throw new CmsDocumentWriteConflictError(key);
    serverlessCmsDocumentVersions.set(key, rows[0].version);
    return;
  }

  await fs.mkdir(path.dirname(localFile), { recursive: true });
  const temporaryFile = `${localFile}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporaryFile, localFile);
}

const validSlug = (slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 140;
const stableBlogId = (slug: string) => `legacy-${createHash('sha256').update(`blog:${slug}`).digest('hex').slice(0, 32)}`;

function createSerialMutationQueue() {
  let tail: Promise<void> = Promise.resolve();
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

const withBlogMutation = createSerialMutationQueue();
const withTeamMutation = createSerialMutationQueue();
const contentRevision = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateBlogImageVariants(value: unknown, maxAltText = 300): ThemeImageVariants | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const variants: ThemeImageVariants = {};
  for (const theme of ['light', 'dark'] as const) {
    const raw = input[theme];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const item = raw as Record<string, unknown>;
    const variant: NonNullable<ThemeImageVariants['light']> = {};
    if (item.url !== undefined) {
      if (!blogImageUrl(item.url)) return undefined;
      variant.url = item.url;
    }
    if (item.altText !== undefined) {
      if (typeof item.altText !== 'string' || item.altText.length > maxAltText) return undefined;
      variant.altText = item.altText.trim();
    }
    for (const key of ['focalX', 'focalY', 'backgroundOpacity', 'backgroundPositionX', 'backgroundPositionY', 'imagePositionX', 'imagePositionY', 'imageOpacity'] as const) {
      const field = item[key];
      if (field === undefined) continue;
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 100) return undefined;
      variant[key] = field;
    }
    if (item.backgroundEnabled !== undefined) {
      if (typeof item.backgroundEnabled !== 'boolean') return undefined;
      variant.backgroundEnabled = item.backgroundEnabled;
    }
    if (item.backgroundFit !== undefined) {
      if (item.backgroundFit !== 'cover' && item.backgroundFit !== 'contain') return undefined;
      variant.backgroundFit = item.backgroundFit;
    }
    if (item.imageSize !== undefined) {
      if (item.imageSize !== 'cover' && item.imageSize !== 'contain') return undefined;
      variant.imageSize = item.imageSize;
    }
    variants[theme] = variant;
  }
  return variants;
}

const blogImageUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 20_000_000 &&
  (value === '' ||
    /^\/uploads\/blog\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(value) ||
    /^https:\/\//.test(value) ||
    /^data:image\/(png|jpeg|webp);base64,/.test(value));

interface BlogCategory {
  name: string;
  slug: string;
  description: string;
}

let memoryBlogCategories: BlogCategory[] = defaultBlogCategories.map((category) => ({ ...category }));

function validateBlogCategory(value: unknown): BlogCategory | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const category = value as Partial<BlogCategory>;
  if (typeof category.name !== 'string' || !category.name.trim() || category.name.trim().length > 80 ||
    typeof category.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug) || category.slug.length > 100 ||
    typeof category.description !== 'string' || category.description.length > 500) return undefined;
  return { name: category.name.trim(), slug: category.slug, description: category.description.trim() };
}

async function readBlogCategories(): Promise<BlogCategory[]> {
  try {
    const parsed = await readCmsDocument<unknown>('blog-categories', blogCategoriesFile);
    if (Array.isArray(parsed)) {
      const categories = parsed.map(validateBlogCategory);
      if (categories.every((category): category is BlogCategory => Boolean(category)) &&
        new Set(categories.map((category) => category.slug)).size === categories.length) return categories;
      console.error('[NearGrow Ads] Blog category store has an invalid structure; using defaults.');
    }
  } catch (error) {
    if (process.env.VERCEL === '1') throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[NearGrow Ads] Blog category store read error:', error);
    }
  }
  return memoryBlogCategories;
}

async function writeBlogCategories(categories: BlogCategory[]): Promise<void> {
  await writeCmsDocument('blog-categories', blogCategoriesFile, categories);
  memoryBlogCategories = categories;
}

async function readBlogPosts(): Promise<ManagedBlogPost[]> {
  try {
    const parsed = await readCmsDocument<unknown>('blog-posts', blogDataFile);
    if (Array.isArray(parsed)) return parsed as ManagedBlogPost[];
  } catch (error) {
    if (process.env.VERCEL === '1') throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[NearGrow Ads] Blog store read error:', error);
    }
  }
  return memoryBlogPosts;
}

async function writeBlogPosts(posts: ManagedBlogPost[]): Promise<void> {
  await writeCmsDocument('blog-posts', blogDataFile, posts);
  memoryBlogPosts = posts;
}

interface StoredBlogSeoAnalysis extends BlogSeoAnalysis {
  status: 'draft' | 'published';
}

async function readBlogSeoAnalyses(): Promise<StoredBlogSeoAnalysis[]> {
  try {
    const parsed = await readCmsDocument<unknown>('blog-seo-health', blogSeoHealthFile);
    if (parsed === undefined) return [];
    if (!Array.isArray(parsed)) throw new Error('The stored SEO health data has an invalid structure.');
    return parsed as StoredBlogSeoAnalysis[];
  } catch (error) {
    if (process.env.VERCEL === '1') throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeBlogSeoAnalyses(analyses: StoredBlogSeoAnalysis[]): Promise<void> {
  await writeCmsDocument('blog-seo-health', blogSeoHealthFile, analyses);
}

function validateBlogPost(value: unknown): ManagedBlogPost | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const post = value as Partial<ManagedBlogPost>;
  if ((post.id !== undefined && (typeof post.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(post.id))) ||
    !post.slug || !validSlug(post.slug) || typeof post.title !== 'string' || !post.title.trim() || post.title.length > 160 ||
    typeof post.excerpt !== 'string' || !post.excerpt.trim() || post.excerpt.length > 320 ||
    typeof post.category !== 'string' || !post.category.trim() || post.category.length > 80 ||
    !Array.isArray(post.contentSections) || post.contentSections.length < 1 || post.contentSections.length > 30 ||
    (post.status !== 'draft' && post.status !== 'published')) return undefined;
  const sections = post.contentSections.filter((section) => section && typeof section.heading === 'string' && Array.isArray(section.paragraphs) && section.paragraphs.every((paragraph) => typeof paragraph === 'string') &&
    (section.id === undefined || (typeof section.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(section.id))));
  if (sections.length !== post.contentSections.length || sections.some((section) => !section.heading.trim() || section.paragraphs.length < 1 || section.paragraphs.some((paragraph) => !paragraph.trim()))) return undefined;
  const storedSectionIds = sections.flatMap((section) => section.id ? [section.id] : []);
  if (new Set(storedSectionIds).size !== storedSectionIds.length) return undefined;
  if (!blogImageUrl(post.featuredImage ?? '')) return undefined;
  const featuredImageVariants = validateBlogImageVariants(post.featuredImageVariants);
  if (post.featuredImageVariants !== undefined && !featuredImageVariants) return undefined;
  const socialImageVariants = validateBlogImageVariants(post.socialImageVariants);
  if (post.socialImageVariants !== undefined && !socialImageVariants) return undefined;
  const authorValue = post.author && typeof post.author === 'object'
    ? post.author as Partial<ManagedBlogPost['author']>
    : {};
  const author: ManagedBlogPost['author'] = {
    name: typeof authorValue.name === 'string' ? authorValue.name : '',
    role: typeof authorValue.role === 'string' ? authorValue.role : '',
    imageUrl: typeof authorValue.imageUrl === 'string' ? authorValue.imageUrl : '',
    ...(authorValue.imageVariants ? { imageVariants: authorValue.imageVariants } : {}),
  };
  if (!blogImageUrl(author.imageUrl ?? '')) return undefined;
  const authorImageVariants = validateBlogImageVariants(author.imageVariants);
  if (author.imageVariants !== undefined && !authorImageVariants) return undefined;
  if (post.socialImage !== undefined && !blogImageUrl(post.socialImage)) return undefined;
  if (post.focusKeywords !== undefined && (!Array.isArray(post.focusKeywords) || post.focusKeywords.length > 30 ||
    post.focusKeywords.some((keyword) => typeof keyword !== 'string' || keyword.length > 80))) return undefined;
  if (post.faqs !== undefined && (!Array.isArray(post.faqs) || post.faqs.length > 30 ||
    post.faqs.some((faq) => !faq || typeof faq.question !== 'string' || !faq.question.trim() || faq.question.length > 240 ||
      typeof faq.answer !== 'string' || !faq.answer.trim() || faq.answer.length > 3000))) return undefined;
  const sectionIds = new Set(storedSectionIds);
  const inlineImagePlacementValid = (image: NonNullable<ManagedBlogPost['inlineImages']>[number]) => {
    const cursorMarkerCount = image.id
      ? sections.reduce((count, section) => count + section.paragraphs.reduce((paragraphCount, paragraph) =>
        paragraphCount + paragraph.split(`data-blog-image-id="${image.id}"`).length - 1, 0), 0)
      : 0;
    return isValidBlogImagePlacement(image, sectionIds, sections.length, cursorMarkerCount === 1);
  };
  if (post.inlineImages !== undefined && (!Array.isArray(post.inlineImages) || post.inlineImages.length > 30 ||
    post.inlineImages.some((image) => !image || !blogImageUrl(image.url) || !image.url ||
      typeof image.altText !== 'string' || image.altText.length > 200 ||
      (image.decorative !== undefined && typeof image.decorative !== 'boolean') ||
      typeof image.caption !== 'string' || image.caption.length > 500 ||
      !inlineImagePlacementValid(image) ||
      (image.imageVariants !== undefined && !validateBlogImageVariants(image.imageVariants, 200))))) return undefined;
  const imageIds = (post.inlineImages || []).flatMap((image) => image?.id ? [image.id] : []);
  if (new Set(imageIds).size !== imageIds.length) return undefined;
  return {
    ...post,
    id: post.id || randomUUID(),
    title: post.title.trim(), excerpt: post.excerpt.trim(), category: post.category.trim(),
    readTime: typeof post.readTime === 'string' ? post.readTime.slice(0, 30) : '5 min read',
    publishedDate: typeof post.publishedDate === 'string' ? post.publishedDate.slice(0, 80) : new Date().toLocaleDateString('en-IN'),
    author: {
      name: author.name.slice(0, 100),
      role: author.role.slice(0, 100),
      imageUrl: author.imageUrl || '',
      ...(authorImageVariants ? { imageVariants: authorImageVariants } : {}),
    },
    contentSections: sections.map((section) => ({ ...(section.id ? { id: section.id } : {}), heading: section.heading.trim().slice(0, 180), paragraphs: section.paragraphs.map((paragraph) => paragraph.slice(0, 12000)), callout: section.callout?.slice(0, 1000) })),
    relatedServiceSlug: typeof post.relatedServiceSlug === 'string' ? post.relatedServiceSlug.trim().slice(0, 500) : '',
    metaDescription: typeof post.metaDescription === 'string' ? post.metaDescription.slice(0, 180) : '',
    metaTitle: typeof post.metaTitle === 'string' ? post.metaTitle.trim().slice(0, 160) : '',
    focusKeywords: Array.isArray(post.focusKeywords) ? post.focusKeywords.map((keyword) => keyword.trim()).filter(Boolean) : [],
    socialTitle: typeof post.socialTitle === 'string' ? post.socialTitle.trim().slice(0, 160) : '',
    socialImage: post.socialImage || '',
    ...(socialImageVariants ? { socialImageVariants } : {}),
    faqs: Array.isArray(post.faqs) ? post.faqs.map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() })) : [],
    inlineImages: Array.isArray(post.inlineImages) ? post.inlineImages.map((image) => ({
      ...(image.id ? { id: image.id } : {}),
      url: image.url,
      altText: image.altText.trim(),
      ...(image.decorative ? { decorative: true } : {}),
      caption: image.caption.trim(),
      ...(image.afterSection !== undefined ? { afterSection: image.afterSection } : {}),
      ...(image.sectionId ? { sectionId: image.sectionId } : {}),
      ...(image.placement ? { placement: image.placement } : {}),
      ...(image.width ? { width: image.width } : {}),
      ...(image.alignment ? { alignment: image.alignment } : {}),
      ...(image.layout ? { layout: image.layout } : {}),
      ...(image.spacingAbove !== undefined ? { spacingAbove: image.spacingAbove } : {}),
      ...(image.spacingBelow !== undefined ? { spacingBelow: image.spacingBelow } : {}),
      ...(image.imageVariants ? { imageVariants: validateBlogImageVariants(image.imageVariants, 200) } : {}),
    })) : [],
    featuredImage: post.featuredImage || '',
    featuredImageAltText: typeof post.featuredImageAltText === 'string' ? post.featuredImageAltText.trim().slice(0, 300) : '',
    ...(featuredImageVariants ? { featuredImageVariants } : {}),
    updatedAt: new Date().toISOString(),
  } as ManagedBlogPost;
}

// ---------- Leadership & Team (About page) ----------
type TeamGroup = 'mentor' | 'core';
interface TeamMember {
  id: string; group: TeamGroup; name: string; role: string; tag?: string; bio: string;
  imageUrl: string; socialUrl: string; order: number; visible: boolean;
}

const teamDataFile = path.join(persistentDataRoot, 'team.json');
const teamUploadRoot = path.join(persistentDataRoot, 'uploads');
const teamUploadDir = path.join(teamUploadRoot, 'team');
const servicePackageUploadDir = path.join(teamUploadRoot, 'service-store');
let memoryTeam: TeamMember[] = [];

const defaultSiteContent = {
  copy: frontendDefaultSiteContent.copy,
  faqs: frontendDefaultSiteContent.faqs,
  media: frontendDefaultSiteContent.media,
  animations: frontendDefaultSiteContent.animations,
  mascotSettings: frontendDefaultSiteContent.mascotSettings,
  navigation: frontendDefaultSiteContent.navigation,
  ctaDestinations: frontendDefaultSiteContent.ctaDestinations,
  footerSettings: frontendDefaultSiteContent.footerSettings,
  seo: frontendDefaultSiteContent.seo,
  hero: {
    eyebrow: 'India-based · Built for global growth',
    headlineBefore: 'Grow Your Business With',
    headlineHighlight: 'Smarter',
    headlineAfter: 'Digital Marketing.',
    description: 'NearGrow Ads helps ambitious businesses grow across markets through international SEO, multi-location search, performance advertising, scalable web engineering, and practical AI-powered automation.',
    primaryCta: 'Get a Free Consultation',
    secondaryCta: 'Explore Our Services',
    videoUrl: '',
  },
  philosophy: {
    eyebrow: 'PEOPLE · IDEAS · GROWTH',
    title: 'A Growth Partner Built on Honest Fundamentals',
    description: 'We combine people who understand business realities, ideas that solve real customer problems, and technology that produces measurable growth.',
    peopleTitle: 'PEOPLE',
    peopleDescription: 'We take the time to understand your unique business, profit margins, competitors, and the exact kind of customers you want to attract. Real human strategists, not automated churn.',
    ideasTitle: 'IDEAS',
    ideasDescription: 'Rather than copying generic templates, we formulate custom acquisition strategies: pinpointing high-intent search terms, crafting compelling ad angles, and removing friction from your sales pathways.',
    growthTitle: 'GROWTH',
    growthDescription: 'Every marketing initiative is measured by real business outcomes: phone calls, WhatsApp messages, store visits, and qualified sales leads, rather than hollow vanity metrics.',
  },
  missionVision: {
    eyebrow: 'Our Purpose',
    title: 'Our Mission / Our Vision',
    missionTitle: 'Our Mission',
    missionDescription: 'To empower ambitious businesses with high-visibility digital marketing, international and multi-location search, and measurable customer acquisition—through creative, practical, data-driven strategies tailored to their growth goals.',
    visionTitle: 'Our Vision',
    visionDescription: 'To be a trusted digital growth partner, helping businesses turn their digital presence into qualified demand across markets through practical results and transparent execution.',
  },
  services: {
    eyebrow: 'Capabilities',
    title: 'Our Core Marketing Services',
    description: 'Eight connected services to strengthen your digital foundation, reach the right audiences across markets, and earn more qualified inquiries.',
    cta: 'Explore all services',
  },
  methodology: {
    eyebrow: 'Our Process',
    title: 'How NearGrow Ads Works',
    description: 'A structured, transparent five-stage methodology ensuring you always understand what is being built, why, and what it achieves.',
  },
  servicesPage: {
    eyebrow: 'PEOPLE · IDEAS · GROWTH',
    headlineBefore: 'Digital growth, built around',
    headlineHighlight: 'what moves your business.',
    description: 'From international search and performance advertising to conversion-ready websites and smarter systems, bring your growth channels together with one accountable team.',
    primaryCta: 'Request a custom audit',
    supportingText: 'A clear, practical plan for your next stage of growth.',
  },
  aboutPage: {
    eyebrow: 'About NearGrow Ads',
    title: 'A Practical Growth Partner for Real Businesses.',
    description: 'We started NearGrow Ads to offer growing businesses a refreshingly honest alternative to bloated, opaque agencies. We combine international and multi-location SEO, performance advertising, scalable web engineering, and reliable automation to help you attract qualified demand across markets.',
    primaryCta: 'Schedule Discovery Call',
    secondaryCta: 'Contact Our Team',
  },
  workPage: {
    eyebrow: 'Portfolio & Selected Work',
    title: 'Documented Client Outcomes & Case Studies',
    description: 'Explore documented outcomes across retail, B2B, and healthcare—from search visibility and paid acquisition to scalable websites and more efficient customer acquisition.',
    primaryCta: 'Get a Free Consultation',
  },
  contactPage: {
    eyebrow: 'Contact & Inquiries',
    title: 'Get in Touch With NearGrow Ads',
    description: 'Have a question about international SEO, multi-location discovery, performance advertising, or web engineering? Reach our team directly via phone, WhatsApp, or form submission.',
    primaryCta: 'Schedule Discovery Consultation',
  },
};

type SiteContent = typeof defaultSiteContent;
const fallbackSiteContent: SiteContent = defaultSiteContent;

async function readLegacySiteContent(): Promise<SiteContent> {
  try {
    const parsed = await readCmsDocument<unknown>('site-content', siteContentFile);
    if (parsed === undefined) return fallbackSiteContent;
    const validated = validateSiteContent(parsed);
    if (validated) return validated;
    console.error('[NearGrow Ads] Site content store has an invalid structure; using defaults.');
  } catch (error) {
    if (process.env.VERCEL === '1') throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[NearGrow Ads] Site content store read error:', error);
    }
  }
  return fallbackSiteContent;
}

function validateSiteContent(value: unknown): SiteContent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const sections = ['hero', 'philosophy', 'missionVision', 'services', 'methodology', 'servicesPage', 'aboutPage', 'workPage', 'contactPage'] as const;
  const limits: Record<string, number> = {
    eyebrow: 120, headlineBefore: 160, headlineHighlight: 160, headlineAfter: 160, description: 1200,
    primaryCta: 80, secondaryCta: 80, videoUrl: 2000, title: 180, peopleTitle: 80, peopleDescription: 800,
    ideasTitle: 80, ideasDescription: 800, growthTitle: 80, growthDescription: 800, cta: 80,
    missionTitle: 80, missionDescription: 1000, visionTitle: 80, visionDescription: 1000,
    supportingText: 240,
  };
  const content = {
    seo: defaultSiteContent.seo,
    copy: DEFAULT_PUBLIC_COPY,
    media: DEFAULT_PUBLIC_MEDIA,
    navigation: defaultSiteContent.navigation,
    ctaDestinations: defaultSiteContent.ctaDestinations,
    footerSettings: defaultSiteContent.footerSettings,
  } as SiteContent;
  const rawMascotSettings = input.mascotSettings === undefined
    ? DEFAULT_MASCOT_SETTINGS
    : input.mascotSettings;
  if (!rawMascotSettings || typeof rawMascotSettings !== 'object' || Array.isArray(rawMascotSettings)) return undefined;
  const mascotSettings = rawMascotSettings as Partial<MascotSettings>;
  const desktopScalePercent = mascotSettings.desktopScalePercent === undefined
    ? DEFAULT_MASCOT_SETTINGS.desktopScalePercent
    : mascotSettings.desktopScalePercent;
  const mobileScalePercent = mascotSettings.mobileScalePercent === undefined
    ? DEFAULT_MASCOT_SETTINGS.mobileScalePercent
    : mascotSettings.mobileScalePercent;
  const renderer = (mascotSettings as Record<string, unknown>).renderer;
  if ((renderer !== undefined && renderer !== '3d' && renderer !== '2d') ||
    typeof desktopScalePercent !== 'number' || !Number.isInteger(desktopScalePercent) ||
    desktopScalePercent < MASCOT_SCALE_MIN || desktopScalePercent > MASCOT_SCALE_MAX ||
    typeof mobileScalePercent !== 'number' || !Number.isInteger(mobileScalePercent) ||
    mobileScalePercent < MASCOT_SCALE_MIN || mobileScalePercent > MASCOT_SCALE_MAX) return undefined;
  content.mascotSettings = { renderer: renderer === '2d' ? '2d' : '3d', desktopScalePercent, mobileScalePercent };
  const seoInput = input.seo === undefined ? defaultSiteContent.seo : input.seo;
  if (!seoInput || typeof seoInput !== 'object' || Array.isArray(seoInput)) return undefined;
  const seoFields = seoInput as Record<string, unknown>;
  const seo = {} as SiteContent['seo'];
  for (const page of ['home', 'services', 'catalogue', 'work', 'about', 'blog', 'contact'] as const) {
    const rawSeo = seoFields[page] === undefined ? defaultSiteContent.seo[page] : seoFields[page];
    if (!rawSeo || typeof rawSeo !== 'object' || Array.isArray(rawSeo)) return undefined;
    const fields = rawSeo as Record<string, unknown>;
    const defaults = defaultSiteContent.seo[page];
    const title = fields.title === undefined ? defaults.title : fields.title;
    const description = fields.description === undefined ? defaults.description : fields.description;
    const ogImage = fields.ogImage === undefined ? defaults.ogImage : fields.ogImage;
    if (typeof title !== 'string' || !title.trim() || title.length > 180 ||
      typeof description !== 'string' || !description.trim() || description.length > 320 ||
      typeof ogImage !== 'string' || ogImage.length > 2000) return undefined;
    if (ogImage) {
      try {
        const parsedImage = new URL(ogImage);
        if (parsedImage.protocol !== 'https:' || parsedImage.username || parsedImage.password) return undefined;
      } catch {
        if (!ogImage.startsWith('/') || ogImage.startsWith('//') || ogImage.includes('\\') ||
          /[\u0000-\u001f]/.test(ogImage)) return undefined;
      }
    }
    seo[page] = { title: title.trim(), description: description.trim(), ogImage: ogImage.trim() };
  }
  content.seo = seo;
  const navigationInput = input.navigation === undefined ? defaultSiteContent.navigation : input.navigation;
  const navigationIds = ['home', 'services', 'catalogue', 'work', 'about', 'blog', 'contact'];
  if (!Array.isArray(navigationInput) || navigationInput.length !== navigationIds.length) return undefined;
  const navigation = [];
  const seenNavigationIds = new Set<string>();
  for (const rawItem of navigationInput) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return undefined;
    const item = rawItem as Record<string, unknown>;
    if (typeof item.id !== 'string' || !navigationIds.includes(item.id) || seenNavigationIds.has(item.id) ||
      typeof item.label !== 'string' || !item.label.trim() || item.label.length > 60 ||
      typeof item.destination !== 'string' || item.destination.length > 2000 ||
      !isSafePublicDestination(item.destination)) return undefined;
    seenNavigationIds.add(item.id);
    navigation.push({ id: item.id, label: item.label.trim(), destination: item.destination.trim() });
  }
  if (navigationIds.some((id) => !seenNavigationIds.has(id))) return undefined;
  content.navigation = navigation as SiteContent['navigation'];
  const ctaDefaults = defaultSiteContent.ctaDestinations as Record<string, string>;
  const ctaInput = input.ctaDestinations === undefined ? ctaDefaults : input.ctaDestinations;
  if (!ctaInput || typeof ctaInput !== 'object' || Array.isArray(ctaInput)) return undefined;
  const ctaDestinations: Record<string, string> = {};
  for (const [id, fallback] of Object.entries(ctaDefaults)) {
    const destination = (ctaInput as Record<string, unknown>)[id] ?? fallback;
    if (typeof destination !== 'string' || destination.length > 2000 || !isSafePublicDestination(destination)) return undefined;
    ctaDestinations[id] = destination.trim();
  }
  content.ctaDestinations = ctaDestinations;
  const footerDefaults = defaultSiteContent.footerSettings;
  const rawFooter = input.footerSettings === undefined ? footerDefaults : input.footerSettings;
  if (!rawFooter || typeof rawFooter !== 'object' || Array.isArray(rawFooter)) return undefined;
  const footer = rawFooter as Record<string, unknown>;
  const footerText: Record<'phone' | 'email' | 'location' | 'hours', string> = {
    phone: footer.phone as string,
    email: footer.email as string,
    location: footer.location as string,
    hours: footer.hours as string,
  };
  const footerLimits = { phone: 80, email: 180, location: 500, hours: 180 } as const;
  for (const key of Object.keys(footerText) as (keyof typeof footerText)[]) {
    const raw = footer[key] === undefined ? footerDefaults[key] : footer[key];
    if (typeof raw !== 'string' || raw.length > footerLimits[key]) return undefined;
    footerText[key] = raw.trim();
  }
  const phoneDestination = footer.phoneDestination === undefined ? footerDefaults.phoneDestination : footer.phoneDestination;
  const emailDestination = footer.emailDestination === undefined ? footerDefaults.emailDestination : footer.emailDestination;
  const secondaryEmailDestination = footer.secondaryEmailDestination === undefined ? footerDefaults.secondaryEmailDestination : footer.secondaryEmailDestination;
  const mapDestination = footer.mapDestination === undefined ? footerDefaults.mapDestination : footer.mapDestination;
  const whatsappDestination = footer.whatsappDestination === undefined ? footerDefaults.whatsappDestination : footer.whatsappDestination;
  if (typeof phoneDestination !== 'string' || !isSafePublicDestination(phoneDestination) ||
    !phoneDestination.startsWith('tel:') || typeof emailDestination !== 'string' ||
    !isSafePublicDestination(emailDestination) || !emailDestination.startsWith('mailto:') ||
    typeof secondaryEmailDestination !== 'string' || !isSafePublicDestination(secondaryEmailDestination) ||
    !secondaryEmailDestination.startsWith('mailto:') || typeof mapDestination !== 'string' ||
    !isSafePublicDestination(mapDestination) || !mapDestination.startsWith('https:') ||
    typeof whatsappDestination !== 'string' || !isSafePublicDestination(whatsappDestination)) return undefined;
  const secondaryEmail = footer.secondaryEmail === undefined ? footerDefaults.secondaryEmail : footer.secondaryEmail;
  if (typeof secondaryEmail !== 'string' || secondaryEmail.length > 180) return undefined;
  const rawSocial = footer.socialLinks === undefined ? footerDefaults.socialLinks : footer.socialLinks;
  const socialIds = ['instagram', 'facebook', 'linkedin'];
  if (!Array.isArray(rawSocial) || rawSocial.length !== socialIds.length) return undefined;
  const socialLinks = [];
  const seenSocialIds = new Set<string>();
  for (const rawLink of rawSocial) {
    if (!rawLink || typeof rawLink !== 'object' || Array.isArray(rawLink)) return undefined;
    const link = rawLink as Record<string, unknown>;
    if (typeof link.id !== 'string' || !socialIds.includes(link.id) || seenSocialIds.has(link.id) ||
      typeof link.label !== 'string' || !link.label.trim() || link.label.length > 40 ||
      typeof link.destination !== 'string' || !link.destination.startsWith('https:') ||
      link.destination.length > 2000 || !isSafePublicDestination(link.destination)) return undefined;
    seenSocialIds.add(link.id);
    socialLinks.push({ id: link.id, label: link.label.trim(), destination: link.destination.trim() });
  }
  if (socialIds.some((id) => !seenSocialIds.has(id))) return undefined;
  content.footerSettings = {
    ...footerText,
    phoneDestination: phoneDestination.trim(),
    emailDestination: emailDestination.trim(),
    secondaryEmail: secondaryEmail.trim(),
    secondaryEmailDestination: secondaryEmailDestination.trim(),
    mapDestination: mapDestination.trim(),
    whatsappDestination: whatsappDestination.trim(),
    socialLinks: socialLinks as SiteContent['footerSettings']['socialLinks'],
  };
  for (const section of sections) {
    const rawFields = input[section] === undefined ? defaultSiteContent[section] : input[section];
    if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return undefined;
    const fields = rawFields as Record<string, unknown>;
    const defaults = defaultSiteContent[section] as Record<string, string>;
    const cleaned: Record<string, string> = {};
    for (const key of Object.keys(defaults)) {
      const field = fields[key] === undefined ? defaults[key] : fields[key];
      const max = limits[key] ?? 1000;
      if (typeof field !== 'string' || field.length > max) return undefined;
      if (key === 'videoUrl' && field.trim()) {
        try {
          const parsedUrl = new URL(field);
          if (parsedUrl.protocol !== 'https:') return undefined;
        } catch {
          if (!field.startsWith('/') || field.startsWith('//') || field.includes('\\')) return undefined;
        }
      }
      cleaned[key] = field.trim();
    }
    (content as unknown as Record<string, unknown>)[section] = cleaned;
  }
  const copyInput = input.copy === undefined ? DEFAULT_PUBLIC_COPY : input.copy;
  if (!copyInput || typeof copyInput !== 'object' || Array.isArray(copyInput)) return undefined;
  const rawCopy = copyInput as Record<string, unknown>;
  const copy: Record<string, string> = {};
  for (const field of PUBLIC_COPY_FIELDS) {
    const value = rawCopy[field.key] === undefined ? field.value : rawCopy[field.key];
    const limit = field.multiline ? 3000 : 500;
    if (typeof value !== 'string' || value.length > limit) return undefined;
    copy[field.key] = value.trim();
  }
  content.copy = copy;
  const legacyFaqs = Array.from({ length: 7 }, (_, index) => ({
    id: `faq-${index + 1}`,
    question: typeof rawCopy[`home.faqs.q${index + 1}`] === 'string'
      ? String(rawCopy[`home.faqs.q${index + 1}`]).trim()
      : frontendDefaultSiteContent.faqs[index].question,
    answer: typeof rawCopy[`home.faqs.a${index + 1}`] === 'string'
      ? String(rawCopy[`home.faqs.a${index + 1}`]).trim()
      : frontendDefaultSiteContent.faqs[index].answer,
  }));
  const rawFaqs = input.faqs === undefined ? legacyFaqs : input.faqs;
  if (!Array.isArray(rawFaqs) || rawFaqs.length > 20) return undefined;
  const faqIds = new Set<string>();
  const faqs: SiteContent['faqs'] = [];
  for (const rawFaq of rawFaqs) {
    if (!rawFaq || typeof rawFaq !== 'object' || Array.isArray(rawFaq)) return undefined;
    const faq = rawFaq as Record<string, unknown>;
    if (typeof faq.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(faq.id) || faqIds.has(faq.id) ||
      typeof faq.question !== 'string' || !faq.question.trim() || faq.question.length > 500 ||
      typeof faq.answer !== 'string' || !faq.answer.trim() || faq.answer.length > 3000) return undefined;
    faqIds.add(faq.id);
    faqs.push({ id: faq.id, question: faq.question.trim(), answer: faq.answer.trim() });
  }
  content.faqs = faqs;
  const mediaInput = input.media === undefined ? DEFAULT_PUBLIC_MEDIA : input.media;
  if (!mediaInput || typeof mediaInput !== 'object' || Array.isArray(mediaInput)) return undefined;
  const rawMedia = mediaInput as Record<string, unknown>;
  const media: SiteContent['media'] = {};
  for (const definition of PUBLIC_MEDIA) {
    const rawAsset = rawMedia[definition.id];
    const fallback = DEFAULT_PUBLIC_MEDIA[definition.id];
    if (rawAsset === undefined) {
      media[definition.id] = fallback;
      continue;
    }
    if (!rawAsset || typeof rawAsset !== 'object' || Array.isArray(rawAsset)) return undefined;
    const asset = rawAsset as Record<string, unknown>;
    const url = asset.url === undefined ? fallback.url : asset.url;
    const altText = asset.altText === undefined ? fallback.altText : asset.altText;
    const focalX = asset.focalX === undefined ? fallback.focalX : asset.focalX;
    const focalY = asset.focalY === undefined ? fallback.focalY : asset.focalY;
    const backgroundEnabled = asset.backgroundEnabled === undefined ? fallback.backgroundEnabled : asset.backgroundEnabled;
    const backgroundFit = asset.backgroundFit === undefined ? fallback.backgroundFit : asset.backgroundFit;
    const backgroundOpacity = asset.backgroundOpacity === undefined ? fallback.backgroundOpacity : asset.backgroundOpacity;
    const backgroundPositionX = asset.backgroundPositionX === undefined ? fallback.backgroundPositionX : asset.backgroundPositionX;
    const backgroundPositionY = asset.backgroundPositionY === undefined ? fallback.backgroundPositionY : asset.backgroundPositionY;
    let imageVariants: ThemeImageVariants | undefined;
    if (asset.imageVariants !== undefined) {
      if (definition.kind !== 'image' || !asset.imageVariants ||
        typeof asset.imageVariants !== 'object' || Array.isArray(asset.imageVariants)) return undefined;
      const rawVariants = asset.imageVariants as Record<string, unknown>;
      const parsedVariants: ThemeImageVariants = {};
      for (const theme of ['light', 'dark'] as const) {
        const rawVariant = rawVariants[theme];
        if (rawVariant === undefined) continue;
        if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) return undefined;
        const item = rawVariant as Record<string, unknown>;
        const variant: NonNullable<ThemeImageVariants['light']> = {};
        if (item.url !== undefined) {
          if (typeof item.url !== 'string' || item.url.length > 2048) return undefined;
          if (item.url) {
            try {
              const parsedUrl = new URL(item.url);
              const supabaseOrigin = new URL(process.env.SUPABASE_URL || '').origin;
              if (parsedUrl.origin !== supabaseOrigin ||
                !parsedUrl.pathname.startsWith('/storage/v1/object/public/site-media/')) return undefined;
            } catch {
              return undefined;
            }
          }
          variant.url = item.url;
        }
        if (item.altText !== undefined) {
          if (typeof item.altText !== 'string' || item.altText.length > 300) return undefined;
          variant.altText = item.altText.trim();
        }
        for (const key of ['focalX', 'focalY', 'backgroundOpacity', 'backgroundPositionX', 'backgroundPositionY'] as const) {
          const field = item[key];
          if (field === undefined) continue;
          if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 100) return undefined;
          variant[key] = field;
        }
        if (item.backgroundEnabled !== undefined) {
          if (typeof item.backgroundEnabled !== 'boolean' ||
            (item.backgroundEnabled && !definition.background)) return undefined;
          variant.backgroundEnabled = item.backgroundEnabled;
        }
        if (item.backgroundFit !== undefined) {
          if (item.backgroundFit !== 'cover' && item.backgroundFit !== 'contain') return undefined;
          variant.backgroundFit = item.backgroundFit;
        }
        parsedVariants[theme] = variant;
      }
      imageVariants = parsedVariants;
    }

    if (typeof url !== 'string' || url.length > 2048 ||
      typeof altText !== 'string' || altText.length > 300 ||
      typeof focalX !== 'number' || !Number.isFinite(focalX) || focalX < 0 || focalX > 100 ||
      typeof focalY !== 'number' || !Number.isFinite(focalY) || focalY < 0 || focalY > 100 ||
      typeof backgroundEnabled !== 'boolean' || (backgroundEnabled && !definition.background) ||
      (backgroundFit !== 'cover' && backgroundFit !== 'contain') ||
      typeof backgroundOpacity !== 'number' || !Number.isFinite(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 100 ||
      typeof backgroundPositionX !== 'number' || !Number.isFinite(backgroundPositionX) || backgroundPositionX < 0 || backgroundPositionX > 100 ||
      typeof backgroundPositionY !== 'number' || !Number.isFinite(backgroundPositionY) || backgroundPositionY < 0 || backgroundPositionY > 100) return undefined;
    if (url) {
      try {
        const parsedUrl = new URL(url);
        const supabaseOrigin = new URL(process.env.SUPABASE_URL || '').origin;
        if (parsedUrl.origin !== supabaseOrigin ||
          !parsedUrl.pathname.startsWith('/storage/v1/object/public/site-media/')) return undefined;
      } catch {
        return undefined;
      }
    }
    media[definition.id] = {
      url,
      altText: altText.trim(),
      focalX,
      focalY,
      backgroundEnabled,
      backgroundFit,
      backgroundOpacity,
      backgroundPositionX,
      backgroundPositionY,
      ...(imageVariants ? { imageVariants } : {}),
    };
  }
  content.media = media;
  const rawAnimations = input.animations === undefined ? defaultSiteContent.animations : input.animations;
  if (!rawAnimations || typeof rawAnimations !== 'object' || Array.isArray(rawAnimations)) return undefined;
  const animations = rawAnimations as Record<string, unknown>;
  const defaults = defaultSiteContent.animations;
  const color = (value: unknown, fallback: string): value is string =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) && value.length === fallback.length;
  const popupText = (value: unknown, fallback: string, maxLength: number): value is string =>
    typeof value === 'string' && value.length <= maxLength;
  const globeEnabled = animations.globeEnabled === undefined ? defaults.globeEnabled : animations.globeEnabled;
  const heroEnabled = animations.heroEnabled === undefined ? defaults.heroEnabled : animations.heroEnabled;
  const globeRotationSpeed = animations.globeRotationSpeed === undefined ? defaults.globeRotationSpeed : animations.globeRotationSpeed;
  const globeSize = animations.globeSize === undefined ? defaults.globeSize : animations.globeSize;
  const globePositionX = animations.globePositionX === undefined ? defaults.globePositionX : animations.globePositionX;
  const globePositionY = animations.globePositionY === undefined ? defaults.globePositionY : animations.globePositionY;
  const heroSpeed = animations.heroSpeed === undefined ? defaults.heroSpeed : animations.heroSpeed;
  const globeLandColor = animations.globeLandColor === undefined ? defaults.globeLandColor : animations.globeLandColor;
  const globeHighlightColor = animations.globeHighlightColor === undefined ? defaults.globeHighlightColor : animations.globeHighlightColor;
  const globeHighlightGlowColor = animations.globeHighlightGlowColor === undefined ? defaults.globeHighlightGlowColor : animations.globeHighlightGlowColor;
  const globeLightAppearance = normalizeGlobeLightAppearance(animations.globeLightAppearance);
  const globePopupTitle = animations.globePopupTitle === undefined ? defaults.globePopupTitle : animations.globePopupTitle;
  const globePopupDetail = animations.globePopupDetail === undefined ? defaults.globePopupDetail : animations.globePopupDetail;
  if (typeof globeEnabled !== 'boolean' || typeof heroEnabled !== 'boolean' ||
    typeof globeRotationSpeed !== 'number' || !Number.isFinite(globeRotationSpeed) || globeRotationSpeed < 0 || globeRotationSpeed > 200 ||
    typeof globeSize !== 'number' || !Number.isFinite(globeSize) || globeSize < 70 || globeSize > 110 ||
    typeof globePositionX !== 'number' || !Number.isFinite(globePositionX) || globePositionX < -5 || globePositionX > 5 ||
    typeof globePositionY !== 'number' || !Number.isFinite(globePositionY) || globePositionY < -5 || globePositionY > 5 ||
    typeof heroSpeed !== 'number' || !Number.isFinite(heroSpeed) || heroSpeed < 50 || heroSpeed > 150 ||
    !color(globeLandColor, defaults.globeLandColor) ||
    !color(globeHighlightColor, defaults.globeHighlightColor) ||
    !color(globeHighlightGlowColor, defaults.globeHighlightGlowColor) ||
    !globeLightAppearance ||
    !popupText(globePopupTitle, defaults.globePopupTitle, 80) ||
    !popupText(globePopupDetail, defaults.globePopupDetail, 120)) return undefined;
  content.animations = {
    globeEnabled,
    globeRotationSpeed,
    globeSize,
    globePositionX,
    globePositionY,
    globeLandColor,
    globeHighlightColor,
    globeHighlightGlowColor,
    globeLightAppearance,
    globePopupTitle: globePopupTitle.trim(),
    globePopupDetail: globePopupDetail.trim(),
    heroEnabled,
    heroSpeed,
  };
  return content;
}

interface SiteContentRecord {
  draft_content: unknown;
  published_content: unknown;
  published_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

async function readSiteContentRecord(): Promise<SiteContentRecord | undefined> {
  const query = new URLSearchParams({ select: 'draft_content,published_content,published_at,updated_at,updated_by', id: 'eq.true', limit: '1' });
  const response = await supabaseAdminRequest(`rest/v1/site_content_cms?${query}`);
  if (response.status === 404) {
    if (!warnedSiteContentMigrationMissing) {
      warnedSiteContentMigrationMissing = true;
      console.warn('[NearGrow Ads] Site content migration is not applied; serving the existing legacy site content until it is.');
    }
    return undefined;
  }
  if (!response.ok) throw new Error(`Site content database read failed (${response.status}).`);
  const rows = await response.json() as SiteContentRecord[];
  return rows[0];
}

async function readSiteContent(): Promise<SiteContent> {
  const row = await readSiteContentRecord();
  const published = row?.published_content ? validateSiteContent(row.published_content) : undefined;
  return published || (row?.published_content ? defaultSiteContent : await readLegacySiteContent());
}

async function readAdminSiteContent(): Promise<{
  draft: SiteContent;
  published: SiteContent;
  publishedAt: string | null;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
}> {
  const row = await readSiteContentRecord();
  const published = row?.published_content ? validateSiteContent(row.published_content) : undefined;
  const draft = row?.draft_content ? validateSiteContent(row.draft_content) : undefined;
  const content = await resolveSiteContentState(draft, published, readLegacySiteContent);
  return {
    draft: content.draft,
    published: content.published,
    publishedAt: row?.published_at || null,
    draftUpdatedAt: row?.updated_at || null,
    draftUpdatedBy: row?.updated_by || null,
  };
}

function validateMascotSettings(value: unknown): MascotSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Partial<MascotSettings>;
  const desktopScalePercent = input.desktopScalePercent;
  const mobileScalePercent = input.mobileScalePercent;
  const renderer = (input as Record<string, unknown>).renderer;
  if ((renderer !== undefined && renderer !== '3d' && renderer !== '2d') ||
    typeof desktopScalePercent !== 'number' || !Number.isInteger(desktopScalePercent) ||
    desktopScalePercent < MASCOT_SCALE_MIN || desktopScalePercent > MASCOT_SCALE_MAX ||
    typeof mobileScalePercent !== 'number' || !Number.isInteger(mobileScalePercent) ||
    mobileScalePercent < MASCOT_SCALE_MIN || mobileScalePercent > MASCOT_SCALE_MAX) return undefined;
  return { renderer: renderer === '2d' ? '2d' : '3d', desktopScalePercent, mobileScalePercent };
}

function sameMascotSettings(left: MascotSettings, right: MascotSettings): boolean {
  return left.renderer === right.renderer &&
    left.desktopScalePercent === right.desktopScalePercent &&
    left.mobileScalePercent === right.mobileScalePercent;
}

function mascotSettingsAdminPayload(state: Awaited<ReturnType<typeof readAdminSiteContent>>) {
  return {
    settings: state.draft.mascotSettings,
    publishedSettings: state.published.mascotSettings,
    publishedAt: state.publishedAt,
    draftUpdatedAt: state.draftUpdatedAt,
    draftUpdatedBy: state.draftUpdatedBy,
    canPublish: state.publishedAt !== null,
  };
}

function expectedMascotDraftVersion(req: Request, res: Response): string | null | undefined {
  const header = req.get('X-Draft-Updated-At');
  if (header === undefined) {
    res.status(428).json({ message: 'Reload the current mascot draft before saving; its version is required to prevent overwriting another editor.' });
    return undefined;
  }
  const expected = header === 'none' ? null : header;
  if (expected !== null && !Number.isFinite(Date.parse(expected))) {
    res.status(400).json({ message: 'The mascot draft version is invalid. Reload the current draft and try again.' });
    return undefined;
  }
  return expected;
}

async function saveMascotSettingsDraft(
  settings: MascotSettings,
  expectedUpdatedAt: string | null,
  actorId: string,
  actorLabel: string,
): Promise<{ conflict: true; updatedAt?: string } | { conflict: false; state: Awaited<ReturnType<typeof readAdminSiteContent>> }> {
  const current = await readAdminSiteContent();
  const result = await writeSiteContentDraft(
    { ...current.draft, mascotSettings: settings },
    actorId,
    actorLabel,
    expectedUpdatedAt,
  );
  if (result.conflict) return { conflict: true, updatedAt: result.updatedAt };
  if (!result.content) throw new Error('Mascot draft save completed without a valid version.');
  return { conflict: false, state: await readAdminSiteContent() };
}

const siteContentDraftSchemaMessage =
  'Supabase cannot resolve the concurrency-safe site-content draft-save function (PGRST202). Verify that supabase/migrations/20261026120000_prevent_site_content_draft_overwrites.sql is applied to this project, then reload the Supabase API schema and retry.';

async function writeSiteContentDraft(
  content: SiteContent,
  actorId: string,
  actorLabel: string,
  expectedUpdatedAt: string | null,
): Promise<{ content?: SiteContent; updatedAt?: string; conflict?: boolean }> {
  const response = await supabaseAdminRequest('rest/v1/rpc/save_site_content_draft', {
    method: 'POST',
    body: JSON.stringify({
      p_content: content,
      p_actor_id: actorId,
      p_actor_label: actorLabel,
      p_expected_updated_at: expectedUpdatedAt,
    }),
  });
  if (!response.ok) {
    const details = await response.text();
    const databaseCode = details.match(/"code"\s*:\s*"([A-Z0-9]+)"/)?.[1];
    if (response.status === 404 || databaseCode === 'PGRST202') {
      throw new Error(siteContentDraftSchemaMessage);
    }
    throw new Error(`Site content draft save failed (${response.status}${databaseCode ? `, ${databaseCode}` : ''}).`);
  }
  const result = await response.json() as { content?: unknown; updated_at?: unknown; conflict?: unknown };
  if (result.conflict === true) {
    return {
      conflict: true,
      ...(typeof result.updated_at === 'string' ? { updatedAt: result.updated_at } : {}),
    };
  }
  const saved = result.content ? validateSiteContent(result.content) : undefined;
  if (!saved || typeof result.updated_at !== 'string') throw new Error('Site content draft save returned invalid content or timestamp.');
  return { content: saved, updatedAt: result.updated_at };
}

async function publishSiteContent(actorId: string): Promise<{ content: SiteContent; publishedAt: string }> {
  const response = await supabaseAdminRequest('rest/v1/rpc/publish_site_content', {
    method: 'POST',
    body: JSON.stringify({ p_actor_id: actorId }),
  });
  if (!response.ok) throw new Error(`Site content publish failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const result = await response.json() as { content?: unknown; published_at?: string } | null;
  const content = result?.content ? validateSiteContent(result.content) : undefined;
  if (!content || typeof result?.published_at !== 'string') throw new Error('Site content publish returned no published version.');
  return { content, publishedAt: result.published_at };
}

async function listSiteContentRevisions(): Promise<Array<{ id: number; action: string; actorLabel: string; createdAt: string }>> {
  const query = new URLSearchParams({
    select: 'id,action,actor_label,created_at',
    order: 'created_at.desc',
    limit: '50',
  });
  const response = await supabaseAdminRequest(`rest/v1/site_content_revisions?${query}`);
  if (response.status === 404) throw new Error('The Page Content revision migration has not been applied.');
  if (!response.ok) throw new Error(`Site content revision history read failed (${response.status}).`);
  const rows = await response.json() as Array<{ id: number; action: string; actor_label: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorLabel: row.actor_label || 'Administrator',
    createdAt: row.created_at,
  }));
}

async function restoreSiteContentRevision(revisionId: number, actorId: string, actorLabel: string): Promise<SiteContent | undefined> {
  const response = await supabaseAdminRequest('rest/v1/rpc/restore_site_content_revision', {
    method: 'POST',
    body: JSON.stringify({ p_revision_id: revisionId, p_actor_id: actorId, p_actor_label: actorLabel }),
  });
  if (!response.ok) throw new Error(`Site content version restore failed (${response.status}).`);
  const result = await response.json() as { content?: unknown } | null;
  const restored = result?.content ? validateSiteContent(result.content) : undefined;
  return restored;
}

async function discardSiteContentDraft(actorId: string, actorLabel: string): Promise<SiteContent | undefined> {
  const response = await supabaseAdminRequest('rest/v1/rpc/discard_site_content_draft', {
    method: 'POST',
    body: JSON.stringify({ p_actor_id: actorId, p_actor_label: actorLabel }),
  });
  if (!response.ok) throw new Error(`Site content draft discard failed (${response.status}).`);
  const result = await response.json() as { content?: unknown } | null;
  const discarded = result?.content ? validateSiteContent(result.content) : undefined;
  return discarded;
}

async function readTeam(): Promise<TeamMember[]> {
  try {
    const parsed = await readCmsDocument<unknown>('team', teamDataFile);
    if (parsed === undefined) return memoryTeam;
    if (Array.isArray(parsed)) return parsed as TeamMember[];
  } catch (error) {
    if (process.env.VERCEL === '1') throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[NearGrow Ads] Team store read error:', error);
  }
  return memoryTeam;
}

async function writeTeam(members: TeamMember[]): Promise<void> {
  await writeCmsDocument('team', teamDataFile, members);
  memoryTeam = members;
}

function validateTeam(body: unknown): { members?: TeamMember[]; message?: string } {
  const list = (body as { members?: unknown })?.members;
  if (!Array.isArray(list) || list.length > 40) return { message: 'Send a list of up to 40 team members.' };
  const ids = new Set<string>();
  const members: TeamMember[] = [];
  for (const raw of list) {
    const m = raw as Partial<TeamMember>;
    const label = typeof m?.name === 'string' && m.name.trim() ? m.name.trim() : 'A profile';
    if (typeof m?.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(m.id) || ids.has(m.id)) return { message: `${label} has an invalid or duplicate ID.` };
    ids.add(m.id);
    if (m.group !== 'mentor' && m.group !== 'core') return { message: `${label} needs a group.` };
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) return { message: 'Every profile needs a name (max 80 characters).' };
    if (typeof m.role !== 'string' || !m.role.trim() || m.role.length > 100) return { message: `${label} needs a role (max 100 characters).` };
    if (typeof m.bio !== 'string' || m.bio.length > 320) return { message: `${label}: bio must be 320 characters or fewer.` };
    if (m.tag !== undefined && (typeof m.tag !== 'string' || m.tag.length > 40)) return { message: `${label}: expertise tag is too long.` };
    const socialUrl = normalizeTeamUrl(m.socialUrl);
    if (socialUrl === null) return { message: `${label}: enter a valid HTTP or HTTPS LinkedIn or portfolio URL.` };
    if (!isSupportedTeamPhotoReference(m.imageUrl)) return { message: `${label}: photo must be empty, an uploaded image or an https link.` };
    members.push({
      id: m.id, group: m.group, name: m.name.trim(), role: m.role.trim(), tag: (m.tag ?? '').trim(), bio: m.bio.trim(),
      imageUrl: m.imageUrl, socialUrl, order: Number.isFinite(m.order) ? Math.max(0, Math.trunc(m.order as number)) : 0,
      visible: m.visible !== false,
    });
  }
  return { members };
}

/** Identify the real image type from its first bytes — never trust the client's Content-Type or filename. */
function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | undefined {
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return undefined;
}

function sniffVideo(buf: Buffer): 'mp4' | 'webm' | undefined {
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length > 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return undefined;
}

type AdminUploadPurpose = 'blog' | 'team' | 'service-store' | 'case-study' | 'site-media' | 'website-service';
type AdminUploadSpec = {
  purpose: AdminUploadPurpose;
  section: AdminSection;
  bucket: 'cms-uploads' | 'case-study-media' | 'site-media';
  objectPath: string;
  mimeType: string;
  extension: string;
  maxSize: number;
};

const uploadExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function createAdminUploadSpec(input: unknown): AdminUploadSpec | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const body = input as Record<string, unknown>;
  const purpose = body.purpose;
  const mimeType = body.mimeType;
  if (typeof purpose !== 'string' || typeof mimeType !== 'string') return undefined;
  const extension = uploadExtensions[mimeType];
  if (!extension) return undefined;

  if (purpose === 'blog' || purpose === 'team' || purpose === 'service-store') {
    if (!mimeType.startsWith('image/')) return undefined;
    return {
      purpose,
      section: purpose === 'blog' ? 'blogs' : purpose === 'team' ? 'team' : 'serviceStore',
      bucket: 'cms-uploads',
      objectPath: `${purpose === 'service-store' ? 'service-store' : purpose}/${randomUUID()}.${extension}`,
      mimeType,
      extension,
      maxSize: 15 * 1024 * 1024,
    };
  }
  if (purpose === 'case-study') {
    if (mimeType !== 'image/png' && mimeType !== 'image/webp') return undefined;
    return {
      purpose,
      section: 'caseStudies',
      bucket: 'case-study-media',
      objectPath: `${randomUUID()}.${extension}`,
      mimeType,
      extension,
      maxSize: 15 * 1024 * 1024,
    };
  }
  if (purpose === 'website-service') {
    if (!WEBSITE_SERVICE_UUID.test(String(body.serviceId || '')) || !mimeType.startsWith('image/')) return undefined;
    return {
      purpose,
      section: 'servicesManagement',
      bucket: 'site-media',
      objectPath: `website-services/${body.serviceId}/${randomUUID()}.${extension}`,
      mimeType,
      extension,
      maxSize: 15 * 1024 * 1024,
    };
  }
  if (purpose === 'site-media') {
    const definition = typeof body.assetId === 'string'
      ? PUBLIC_MEDIA.find((item) => item.id === body.assetId)
      : undefined;
    if (!definition || (definition.kind === 'image' && !mimeType.startsWith('image/')) ||
      (definition.kind === 'video' && !mimeType.startsWith('video/'))) return undefined;
    return {
      purpose,
      section: 'content',
      bucket: 'site-media',
      objectPath: `${definition.id}/${randomUUID()}.${extension}`,
      mimeType,
      extension,
      maxSize: definition.kind === 'video' ? 100 * 1024 * 1024 : 15 * 1024 * 1024,
    };
  }
  return undefined;
}

function isValidUploadObjectPath(spec: AdminUploadSpec, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const uuidFile = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const prefix = spec.objectPath.slice(0, spec.objectPath.lastIndexOf('/') + 1);
  return value.startsWith(prefix) && new RegExp(`^${uuidFile}\\.${spec.extension}$`, 'i')
    .test(value.slice(prefix.length));
}

function verifiedUploadUrl(spec: AdminUploadSpec, objectPath: string): string {
  if (spec.bucket === 'cms-uploads') {
    const folder = spec.purpose === 'service-store' ? 'service-store' : spec.purpose;
    return `/uploads/${folder}/${objectPath.split('/').pop()}`;
  }
  if (spec.purpose === 'case-study') return `/api/admin/case-studies/media/${objectPath}`;
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Supabase Storage is not configured.');
  return `${baseUrl}/storage/v1/object/public/site-media/${objectPath}`;
}

async function prepareAdminUpload(input: unknown): Promise<{ uploadUrl: string; path: string; url: string; spec: AdminUploadSpec } | undefined> {
  const spec = createAdminUploadSpec(input);
  if (!spec) return undefined;
  const body = input as Record<string, unknown>;
  if (!Number.isSafeInteger(body.size) || Number(body.size) < 1 || Number(body.size) > spec.maxSize) return undefined;
  const path = spec.objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await supabaseAdminRequest(`storage/v1/object/upload/sign/${spec.bucket}/${path}`, {
    method: 'POST',
    headers: { 'x-upsert': 'false' },
  });
  if (!response.ok) {
    console.error(`[NearGrow Ads] Signed upload URL creation failed (${response.status}).`);
    throw new Error('Supabase Storage could not prepare the media upload.');
  }
  const result = await response.json() as { url?: string; signedUrl?: string };
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Supabase Storage is not configured.');
  const signedUrl = result.signedUrl || result.url;
  const uploadUrl = signedUrl
    ? /^https?:\/\//i.test(signedUrl)
      ? signedUrl
      : `${baseUrl}/storage/v1${signedUrl.startsWith('/') ? signedUrl : `/${signedUrl}`}`
    : undefined;
  if (!uploadUrl) throw new Error('Supabase Storage returned an invalid signed upload response.');
  const parsedUploadUrl = new URL(uploadUrl);
  const expectedPath = `/storage/v1/object/upload/sign/${spec.bucket}/${path}`;
  if (parsedUploadUrl.origin !== new URL(baseUrl).origin ||
    parsedUploadUrl.pathname !== expectedPath ||
    !parsedUploadUrl.searchParams.has('token')) {
    throw new Error('Supabase Storage returned an unexpected signed upload URL.');
  }
  return { uploadUrl, path: spec.objectPath, url: verifiedUploadUrl(spec, spec.objectPath), spec };
}

async function verifyAdminUpload(input: unknown): Promise<string | undefined> {
  const spec = createAdminUploadSpec(input);
  if (!spec) return undefined;
  const body = input as Record<string, unknown>;
  if (!isValidUploadObjectPath(spec, body.path)) return undefined;
  if (!Number.isSafeInteger(body.size) || Number(body.size) < 1 || Number(body.size) > spec.maxSize) return undefined;
  const encodedPath = body.path.split('/').map(encodeURIComponent).join('/');
  const objectUrl = `storage/v1/object/${spec.bucket}/${encodedPath}`;
  const head = await supabaseAdminRequest(objectUrl, { method: 'HEAD' });
  const contentLength = Number(head.headers.get('content-length'));
  const storedType = head.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!head.ok || contentLength !== body.size || contentLength > spec.maxSize || storedType !== spec.mimeType) {
    await supabaseAdminRequest(objectUrl, { method: 'DELETE' }).catch(() => undefined);
    return undefined;
  }
  const sampleResponse = await supabaseAdminRequest(objectUrl, { headers: { Range: 'bytes=0-15' } });
  if (!sampleResponse.ok) return undefined;
  const reader = sampleResponse.body?.getReader();
  if (!reader) return undefined;
  let sample = Buffer.alloc(0);
  try {
    while (sample.length < 16) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      sample = Buffer.concat([sample, Buffer.from(value)]).subarray(0, 16);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const actualExtension = spec.mimeType.startsWith('image/')
    ? sniffImage(sample)
    : sniffVideo(sample);
  if (actualExtension !== spec.extension) {
    await supabaseAdminRequest(objectUrl, { method: 'DELETE' }).catch(() => undefined);
    return undefined;
  }
  return verifiedUploadUrl(spec, body.path);
}

async function uploadSiteMedia(req: Request): Promise<{ url: string } | { message: string }> {
  const contentType = req.headers['content-type'];
  if (!Buffer.isBuffer(req.body) || typeof contentType !== 'string' || !contentType.startsWith('multipart/form-data;')) {
    return { message: 'Send the selected media as multipart/form-data.' };
  }

  let formData: FormData;
  try {
    const multipartRequest = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(req.body),
    });
    formData = await multipartRequest.formData();
  } catch {
    return { message: 'The media upload is malformed. Please select the file again.' };
  }

  const assetId = formData.get('assetId');
  const file = formData.get('media');
  const definition = typeof assetId === 'string' ? PUBLIC_MEDIA.find((item) => item.id === assetId) : undefined;
  if (!definition || !(file instanceof File)) return { message: 'Choose a supported media field and file.' };

  const maxSize = definition.kind === 'video' ? 100 * 1024 * 1024 : 15 * 1024 * 1024;
  if (file.size < 1 || file.size > maxSize) {
    return { message: definition.kind === 'video'
      ? 'Upload an MP4 or WebM video no larger than 100 MB.'
      : 'Upload a JPG, PNG or WebP image no larger than 15 MB.' };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = definition.kind === 'image' ? sniffImage(bytes) : sniffVideo(bytes);
  if (!extension) {
    return { message: definition.kind === 'video'
      ? 'The uploaded file is not a valid MP4 or WebM video.'
      : 'The uploaded file is not a valid PNG, JPG or WebP image.' };
  }

  const mimeType = extension === 'jpg' ? 'image/jpeg'
    : extension === 'png' ? 'image/png'
      : extension === 'webp' ? 'image/webp'
        : extension === 'mp4' ? 'video/mp4' : 'video/webm';
  const objectPath = `${definition.id}/${randomUUID()}.${extension}`;
  const response = await supabaseAdminRequest(`storage/v1/object/site-media/${objectPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!response.ok) {
    console.error(`[NearGrow Ads] Site media storage upload failed (${response.status}).`);
    return { message: 'Media storage is unavailable. Confirm the site-media storage migration has been applied.' };
  }
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Supabase Storage is not configured.');
  return { url: `${baseUrl}/storage/v1/object/public/site-media/${objectPath}` };
}

async function uploadWebsiteServiceImage(req: Request): Promise<{ url: string } | { message: string }> {
  const contentType = req.headers['content-type'];
  if (!Buffer.isBuffer(req.body) || typeof contentType !== 'string' || !contentType.startsWith('multipart/form-data;')) {
    return { message: 'Send the image as multipart/form-data.' };
  }
  let formData: FormData;
  try {
    const multipartRequest = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(req.body),
    });
    formData = await multipartRequest.formData();
  } catch {
    return { message: 'The background image upload is malformed. Please select it again.' };
  }
  const serviceId = formData.get('serviceId');
  const file = formData.get('image');
  if (typeof serviceId !== 'string' || !WEBSITE_SERVICE_UUID.test(serviceId) || !(file instanceof File)) {
    return { message: 'Choose a valid service and an image file.' };
  }
  if (file.size < 1 || file.size > 15 * 1024 * 1024) {
    return { message: 'Upload a JPG, PNG or WebP image no larger than 15 MB.' };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = sniffImage(bytes);
  if (!extension) return { message: 'The uploaded file is not a valid PNG, JPG or WebP image.' };
  const mimeType = extension === 'jpg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : 'image/webp';
  const objectPath = `website-services/${serviceId}/${randomUUID()}.${extension}`;
  const response = await supabaseAdminRequest(`storage/v1/object/site-media/${objectPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!response.ok) {
    console.error(`[NearGrow Ads] Website service media upload failed (${response.status}).`);
    return { message: 'Image storage is unavailable. Confirm the site-media storage migration has been applied.' };
  }
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Supabase Storage is not configured.');
  return { url: `${baseUrl}/storage/v1/object/public/site-media/${objectPath}` };
}

async function storeMultipartImage(req: Request, directory: string): Promise<{ url: string } | { message: string }> {
  const body = req.body as unknown;
  const contentType = req.headers['content-type'];
  if (!Buffer.isBuffer(body) || typeof contentType !== 'string' || !contentType.startsWith('multipart/form-data;')) {
    return { message: 'Send the image as multipart/form-data using the "image" field.' };
  }
  let formData: FormData;
  try {
    const multipartRequest = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(body),
    });
    formData = await multipartRequest.formData();
  } catch {
    return { message: 'The multipart image upload is malformed. Please select the image again.' };
  }
  const file = formData.get('image');
  if (!(file instanceof File)) return { message: 'Choose an image file to upload.' };
  if (file.size < 1 || file.size > 15 * 1024 * 1024) return { message: 'Upload a JPG, PNG or WebP image no larger than 15 MB.' };
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = sniffImage(bytes);
  if (!extension) return { message: 'The uploaded file is not a valid PNG, JPG or WebP image.' };

  const filename = `${randomUUID()}.${extension}`;
  if (process.env.VERCEL === '1') {
    const folder = path.basename(directory);
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    const response = await supabaseAdminRequest(`storage/v1/object/cms-uploads/${folder}/${filename}`, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-upsert': 'false',
      },
      body: bytes,
    });
    if (!response.ok) {
      console.error(`[NearGrow Ads] CMS image upload failed (${folder}, ${response.status}).`);
      return { message: 'Image storage is unavailable. Confirm the CMS uploads migration has been applied.' };
    }
    return { url: `/uploads/${folder}/${filename}` };
  }

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), bytes, { flag: 'wx' });
  return { url: `/uploads/${path.basename(directory)}/${filename}` };
}

async function cmsUploadExists(folder: string, filename: string): Promise<boolean> {
  if (!['blog', 'team', 'service-store'].includes(folder) ||
    !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(filename)) return false;
  if (process.env.VERCEL !== '1') {
    try {
      await fs.access(path.join(persistentDataRoot, 'uploads', folder, filename));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  const response = await supabaseAdminRequest(`storage/v1/object/cms-uploads/${folder}/${filename}`, { method: 'HEAD' });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`CMS upload lookup failed (${response.status}).`);
  return true;
}

async function uploadCaseStudyImage(req: Request): Promise<{ url: string } | { message: string }> {
  const contentType = req.headers['content-type'];
  if (!Buffer.isBuffer(req.body) || typeof contentType !== 'string' || !contentType.startsWith('multipart/form-data;')) {
    return { message: 'Send the image as multipart/form-data using the "image" field.' };
  }
  let formData: FormData;
  try {
    formData = await new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(req.body),
    }).formData();
  } catch {
    return { message: 'The multipart image upload is malformed. Please select the image again.' };
  }
  const file = formData.get('image');
  if (!(file instanceof File)) return { message: 'Choose a PNG or WebP image to upload.' };
  if (file.size < 1 || file.size > 15 * 1024 * 1024) return { message: 'Upload a PNG or WebP image no larger than 15 MB.' };
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = sniffImage(bytes);
  if (extension !== 'png' && extension !== 'webp') {
    return { message: 'The uploaded file must be a valid PNG or WebP image.' };
  }
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Supabase Storage is not configured.');
  const objectKey = `${randomUUID()}.${extension}`;
  const storageResponse = await supabaseAdminRequest(`storage/v1/object/case-study-media/${objectKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': extension === 'png' ? 'image/png' : 'image/webp',
      'Cache-Control': '31536000',
      'x-upsert': 'false',
    },
    body: new Uint8Array(bytes),
  });
  if (!storageResponse.ok) {
    const detail = (await storageResponse.text()).slice(0, 300);
    throw new Error(`Case study image storage failed (${storageResponse.status}): ${detail}`);
  }
  return { url: `/api/admin/case-studies/media/${objectKey}` };
}

async function readCaseStudyImage(objectKey: string): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  const response = await supabaseAdminRequest(`storage/v1/object/case-study-media/${objectKey}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new CaseStudyStorageError(response.status, 'image_read_failed');
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: objectKey.endsWith('.png') ? 'image/png' : 'image/webp',
  };
}

type AdminRole = 'owner' | 'super_admin' | 'custom_admin';
type AdminSection = 'dashboard' | 'leads' | 'serviceStore' | 'content' | 'mascot' | 'caseStudies' | 'servicesManagement' | 'blogs' | 'team' | 'categories' | 'securityMonitoring' | 'settings';
type AdminAction = 'view' | 'create' | 'edit' | 'delete' | 'publish' | 'export';
type AdminPermissions = Partial<Record<AdminSection, Partial<Record<AdminAction, boolean>>>>;

interface AdminIdentity {
  id: string;
  email: string;
  role: AdminRole;
  status: 'pending' | 'active' | 'disabled';
  permissions: AdminPermissions;
  isPrimaryOwner: boolean;
  username?: string;
  mustChangePassword?: boolean;
}

interface AdminSessionToken {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

const adminSectionActions: Record<AdminSection, AdminAction[]> = {
  dashboard: ['view'],
  leads: ['view', 'edit', 'export'],
  serviceStore: ['view', 'create', 'edit', 'delete', 'publish'],
  content: ['view', 'edit'],
  mascot: ['view', 'edit', 'publish'],
  caseStudies: ['view', 'create', 'edit', 'delete', 'publish'],
  servicesManagement: ['view', 'create', 'edit', 'delete', 'publish'],
  blogs: ['view', 'create', 'edit', 'delete', 'publish'],
  team: ['view', 'create', 'edit', 'delete'],
  categories: ['view', 'create', 'edit', 'delete'],
  securityMonitoring: ['view', 'edit'],
  settings: ['view'],
};

function adminConfigIssues(): string[] {
  const issues: string[] = [];
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    issues.push('SUPABASE_URL is not set.');
  } else {
    try {
      if (!['http:', 'https:'].includes(new URL(supabaseUrl).protocol)) issues.push('SUPABASE_URL must use HTTP or HTTPS.');
    } catch {
      issues.push('SUPABASE_URL is not a valid URL.');
    }
  }
  if (!process.env.SUPABASE_ANON_KEY) issues.push('SUPABASE_ANON_KEY is not set.');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) issues.push('SUPABASE_SERVICE_ROLE_KEY is not set.');
  if (!process.env.ADMIN_OWNER_USER_ID ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.env.ADMIN_OWNER_USER_ID)) {
    issues.push('ADMIN_OWNER_USER_ID must be the verified Owner account UUID.');
  }
  if (!process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET.length < 32) {
    issues.push('ADMIN_SESSION_SECRET must be at least 32 characters.');
  }
  return issues;
}

function adminConfigIsReady(): boolean {
  return adminConfigIssues().length === 0;
}

function adminSignature(payload: string): string {
  return createHmac('sha256', process.env.ADMIN_SESSION_SECRET || '').update(payload).digest('base64url');
}

function setAdminSessionCookie(
  req: Request,
  res: Response,
  sessionId: string,
  userId: string,
  expiresAt: string,
): void {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) throw new Error('The admin session expiry returned by Supabase is invalid.');
  const payload = Buffer.from(JSON.stringify({ sessionId, userId, expiresAt: expiresAtMs })).toString('base64url');
  res.cookie(ADMIN_SESSION_COOKIE, `${payload}.${adminSignature(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.secure,
    sameSite: 'strict',
    path: '/api/admin',
    expires: new Date(expiresAtMs),
  });
}

function safeStringEqual(supplied: string, expected: string): boolean {
  const suppliedHash = createHash('sha256').update(supplied).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

function readAdminSession(req: Request): AdminSessionToken | undefined {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.slice(ADMIN_SESSION_COOKIE.length + 1);
  if (!cookie) return undefined;

  const [payload, signature] = cookie.split('.');
  if (!payload || !signature || !safeStringEqual(signature, adminSignature(payload))) return undefined;
  try {
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AdminSessionToken>;
    if (
      typeof token.sessionId !== 'string' ||
      typeof token.userId !== 'string' ||
      typeof token.expiresAt !== 'number' ||
      !Number.isFinite(token.expiresAt)
    ) return undefined;
    return token as AdminSessionToken;
  } catch {
    return undefined;
  }
}

async function supabaseAdminRequest(pathname: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error('Supabase Auth and database are not configured on the server.');
  return fetch(`${baseUrl.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

async function supabaseAuthRequest(pathname: string, init: RequestInit = {}, accessToken?: string): Promise<globalThis.Response> {
  const baseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase Auth is not configured on the server.');
  return fetch(`${baseUrl.replace(/\/+$/, '')}/auth/v1/${pathname.replace(/^\/+/, '')}`, {
    ...init,
    headers: {
      apikey: anonKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

class SupabaseRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly providerMessage: string,
  ) {
    super(`Supabase request failed (${status}${code ? `, ${code}` : ''}).`);
    this.name = 'SupabaseRequestError';
  }
}

function safeProviderText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 500)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token]');
}

async function readSupabaseJson<T>(response: globalThis.Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // Retain the HTTP status if the provider response is not JSON.
    }
    const rawCode = body.code ?? body.error_code;
    const code = typeof rawCode === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(rawCode) ? rawCode : undefined;
    const providerMessage = safeProviderText(body.message ?? body.msg ?? body.error_description ?? body.error);
    throw new SupabaseRequestError(response.status, code, providerMessage);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Supabase returned a non-JSON response (${response.status}).`);
  }
}

function isMissingAdminAccountManagementSchema(error: unknown): boolean {
  return error instanceof Error &&
    /(?:column .* (?:does not exist|not found)|could not find .* column|PGRST204|42703)/i.test(error.message) &&
    /admin_users|username|must_change_password|last_login_at|last_password_reset_at/i.test(error.message);
}

function warnAdminAccountMigrationMissing(error: unknown): void {
  if (warnedAdminAccountMigrationMissing) return;
  warnedAdminAccountMigrationMissing = true;
  console.warn('[NearGrow Ads] Admin account-management migration is not applied. Email/password sign-in remains available; username aliases and Settings account-management features require supabase/migrations/20261020000000_admin_account_management.sql.');
  if (!(error instanceof Error)) console.warn('[NearGrow Ads] Admin schema check returned an unknown error.');
}

async function readAdminIdentity(userId: string): Promise<AdminIdentity | undefined> {
  const query = new URLSearchParams({
    id: `eq.${userId}`,
    select: 'id,email,role,status,permissions,is_primary_owner',
    limit: '1',
  });
  const response = await supabaseAdminRequest(`rest/v1/admin_users?${query}`);
  const rows = await readSupabaseJson<Array<Record<string, unknown>>>(response);
  const row = rows[0];
  if (!row || !['owner', 'super_admin', 'custom_admin'].includes(String(row.role)) ||
    !['pending', 'active', 'disabled'].includes(String(row.status))) return undefined;
  const identity: AdminIdentity = {
    id: String(row.id),
    email: String(row.email),
    role: row.role as AdminRole,
    status: row.status as AdminIdentity['status'],
    permissions: row.permissions && typeof row.permissions === 'object' ? row.permissions as AdminPermissions : {},
    isPrimaryOwner: row.is_primary_owner === true && row.role === 'owner',
  };
  const accountDetailsQuery = new URLSearchParams({
    id: `eq.${userId}`,
    select: 'username,must_change_password',
    limit: '1',
  });
  try {
    const details = await readSupabaseJson<Array<{ username?: string | null; must_change_password?: boolean }>>(
      await supabaseAdminRequest(`rest/v1/admin_users?${accountDetailsQuery}`),
    );
    if (typeof details[0]?.username === 'string') identity.username = details[0].username;
    identity.mustChangePassword = details[0]?.must_change_password === true;
  } catch (error) {
    if (!isMissingAdminAccountManagementSchema(error)) throw error;
    warnAdminAccountMigrationMissing(error);
  }
  return identity;
}

async function authenticateAdminSession(req: Request): Promise<AdminIdentity | undefined> {
  const token = readAdminSession(req);
  if (!token) return undefined;
  const activeSessions = await readSupabaseJson<Array<{ session_id: string }>>(
    await supabaseAdminRequest('rest/v1/rpc/get_active_admin_session', {
      method: 'POST',
      body: JSON.stringify({ p_session_id: token.sessionId, p_user_id: token.userId }),
    }),
  );
  if (!activeSessions.length) return undefined;
  const identity = await readAdminIdentity(token.userId);
  return identity?.status === 'active' ? identity : undefined;
}

function currentAdmin(res: Response): AdminIdentity | undefined {
  return res.locals.adminIdentity as AdminIdentity | undefined;
}

function isSameOriginRequest(req: Request): boolean {
  const origin = req.header('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function requireAdmin(_req: Request, res: Response): boolean {
  res.setHeader('Cache-Control', 'no-store');
  if (!currentAdmin(res)) {
    res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
    return false;
  }
  return true;
}

function requireOwner(req: Request, res: Response): boolean {
  if (!requireAdmin(req, res)) return false;
  if (currentAdmin(res)?.isPrimaryOwner !== true) {
    res.status(403).json({ message: 'Only the Primary Owner can perform this account-governance action.' });
    return false;
  }
  return true;
}

function requireMascotPermission(res: Response, action: 'view' | 'edit' | 'publish'): AdminIdentity | undefined {
  const identity = currentAdmin(res);
  if (!identity) {
    res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
    return undefined;
  }
  if (!hasPermission(identity, 'mascot', action)) {
    res.status(403).json({ message: `Your role does not have permission to ${action} mascot settings.` });
    return undefined;
  }
  return identity;
}

function hasPermission(identity: AdminIdentity, section: AdminSection, action: AdminAction): boolean {
  if (identity.role === 'owner') return true;
  if (action !== 'view' && identity.permissions[section]?.view !== true) return false;
  return identity.permissions[section]?.[action] === true;
}

function hasSecurityMonitoringAccess(identity: AdminIdentity, action: 'view' | 'edit'): boolean {
  return canAccessSecurityMonitoring(identity, action);
}

function requiredAdminPermission(req: Request): { section: AdminSection; action: AdminAction } | undefined {
  const pathName = req.path;
  if (pathName === '/uploads/sign' || pathName === '/uploads/complete') {
    const upload = createAdminUploadSpec(req.body);
    return upload ? { section: upload.section, action: 'edit' } : undefined;
  }
  const blogSeoPermission = blogSeoAdminPermission(pathName, req.method);
  if (blogSeoPermission) return blogSeoPermission;
  if (pathName === '/security-monitoring') return { section: 'securityMonitoring', action: 'view' };
  if (pathName === '/security-monitoring/website-activity') return { section: 'securityMonitoring', action: 'view' };
  if (pathName === '/security-monitoring/rules') return { section: 'securityMonitoring', action: 'edit' };
  if (/^\/security-monitoring\/alerts\/[^/]+$/.test(pathName)) return { section: 'securityMonitoring', action: 'edit' };
  if (pathName === '/mascot-settings' || pathName === '/mascot-settings/revisions') {
    return { section: 'mascot', action: 'view' };
  }
  if (pathName === '/mascot-settings/draft' || pathName === '/mascot-settings/discard' ||
    pathName === '/mascot-settings/restore') {
    return { section: 'mascot', action: 'edit' };
  }
  if (pathName === '/mascot-settings/publish' && req.method === 'POST') {
    return { section: 'mascot', action: 'publish' };
  }
  if (pathName === '/leads' && req.method === 'GET') return { section: 'leads', action: 'view' };
  if (pathName === '/leads/export/options' || pathName === '/leads/export/preview' || pathName === '/leads/export') {
    return { section: 'leads', action: 'export' };
  }
  if (/^\/leads\/[^/]+\/status$/.test(pathName) && req.method === 'PATCH') return { section: 'leads', action: 'edit' };
  if (/^\/leads\/[^/]+\/notification\/retry$/.test(pathName) && req.method === 'POST') return { section: 'leads', action: 'edit' };
  if ((pathName === '/service-packages' || pathName === '/service-enquiries') && req.method === 'GET') return { section: 'serviceStore', action: 'view' };
  if (pathName === '/orders' && req.method === 'GET') return { section: 'serviceStore', action: 'view' };
  if (/^\/orders\/[^/]+\/fulfillment$/.test(pathName) && req.method === 'PATCH') return { section: 'serviceStore', action: 'edit' };
  if (/^\/payment-settings(?:\/(?:history|verify|gateway|settlement-change))?$/.test(pathName)) {
    return { section: 'serviceStore', action: req.method === 'GET' ? 'view' : 'edit' };
  }
  if (pathName === '/service-packages' && req.method === 'POST') return { section: 'serviceStore', action: 'create' };
  if (pathName === '/service-categories') {
    return { section: 'serviceStore', action: req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit' };
  }
  if (/^\/service-categories\/[^/]+$/.test(pathName)) {
    return { section: 'serviceStore', action: req.method === 'DELETE' ? 'delete' : 'edit' };
  }
  if (pathName === '/service-packages/upload') return { section: 'serviceStore', action: 'edit' };
  if (/^\/service-packages\/[^/]+$/.test(pathName)) {
    return { section: 'serviceStore', action: req.method === 'DELETE' ? 'delete' : 'edit' };
  }
  if (pathName === '/site-content' || pathName === '/site-content/revisions') {
    return { section: 'content', action: 'view' };
  }
  if (pathName === '/site-content/draft' || pathName === '/site-content/media/upload' ||
    pathName === '/site-content/restore' || pathName === '/site-content/discard') {
    return { section: 'content', action: req.method === 'GET' ? 'view' : 'edit' };
  }
  if (pathName === '/site-content/publish' && req.method === 'POST') return { section: 'content', action: 'publish' };
  if (pathName === '/blog-categories') {
    return { section: 'categories', action: req.method === 'GET' ? 'view' : 'create' };
  }
  if (/^\/blog-categories\/[^/]+$/.test(pathName)) {
    return { section: 'categories', action: req.method === 'DELETE' ? 'delete' : 'edit' };
  }
  if (pathName === '/blogs') {
    return { section: 'blogs', action: req.method === 'GET' ? 'view' : 'create' };
  }
  if (pathName === '/blogs/upload') return { section: 'blogs', action: 'edit' };
  if (/^\/blogs\/[^/]+$/.test(pathName)) {
    if (req.method === 'PUT' && req.body?.status === 'published') return { section: 'blogs', action: 'publish' };
    return { section: 'blogs', action: req.method === 'DELETE' ? 'delete' : 'edit' };
  }
  if (pathName === '/case-studies') {
    return { section: 'caseStudies', action: req.method === 'GET' ? 'view' : 'create' };
  }
  if (pathName === '/case-study-categories') {
    const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : req.method === 'DELETE' ? 'delete' : 'edit';
    return { section: 'caseStudies', action };
  }
  if (pathName === '/case-studies/reorder' && req.method === 'POST') return { section: 'caseStudies', action: 'edit' };
  if (/^\/case-studies\/media\/[^/]+$/.test(pathName) && req.method === 'GET') return { section: 'caseStudies', action: 'view' };
  if (pathName === '/case-studies/upload') return { section: 'caseStudies', action: 'edit' };
  if (/^\/case-studies\/[^/]+\/status$/.test(pathName) && req.method === 'PATCH') {
    return { section: 'caseStudies', action: req.body?.status === 'archived' ? 'delete' : 'publish' };
  }
  if (/^\/case-studies\/[^/]+$/.test(pathName)) {
    if (req.method === 'DELETE') return { section: 'caseStudies', action: 'delete' };
    if (req.method === 'PUT' && req.body?.status === 'published') return { section: 'caseStudies', action: 'publish' };
    return { section: 'caseStudies', action: req.method === 'GET' ? 'view' : 'edit' };
  }
  if (pathName === '/services' && req.method === 'GET') return { section: 'servicesManagement', action: 'view' };
  if (pathName === '/services' && req.method === 'POST') return { section: 'servicesManagement', action: 'create' };
  if (pathName === '/services/upload') return { section: 'servicesManagement', action: 'edit' };
  if (/^\/services\/[^/]+\/status$/.test(pathName) && req.method === 'PATCH') {
    return { section: 'servicesManagement', action: req.body?.status === 'archived' ? 'delete' : 'publish' };
  }
  if (/^\/services\/[^/]+$/.test(pathName)) {
    return { section: 'servicesManagement', action: req.method === 'DELETE' ? 'delete' : 'edit' };
  }
  if (pathName === '/team') return { section: 'team', action: req.method === 'GET' ? 'view' : 'edit' };
  if (pathName === '/team/upload') return { section: 'team', action: 'edit' };
  return undefined;
}

async function writeAdminAudit(actorId: string, action: string, section: string, targetId?: string, details: Record<string, unknown> = {}): Promise<void> {
  const response = await supabaseAdminRequest('rest/v1/admin_audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_id: actorId,
      target_id: targetId || null,
      action,
      section,
      details,
    }),
  });
  if (!response.ok) throw new Error(`Could not write the administrator audit event (${response.status}): ${(await response.text()).slice(0, 300)}`);
}

interface SecurityEventInput {
  eventType: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  actorId?: string;
  subjectHash?: string;
  route?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

async function writeSecurityEvent(input: SecurityEventInput): Promise<void> {
  const response = await supabaseAdminRequest('rest/v1/security_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_type: input.eventType,
      severity: input.severity || 'low',
      actor_id: input.actorId || null,
      subject_hash: input.subjectHash || null,
      route: input.route || null,
      status_code: input.statusCode || null,
      details: sanitizeSecurityDetails(input.details),
    }),
  });
  if (!response.ok) throw new Error(`Security event persistence failed (${response.status}).`);
}

function securityPseudonym(value: string): string | undefined {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32 || !value) return undefined;
  return createHmac('sha256', secret).update(value).digest('hex');
}

async function websiteActivityDatabaseErrorCode(response: globalThis.Response): Promise<string> {
  try {
    const payload = await response.json() as { code?: unknown };
    return typeof payload.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(payload.code)
      ? payload.code
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function scheduleWebsiteActivityCleanup(now: number): void {
  if (now - lastWebsiteActivityCleanupAt < 15 * 60_000) return;
  lastWebsiteActivityCleanupAt = now;
  void supabaseAdminRequest('rest/v1/rpc/prune_website_activity', {
    method: 'POST',
    body: JSON.stringify({ p_batch_size: 500 }),
  }).then((response) => {
    if (!response.ok) {
      void websiteActivityDatabaseErrorCode(response).then((code) => {
        console.error('[NearGrow Ads] Website activity retention cleanup failed:', { status: response.status, code });
      });
    } else {
      void response.text();
    }
  }).catch((error: unknown) => {
    console.error('[NearGrow Ads] Website activity retention cleanup failed:', error instanceof Error ? error.message : 'unknown error');
  });
}

function adminApiModule(route: string): string {
  const module = route.split('/').filter(Boolean)[0] || 'unknown';
  return /^[a-z-]{1,40}$/.test(module) ? module : 'other';
}

function recordSecurityEventSafely(input: SecurityEventInput): void {
  const details = input.details || {};
  const sourceKey = typeof details.sourceHash === 'string'
    ? details.sourceHash
    : input.subjectHash;
  if (sourceKey) {
    const now = Date.now();
    const recent = (securityEventWriteAttempts.get(sourceKey) || []).filter((time) => now - time < 60_000);
    if (recent.length >= 300) return;
    recent.push(now);
    securityEventWriteAttempts.set(sourceKey, recent);
    if (securityEventWriteAttempts.size > 10_000) {
      for (const [key, timestamps] of securityEventWriteAttempts) {
        if (!timestamps.some((time) => now - time < 60_000)) securityEventWriteAttempts.delete(key);
        if (securityEventWriteAttempts.size <= 8_000) break;
      }
    }
  }
  void writeSecurityEvent(input).catch((error: unknown) => {
    console.error('[NearGrow Ads] Security event persistence failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  });
}

async function reauthenticateAdmin(identity: AdminIdentity, password: unknown): Promise<string | undefined> {
  if (typeof password !== 'string' || !password || password.length > 200) return undefined;
  const response = await supabaseAuthRequest('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, password }),
  });
  if (!response.ok) return undefined;
  const data = await response.json() as { access_token?: string; user?: { id?: string; email_confirmed_at?: string } };
  if (data.user?.id !== identity.id || !data.user.email_confirmed_at || !data.access_token) return undefined;
  return data.access_token;
}

async function reauthenticateAdminRequest(req: Request, res: Response, identity: AdminIdentity, password: unknown, message: string): Promise<string | undefined> {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempts = (adminReauthAttempts.get(clientIp) || []).filter((time) => now - time < ADMIN_LOGIN_WINDOW_MS);
  if (attempts.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    res.status(429).json({ message: 'Too many password verification attempts. Please wait 15 minutes and try again.' });
    return undefined;
  }
  const accessToken = await reauthenticateAdmin(identity, password);
  if (!accessToken) {
    attempts.push(now);
    adminReauthAttempts.set(clientIp, attempts);
    res.status(401).json({ message });
    return undefined;
  }
  adminReauthAttempts.delete(clientIp);
  return accessToken;
}

function enforceAdminRateLimit(req: Request, res: Response, attemptsByIp: Map<string, number[]>, message: string): boolean {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempts = (attemptsByIp.get(clientIp) || []).filter((time) => now - time < ADMIN_LOGIN_WINDOW_MS);
  if (attempts.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    res.status(429).json({ message });
    return false;
  }
  attempts.push(now);
  attemptsByIp.set(clientIp, attempts);
  return true;
}

function validateAdminPermissions(value: unknown): AdminPermissions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: AdminPermissions = {};
  for (const [section, rawActions] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(adminSectionActions, section) || !rawActions || typeof rawActions !== 'object' || Array.isArray(rawActions)) return undefined;
    const actions: Partial<Record<AdminAction, boolean>> = {};
    for (const [action, enabled] of Object.entries(rawActions)) {
      if (!(adminSectionActions[section as AdminSection].includes(action as AdminAction)) || typeof enabled !== 'boolean') return undefined;
      actions[action as AdminAction] = enabled;
    }
    if (Object.entries(actions).some(([action, enabled]) => action !== 'view' && enabled) && actions.view !== true) return undefined;
    output[section as AdminSection] = actions;
  }

  return output;
}

function defaultSuperAdminPermissions(): AdminPermissions {
  return {
    dashboard: { view: true },
    leads: { view: true, edit: true, export: true },
    serviceStore: { view: true, create: true, edit: true, delete: true, publish: true },
    content: { view: true, edit: true },
    mascot: { view: true, edit: true, publish: true },
    servicesManagement: { view: true, create: true, edit: true, delete: true, publish: true },
    blogs: { view: true, create: true, edit: true, delete: true, publish: true },
    team: { view: true, create: true, edit: true, delete: true },
    categories: { view: true, create: true, edit: true, delete: true },
    settings: { view: true },
  };
}

function normalizeUsername(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) ? username : undefined;
}

function isStrongAdminPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 12 && password.length <= 200 &&
    [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)]
      .filter(Boolean).length >= 3;
}

async function setSupabaseUserPassword(userId: string, password: string): Promise<void> {
  const response = await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
  await readSupabaseJson<unknown>(response);
}

async function deleteSupabaseUser(userId: string): Promise<void> {
  const response = await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  await readSupabaseJson<unknown>(response);
}

interface AdminAuthStatus {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  confirmation_sent_at?: string;
  invited_at?: string;
  last_sign_in_at?: string;
  banned_until?: string;
}

async function readAdminAuthStatus(userId: string): Promise<AdminAuthStatus | undefined> {
  try {
    const result = await readSupabaseJson<AdminAuthStatus>(
      await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(userId)}`),
    );
    return result.id === userId ? result : undefined;
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status === 404) return undefined;
    throw error;
  }
}

async function revokeSupabaseRefreshTokens(userId: string): Promise<void> {
  const response = await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(userId)}/logout?scope=global`, {
    method: 'POST',
  });
  await readSupabaseJson<unknown>(response);
}

async function findSupabaseUserByEmail(email: string): Promise<{ id: string; email: string; email_confirmed_at?: string } | undefined> {
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: '100' });
    const result = await readSupabaseJson<{ users?: Array<{ id: string; email?: string; email_confirmed_at?: string }> }>(
      await supabaseAdminRequest(`auth/v1/admin/users?${query}`),
    );
    const match = result.users?.find((user) => user.email?.toLowerCase() === email);
    if (match?.email) return { id: match.id, email: match.email, email_confirmed_at: match.email_confirmed_at };
    if (!result.users || result.users.length < 100) return undefined;
  }
  throw new Error('The administrator directory is too large to search safely. Add the Auth user before inviting it.');
}

async function ensurePrimaryOwnerAccount(): Promise<void> {
  if (!adminConfigIsReady()) {
    console.warn('[NearGrow Ads] Admin access is disabled until Supabase Auth, Supabase database, ADMIN_OWNER_USER_ID, and ADMIN_SESSION_SECRET are configured.');
    return;
  }
  const ownerId = process.env.ADMIN_OWNER_USER_ID!;
  const authResponse = await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(ownerId)}`);
  const authUser = await readSupabaseJson<{ id?: string; email?: string; email_confirmed_at?: string }>(authResponse);
  if (authUser.id !== ownerId || authUser.email?.toLowerCase() !== 'harsh6026435@gmail.com' || !authUser.email_confirmed_at) {
    throw new Error('ADMIN_OWNER_USER_ID must identify the email-verified Supabase Auth account for harsh6026435@gmail.com.');
  }

  const query = new URLSearchParams({ id: `eq.${ownerId}`, select: 'id,email,role,status', limit: '1' });
  const existing = await readSupabaseJson<Array<{ id: string; email: string; role: AdminRole; status: AdminIdentity['status'] }>>(
    await supabaseAdminRequest(`rest/v1/admin_users?${query}`),
  );
  if (existing.length) {
    const ownerRecord = existing[0];
    if (ownerRecord.email.toLowerCase() !== authUser.email.toLowerCase() ||
      ownerRecord.role !== 'owner' || ownerRecord.status !== 'active') {
      throw new Error('The verified primary Owner Auth account has an existing inactive or non-Owner CMS record. Review it in Supabase; startup will not change existing permissions automatically.');
    }
    return;
  }
  const response = await supabaseAdminRequest('rest/v1/admin_users', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      id: ownerId,
      email: authUser.email.toLowerCase(),
      role: 'owner',
      status: 'active',
      permissions: {},
      is_primary_owner: true,
    }),
  });
  await readSupabaseJson<unknown>(response);

  const initialized = await readSupabaseJson<Array<{ id: string; email: string; role: AdminRole; status: AdminIdentity['status'] }>>(
    await supabaseAdminRequest(`rest/v1/admin_users?${query}`),
  );
  const ownerRecord = initialized[0];
  if (!ownerRecord || ownerRecord.email.toLowerCase() !== authUser.email.toLowerCase() ||
    ownerRecord.role !== 'owner' || ownerRecord.status !== 'active') {
    throw new Error('The verified Owner Auth account was not safely initialized in public.admin_users. Review the existing record and migration status.');
  }
}

function fromSupabaseLead(row: Record<string, unknown>): StoredLead {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    businessName: String(row.business_name || ''),
    email: String(row.email || ''),
    phone: row.phone ? String(row.phone) : undefined,
    websiteUrl: row.website_url ? String(row.website_url) : undefined,
    serviceInterest: String(row.service_interest || ''),
    budgetRange: row.budget_range ? String(row.budget_range) : undefined,
    message: String(row.message || ''),
    preferredContactMethod: row.preferred_contact_method ? String(row.preferred_contact_method) : undefined,
    consentStatus: row.consent_status === true,
    notificationStatus: row.notification_status === 'delivered' || row.notification_status === 'failed' ||
      row.notification_status === 'pending' ? row.notification_status : 'not_configured',
    sourcePage: String(row.source_page || '/'),
    utmSource: row.utm_source ? String(row.utm_source) : undefined,
    utmMedium: row.utm_medium ? String(row.utm_medium) : undefined,
    utmCampaign: row.utm_campaign ? String(row.utm_campaign) : undefined,
    createdAt: String(row.created_at),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    status: row.status === 'reviewed' || row.status === 'contacted' ? row.status : 'new',
  };
}

async function supabaseRequest(pathname: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new LeadStorageFailure('configuration', 'configuration');
  }
  try {
    return await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/${pathname}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new LeadStorageFailure('unavailable', 'network');
  }
}

async function ensureLeadResponse(response: globalThis.Response, operation: string): Promise<void> {
  if (response.ok) return;
  let code: string | undefined;
  let diagnostic: { message?: string; hint?: string } | undefined;
  try {
    const payload = await response.json() as { code?: unknown; message?: unknown; hint?: unknown };
    if (typeof payload.code === 'string') code = payload.code;
    const message = typeof payload.message === 'string' ? payload.message.slice(0, 300) : undefined;
    const hint = typeof payload.hint === 'string' ? payload.hint.slice(0, 300) : undefined;
    if (message || hint) diagnostic = { message, hint };
  } catch {
    // HTTP status still provides a safe classification when PostgREST omits JSON details.
  }
  if (code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || code === '42703') {
    throw new LeadStorageFailure('schema', operation, code, response.status, diagnostic);
  }
  if (code === '42501' || response.status === 401 || response.status === 403) {
    throw new LeadStorageFailure('permission', operation, code, response.status);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new LeadStorageFailure('unavailable', operation, code, response.status);
  }
  throw new LeadStorageFailure('request', operation, code, response.status);
}

function leadStorageMessage(error: unknown): string {
  if (!(error instanceof LeadStorageFailure)) {
    return 'Lead database is temporarily unavailable. Try again later.';
  }
  switch (error.kind) {
    case 'configuration':
      return 'Lead storage is not configured correctly. Check the server-side Supabase URL and service-role configuration.';
    case 'schema':
      return 'The Supabase leads table is missing from the PostgREST schema cache. Verify the leads migration and reload the schema cache.';
    case 'permission':
      return 'The server is not authorized to access lead storage. Check the Supabase service-role configuration and database grants.';
    case 'unavailable':
      return 'The lead database is temporarily unavailable. Try again later.';
    case 'request':
      return 'The lead database rejected the request. Check the server logs for the storage error code.';
  }
}

function logLeadStorageFailure(operation: string, error: unknown): void {
  if (error instanceof LeadStorageFailure) {
    console.error('[NearGrow Ads] Lead storage failure.', {
      operation,
      kind: error.kind,
      ...(error.code ? { code: error.code } : {}),
      ...(error.status ? { status: error.status } : {}),
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    });
    return;
  }
  console.error('[NearGrow Ads] Lead storage failure.', {
    operation,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
}

async function saveLeadToSupabase(lead: StoredLead): Promise<void> {
  const response = await supabaseRequest('leads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: lead.id,
      name: lead.name,
      business_name: lead.businessName,
      email: lead.email,
      phone: lead.phone,
      website_url: lead.websiteUrl,
      service_interest: lead.serviceInterest,
      budget_range: lead.budgetRange,
      message: lead.message,
      preferred_contact_method: lead.preferredContactMethod,
      consent_status: lead.consentStatus,
      notification_status: lead.notificationStatus,
      source_page: lead.sourcePage,
      utm_source: lead.utmSource,
      utm_medium: lead.utmMedium,
      utm_campaign: lead.utmCampaign,
      status: lead.status,
    }),
  });
  await ensureLeadResponse(response, 'insert');
  let rows: Record<string, unknown>[];
  try {
    rows = await response.json() as Record<string, unknown>[];
  } catch {
    throw new LeadStorageFailure('request', 'insert-response');
  }
  if (!Array.isArray(rows) || !rows.some((row) => String(row.id) === lead.id)) {
    throw new LeadStorageFailure('request', 'insert-unconfirmed');
  }
}

async function findSupabaseLeadById(id: string): Promise<StoredLead | undefined> {
  const query = new URLSearchParams({ select: '*', id: `eq.${id}`, limit: '1' });
  const response = await supabaseRequest(`leads?${query.toString()}`);
  await ensureLeadResponse(response, 'idempotency-read');
  let rows: Record<string, unknown>[];
  try {
    rows = await response.json() as Record<string, unknown>[];
  } catch {
    throw new LeadStorageFailure('request', 'idempotency-response');
  }
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? fromSupabaseLead(row) : undefined;
}

function isSameLeadSubmission(existing: StoredLead, submitted: StoredLead): boolean {
  return existing.sourcePage === submitted.sourcePage &&
    existing.name === submitted.name &&
    existing.phone === submitted.phone &&
    existing.businessName === submitted.businessName &&
    existing.email === submitted.email &&
    existing.serviceInterest === submitted.serviceInterest &&
    existing.message === submitted.message &&
    existing.budgetRange === submitted.budgetRange &&
    existing.websiteUrl === submitted.websiteUrl &&
    existing.preferredContactMethod === submitted.preferredContactMethod &&
    existing.consentStatus === submitted.consentStatus &&
    existing.utmSource === submitted.utmSource &&
    existing.utmMedium === submitted.utmMedium &&
    existing.utmCampaign === submitted.utmCampaign;
}

async function readSupabaseLeads(options: {
  page: number;
  pageSize: number;
  status: string;
  search: string;
}): Promise<{ leads: StoredLead[]; total: number }> {
  const offset = (options.page - 1) * options.pageSize;
  const params = new URLSearchParams({
    select: '*',
    order: 'created_at.desc',
    limit: String(options.pageSize),
    offset: String(offset),
  });
  if (options.status !== 'all') params.set('status', `eq.${options.status}`);
  const search = options.search.replace(/[,*()%\\]/g, ' ').trim().slice(0, 100);
  if (search) {
    const wildcardSearch = `*${search}*`;
    params.set('or', `(name.ilike.${wildcardSearch},business_name.ilike.${wildcardSearch},email.ilike.${wildcardSearch},service_interest.ilike.${wildcardSearch},phone.ilike.${wildcardSearch},source_page.ilike.${wildcardSearch})`);
  }
  const response = await supabaseRequest(`leads?${params.toString()}`, {
    headers: { Prefer: 'count=exact' },
  });
  await ensureLeadResponse(response, 'read');
  let rows: Record<string, unknown>[];
  try {
    rows = await response.json() as Record<string, unknown>[];
  } catch {
    throw new LeadStorageFailure('request', 'read-response');
  }
  const contentRange = response.headers.get('Content-Range');
  const total = contentRange?.split('/')[1];
  if (!total || !/^\d+$/.test(total)) {
    throw new LeadStorageFailure('request', 'read-count');
  }
  return { leads: rows.map(fromSupabaseLead), total: Number(total) };
}

function parseLeadExportFilters(value: unknown): LeadExportFilters | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const scopes: LeadExportScope[] = ['all', 'filtered', 'selected', 'today', 'last7', 'last30', 'thisMonth', 'custom'];
  if (!scopes.includes(item.scope as LeadExportScope) ||
    !['all', 'new', 'reviewed', 'contacted'].includes(String(item.status ?? 'all')) ||
    (item.source !== undefined && (typeof item.source !== 'string' || item.source.length > 150)) ||
    (item.service !== undefined && (typeof item.service !== 'string' || item.service.length > 100)) ||
    (item.search !== undefined && (typeof item.search !== 'string' || item.search.length > 100)) ||
    (item.from !== undefined && typeof item.from !== 'string') ||
    (item.to !== undefined && typeof item.to !== 'string')) return undefined;
  const selectedIds = item.selectedIds === undefined ? [] : item.selectedIds;
  if (!Array.isArray(selectedIds) || selectedIds.length > 1000 ||
    selectedIds.some((id) => typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return undefined;
  const scope = item.scope as LeadExportScope;
  if (scope === 'selected' && selectedIds.length === 0) return undefined;
  return {
    scope,
    status: (item.status ?? 'all') as LeadExportFilters['status'],
    source: typeof item.source === 'string' ? item.source.trim() : '',
    service: typeof item.service === 'string' ? item.service.trim() : '',
    search: typeof item.search === 'string' ? item.search.trim().slice(0, 100) : '',
    selectedIds: [...new Set(selectedIds as string[])],
    ...(typeof item.from === 'string' ? { from: item.from } : {}),
    ...(typeof item.to === 'string' ? { to: item.to } : {}),
  };
}

function parseLeadExportColumns(value: unknown): LeadExportColumn[] | undefined {
  const optionalColumns = LEAD_EXPORT_COLUMNS.filter((column) => !column.required).map((column) => column.key);
  if (value === undefined) return LEAD_EXPORT_COLUMNS.map((column) => column.key);
  if (!Array.isArray(value) || value.some((column) => typeof column !== 'string' ||
    !LEAD_EXPORT_COLUMNS.some((entry) => entry.key === column))) return undefined;
  return [...new Set([
    ...LEAD_EXPORT_COLUMNS.filter((column) => column.required).map((column) => column.key),
    ...(value as string[]).filter((column): column is LeadExportColumn =>
      optionalColumns.includes(column as typeof optionalColumns[number])),
  ])];
}

function leadExportMatches(lead: StoredLead, filters: LeadExportFilters, dateRange?: ReturnType<typeof leadExportDateRange>, cutoff?: string): boolean {
  const createdAt = Date.parse(lead.createdAt);
  return (!cutoff || createdAt < Date.parse(cutoff)) &&
    (filters.scope !== 'selected' || filters.selectedIds.includes(lead.id)) &&
    (filters.status === 'all' || lead.status === filters.status) &&
    (!filters.source || lead.sourcePage === filters.source) &&
    (!filters.service || lead.serviceInterest === filters.service) &&
    (!filters.search || [lead.name, lead.businessName, lead.email, lead.serviceInterest, lead.phone || '', lead.sourcePage]
      .some((value) => value.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase()))) &&
    (!dateRange || (createdAt >= Date.parse(dateRange.startUtc) && createdAt < Date.parse(dateRange.endUtcExclusive)));
}

function leadExportQuery(
  filters: LeadExportFilters,
  dateRange: ReturnType<typeof leadExportDateRange>,
  cutoff: string,
  cursor?: { createdAt: string; id: string },
): URLSearchParams {
  const query = new URLSearchParams({
    select: '*',
    order: 'created_at.asc,id.asc',
    limit: String(LEAD_EXPORT_PAGE_SIZE),
    created_at: `lt.${cutoff}`,
  });
  if (filters.scope === 'selected') query.set('id', `in.(${filters.selectedIds.join(',')})`);
  if (filters.status !== 'all') query.set('status', `eq.${filters.status}`);
  if (filters.source) query.set('source_page', `eq.${filters.source}`);
  if (filters.service) query.set('service_interest', `eq.${filters.service}`);
  const andFilters: string[] = [];
  if (dateRange) {
    andFilters.push(`created_at.gte.${dateRange.startUtc}`, `created_at.lt.${dateRange.endUtcExclusive}`);
  }
  const search = filters.search.replace(/[,*()%\\]/g, ' ').trim().slice(0, 100);
  if (search) {
    const wildcard = `*${search}*`;
    andFilters.push(`or(name.ilike.${wildcard},business_name.ilike.${wildcard},email.ilike.${wildcard},service_interest.ilike.${wildcard},phone.ilike.${wildcard},source_page.ilike.${wildcard})`);
  }
  if (cursor) {
    andFilters.push(`or(created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`);
  }
  if (andFilters.length) query.set('and', `(${andFilters.join(',')})`);
  return query;
}

function selectedLeadIdBatches(filters: LeadExportFilters): string[][] {
  const ids = filters.selectedIds;
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  return batches;
}

async function countSupabaseLeadExportQuery(query: URLSearchParams): Promise<number> {
  query.set('select', 'id');
  query.set('limit', '1');
  const response = await supabaseRequest(`leads?${query}`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  await ensureLeadResponse(response, 'export-count');
  const total = response.headers.get('Content-Range')?.split('/')[1];
  await response.body?.cancel();
  if (!total || !/^\d+$/.test(total)) throw new LeadStorageFailure('request', 'export-count-unavailable');
  return Number(total);
}

async function countLeadExportRecords(
  filters: LeadExportFilters,
  dateRange: ReturnType<typeof leadExportDateRange>,
  cutoff: string,
  storage: 'memory' | 'supabase',
): Promise<number> {
  if (storage === 'memory') {
    return memoryLeads.filter((lead) => leadExportMatches(lead, filters, dateRange, cutoff)).length;
  }
  if (filters.scope === 'selected') {
    let total = 0;
    for (const selectedIds of selectedLeadIdBatches(filters)) {
      total += await countSupabaseLeadExportQuery(
        leadExportQuery({ ...filters, selectedIds }, dateRange, cutoff),
      );
    }
    return total;
  }
  return countSupabaseLeadExportQuery(leadExportQuery(filters, dateRange, cutoff));
}

async function* iterateLeadExportRecords(
  filters: LeadExportFilters,
  dateRange: ReturnType<typeof leadExportDateRange>,
  cutoff: string,
  expectedCount: number,
  storage: 'memory' | 'supabase',
): AsyncGenerator<StoredLead> {
  let count = 0;
  if (storage === 'memory') {
    const matches = memoryLeads
      .filter((lead) => leadExportMatches(lead, filters, dateRange, cutoff))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    for (const lead of matches) {
      yield lead;
      count += 1;
    }
  } else {
    const selectedBatches: Array<string[] | undefined> = filters.scope === 'selected'
      ? selectedLeadIdBatches(filters)
      : [undefined];
    for (const selectedIds of selectedBatches) {
      let cursor: { createdAt: string; id: string } | undefined;
      for (;;) {
        const query = leadExportQuery(
          selectedIds ? { ...filters, selectedIds } : filters,
          dateRange,
          cutoff,
          cursor,
        );
        const response = await supabaseRequest(`leads?${query}`);
        await ensureLeadResponse(response, 'export-read');
        let rows: Record<string, unknown>[];
        try {
          rows = await response.json() as Record<string, unknown>[];
        } catch {
          throw new LeadStorageFailure('request', 'export-response');
        }
        if (!Array.isArray(rows) || rows.length > LEAD_EXPORT_PAGE_SIZE) {
          throw new LeadStorageFailure('request', 'export-page-invalid');
        }
        if (!rows.length) break;
        for (const row of rows) {
          const lead = fromSupabaseLead(row);
          if (cursor && (lead.createdAt < cursor.createdAt ||
            (lead.createdAt === cursor.createdAt && lead.id <= cursor.id))) {
            throw new LeadStorageFailure('request', 'export-cursor-invalid');
          }
          yield lead;
          count += 1;
        }
        if (rows.length < LEAD_EXPORT_PAGE_SIZE) break;
        const last = rows[rows.length - 1];
        cursor = { createdAt: String(last.created_at), id: String(last.id) };
      }
    }
  }
  if (count !== expectedCount) throw new LeadStorageFailure('request', 'export-count-mismatch');
}

function leadExportValues(lead: StoredLead, columns: LeadExportColumn[]): string[] {
  const values: Record<LeadExportColumn, string> = {
    id: lead.id,
    businessName: lead.businessName || lead.name,
    name: lead.name,
    email: lead.email,
    phone: lead.phone || '',
    serviceInterest: lead.serviceInterest,
    sourcePage: leadSourceLabel(lead.sourcePage),
    message: lead.message,
    status: lead.status === 'reviewed' ? 'In Review' : lead.status === 'contacted' ? 'Contacted' : 'New',
    createdAt: formatLeadExportDate(lead.createdAt),
    updatedAt: formatLeadExportDate(lead.updatedAt),
  };
  return columns.map((column) => values[column]);
}

async function writeLeadExportChunk(stream: WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function finishLeadExportStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

async function readLeadExportOptions(storage: 'memory' | 'supabase'): Promise<{ sources: string[]; services: string[] }> {
  const sourceValues = new Set<string>();
  const serviceValues = new Set<string>();
  if (storage === 'memory') {
    memoryLeads.forEach((lead) => {
      sourceValues.add(lead.sourcePage);
      serviceValues.add(lead.serviceInterest);
    });
  } else {
    const pageSize = 500;
    let afterId = '';
    for (;;) {
      const query = new URLSearchParams({
        select: 'id,source_page,service_interest',
        order: 'id.asc',
        limit: String(pageSize),
      });
      if (afterId) query.set('id', `gt.${afterId}`);
      const response = await supabaseRequest(`leads?${query}`);
      await ensureLeadResponse(response, 'export-options');
      const rows = await response.json() as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) throw new LeadStorageFailure('request', 'export-options-response');
      rows.forEach((row) => {
        if (typeof row.source_page === 'string' && row.source_page) sourceValues.add(row.source_page);
        if (typeof row.service_interest === 'string' && row.service_interest) serviceValues.add(row.service_interest);
      });
      if (rows.length < pageSize) break;
      const lastId = rows[rows.length - 1]?.id;
      if (typeof lastId !== 'string' || lastId <= afterId) throw new LeadStorageFailure('request', 'export-options-cursor-invalid');
      afterId = lastId;
    }
  }
  return {
    sources: [...sourceValues].sort((left, right) => leadSourceLabel(left).localeCompare(leadSourceLabel(right))),
    services: [...serviceValues].sort((left, right) => left.localeCompare(right)),
  };
}

async function updateSupabaseLeadStatus(id: string, status: LeadStatus): Promise<boolean> {
  const query = new URLSearchParams({ id: `eq.${id}`, select: 'id' });
  const response = await supabaseRequest(`leads?${query.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
  await ensureLeadResponse(response, 'update');
  let rows: unknown[];
  try {
    rows = await response.json() as unknown[];
  } catch {
    throw new LeadStorageFailure('request', 'update-response');
  }
  return rows.length > 0;
}

async function updateSupabaseLeadNotificationStatus(
    id: string,
    notificationStatus: StoredLead['notificationStatus'],
  ): Promise<void> {
    const query = new URLSearchParams({ id: `eq.${id}`, select: 'id' });
    const response = await supabaseRequest(`leads?${query.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ notification_status: notificationStatus }),
    });
    await ensureLeadResponse(response, 'notification-status-update');
    const rows = await response.json() as Array<{ id?: unknown }>;
    if (!rows.some((row) => String(row.id) === id)) {
      throw new LeadStorageFailure('request', 'notification-status-update-unconfirmed');
    }
}

async function dispatchLeadNotification(lead: StoredLead): Promise<StoredLead['notificationStatus']> {
    const webhookUrl = process.env.N8N_LEAD_WEBHOOK_URL;
    if (!webhookUrl || process.env.NODE_ENV === 'test') return 'not_configured';
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': lead.id,
          ...(process.env.N8N_WEBHOOK_SECRET
            ? { 'X-NearGrow-Secret': process.env.N8N_WEBHOOK_SECRET }
            : {}),
        },
        body: JSON.stringify(lead),
      });
      if (!response.ok) {
        console.error('[NearGrow Ads] n8n notification returned an unsuccessful HTTP status.', {
          status: response.status,
          leadId: lead.id,
        });
        return 'failed';
      }
      return 'delivered';
    } catch (error) {
      console.error('[NearGrow Ads] n8n notification dispatch failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        leadId: lead.id,
      });
      return 'failed';
    }
}

function canonicalSiteOrigin(): string {
  const configured = process.env.SITE_URL;
  if (!configured) throw new Error('SITE_URL must be configured with the canonical HTTPS origin.');
  const parsed = new URL(configured);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
    parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SITE_URL must be the canonical HTTPS origin without a path, query or fragment.');
  }
  return parsed.origin;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] || character);
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

function replaceMetaContent(html: string, attribute: 'name' | 'property', name: string, content: string): string {
  const tagPattern = new RegExp(`<meta\\s+${attribute}=["']${name}["'][^>]*>`, 'i');
  return html.replace(tagPattern, (tag) => {
    const escaped = escapeHtmlAttribute(content);
    const contentPattern = /\scontent=(["'])[\s\S]*?\1/i;
    return contentPattern.test(tag)
      ? tag.replace(contentPattern, ` content="${escaped}"`)
      : tag.replace(/\s*\/?>$/, ` content="${escaped}" />`);
  });
}

async function resolvePublicPageMetadata(pathname: string): Promise<{
  found: boolean;
  title: string;
  description: string;
  image: string;
  noindex: boolean;
}> {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const adminPaths = new Set([
    '/admin', '/admin/login', '/admin/accept-invite', '/admin/password-reset',
    '/admin/blog', '/admin/blog/new', '/admin/team', '/admin/leads', '/admin/categories',
    '/admin/content', '/admin/mascot', '/admin/case-studies', '/admin/services',
    '/admin/settings', '/admin/service-store',
  ]);
  if (adminPaths.has(normalized) || /^\/admin\/blog\/[a-z0-9-]+$/.test(normalized)) {
    return { found: true, title: 'Admin | NearGrow Ads', description: 'Administrative workspace.', image: '', noindex: true };
  }
  if (normalized === '/thank-you') {
    return { found: true, title: 'Thank You | NearGrow Ads', description: 'Thank you for contacting NearGrow Ads.', image: '', noindex: true };
  }
  const staticSeoPages = {
    '/': 'home',
    '/services': 'services',
    '/catalogue': 'catalogue',
    '/work': 'work',
    '/about': 'about',
    '/blog': 'blog',
    '/contact': 'contact',
  } as const;
  const page = staticSeoPages[normalized as keyof typeof staticSeoPages];
  if (page) {
    const siteContent = await readSiteContent();
    const seo = siteContent.seo[page];
    return { found: true, title: seo.title, description: seo.description, image: seo.ogImage, noindex: false };
  }
  if (normalized === '/get-started' || normalized === '/privacy-policy' || normalized === '/terms-and-conditions') {
    const titles: Record<string, string> = {
      '/get-started': 'Get Started | NearGrow Ads',
      '/privacy-policy': 'Privacy Policy | NearGrow Ads',
      '/terms-and-conditions': 'Terms and Conditions | NearGrow Ads',
    };
    return { found: true, title: titles[normalized], description: 'NearGrow Ads website information.', image: '', noindex: normalized === '/privacy-policy' || normalized === '/terms-and-conditions' };
  }
  const serviceMatch = normalized.match(/^\/services\/([a-z0-9-]+)$/);
  if (serviceMatch) {
    const service = (await readWebsiteServices(false)).find((item) => item.slug === serviceMatch[1]);
    return service
      ? { found: true, title: `${service.title} | NearGrow Ads`, description: service.shortDescription, image: service.backgroundImageUrl, noindex: false }
      : { found: false, title: 'Page Not Found | NearGrow Ads', description: 'The requested page is not available.', image: '', noindex: true };
  }
  const blogMatch = normalized.match(/^\/blog\/([a-z0-9-]+)$/);
  if (blogMatch) {
    const post = (await readBlogPosts()).find((item) => item.slug === blogMatch[1] && item.status === 'published');
    return post
      ? { found: true, title: post.metaTitle || post.title, description: post.metaDescription || post.excerpt, image: post.socialImage || post.featuredImage || '', noindex: false }
      : { found: false, title: 'Page Not Found | NearGrow Ads', description: 'The requested page is not available.', image: '', noindex: true };
  }
  const catalogueMatch = normalized.match(/^\/catalogue\/([a-z0-9-]+)$/);
  if (catalogueMatch) {
    const item = (await readServicePackages(true)).find((candidate) => candidate.slug === catalogueMatch[1]);
    return item
      ? { found: true, title: `${item.title} | NearGrow Ads`, description: item.summary, image: item.imageUrl, noindex: false }
      : { found: false, title: 'Page Not Found | NearGrow Ads', description: 'The requested page is not available.', image: '', noindex: true };
  }
  return { found: false, title: 'Page Not Found | NearGrow Ads', description: 'The requested page is not available.', image: '', noindex: true };
}

async function renderInitialPageHtml(pathname: string, html: string): Promise<{ found: boolean; html: string }> {
  const metadata = await resolvePublicPageMetadata(pathname);
  const origin = canonicalSiteOrigin();
  const canonicalUrl = `${origin}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`;
  const imageUrl = metadata.image
    ? new URL(metadata.image, `${origin}/`).href
    : `${origin}/neargrow-mark.jpg`;
  let rendered = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttribute(metadata.title)}</title>`);
  rendered = replaceMetaContent(rendered, 'name', 'description', metadata.description);
  rendered = replaceMetaContent(rendered, 'name', 'robots', metadata.noindex ? 'noindex, nofollow' : 'index, follow');
  rendered = replaceMetaContent(rendered, 'property', 'og:title', metadata.title);
  rendered = replaceMetaContent(rendered, 'property', 'og:description', metadata.description);
  rendered = replaceMetaContent(rendered, 'property', 'og:url', canonicalUrl);
  rendered = replaceMetaContent(rendered, 'property', 'og:image', imageUrl);
  rendered = replaceMetaContent(rendered, 'name', 'twitter:title', metadata.title);
  rendered = replaceMetaContent(rendered, 'name', 'twitter:description', metadata.description);
  rendered = replaceMetaContent(rendered, 'name', 'twitter:image', imageUrl);
  rendered = rendered.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}" />`);
  return { found: metadata.found, html: rendered };
}

function isPortAvailable(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    const onListening = () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    };
    if (host) {
      server.listen(port, host, onListening);
    } else {
      server.listen(port, onListening);
    }
  });
}

async function findAvailablePort(startPort: number, host?: string): Promise<number> {
  for (let port = startPort; port <= 65535 && port < startPort + 100; port += 1) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error(`No available port found between ${startPort} and ${Math.min(startPort + 99, 65535)}.`);
}

async function createApplication(serverless = false): Promise<{ app: express.Express; port?: number }> {
  if (process.env.NODE_ENV === 'production') canonicalSiteOrigin();
  if (!serverless && process.env.NODE_ENV === 'production' && !process.env.PERSISTENT_DATA_DIR) {
    throw new Error('PERSISTENT_DATA_DIR must point to a durable mounted volume in production.');
  }
  if (!serverless) await fs.mkdir(persistentDataRoot, { recursive: true });
  if (!serverless) await ensurePrimaryOwnerAccount();
  const app = express();
  const proxyHops = serverless ? 1 : Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(proxyHops) || proxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer matching the hosting proxy chain.');
  }
  app.set('trust proxy', proxyHops);
  const requestedPort = serverless ? undefined : process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  if (!serverless && (!Number.isInteger(requestedPort) || requestedPort! < 1 || requestedPort! > 65535)) {
    throw new Error(`Invalid PORT value "${process.env.PORT}". Choose a port between 1 and 65535.`);
  }

  const port = serverless ? undefined : process.env.PORT
    ? requestedPort
    : await findAvailablePort(requestedPort!, '0.0.0.0');
  if (!serverless && process.env.PORT && !(await isPortAvailable(port!, '0.0.0.0'))) {
    throw new Error(`Port ${port} is already in use. Stop the process using it or choose another PORT.`);
  }
  const hmrPort = serverless ? DEFAULT_HMR_PORT : await findAvailablePort(DEFAULT_HMR_PORT);

  app.use('/api/website-activity', express.json({ limit: '1kb' }));
  app.use(express.json({
    limit: '3mb',
    verify: (req, _res, buffer) => {
      if (req.url?.split('?')[0] === '/api/payments/razorpay/test-webhook') {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    },
  }));

  // Uploaded team portraits. Random UUID filenames never change, so they are safe to cache hard.
  if (!serverless) {
    app.use('/uploads', express.static(teamUploadRoot, {
      maxAge: '30d', immutable: true, index: false, dotfiles: 'deny',
      setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); },
    }));
  }

  // --- API Routes ---
  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      app: 'NearGrow Ads API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/uploads/:folder/:filename', (req: Request, res: Response): void => {
    const { folder, filename } = req.params;
    if (!['blog', 'team', 'service-store'].includes(folder) ||
      !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(filename)) {
      res.status(404).end();
      return;
    }
    const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    if (!baseUrl) {
      res.status(503).json({ message: 'CMS media storage is not configured.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.redirect(302, `${baseUrl}/storage/v1/object/public/cms-uploads/${folder}/${filename}`);
  });

  app.post('/api/website-activity', async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const visitorId = req.body?.visitorId;
    const currentPath = normalizeWebsiteActivityPath(req.body?.path);
    const suppliedKeys = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? Object.keys(req.body) : [];
    if (suppliedKeys.length !== 2 || !suppliedKeys.every((key) => ['visitorId', 'path'].includes(key)) ||
      !isWebsiteVisitorId(visitorId) || !currentPath) {
      res.status(400).json({ message: 'A valid public page activity update is required.' });
      return;
    }
    const ipHash = securityPseudonym(req.ip || req.socket.remoteAddress || '');
    const visitorHash = securityPseudonym(visitorId);
    if (!ipHash || !visitorHash) {
      res.status(503).json({ message: 'Website activity tracking is temporarily unavailable.' });
      return;
    }
    const now = Date.now();
    if (!websiteActivityIpLimiter.allow(ipHash, now, { maxRequests: 120, windowMs: 60_000 }) ||
      !websiteActivityVisitorLimiter.allow(visitorHash, now, { maxRequests: 20, windowMs: 60_000 })) {
      res.status(429).json({ message: 'Please slow down website activity updates.' });
      return;
    }

    try {
      const device = websiteDeviceFromUserAgent(req.get('user-agent'));
      const recorded = await supabaseAdminRequest('rest/v1/rpc/record_website_activity', {
        method: 'POST',
        body: JSON.stringify({
          p_visitor_hash: visitorHash,
          p_current_path: currentPath,
          p_device: device,
        }),
      });
      if (!recorded.ok) {
        const code = await websiteActivityDatabaseErrorCode(recorded);
        console.error('[NearGrow Ads] Website activity write failed:', { status: recorded.status, code });
        res.status(503).json({ message: 'Website activity could not be recorded.' });
        return;
      }
      await recorded.text();
      scheduleWebsiteActivityCleanup(now);
      res.status(204).end();
    } catch (error) {
      console.error('[NearGrow Ads] Website activity write failed:', error instanceof Error ? error.message : 'unknown error');
      res.status(503).json({ message: 'Website activity could not be recorded.' });
    }
  });

  app.use('/api/admin', async (req: Request, res: Response, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path !== '/login') {
      res.once('finish', () => {
        if (res.statusCode !== 401 && res.statusCode !== 403) return;
        const identity = currentAdmin(res);
        recordSecurityEventSafely({
          eventType: 'api.unauthorized',
          severity: res.statusCode === 403 ? 'medium' : 'low',
          ...(identity ? { actorId: identity.id } : {}),
          subjectHash: securityPseudonym(req.ip || req.socket.remoteAddress || ''),
          route: adminApiModule(req.path),
          statusCode: res.statusCode,
          details: { permissionDenied: res.statusCode === 403 },
        });
      });
    }
    const authExemptPaths = ['/login', '/session', '/activity', '/logout', '/auth/recovery', '/auth/complete'];
    if (authExemptPaths.includes(req.path)) {
      next();
      return;
    }
    try {
      const identity = await authenticateAdminSession(req);
      if (!identity) {
        res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
        return;
      }
      res.locals.adminIdentity = identity;

      if (identity.mustChangePassword && req.path !== '/auth/first-password') {
        res.status(403).json({ message: 'Change your temporary password before using the administrator workspace.' });
        return;
      }

      if (req.path === '/security-monitoring' ||
        req.path === '/security-monitoring/website-activity' ||
        req.path === '/security-monitoring/rules' ||
        /^\/security-monitoring\/alerts\/[^/]+$/.test(req.path)) {
        const action = (req.path === '/security-monitoring' ||
          req.path === '/security-monitoring/website-activity') && req.method === 'GET' ? 'view' : 'edit';
        if (req.path === '/security-monitoring/rules' && !identity.isPrimaryOwner) {
          res.status(403).json({ message: 'Only the Primary Owner can configure security detection rules.' });
          return;
        }
        if (!hasSecurityMonitoringAccess(identity, action)) {
          res.status(403).json({ message: 'Your role does not have Security Monitoring permission.' });
          return;
        }
        next();
        return;
      }

      const ownerManagedPath = /^\/(?:users(?:\/.*)?|audit-logs(?:\/.*)?|ownership(?:\/.*)?|sessions(?:\/.*)?)$/.test(req.path);
      const personalPath = req.path === '/profile' || req.path === '/profile/password' ||
        req.path === '/auth/first-password' || req.path === '/sessions/mine' ||
        /^\/sessions\/[^/]+$/.test(req.path);
      if (ownerManagedPath && !personalPath) {
        next();
        return;
      }
      if (req.path === '/team' && req.method === 'PUT') {
        const validated = validateTeam(req.body);
        const submittedMembers = validated.members;
        if (submittedMembers) {
          const previousMembers = await readTeam();
          const previous = new Map(previousMembers.map((member) => [member.id, member]));
          const nextMembers = new Map(submittedMembers.map((member) => [member.id, member]));
          const requiredActions = new Set<AdminAction>();
          const addedIds = new Set([...nextMembers.keys()].filter((id) => !previous.has(id)));
          const deletedIds = new Set([...previous.keys()].filter((id) => !nextMembers.has(id)));
          if (addedIds.size) requiredActions.add('create');
          if (deletedIds.size) requiredActions.add('delete');

          const contentEdited = [...nextMembers].some(([id, member]) => {
            const oldMember = previous.get(id);
            return oldMember && JSON.stringify({ ...oldMember, order: 0 }) !== JSON.stringify({ ...member, order: 0 });
          });
          const groups = new Set([...previousMembers, ...submittedMembers].map((member) => member.group));
          const reordered = [...groups].some((group) => {
            const oldOrder = previousMembers
              .filter((member) => member.group === group && !deletedIds.has(member.id))
              .sort((a, b) => a.order - b.order)
              .map((member) => member.id);
            const newOrder = submittedMembers
              .filter((member) => member.group === group && previous.has(member.id))
              .sort((a, b) => a.order - b.order)
              .map((member) => member.id);
            return oldOrder.length !== newOrder.length || oldOrder.some((id, index) => id !== newOrder[index]);
          });
          if (contentEdited || reordered) requiredActions.add('edit');
          if (!requiredActions.size) requiredActions.add('edit');
          if ([...requiredActions].some((action) => !hasPermission(identity, 'team', action))) {
            res.status(403).json({ message: 'Your role lacks the required create, edit, or delete permission for these team changes.' });
            return;
          }
          next();
          return;
        }
        res.status(400).json({ message: validated.message || 'The team data is invalid.' });
        return;
      }
      const permission = requiredAdminPermission(req);
      if (req.path === '/blogs/upload' || req.path === '/team/upload' || req.path === '/service-packages/upload' ||
        req.path === '/case-studies/upload' || req.path === '/services/upload' ||
        req.path === '/uploads/sign' || req.path === '/uploads/complete') {
        const upload = req.path === '/uploads/sign' || req.path === '/uploads/complete'
          ? createAdminUploadSpec(req.body)
          : undefined;
        const section = upload?.section ||
          (req.path === '/blogs/upload' ? 'blogs' : req.path === '/team/upload' ? 'team' :
            req.path === '/case-studies/upload' ? 'caseStudies' : req.path === '/services/upload' ?
              'servicesManagement' : 'serviceStore');
        if ((req.path === '/uploads/sign' || req.path === '/uploads/complete') && !upload) {
          res.status(400).json({ message: 'Choose a supported media purpose and file type.' });
          return;
        }
        if (identity.role !== 'owner' &&
          !hasPermission(identity, section, 'create') &&
          !hasPermission(identity, section, 'edit')) {
          res.status(403).json({ message: 'Your role does not allow uploading media for this section.' });
          return;
        }
        next();
        return;
      }
      const publishingBlog = (req.path === '/blogs' && req.method === 'POST' && req.body?.status === 'published') ||
        (/^\/blogs\/[^/]+$/.test(req.path) && req.method === 'PUT' && req.body?.status === 'published');
      let publishingServicePackage =
        req.path === '/service-packages' && req.method === 'POST' && req.body?.status === 'published';
      if (/^\/service-packages\/[^/]+$/.test(req.path) && req.method === 'PUT' && req.body?.status === 'published') {
        const existingPackage = await readServicePackageById(req.path.split('/').pop() || '');
        publishingServicePackage = existingPackage?.status !== 'published';
      }
      if (publishingBlog) {
        const contentAction: AdminAction = req.method === 'POST' ? 'create' : 'edit';
        if (!hasPermission(identity, 'blogs', contentAction) || !hasPermission(identity, 'blogs', 'publish')) {
          res.status(403).json({ message: 'Your role needs both content access and publish permission to publish blog posts.' });
          return;
        }
      }
      if (publishingServicePackage) {
        const contentAction: AdminAction = req.method === 'POST' ? 'create' : 'edit';
        if (!hasPermission(identity, 'serviceStore', contentAction) || !hasPermission(identity, 'serviceStore', 'publish')) {
          res.status(403).json({ message: 'Your role needs both package access and publish permission to publish service packages.' });
          return;
        }
      }
      const publishingCaseStudy =
        (req.path === '/case-studies' && req.method === 'POST' && req.body?.status === 'published') ||
        (/^\/case-studies\/[0-9a-f-]+$/i.test(req.path) && req.method === 'PUT' && req.body?.status === 'published') ||
        (/^\/case-studies\/[0-9a-f-]+\/status$/i.test(req.path) && req.method === 'PATCH' && req.body?.status === 'published');
      if (publishingCaseStudy) {
        const contentAction: AdminAction = req.method === 'POST' ? 'create' : 'edit';
        if (!hasPermission(identity, 'caseStudies', contentAction) || !hasPermission(identity, 'caseStudies', 'publish')) {
          res.status(403).json({ message: 'Your role needs case study content access and publish permission to publish case studies.' });
          return;
        }
      }
      const publishingWebsiteService =
        /^\/services\/[0-9a-f-]+\/status$/i.test(req.path) &&
        req.method === 'PATCH' && req.body?.status === 'published';
      if (publishingWebsiteService &&
        (!hasPermission(identity, 'servicesManagement', 'edit') || !hasPermission(identity, 'servicesManagement', 'publish'))) {
        res.status(403).json({ message: 'Your role needs service edit and publish permission to publish website services.' });
        return;
      }
      if (!permission) {
        if (personalPath) {
          next();
          return;
        }
        res.status(403).json({ message: 'This administrator API action is not available.' });
        return;
      }
      if (!hasPermission(identity, permission.section, permission.action)) {
        res.status(403).json({ message: `Your role does not allow ${permission.action} access to ${permission.section}.` });
        return;
      }
      next();
    } catch (error) {
      console.error('[NearGrow Ads] Admin request authorization failed:', error);
      res.status(503).json({ message: 'Administrator access could not be verified. Please try again.' });
    }
  });

  app.post('/api/admin/uploads/sign', async (req: Request, res: Response): Promise<void> => {
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Media can only be uploaded from this website.' });
      return;
    }
    try {
      const prepared = await prepareAdminUpload(req.body);
      if (!prepared) {
        res.status(400).json({ message: 'Choose a supported file type and ensure the file is within the allowed size.' });
        return;
      }
      res.status(201).json({
        uploadUrl: prepared.uploadUrl,
        path: prepared.path,
        url: prepared.url,
      });
    } catch (error) {
      console.error('[NearGrow Ads] Admin upload preparation failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Media storage could not prepare the upload.' });
    }
  });

  app.post('/api/admin/uploads/complete', async (req: Request, res: Response): Promise<void> => {
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Media can only be verified from this website.' });
      return;
    }
    try {
      const url = await verifyAdminUpload(req.body);
      if (!url) {
        res.status(415).json({ message: 'The uploaded file failed storage, size, or file-signature verification.' });
        return;
      }
      res.status(201).json({ url });
    } catch (error) {
      console.error('[NearGrow Ads] Admin upload verification failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The uploaded file could not be verified.' });
    }
  });

  app.post('/api/admin/login', async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    if (!adminConfigIsReady()) {
      res.status(503).json({
        message: 'Admin access is not configured. Set the required server environment variables and restart the server.',
        configurationIssues: adminConfigIssues(),
      });
      return;
    }

    const { password } = req.body || {};
    const identifier = typeof req.body?.identifier === 'string'
      ? req.body.identifier.trim()
      : typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const logFailedLogin = (reason: string, statusCode: number) => recordSecurityEventSafely({
      eventType: 'auth.login.failed',
      severity: statusCode === 403 ? 'medium' : 'low',
      subjectHash: securityPseudonym(identifier.toLowerCase()),
      route: 'login',
      statusCode,
      details: {
        reason,
        sourceHash: securityPseudonym(clientIp),
      },
    });
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = (adminLoginAttempts.get(clientIp) || []).filter((time) => now - time < ADMIN_LOGIN_WINDOW_MS);
    if (attempts.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
      logFailedLogin('rate_limited', 429);
      res.status(429).json({ message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
      return;
    }
    attempts.push(now);
    adminLoginAttempts.set(clientIp, attempts);

    if (!identifier || identifier.length > 254 || typeof password !== 'string' || password.length > 200) {
      logFailedLogin('invalid_credentials_shape', 401);
      res.status(401).json({ message: 'The email, username, or password is incorrect.' });
      return;
    }

    try {
      let normalizedEmail = identifier.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
        const username = normalizeUsername(identifier);
        if (!username) {
          logFailedLogin('unknown_account', 401);
          res.status(401).json({ message: 'The email, username, or password is incorrect.' });
          return;
        }
        const aliasQuery = new URLSearchParams({
          username: `eq.${username}`,
          select: 'email',
          limit: '1',
        });
        let aliases: Array<{ email: string }>;
        try {
          aliases = await readSupabaseJson<Array<{ email: string }>>(
            await supabaseAdminRequest(`rest/v1/admin_users?${aliasQuery}`),
          );
        } catch (error) {
          if (!isMissingAdminAccountManagementSchema(error)) throw error;
          warnAdminAccountMigrationMissing(error);
          res.status(503).json({ message: 'Username sign-in is not available until the admin account-management SQL migration has been applied. You can still sign in with your verified email.' });
          return;
        }
        if (!aliases[0]) {
          logFailedLogin('unknown_account', 401);
          res.status(401).json({ message: 'The email, username, or password is incorrect.' });
          return;
        }
        normalizedEmail = aliases[0].email.toLowerCase();
      }
      const authResponse = await supabaseAuthRequest('token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      if (!authResponse.ok) {
        logFailedLogin('credentials_rejected', 401);
        res.status(401).json({ message: 'The email, username, or password is incorrect.' });
        return;
      }
      const authData = await authResponse.json() as {
        access_token?: string;
        user?: { id?: string; email?: string; email_confirmed_at?: string };
      };
      if (!authData.access_token || !authData.user?.id || !authData.user.email_confirmed_at) {
        logFailedLogin('email_not_verified', 401);
        res.status(401).json({ message: 'Verify your email address before signing in.' });
        return;
      }
      const identity = await readAdminIdentity(authData.user.id);
      if (!identity || identity.email !== normalizedEmail) {
        logFailedLogin('admin_access_missing', 403);
        res.status(403).json({ message: 'This verified account does not currently have active CMS access.' });
        return;
      }
      if (identity.status === 'disabled') {
        logFailedLogin('admin_account_disabled', 403);
        res.status(403).json({ message: 'This administrator account is disabled. Contact the Primary Owner to restore access.' });
        return;
      }
      if (identity.status === 'pending') {
        logFailedLogin('admin_account_pending', 403);
        res.status(403).json({ message: 'This administrator account is pending email verification or setup. Complete the email link or contact the Primary Owner.' });
        return;
      }
      adminLoginAttempts.delete(clientIp);
      const lastLoginQuery = new URLSearchParams({ id: `eq.${identity.id}` });
      try {
        await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${lastLoginQuery}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_login_at: new Date().toISOString() }),
        }));
      } catch (error) {
        if (!isMissingAdminAccountManagementSchema(error)) throw error;
        warnAdminAccountMigrationMissing(error);
      }
      const sessionId = randomUUID();
      const insertResponse = await supabaseAdminRequest('rest/v1/admin_sessions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          id: sessionId,
          user_id: identity.id,
          user_agent: (req.get('user-agent') || '').slice(0, 500),
        }),
      });
      const createdSessions = await readSupabaseJson<Array<{ expires_at: string }>>(insertResponse);
      const expiresAt = createdSessions[0]?.expires_at;
      if (!expiresAt) throw new Error('Supabase did not return the new admin session expiry.');
      setAdminSessionCookie(req, res, sessionId, identity.id, expiresAt);
      await writeAdminAudit(identity.id, 'auth.login', 'security');
      res.json({ authenticated: true, user: identity });
    } catch (error) {
      console.error('[NearGrow Ads] Supabase admin login failed:', error);
      res.status(503).json({ message: 'Sign-in could not be completed. Check the Supabase Auth and admin database configuration.' });
    }
  });

  app.get('/api/admin/session', async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await authenticateAdminSession(req);
      res.json({
        configured: adminConfigIsReady(),
        ...(adminConfigIsReady() ? {} : { configurationIssues: adminConfigIssues() }),
        authenticated: Boolean(identity),
        ...(identity ? { user: identity } : {}),
      });
    } catch (error) {
      console.error('[NearGrow Ads] Admin session check failed:', error);
      res.status(503).json({
        configured: adminConfigIsReady(),
        ...(adminConfigIsReady() ? {} : { configurationIssues: adminConfigIssues() }),
        authenticated: false,
        message: 'Could not verify the administrator session.',
      });
    }
  });

  app.post('/api/admin/activity', async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Admin activity must be reported from this website.' });
      return;
    }
    const session = readAdminSession(req);
    if (!session) {
      res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
      return;
    }
    try {
      const identity = await authenticateAdminSession(req);
      if (!identity) {
        res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
        return;
      }
      const response = await supabaseAdminRequest('rest/v1/rpc/touch_admin_session', {
        method: 'POST',
        body: JSON.stringify({ p_session_id: session.sessionId, p_user_id: session.userId }),
      });
      const updated = await readSupabaseJson<Array<{ expires_at: string }>>(response);
      const expiresAt = updated[0]?.expires_at;
      if (!expiresAt) {
        res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
        return;
      }
      setAdminSessionCookie(req, res, session.sessionId, identity.id, expiresAt);
      res.json({ authenticated: true });
    } catch (error) {
      console.error('[NearGrow Ads] Admin activity could not renew the idle session.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Could not verify the administrator session.' });
    }
  });

  app.post('/api/admin/logout', async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    const session = readAdminSession(req);
    try {
      const identity = session ? await authenticateAdminSession(req) : undefined;
      if (session) {
        await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?id=eq.${encodeURIComponent(session.sessionId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        }));
      }
      if (session && identity) await writeAdminAudit(identity.id, 'auth.logout', 'security');
    } catch (error) {
      console.error('[NearGrow Ads] Admin logout session revocation failed:', error);
      res.clearCookie(ADMIN_SESSION_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'strict',
        path: '/api/admin',
      });
      res.status(503).json({ message: 'The session could not be revoked. Please try again.' });
      return;
    }
    res.clearCookie(ADMIN_SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || req.secure,
      sameSite: 'strict',
      path: '/api/admin',
    });
    res.json({ authenticated: false });
  });

  app.post('/api/admin/auth/recovery', async (req: Request, res: Response): Promise<void> => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = (adminRecoveryAttempts.get(clientIp) || []).filter((time) => now - time < ADMIN_LOGIN_WINDOW_MS);
    if (attempts.length >= ADMIN_LOGIN_MAX_ATTEMPTS) {
      res.status(429).json({ message: 'Too many recovery requests. Please wait 15 minutes and try again.' });
      return;
    }
    attempts.push(now);
    adminRecoveryAttempts.set(clientIp, attempts);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      res.status(400).json({ message: 'Enter a valid email address.' });
      return;
    }
    try {
      const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/password-reset`;
      const query = new URLSearchParams({ redirect_to: redirectTo });
      const response = await supabaseAuthRequest(`recover?${query}`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        console.error('[NearGrow Ads] Supabase password recovery request failed:', response.status, (await response.text()).slice(0, 300));
        res.status(503).json({ message: 'The recovery email could not be sent. Check Supabase Auth email and SMTP settings.' });
        return;
      }
      res.json({ message: 'If this address has an administrator account, a recovery email has been sent.' });
    } catch (error) {
      console.error('[NearGrow Ads] Password recovery request failed:', error);
      res.status(503).json({ message: 'Password recovery is temporarily unavailable.' });
    }
  });

  app.post('/api/admin/auth/complete', async (req: Request, res: Response): Promise<void> => {
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Setup can only be completed from this website.' });
      return;
    }
    const {
      accessToken,
      authorizationCode,
      codeVerifier,
      tokenHash,
      tokenType,
      password,
      confirmPassword,
      mode,
    } = req.body || {};
    const hasAccessToken = typeof accessToken === 'string';
    const hasCodeCallback = typeof authorizationCode === 'string' || typeof codeVerifier === 'string';
    const hasTokenHash = typeof tokenHash === 'string' || typeof tokenType === 'string';
    if ([hasAccessToken, hasCodeCallback, hasTokenHash].filter(Boolean).length !== 1 ||
      (hasAccessToken && (accessToken.length < 20 || accessToken.length > 10_000)) ||
      (typeof authorizationCode === 'string' && (authorizationCode.length < 8 || authorizationCode.length > 2_000)) ||
      (typeof codeVerifier === 'string' && !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) ||
      (hasCodeCallback && (typeof authorizationCode !== 'string' || typeof codeVerifier !== 'string')) ||
      (typeof tokenHash === 'string' && (tokenHash.length < 20 || tokenHash.length > 2_000)) ||
      (hasTokenHash && (typeof tokenHash !== 'string' || typeof tokenType !== 'string' ||
        !['signup', 'invite', 'recovery'].includes(tokenType))) ||
      (mode !== 'invite' && mode !== 'recovery') ||
      (typeof password !== 'string' && !(mode === 'invite' && password === undefined)) ||
      (password !== undefined && (!isStrongAdminPassword(password) || password !== confirmPassword))) {
      res.status(400).json({ message: 'The setup request is incomplete or invalid. Check the link and password requirements.' });
      return;
    }
    try {
      let verifiedAccessToken = accessToken as string | undefined;
      if (typeof authorizationCode === 'string' && typeof codeVerifier === 'string') {
        const exchangeResponse = await supabaseAuthRequest('token?grant_type=pkce', {
          method: 'POST',
          body: JSON.stringify({ auth_code: authorizationCode, code_verifier: codeVerifier }),
        });
        const exchange = await readSupabaseJson<{ access_token?: string }>(exchangeResponse);
        verifiedAccessToken = exchange.access_token;
      } else if (typeof tokenHash === 'string' && typeof tokenType === 'string') {
        const allowedTypes = mode === 'invite' ? ['signup', 'invite'] : ['recovery'];
        if (!allowedTypes.includes(tokenType)) {
          res.status(401).json({ message: 'This email link is not valid for the requested account action.' });
          return;
        }
        const verifyResponse = await supabaseAuthRequest('verify', {
          method: 'POST',
          body: JSON.stringify({ token_hash: tokenHash, type: tokenType }),
        });
        const verified = await readSupabaseJson<{ access_token?: string }>(verifyResponse);
        verifiedAccessToken = verified.access_token;
      }
      if (!verifiedAccessToken || verifiedAccessToken.length > 10_000) {
        res.status(401).json({ message: 'The verification link is invalid or expired. Ask the Primary Owner to resend setup.' });
        return;
      }
      const authResponse = await supabaseAuthRequest('user', { method: 'GET' }, verifiedAccessToken);
      const authUser = await readSupabaseJson<{ id?: string; email?: string; email_confirmed_at?: string }>(authResponse);
      if (!authUser.id || !authUser.email || !authUser.email_confirmed_at) {
        res.status(401).json({ message: 'Verify the invited email address before completing setup.' });
        return;
      }
      const identity = await readAdminIdentity(authUser.id);
      if (!identity) {
        res.status(403).json({ message: 'This verified identity does not have an eligible administrator account.' });
        return;
      }
      if ((mode === 'invite' && decideAdminInvitationCompletion(identity, authUser) === 'reject') ||
        (mode === 'recovery' && (identity.email !== authUser.email.toLowerCase() ||
          identity.status === 'disabled' || (identity.status !== 'active' &&
            !(identity.status === 'pending' && identity.mustChangePassword))))) {
        res.status(403).json({ message: 'This verified identity does not have an eligible administrator account.' });
        return;
      }
      if (mode === 'invite' && identity.status === 'active') {
        const replayResult = await readSupabaseJson<{ status?: string }>(
          await supabaseAdminRequest('rest/v1/rpc/complete_admin_invitation', {
            method: 'POST',
            body: JSON.stringify({
              p_user_id: identity.id,
              p_email: identity.email,
              p_must_change_password: identity.mustChangePassword === true,
            }),
          }),
        );
        if (decideAdminInvitationCompletion(identity, authUser, replayResult.status === 'already_accepted') !== 'already_accepted') {
          res.status(403).json({ message: 'This invitation is no longer available. Contact the Primary Owner.' });
          return;
        }
        res.json({ message: 'Admin setup is already complete. Sign in with your own password.' });
        return;
      }
      if (password !== undefined) {
        const updateResponse = await supabaseAuthRequest('user', {
          method: 'PUT',
          body: JSON.stringify({ password }),
        }, verifiedAccessToken);
        await readSupabaseJson<unknown>(updateResponse);
      } else if (!identity.mustChangePassword) {
        res.status(400).json({ message: 'Choose a strong password to finish setting up this invitation.' });
        return;
      }
      if (mode === 'invite') {
        const completion = await readSupabaseJson<{ status?: string }>(
          await supabaseAdminRequest('rest/v1/rpc/complete_admin_invitation', {
            method: 'POST',
            body: JSON.stringify({
              p_user_id: identity.id,
              p_email: identity.email,
              p_must_change_password: password === undefined,
            }),
          }),
        );
        if (completion.status !== 'accepted' &&
          decideAdminInvitationCompletion(identity, authUser, completion.status === 'already_accepted') !== 'already_accepted') {
          res.status(403).json({ message: 'This invitation is no longer pending or has been cancelled. Contact the Primary Owner.' });
          return;
        }
      } else {
        if (identity.status === 'pending') {
          const completion = await readSupabaseJson<{ status?: string }>(
            await supabaseAdminRequest('rest/v1/rpc/complete_admin_invitation', {
              method: 'POST',
              body: JSON.stringify({
                p_user_id: identity.id,
                p_email: identity.email,
                p_must_change_password: false,
              }),
            }),
          );
          if (completion.status !== 'accepted') {
            res.status(403).json({ message: 'This invitation is no longer pending or has been cancelled. Contact the Primary Owner.' });
            return;
          }
        } else {
          const query = new URLSearchParams({ id: `eq.${identity.id}` });
          await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${query}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              must_change_password: false,
              last_password_reset_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }),
          }));
        }
      }
      if (mode === 'recovery') {
        const sessionsQuery = new URLSearchParams({ user_id: `eq.${identity.id}`, revoked_at: 'is.null' });
        await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        }));
        await revokeSupabaseRefreshTokens(identity.id);
        if (identity.status !== 'pending') {
          await writeAdminAudit(identity.id, 'auth.password.recovered', 'security', identity.id);
        }
      }
      res.json({ message: 'Your account is ready. Sign in with your own password.' });
    } catch (error) {
      console.error('[NearGrow Ads] Admin account activation or recovery failed.', {
        status: error instanceof SupabaseRequestError ? error.status : undefined,
        code: error instanceof SupabaseRequestError ? error.code : undefined,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      if (error instanceof SupabaseRequestError && [400, 401, 403].includes(error.status)) {
        res.status(401).json({ message: 'The verification link is invalid or expired. Ask the Primary Owner to resend setup.' });
        return;
      }
      res.status(503).json({ message: 'Setup could not be completed right now. Retry, or ask the Primary Owner to resend setup.' });
    }
  });

  app.get('/api/admin/users', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    try {
      const query = new URLSearchParams({
        select: 'id,email,username,role,status,permissions,is_primary_owner,must_change_password,last_login_at,last_password_reset_at,invited_by,created_at,updated_at',
        order: 'created_at.desc',
        limit: '300',
      });
      const users = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_users?${query}`));
      const authStatuses: Array<AdminAuthStatus | undefined> = [];
      for (let index = 0; index < users.length; index += 10) {
        const batch = await Promise.all(users.slice(index, index + 10).map((user) =>
          readAdminAuthStatus(String(user.id)),
        ));
        authStatuses.push(...batch);
      }
      const userEmailById = new Map(users.map((user) => [String(user.id), String(user.email)]));
      res.json({ users: users.map((user, index) => {
        const authUser = authStatuses[index];
        return {
          id: user.id,
          email: user.email,
          username: user.username || null,
          role: user.role,
          status: user.status,
          permissions: user.permissions || {},
          isPrimaryOwner: user.is_primary_owner === true && user.role === 'owner',
          mustChangePassword: user.must_change_password === true,
          lastLoginAt: user.last_login_at || null,
          lastPasswordResetAt: user.last_password_reset_at || null,
          invitedBy: user.invited_by,
          invitedByEmail: userEmailById.get(String(user.invited_by)) || null,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
          authIdentityExists: Boolean(authUser),
          emailVerified: Boolean(authUser?.email_confirmed_at),
          emailVerifiedAt: authUser?.email_confirmed_at || null,
          confirmationSentAt: authUser?.confirmation_sent_at || null,
          invitedAt: authUser?.invited_at || null,
          authLastSignInAt: authUser?.last_sign_in_at || null,
          authBannedUntil: authUser?.banned_until || null,
        };
      }) });
    } catch (error) {
      console.error('[NearGrow Ads] Admin user list failed:', error);
      res.status(503).json({
        message: isMissingAdminAccountManagementSchema(error)
          ? 'Apply supabase/migrations/20261020000000_admin_account_management.sql before using Settings account management.'
          : 'Administrator records are temporarily unavailable.',
      });
    }
  });

  app.post('/api/admin/users/invite', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!enforceAdminRateLimit(req, res, adminAccountCreateAttempts, 'Too many administrator invitations. Please wait 15 minutes before adding another account.')) return;
    const actor = currentAdmin(res)!;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body?.role as AdminRole;
    const initialPassword = req.body?.newPassword ?? req.body?.initialPassword;
    const confirmInitialPassword = req.body?.confirmPassword ?? req.body?.confirmInitialPassword;
    const username = req.body?.username === '' || req.body?.username == null ? null : normalizeUsername(req.body.username);
    const permissions = role === 'owner'
      ? {}
      : req.body?.permissions == null && role === 'super_admin'
        ? defaultSuperAdminPermissions()
        : validateAdminPermissions(req.body?.permissions);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254 ||
      !['owner', 'super_admin', 'custom_admin'].includes(role) ||
      (role !== 'owner' && !username) ||
      (req.body?.username != null && req.body.username !== '' && !username) ||
      (role !== 'owner' && !permissions) ||
      (role !== 'owner' && (
        !isStrongAdminPassword(initialPassword) ||
        initialPassword !== confirmInitialPassword
      )) ||
      (role === 'owner' && (initialPassword !== undefined || confirmInitialPassword !== undefined))) {
      res.status(400).json({ message: 'Provide a valid email, username, role, permission set, and matching strong password for delegated administrators.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to invite an administrator.')) return;
    let newlyCreatedAuthUserId: string | undefined;
    let adminRecordCreated = false;
    let operationStage = 'admin_count';
    try {
      const userCountQuery = new URLSearchParams({ select: 'id', limit: '100' });
      const existingUsers = await readSupabaseJson<Array<{ id: string }>>(await supabaseAdminRequest(`rest/v1/admin_users?${userCountQuery}`));
      if (existingUsers.length >= 100) {
        res.status(409).json({ message: 'The 100-administrator account limit has been reached.' });
        return;
      }
      const duplicateQuery = new URLSearchParams({ email: `eq.${email}`, select: 'id', limit: '1' });
      operationStage = 'email_duplicate_check';
      const duplicate = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_users?${duplicateQuery}`));
      if (duplicate.length) {
        const existing = duplicate[0];
        res.status(409).json({
          message: `This administrator already exists. Current status: ${String(existing.status || 'unknown')}. Open Admin Accounts to manage the existing account.`,
          existingUser: {
            id: existing.id,
            email: existing.email,
            username: existing.username || null,
            role: existing.role,
            status: existing.status,
            isPrimaryOwner: existing.is_primary_owner === true,
          },
        });
        return;
      }
      if (username) {
        operationStage = 'username_duplicate_check';
        const usernameQuery = new URLSearchParams({ username: `eq.${username}`, select: 'id', limit: '1' });
        const duplicateUsername = await readSupabaseJson<Array<{ id: string }>>(
          await supabaseAdminRequest(`rest/v1/admin_users?${usernameQuery}`),
        );
        if (duplicateUsername.length) {
          res.status(409).json({ message: 'This username is already assigned to an administrator.' });
          return;
        }
      }

      operationStage = 'auth_identity_lookup';
      const authUser = await findSupabaseUserByEmail(email);
      let userId: string;
      let status: AdminIdentity['status'];
      let sendSignupVerification = false;
      const mustChangePassword = role !== 'owner';
      if (role === 'owner' && authUser) {
        userId = authUser.id;
        status = authUser.email_confirmed_at ? 'active' : 'pending';
        sendSignupVerification = !authUser.email_confirmed_at;
      } else if (role === 'owner') {
        operationStage = 'auth_invitation';
        const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/accept-invite`;
        const query = new URLSearchParams({ redirect_to: redirectTo });
        const invited = await readSupabaseJson<{ id?: string; email?: string }>(await supabaseAuthRequest(`invite?${query}`, {
          method: 'POST',
          body: JSON.stringify({ email }),
        }));
        if (!invited.id) throw new Error('Supabase invitation did not return a user identity.');
        userId = invited.id;
        status = 'pending';
      } else if (authUser) {
        userId = authUser.id;
        status = authUser.email_confirmed_at ? 'active' : 'pending';
        sendSignupVerification = !authUser.email_confirmed_at;
      } else {
        operationStage = 'auth_user_create';
        const created = await readSupabaseJson<{ id?: string; email?: string }>(
          await supabaseAdminRequest('auth/v1/admin/users', {
            method: 'POST',
            body: JSON.stringify({
              email,
              password: initialPassword,
              email_confirm: false,
            }),
          }),
        );
        if (!created.id) throw new Error('Supabase did not return the delegated Auth identity.');
        userId = created.id;
        newlyCreatedAuthUserId = userId;
        status = 'pending';
        sendSignupVerification = true;
      }
      operationStage = 'admin_record_insert';
      const createResponse = await supabaseAdminRequest('rest/v1/admin_users', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: userId,
          email,
          username,
          role,
          status,
          permissions,
          is_primary_owner: false,
          must_change_password: mustChangePassword,
          ...(mustChangePassword ? { last_password_reset_at: new Date().toISOString() } : {}),
          invited_by: actor.id,
        }),
      });
      await readSupabaseJson<unknown>(createResponse);
      adminRecordCreated = true;
      if (role !== 'owner' && authUser) {
        operationStage = 'auth_password_setup';
        await setSupabaseUserPassword(userId, initialPassword as string);
      }
      if (role !== 'owner') {
        if (sendSignupVerification) {
          operationStage = 'verification_email';
          const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/accept-invite?setup=temporary`;
          const query = new URLSearchParams({ type: 'signup', redirect_to: redirectTo });
          await readSupabaseJson<unknown>(await supabaseAuthRequest(`resend?${query}`, {
            method: 'POST',
            body: JSON.stringify({ type: 'signup', email }),
          }));
          await writeAdminAudit(actor.id, 'admin.invitation.dispatch_initiated', 'settings', userId, {
            provider: 'supabase_auth',
            accountStatus: status,
          });
        }
        operationStage = 'session_revocation';
        await revokeSupabaseRefreshTokens(userId);
        const sessionsQuery = new URLSearchParams({ user_id: `eq.${userId}`, revoked_at: 'is.null' });
        await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        }));
        operationStage = 'audit_log';
        await writeAdminAudit(actor.id, 'admin.created_with_temporary_password', 'settings', userId, { email, username, role, permissions });
        res.status(201).json({
          message: status === 'active'
            ? 'Delegated administrator created with a one-time password. Deliver it through a secure channel; the user must change it at first sign-in.'
            : 'Delegated account created and kept pending. A verification link was sent to the email; access remains blocked until verification, then the one-time password must be changed at first sign-in.',
        });
        return;
      }
      if (sendSignupVerification) {
        operationStage = 'verification_email';
        const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/accept-invite`;
        const query = new URLSearchParams({ type: 'signup', redirect_to: redirectTo });
        await readSupabaseJson<unknown>(await supabaseAuthRequest(`resend?${query}`, {
          method: 'POST',
          body: JSON.stringify({ type: 'signup', email }),
        }));
        await writeAdminAudit(actor.id, 'admin.invitation.dispatch_initiated', 'settings', userId, {
          provider: 'supabase_auth',
          accountStatus: status,
        });
      }
      operationStage = 'audit_log';
      await writeAdminAudit(actor.id, 'admin.invited', 'settings', userId, { email, username, role, permissions });
      res.status(201).json({ message: status === 'active' ? 'Co-Owner account added.' : 'Co-Owner invitation sent. Access activates after email verification and password setup.' });
    } catch (error) {
      let authCleanupFailed = false;
      if (newlyCreatedAuthUserId && !adminRecordCreated) {
        try {
          await deleteSupabaseUser(newlyCreatedAuthUserId);
        } catch (cleanupError) {
          authCleanupFailed = true;
          console.error('[NearGrow Ads] Admin invite cleanup failed.', {
            stage: 'auth_cleanup',
            status: cleanupError instanceof SupabaseRequestError ? cleanupError.status : undefined,
            code: cleanupError instanceof SupabaseRequestError ? cleanupError.code : undefined,
          });
        }
      }
      const requestError = error instanceof SupabaseRequestError ? error : undefined;
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[NearGrow Ads] Administrator creation failed.', {
          stage: operationStage,
          status: requestError?.status,
          code: requestError?.code,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      } else {
        console.error('[NearGrow Ads] Administrator creation failed.', {
          stage: operationStage,
          status: requestError?.status,
          code: requestError?.code,
        });
      }
      let statusCode = 503;
      let message = 'Supabase is temporarily unavailable. Please try again.';
      if (adminRecordCreated) {
        message = 'The administrator record was created, but account setup did not finish. Refresh the user list before retrying.';
      } else if (authCleanupFailed) {
        message = 'Database setup is incomplete and an unverified Auth identity could not be cleaned up. Do not retry with this email; contact the system administrator.';
      } else if (requestError?.code === 'email_exists' || requestError?.code === 'user_already_exists' ||
        (requestError?.code === '23505' && /auth_user_create/i.test(operationStage))) {
        statusCode = 409;
        message = 'This email is already registered with Supabase Auth. Check the existing Auth identity before retrying.';
      } else if (requestError?.code === '23505' &&
        (requestError.providerMessage.toLowerCase().includes('username') || requestError.providerMessage.toLowerCase().includes('email'))) {
        statusCode = 409;
        message = requestError.providerMessage.toLowerCase().includes('username')
          ? 'This username is already assigned to an administrator.'
          : 'This email already has a CMS administrator record.';
      } else if (requestError?.code === 'over_email_send_rate_limit' ||
        requestError?.code === 'email_rate_limit_exceeded' ||
        (requestError?.status === 429 && ['auth_invitation', 'verification_email'].includes(operationStage))) {
        message = 'Invitation delivery failed because Supabase is rate-limiting email. Check Auth email/SMTP limits and try again later.';
      } else if (requestError && /already registered|already exists|email_exists/i.test(requestError.providerMessage)) {
        statusCode = 409;
        message = 'This email is already registered with Supabase Auth. Check the existing Auth identity before retrying.';
      } else if (operationStage === 'auth_user_create' && requestError &&
        requestError.status >= 400 && requestError.status < 500) {
        message = 'Supabase Auth rejected the administrator identity. Check the configured password policy and Auth user settings.';
      } else if (['42P01', '42703', '42501', 'PGRST204', 'PGRST205'].includes(requestError?.code || '') ||
        operationStage === 'admin_record_insert') {
        message = 'Database setup incomplete. Check the admin account-management migration and service-role database permissions.';
      } else if (['auth_invitation', 'verification_email'].includes(operationStage) &&
        requestError?.status !== undefined && requestError.status >= 400 && requestError.status < 500) {
        message = 'Invitation delivery failed. Check Supabase Auth email provider, SMTP settings, site URL, and allowed redirect URLs.';
      }
      res.status(statusCode).json({ message });
    }
  });

  app.put('/api/admin/users/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    const actor = currentAdmin(res)!;
    const targetId = req.params.id;
    const role = req.body?.role as AdminRole;
    const status = req.body?.status as AdminIdentity['status'];
    const username = req.body?.username === '' || req.body?.username == null ? null : normalizeUsername(req.body.username);
    const permissions = role === 'owner'
      ? {}
      : role === 'super_admin' && req.body?.permissions == null
        ? defaultSuperAdminPermissions()
        : validateAdminPermissions(req.body?.permissions);
    if (!['owner', 'super_admin', 'custom_admin'].includes(role) ||
      !['pending', 'active', 'disabled'].includes(status) ||
      (req.body?.username != null && req.body.username !== '' && !username) ||
      (role !== 'owner' && !permissions)) {
      res.status(400).json({ message: 'Choose a valid username, role, status, and permission set.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to change administrator access.')) return;
    try {
      const target = await readAdminIdentity(targetId);
      if (!target) {
        res.status(404).json({ message: 'Administrator record not found.' });
        return;
      }
      if (target.role !== 'owner' && role === 'owner') {
        res.status(403).json({ message: 'Use the dedicated Co-Owner invitation workflow to grant Owner access.' });
        return;
      }
      if (target.isPrimaryOwner && (role !== 'owner' || status !== 'active')) {
        res.status(403).json({ message: 'Transfer primary ownership before changing the primary Owner account.' });
        return;
      }
      if (status === 'active') {
        const authUser = await readSupabaseJson<{ id?: string; email?: string; email_confirmed_at?: string }>(
          await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(target.id)}`),
        );
        if (authUser.id !== target.id || authUser.email?.toLowerCase() !== target.email.toLowerCase() || !authUser.email_confirmed_at) {
          res.status(409).json({ message: 'This account cannot be activated until its matching email identity is verified in Supabase Auth.' });
          return;
        }
      }
      if (target.id === actor.id && status !== 'active') {
        res.status(400).json({ message: 'You cannot disable your own active administrator account.' });
        return;
      }
      if (username && username !== target.username) {
        const usernameQuery = new URLSearchParams({ username: `eq.${username}`, select: 'id', limit: '1' });
        const duplicates = await readSupabaseJson<Array<{ id: string }>>(
          await supabaseAdminRequest(`rest/v1/admin_users?${usernameQuery}`),
        );
        if (duplicates.some((item) => item.id !== target.id)) {
          res.status(409).json({ message: 'This username is already assigned to another administrator.' });
          return;
        }
      }
      if (target.role === 'owner' && (role !== 'owner' || status !== 'active')) {
        const countQuery = new URLSearchParams({ role: 'eq.owner', status: 'eq.active', select: 'id' });
        const activeOwners = await readSupabaseJson<Array<{ id: string }>>(await supabaseAdminRequest(`rest/v1/admin_users?${countQuery}`));
        if (activeOwners.length <= 1) {
          res.status(409).json({ message: 'The last active Owner cannot be demoted or disabled.' });
          return;
        }
      }
      const query = new URLSearchParams({ id: `eq.${targetId}` });
      const updateResponse = await supabaseAdminRequest(`rest/v1/admin_users?${query}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ username, role, status, permissions, updated_at: new Date().toISOString() }),
      });
      await readSupabaseJson<unknown>(updateResponse);
      if (status !== 'active') {
        const sessionsQuery = new URLSearchParams({ user_id: `eq.${targetId}`, revoked_at: 'is.null' });
        await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        }));
        await revokeSupabaseRefreshTokens(targetId);
      }
      if (target.role !== role) {
        await writeAdminAudit(actor.id, 'admin.role.changed', 'settings', targetId, { oldRole: target.role, role });
      }
      if (JSON.stringify(target.permissions) !== JSON.stringify(permissions)) {
        await writeAdminAudit(actor.id, 'admin.permissions.updated', 'settings', targetId, { role, permissions });
      }
      if (target.status !== status) {
        await writeAdminAudit(actor.id, status === 'disabled' ? 'admin.disabled' : 'admin.enabled', 'settings', targetId, { oldStatus: target.status, status });
      }
      await writeAdminAudit(actor.id, 'admin.access.updated', 'settings', targetId, { oldRole: target.role, role, status, username, permissions });
      res.json({ message: 'Administrator access updated.' });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator access update failed:', error);
      res.status(503).json({ message: 'Administrator access could not be updated.' });
    }
  });

  app.post('/api/admin/users/:id/recovery', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!enforceAdminRateLimit(req, res, adminManagedRecoveryAttempts, 'Too many administrator password-reset requests. Please wait 15 minutes and try again.')) return;
    const actor = currentAdmin(res)!;
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to request a password reset.')) return;
    try {
      const target = await readAdminIdentity(req.params.id);
      if (!target) {
        res.status(404).json({ message: 'Administrator record not found.' });
        return;
      }
      if (target.isPrimaryOwner) {
        res.status(403).json({ message: 'The primary Owner manages only their own password through My Password.' });
        return;
      }
      if (target.status === 'disabled') {
        res.status(409).json({ message: 'This account is disabled. Enable it before issuing setup or recovery email.' });
        return;
      }
      if (target.status === 'pending') {
        const authUser = await readAdminAuthStatus(target.id);
        if (!authUser || authUser.email?.toLowerCase() !== target.email.toLowerCase()) {
          res.status(409).json({ message: 'The matching Supabase Auth identity is unavailable. Do not create a duplicate; review the Auth account first.' });
          return;
        }
        if (!authUser.email_confirmed_at) {
          const temporarySetup = target.mustChangePassword ? '?setup=temporary' : '';
          const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/accept-invite${temporarySetup}`;
          const query = new URLSearchParams({ type: 'signup', redirect_to: redirectTo });
          await readSupabaseJson<unknown>(await supabaseAuthRequest(`resend?${query}`, {
            method: 'POST',
            body: JSON.stringify({ type: 'signup', email: target.email }),
          }));
          await writeAdminAudit(actor.id, 'admin.invitation.resent', 'settings', target.id, {
            provider: 'supabase_auth',
            delivery: 'dispatch_initiated',
            kind: 'verification',
          });
          res.json({ message: 'Supabase Auth accepted a new verification-email request. Delivery is not confirmed; access remains blocked until verification.' });
          return;
        }
        const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/password-reset`;
        const query = new URLSearchParams({ redirect_to: redirectTo });
        await readSupabaseJson<unknown>(await supabaseAuthRequest(`recover?${query}`, {
          method: 'POST',
          body: JSON.stringify({ email: target.email }),
        }));
        await writeAdminAudit(actor.id, 'admin.invitation.setup_link_resent', 'settings', target.id, {
          provider: 'supabase_auth',
          delivery: 'dispatch_initiated',
          kind: 'password_setup',
        });
        res.json({ message: 'Supabase Auth accepted a secure password-setup request. Delivery is not confirmed; the account remains pending until setup is completed.' });
        return;
      }
      const authUser = await readSupabaseJson<{ id?: string; email?: string; email_confirmed_at?: string }>(
        await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(target.id)}`),
      );
      if (authUser.id !== target.id || authUser.email?.toLowerCase() !== target.email.toLowerCase() || !authUser.email_confirmed_at) {
        res.status(409).json({ message: 'A password reset can be sent only to the verified email identity associated with this account.' });
        return;
      }
      const userQuery = new URLSearchParams({ id: `eq.${target.id}` });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${userQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ must_change_password: true, updated_at: new Date().toISOString() }),
      }));
      const sessionsQuery = new URLSearchParams({ user_id: `eq.${target.id}`, revoked_at: 'is.null' });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }));
      await revokeSupabaseRefreshTokens(target.id);
      const redirectTo = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/admin/password-reset`;
      const query = new URLSearchParams({ redirect_to: redirectTo });
      await readSupabaseJson<unknown>(await supabaseAuthRequest(`recover?${query}`, {
        method: 'POST',
        body: JSON.stringify({ email: target.email }),
      }));
      await writeAdminAudit(actor.id, 'admin.password_reset.requested', 'security', target.id);
      res.json({ message: 'A secure password-reset link has been sent. The account must set a new password before signing in; existing sessions were revoked.' });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator recovery request failed:', error);
      res.status(503).json({ message: 'The password-reset email could not be sent. Check Supabase Auth SMTP settings.' });
    }
  });

  app.post('/api/admin/users/:id/cancel', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    const actor = currentAdmin(res)!;
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to cancel this invitation.')) return;
    try {
      const target = await readAdminIdentity(req.params.id);
      if (!target) {
        res.status(404).json({ message: 'Administrator record not found.' });
        return;
      }
      if (target.isPrimaryOwner || target.role === 'owner') {
        res.status(403).json({ message: 'Owner accounts cannot be cancelled from delegated invitation management.' });
        return;
      }
      const cancellation = await readSupabaseJson<{ status?: string }>(
        await supabaseAdminRequest('rest/v1/rpc/cancel_admin_invitation', {
          method: 'POST',
          body: JSON.stringify({ p_actor_id: actor.id, p_target_id: target.id }),
        }),
      );
      if (cancellation.status === 'already_cancelled') {
        await revokeSupabaseRefreshTokens(target.id);
        res.json({ message: 'Invitation was already cancelled. CMS access remains revoked and the Auth identity was retained safely.' });
        return;
      }
      await revokeSupabaseRefreshTokens(target.id);
      res.json({ message: 'Invitation cancelled. CMS access and username login were revoked; the Auth identity was retained safely.' });
    } catch (error) {
      if (error instanceof SupabaseRequestError && error.providerMessage) {
        res.status(409).json({ message: error.providerMessage });
        return;
      }
      console.error('[NearGrow Ads] Administrator invitation cancellation failed.', error instanceof Error ? error.name : 'Unknown error');
      res.status(503).json({ message: 'The pending invitation could not be cancelled. Try again or contact the system administrator.' });
    }
  });

  app.post('/api/admin/users/:id/password', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!enforceAdminRateLimit(req, res, adminManagedRecoveryAttempts, 'Too many administrator password changes. Please wait 15 minutes and try again.')) return;
    const actor = currentAdmin(res)!;
    const { newPassword, confirmPassword } = req.body || {};
    if (!isStrongAdminPassword(newPassword) || newPassword !== confirmPassword) {
      res.status(400).json({ message: 'Enter matching passwords with at least 12 characters and at least three character types.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to reset this administrator password.')) return;
    try {
      const target = await readAdminIdentity(req.params.id);
      if (!target) {
        res.status(404).json({ message: 'Administrator record not found.' });
        return;
      }
      if (target.isPrimaryOwner || target.role === 'owner') {
        res.status(403).json({ message: 'Temporary password resets are only available for delegated Super Admin and Custom Admin accounts.' });
        return;
      }
      if (target.status !== 'active') {
        res.status(409).json({ message: 'Only an active, verified administrator account can receive a temporary password.' });
        return;
      }
      const authUser = await readSupabaseJson<{ id?: string; email?: string; email_confirmed_at?: string }>(
        await supabaseAdminRequest(`auth/v1/admin/users/${encodeURIComponent(target.id)}`),
      );
      if (authUser.id !== target.id || authUser.email?.toLowerCase() !== target.email.toLowerCase() || !authUser.email_confirmed_at) {
        res.status(409).json({ message: 'A temporary password can be set only for the verified email identity associated with this account.' });
        return;
      }
      const userQuery = new URLSearchParams({ id: `eq.${target.id}` });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${userQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ must_change_password: true, updated_at: new Date().toISOString() }),
      }));
      await setSupabaseUserPassword(target.id, newPassword);
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${userQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ last_password_reset_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      }));
      const sessionsQuery = new URLSearchParams({ user_id: `eq.${target.id}`, revoked_at: 'is.null' });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }));
      await revokeSupabaseRefreshTokens(target.id);
      await writeAdminAudit(actor.id, 'admin.password_reset.temporary', 'security', target.id);
      res.json({ message: 'Temporary password set in Supabase Auth. Deliver it to the administrator through a secure channel; it must be changed at first sign-in. Their CMS sessions and Supabase refresh tokens were revoked.' });
    } catch (error) {
      console.error('[NearGrow Ads] Temporary administrator password reset failed.', error instanceof Error ? error.name : 'Unknown error');
      res.status(503).json({ message: 'The temporary password could not be set securely. Check the Supabase Auth Admin API configuration.' });
    }
  });

  app.post('/api/admin/auth/first-password', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = currentAdmin(res)!;
    if (identity.isPrimaryOwner || identity.role === 'owner' || identity.mustChangePassword !== true) {
      res.status(403).json({ message: 'A forced first-login password change is not pending for this delegated account.' });
      return;
    }
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!isStrongAdminPassword(newPassword) || newPassword !== confirmPassword) {
      res.status(400).json({ message: 'Enter matching passwords with at least 12 characters and at least three character types.' });
      return;
    }
    try {
      const accessToken = await reauthenticateAdminRequest(
        req,
        res,
        identity,
        currentPassword,
        'Enter the temporary password provided by your Owner.',
      );
      if (!accessToken) return;
      await readSupabaseJson<unknown>(await supabaseAuthRequest('user', {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      }, accessToken));
      const userQuery = new URLSearchParams({ id: `eq.${identity.id}` });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${userQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          must_change_password: false,
          last_password_reset_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }));
      const currentSessionId = readAdminSession(req)?.sessionId;
      const sessionsQuery = new URLSearchParams({
        user_id: `eq.${identity.id}`,
        revoked_at: 'is.null',
        ...(currentSessionId ? { id: `neq.${currentSessionId}` } : {}),
      });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }));
      await revokeSupabaseRefreshTokens(identity.id);
      await writeAdminAudit(identity.id, 'auth.password.temporary_changed', 'security');
      res.json({ message: 'Password changed. Your temporary password is no longer valid.' });
    } catch (error) {
      console.error('[NearGrow Ads] First-login password change failed.', error instanceof Error ? error.name : 'Unknown error');
      res.status(503).json({ message: 'Your password could not be changed. Contact the Owner before retrying.' });
    }
  });

  app.get('/api/admin/sessions/mine', async (_req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(_req, res)) return;
    const identity = currentAdmin(res)!;
    const currentSessionId = readAdminSession(_req)?.sessionId;
    try {
      const query = new URLSearchParams({
        user_id: `eq.${identity.id}`,
        select: 'id,created_at,expires_at,revoked_at,user_agent',
        order: 'created_at.desc',
        limit: '100',
      });
      const sessions = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_sessions?${query}`));
      res.json({ sessions: sessions.map((session) => ({ ...session, current: session.id === currentSessionId })) });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator session list failed:', error);
      res.status(503).json({ message: 'Your session list is temporarily unavailable.' });
    }
  });

  app.get('/api/admin/sessions', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    const currentSessionId = readAdminSession(req)?.sessionId;
    try {
      const query = new URLSearchParams({
        select: 'id,user_id,created_at,expires_at,revoked_at,user_agent,admin_users(email,role)',
        order: 'created_at.desc',
        limit: '200',
      });
      const sessions = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_sessions?${query}`));
      res.json({ sessions: sessions.map((session) => ({ ...session, current: session.id === currentSessionId })) });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator session directory failed:', error);
      res.status(503).json({ message: 'Administrator sessions are temporarily unavailable.' });
    }
  });

  app.delete('/api/admin/sessions/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = currentAdmin(res)!;
    try {
      const query = new URLSearchParams({ id: `eq.${req.params.id}`, select: 'id,user_id' });
      const sessions = await readSupabaseJson<Array<{ id: string; user_id: string }>>(await supabaseAdminRequest(`rest/v1/admin_sessions?${query}`));
      const target = sessions[0];
      if (!target) {
        res.status(404).json({ message: 'Session not found.' });
        return;
      }
      if (target.user_id !== identity.id && !identity.isPrimaryOwner) {
        res.status(403).json({ message: 'You may revoke only your own sessions.' });
        return;
      }
      const revokeQuery = new URLSearchParams({ id: `eq.${req.params.id}`, revoked_at: 'is.null' });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${revokeQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }));
      await writeAdminAudit(identity.id, 'auth.session.revoked', 'security', target.user_id);
      res.json({ message: 'Session revoked.', currentSession: target.id === readAdminSession(req)?.sessionId });
    } catch (error) {
      console.error('[NearGrow Ads] Session revocation failed:', error);
      res.status(503).json({ message: 'The session could not be revoked.' });
    }
  });

  app.post('/api/admin/users/:id/sessions/revoke', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    const actor = currentAdmin(res)!;
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to revoke administrator sessions.')) return;
    try {
      const target = await readAdminIdentity(req.params.id);
      if (!target) {
        res.status(404).json({ message: 'Administrator record not found.' });
        return;
      }
      if (target.isPrimaryOwner) {
        res.status(403).json({ message: 'Primary Owner sessions cannot be revoked from administrator management.' });
        return;
      }
      const sessionsQuery = new URLSearchParams({ user_id: `eq.${target.id}`, revoked_at: 'is.null' });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }));
      await revokeSupabaseRefreshTokens(target.id);
      await writeAdminAudit(actor.id, 'auth.sessions.revoked', 'security', target.id);
      res.json({ message: 'All active administrator sessions were revoked.' });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator session revocation failed:', error);
      res.status(503).json({ message: 'Administrator sessions could not be revoked.' });
    }
  });

  app.delete('/api/admin/users/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!enforceAdminRateLimit(req, res, adminManagedRecoveryAttempts, 'Too many administrator account changes. Please wait 15 minutes and try again.')) return;
    const actor = currentAdmin(res)!;
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to delete this administrator.')) return;
    try {
      const target = await readAdminIdentity(req.params.id);
      if (!target) {
        res.status(404).json({ message: 'Administrator record not found.' });
        return;
      }
      if (target.isPrimaryOwner || target.role === 'owner') {
        res.status(403).json({ message: 'Owner accounts cannot be deleted from delegated-account management.' });
        return;
      }
      const disabledAt = new Date().toISOString();
      const userQuery = new URLSearchParams({ id: `eq.${target.id}` });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${userQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'disabled',
          username: null,
          permissions: {},
          updated_at: disabledAt,
        }),
      }));
      const sessionsQuery = new URLSearchParams({ user_id: `eq.${target.id}`, revoked_at: 'is.null' });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${sessionsQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: disabledAt }),
      }));
      await revokeSupabaseRefreshTokens(target.id);
      await writeAdminAudit(actor.id, 'admin.removed', 'settings', target.id, {
        removalPolicy: 'revoke_cms_access_keep_auth_identity_and_history',
        email: target.email,
        role: target.role,
      });
      res.json({ message: 'Administrator CMS access was removed, sessions were revoked, and audit history was preserved. The Supabase Auth identity was retained to avoid affecting other application features.' });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator deletion failed.', error instanceof Error ? error.name : 'Unknown error');
      res.status(503).json({ message: 'The administrator could not be deleted. Check Supabase Auth Admin API configuration.' });
    }
  });

  app.post('/api/admin/profile/password', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = currentAdmin(res)!;
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword !== confirmPassword || newPassword.length < 12 ||
      newPassword.length > 200 || new Set([
        /[a-z]/.test(newPassword),
        /[A-Z]/.test(newPassword),
        /\d/.test(newPassword),
        /[^A-Za-z0-9]/.test(newPassword),
      ].filter(Boolean)).size < 3) {
      res.status(400).json({ message: 'Use a matching password with at least 12 characters and at least three character types.' });
      return;
    }
    try {
      const accessToken = await reauthenticateAdminRequest(req, res, identity, currentPassword, 'The current password is incorrect. Google-only accounts must use their identity provider recovery flow.');
      if (!accessToken) return;
      await readSupabaseJson<unknown>(await supabaseAuthRequest('user', {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      }, accessToken));
      await revokeSupabaseRefreshTokens(identity.id);
      const userQuery = new URLSearchParams({ id: `eq.${identity.id}` });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_users?${userQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ last_password_reset_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      }));
      await writeAdminAudit(identity.id, 'auth.password.changed', 'security');
      const revokeQuery = new URLSearchParams({ user_id: `eq.${identity.id}`, revoked_at: 'is.null' });
      await readSupabaseJson<unknown>(await supabaseAdminRequest(`rest/v1/admin_sessions?${revokeQuery}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      }));
      res.clearCookie(ADMIN_SESSION_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'strict',
        path: '/api/admin',
      });
      res.json({ message: 'Password updated. Sign in again with your new password.' });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator password change failed:', error);
      res.status(503).json({ message: 'The password could not be updated. Check that this account uses Supabase email/password authentication.' });
    }
  });

  app.get('/api/admin/security-monitoring/website-activity', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    scheduleWebsiteActivityCleanup(Date.now());
    try {
      const response = await supabaseAdminRequest('rest/v1/rpc/get_active_website_activity', { method: 'POST', body: '{}' });
      if (!response.ok) {
        const code = await websiteActivityDatabaseErrorCode(response);
        console.error('[NearGrow Ads] Website activity summary query failed:', { status: response.status, code });
        res.status(503).json({ message: 'Live website activity is unavailable. Verify its database migration and access.' });
        return;
      }
      const rows = await readSupabaseJson<Array<{
        active_visitors: number;
        active_pages: Array<{ path: string; count: number }>;
        device_breakdown: { mobile: number; desktop: number; tablet: number };
        last_activity_at: string | null;
        generated_at: string;
      }>>(response);
      const summary = rows[0];
      if (!summary || !Number.isSafeInteger(summary.active_visitors) || summary.active_visitors < 0 ||
        !Array.isArray(summary.active_pages) ||
        !summary.active_pages.every((page) => typeof page.path === 'string' && Number.isSafeInteger(page.count) && page.count >= 0) ||
        !summary.device_breakdown ||
        !Number.isSafeInteger(summary.device_breakdown.mobile) || summary.device_breakdown.mobile < 0 ||
        !Number.isSafeInteger(summary.device_breakdown.desktop) || summary.device_breakdown.desktop < 0 ||
        !Number.isSafeInteger(summary.device_breakdown.tablet) || summary.device_breakdown.tablet < 0 ||
        !(summary.last_activity_at === null || Number.isFinite(Date.parse(summary.last_activity_at))) ||
        !Number.isFinite(Date.parse(summary.generated_at))) {
        throw new Error('The website activity summary response was incomplete.');
      }
      res.json({
        activeVisitors: summary.active_visitors,
        pages: summary.active_pages,
        devices: summary.device_breakdown,
        lastActivityAt: summary.last_activity_at,
        generatedAt: summary.generated_at,
      });
    } catch (error) {
      console.error('[NearGrow Ads] Website activity summary query failed:', error instanceof Error ? error.message : 'unknown error');
      res.status(503).json({ message: 'Live website activity is unavailable. Verify its database migration and access.' });
    }
  });

  app.get('/api/admin/security-monitoring', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.eventPage || 1);
    const alertPage = Number(req.query.alertPage || 1);
    const pageSize = 50;
    const rawAlertStatus = req.query.alertStatus;
    const rawEventSeverity = req.query.eventSeverity;
    if (!Number.isInteger(page) || page < 1 || page > 10_000 ||
      !Number.isInteger(alertPage) || alertPage < 1 || alertPage > 10_000 ||
      (rawAlertStatus !== undefined && (typeof rawAlertStatus !== 'string' ||
        !['all', 'new', 'investigating', 'resolved'].includes(rawAlertStatus))) ||
      (rawEventSeverity !== undefined && (typeof rawEventSeverity !== 'string' ||
        !['all', 'low', 'medium', 'high', 'critical'].includes(rawEventSeverity)))) {
      res.status(400).json({ message: 'Choose a valid security event page and alert filter.' });
      return;
    }
    const alertStatus = typeof rawAlertStatus === 'string' ? rawAlertStatus : 'all';
    const eventSeverity = typeof rawEventSeverity === 'string' ? rawEventSeverity : 'all';
    const eventSearch = typeof req.query.eventSearch === 'string' ? req.query.eventSearch.trim().slice(0, 60) : '';
    try {
      const rangeStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const countFrom = async (tablePath: string): Promise<number> => {
        const response = await supabaseAdminRequest(tablePath, {
          method: 'HEAD',
          headers: { Prefer: 'count=exact' },
        });
        if (!response.ok) {
          await readSupabaseJson<unknown>(response);
          throw new Error(`Security monitoring count query failed (${response.status}).`);
        }
        const match = /\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!match) throw new Error('Security monitoring count response was incomplete.');
        return Number(match[1]);
      };
      const tableRows = async <T>(tablePath: string, init?: RequestInit): Promise<T> =>
        readSupabaseJson<T>(await supabaseAdminRequest(tablePath, init));
      const rulesRows = await tableRows<Array<{ settings: unknown; updated_at: string }>>(
        'rest/v1/security_detection_rules?id=eq.default&select=settings,updated_at&limit=1',
      );
      const rules = validateSecurityRules(rulesRows[0]?.settings);
      if (!rules) throw new Error('Security detection rules are missing or invalid.');
      await tableRows<unknown>('rest/v1/rpc/prune_expired_security_events', {
        method: 'POST',
        body: JSON.stringify({ p_retention_days: 180, p_batch_size: 500 }),
      });

      const detectionStart = new Date(Date.now() - Math.max(rules.windowMinutes, 24 * 60) * 60_000).toISOString();
      const detectionParams = new URLSearchParams({
        select: 'id,event_type,occurred_at,actor_id,subject_hash,route,status_code,details',
        event_type: 'in.(auth.login.failed,api.unauthorized)',
        occurred_at: `gte.${detectionStart}`,
        order: 'occurred_at.desc,id.desc',
        limit: '5000',
      });
      const detectionEvents = await tableRows<Array<Record<string, unknown>>>(
        `rest/v1/security_events?${detectionParams}`,
      );
      const privilegedActions = [
        'admin.created_with_temporary_password',
        'admin.invited',
        'admin.role.changed',
        'admin.permissions.updated',
        'admin.disabled',
        'admin.removed',
        'admin.access.updated',
        'leads.export.generated',
      ];
      const auditDetectionParams = new URLSearchParams({
        select: 'id,actor_id,target_id,action,details,created_at,actor:admin_users!admin_audit_logs_actor_id_fkey(is_primary_owner)',
        action: `in.(${privilegedActions.join(',')})`,
        created_at: `gte.${detectionStart}`,
        order: 'created_at.desc,id.desc',
        limit: '1000',
      });
      const auditDetectionEvents = await tableRows<Array<Record<string, unknown>>>(
        `rest/v1/admin_audit_logs?${auditDetectionParams}`,
      );
      const sourceEvents: SecuritySourceEvent[] = [
        ...detectionEvents.map((event) => ({
          id: String(event.id),
          eventType: String(event.event_type),
          occurredAt: String(event.occurred_at),
          actorId: typeof event.actor_id === 'string' ? event.actor_id : null,
          subjectHash: typeof event.subject_hash === 'string' ? event.subject_hash : null,
          route: typeof event.route === 'string' ? event.route : null,
          statusCode: typeof event.status_code === 'number' ? event.status_code : null,
          details: sanitizeSecurityDetails(event.details),
        })),
        ...auditDetectionEvents.map((event) => {
          const actor = event.actor && typeof event.actor === 'object' ? event.actor as Record<string, unknown> : {};
          return {
            id: String(event.id),
            eventType: 'audit',
            occurredAt: String(event.created_at),
            actorId: typeof event.actor_id === 'string' ? event.actor_id : null,
            action: String(event.action),
            details: sanitizeSecurityDetails(event.details),
            ...(typeof actor.is_primary_owner === 'boolean' ? { actorIsPrimaryOwner: actor.is_primary_owner } : {}),
          };
        }),
      ];
      const indicators = detectSecurityIndicators(sourceEvents, rules).slice(0, 250);
      const storedAlerts = await tableRows<Array<Record<string, unknown>>>(
        'rest/v1/security_alerts?select=id,rule_id,fingerprint,severity,status,title,summary,event_ids,first_seen_at,last_seen_at,acknowledged_by,acknowledged_at,resolved_by,resolved_at&order=last_seen_at.desc&limit=5000',
      );
      const existingByKey = new Map(storedAlerts.map((alert) => [`${alert.rule_id}:${alert.fingerprint}`, alert]));
      for (const indicator of indicators) {
        const key = `${indicator.ruleId}:${indicator.fingerprint}`;
        const existing = existingByKey.get(key);
        if (!existing) {
          const params = new URLSearchParams({ select: '*' });
          const response = await supabaseAdminRequest(`rest/v1/security_alerts?${params}`, {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              rule_id: indicator.ruleId,
              fingerprint: indicator.fingerprint,
              severity: indicator.severity,
              status: 'new',
              title: indicator.title,
              summary: indicator.summary,
              event_ids: indicator.eventIds,
              first_seen_at: indicator.firstSeenAt,
              last_seen_at: indicator.lastSeenAt,
            }),
          });
          const created = await readSupabaseJson<Array<Record<string, unknown>>>(response);
          if (!created[0]) throw new Error('The detected security indicator was not persisted.');
          existingByKey.set(key, created[0]);
          recordSecurityEventSafely({
            eventType: 'security.alert.detected',
            severity: indicator.severity,
            details: { ruleId: indicator.ruleId, alertId: created[0].id },
          });
        } else {
          const wasResolved = existing.status === 'resolved';
          const updateQuery = new URLSearchParams({ id: `eq.${String(existing.id)}` });
          const updateResponse = await supabaseAdminRequest(`rest/v1/security_alerts?${updateQuery}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              severity: indicator.severity,
              status: wasResolved ? 'new' : existing.status,
              title: indicator.title,
              summary: indicator.summary,
              event_ids: indicator.eventIds,
              last_seen_at: indicator.lastSeenAt,
              updated_at: new Date().toISOString(),
              ...(wasResolved ? { acknowledged_by: null, acknowledged_at: null, resolved_by: null, resolved_at: null } : {}),
            }),
          });
          await readSupabaseJson<unknown>(updateResponse);
          existing.status = wasResolved ? 'new' : existing.status;
          if (wasResolved) recordSecurityEventSafely({
            eventType: 'security.alert.reopened',
            severity: indicator.severity,
            details: { ruleId: indicator.ruleId, alertId: existing.id },
          });
        }
      }

      const eventParams = new URLSearchParams({
        select: 'id,event_type,severity,actor_id,route,status_code,details,occurred_at',
        occurred_at: `gte.${rangeStart}`,
        order: 'occurred_at.desc,id.desc',
        limit: String(pageSize),
        offset: String(securityEventPageOffset(page, pageSize)),
      });
      if (eventSearch) eventParams.set('event_type', `ilike.*${eventSearch.replace(/[^a-zA-Z0-9_.-]/g, '')}*`);
      if (eventSeverity !== 'all') eventParams.set('severity', `eq.${eventSeverity}`);
      const eventCountParams = new URLSearchParams({ select: 'id', occurred_at: `gte.${rangeStart}` });
      if (eventSearch) eventCountParams.set('event_type', `ilike.*${eventSearch.replace(/[^a-zA-Z0-9_.-]/g, '')}*`);
      if (eventSeverity !== 'all') eventCountParams.set('severity', `eq.${eventSeverity}`);
      const accessActions = [
        'admin.created_with_temporary_password', 'admin.invited', 'admin.role.changed',
        'admin.permissions.updated', 'admin.disabled', 'admin.removed', 'admin.access.updated',
      ];
      const accessParams = new URLSearchParams({
        select: 'id,actor_id,target_id,action,section,details,created_at,actor:admin_users!admin_audit_logs_actor_id_fkey(is_primary_owner)',
        action: `in.(${accessActions.join(',')})`,
        order: 'created_at.desc,id.desc',
        limit: '10',
      });
      const activeSessionParams = new URLSearchParams({
        select: 'id',
        revoked_at: 'is.null',
        expires_at: `gt.${new Date().toISOString()}`,
      });
      const alertParams = new URLSearchParams({
        select: 'id,rule_id,severity,status,title,summary,event_ids,first_seen_at,last_seen_at,acknowledged_by,acknowledged_at,resolved_by,resolved_at',
        order: 'last_seen_at.desc,id.desc',
        limit: String(pageSize),
        offset: String(securityEventPageOffset(alertPage, pageSize)),
      });
      if (alertStatus !== 'all') alertParams.set('status', `eq.${alertStatus}`);
      const alertCountParams = new URLSearchParams({ select: 'id' });
      if (alertStatus !== 'all') alertCountParams.set('status', `eq.${alertStatus}`);

      const [
        totalEvents, failedLogins, unauthorizedRequests, activeSessions, alertCount, eventTotal, filteredAlertTotal,
        events, alerts, recentAccessChanges,
      ] = await Promise.all([
        countFrom(`rest/v1/security_monitoring_feed?select=id&occurred_at=gte.${encodeURIComponent(rangeStart)}`),
        countFrom(`rest/v1/security_events?select=id&event_type=eq.auth.login.failed&occurred_at=gte.${encodeURIComponent(rangeStart)}`),
        countFrom(`rest/v1/security_events?select=id&event_type=eq.api.unauthorized&occurred_at=gte.${encodeURIComponent(rangeStart)}`),
        countFrom(`rest/v1/admin_sessions?${activeSessionParams}`),
        countFrom('rest/v1/security_alerts?select=id&status=in.(new,investigating)'),
        countFrom(`rest/v1/security_monitoring_feed?${eventCountParams}`),
        countFrom(`rest/v1/security_alerts?${alertCountParams}`),
        tableRows<Array<Record<string, unknown>>>(`rest/v1/security_monitoring_feed?${eventParams}`),
        tableRows<Array<Record<string, unknown>>>(`rest/v1/security_alerts?${alertParams}`),
        tableRows<Array<Record<string, unknown>>>(`rest/v1/admin_audit_logs?${accessParams}`),
      ]);
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const timelineDaily = await Promise.all(Array.from({ length: 7 }, async (_unused, index) => {
        const day = new Date(todayUtc.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
        const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
        const dayQuery = new URLSearchParams({
          select: 'id',
          occurred_at: `gte.${day.toISOString()}`,
          and: `(occurred_at.lt.${nextDay.toISOString()})`,
        });
        return {
          date: day.toISOString().slice(0, 10),
          count: await countFrom(`rest/v1/security_monitoring_feed?${dayQuery}`),
        };
      }));
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        rangeStart,
        page,
        pageSize,
        eventTotal,
        eventSeverity,
        events: events.map((event) => ({
          id: event.id,
          eventType: event.event_type,
          severity: event.severity,
          actorId: event.actor_id,
          route: event.route,
          statusCode: event.status_code,
          details: sanitizeSecurityDetails(event.details),
          occurredAt: event.occurred_at,
        })),
        counters: { totalEvents, failedLogins, unauthorizedRequests, suspiciousAlerts: alertCount, activeSessions },
        alerts,
        alertPage,
        alertTotal: filteredAlertTotal,
        alertStatus,
        timelineDaily,
        rules,
        rulesUpdatedAt: rulesRows[0].updated_at,
        recentAccessChanges: recentAccessChanges.map((event) => ({
          id: event.id,
          actorId: event.actor_id,
          targetId: event.target_id,
          action: event.action,
          createdAt: event.created_at,
          actorIsPrimaryOwner: typeof (event.actor as Record<string, unknown> | undefined)?.is_primary_owner === 'boolean'
            ? (event.actor as Record<string, unknown>).is_primary_owner === true
            : null,
        })),
      });
    } catch (error) {
      const databaseError = error instanceof SupabaseRequestError ? error : undefined;
      const databaseStatus = databaseError?.status ?? (error instanceof TypeError ? 0 : undefined);
      const databaseCode = databaseError?.code;
      console.error('[NearGrow Ads] Security Monitoring data could not be loaded.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        databaseStatus,
        databaseCode,
        providerMessage: databaseError?.providerMessage || undefined,
      });
      res.status(503).json({
        message: securityMonitoringFailureMessage(databaseStatus, databaseCode),
        databaseCode,
      });
    }
  });

  app.put('/api/admin/security-monitoring/rules', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const rules = validateSecurityRules(req.body);
    if (!rules) {
      res.status(400).json({ message: 'Detection thresholds are invalid or outside the supported safe ranges.' });
      return;
    }
    try {
      const actor = currentAdmin(res)!;
      const response = await supabaseAdminRequest('rest/v1/rpc/save_security_detection_rules', {
        method: 'POST',
        body: JSON.stringify({ p_settings: rules, p_actor_id: actor.id }),
      });
      const updated = await readSupabaseJson<Array<{ settings: SecurityRuleSettings; updated_at: string }>>(
        response,
      );
      if (!updated[0]) throw new Error('The updated security rules were not returned.');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ rules: updated[0].settings, updatedAt: updated[0].updated_at });
    } catch (error) {
      console.error('[NearGrow Ads] Security detection rules could not be saved.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Security detection rules could not be saved.' });
    }
  });

  app.patch('/api/admin/security-monitoring/alerts/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const status = req.body?.status as SecurityAlertStatus;
    if (!['investigating', 'resolved'].includes(status)) {
      res.status(400).json({ message: 'Choose Investigating or Resolved for this alert.' });
      return;
    }
    try {
      const actor = currentAdmin(res)!;
      const response = await supabaseAdminRequest('rest/v1/rpc/update_security_alert_status', {
        method: 'POST',
        body: JSON.stringify({ p_alert_id: req.params.id, p_status: status, p_actor_id: actor.id }),
      });
      const alert = await readSupabaseJson<Record<string, unknown> | null>(response);
      if (!alert) {
        res.status(404).json({ message: 'The alert could not be found or is already resolved.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ alert });
    } catch (error) {
      console.error('[NearGrow Ads] Security alert status update failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The alert status could not be updated.' });
    }
  });

  app.get('/api/admin/audit-logs/export', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;

    const format = req.query.format === 'csv' ? 'csv' : req.query.format === 'json' ? 'json' : undefined;
    const scope = req.query.scope === 'all' ? 'all' : req.query.scope === 'date_range' ? 'date_range' : undefined;
    if (!format || !scope) {
      res.status(400).json({ message: 'Choose a supported export format and scope.' });
      return;
    }

    const exportedAt = new Date().toISOString();
    let snapshotCutoff = exportedAt;
    if (req.query.cutoff !== undefined) {
      if (typeof req.query.cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(req.query.cutoff)) {
        res.status(400).json({ message: 'The export snapshot cutoff is invalid.' });
        return;
      }
      const cutoffDate = new Date(req.query.cutoff);
      if (Number.isNaN(cutoffDate.getTime()) || cutoffDate.toISOString() !== req.query.cutoff) {
        res.status(400).json({ message: 'The export snapshot cutoff is invalid.' });
        return;
      }
      snapshotCutoff = req.query.cutoff;
    }

    let dateRange: ReturnType<typeof resolveAuditDateRange> | undefined;
    if (scope === 'date_range') {
      if (typeof req.query.from !== 'string' || typeof req.query.to !== 'string') {
        res.status(400).json({ message: 'Choose both dates for the custom date range.' });
        return;
      }
      try {
        dateRange = resolveAuditDateRange(req.query.from, req.query.to, AUDIT_EXPORT_TIME_ZONE);
      } catch (error) {
        res.status(400).json({ message: error instanceof Error ? error.message : 'Choose a valid custom date range.' });
        return;
      }
    }
    const identity = currentAdmin(res)!;
    const filters = new URLSearchParams({
      select: 'id,actor_id,target_id,action,section,details,created_at,actor:admin_users!admin_audit_logs_actor_id_fkey(email),target:admin_users!admin_audit_logs_target_id_fkey(email)',
      'created_at': `lt.${snapshotCutoff}`,
    });
    if (dateRange) {
      filters.set('created_at', `gte.${dateRange.startUtc}`);
      filters.set('and', `(created_at.lt.${dateRange.endUtcExclusive},created_at.lt.${snapshotCutoff})`);
    }

    const requestAbort = new AbortController();
    let clientDisconnected = false;
    const abortForDisconnect = () => {
      if (res.writableEnded) return;
      clientDisconnected = true;
      requestAbort.abort();
    };
    res.once('close', abortForDisconnect);
    req.once('aborted', abortForDisconnect);

    const writeChunk = async (chunk: string): Promise<void> => {
      if (clientDisconnected || res.destroyed) throw new Error('The audit export client disconnected.');
      if (!res.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            res.removeListener('drain', onDrain);
            res.removeListener('close', onClose);
            res.removeListener('error', onError);
          };
          const onDrain = () => { cleanup(); resolve(); };
          const onClose = () => { cleanup(); reject(new Error('The audit export client disconnected.')); };
          const onError = (error: Error) => { cleanup(); reject(error); };
          res.once('drain', onDrain);
          res.once('close', onClose);
          res.once('error', onError);
        });
      }
      if (clientDisconnected || res.destroyed) throw new Error('The audit export client disconnected.');
    };

    try {
      const countQuery = new URLSearchParams(filters);
      countQuery.set('select', 'id');
      countQuery.set('limit', '1');
      const countResponse = await supabaseAdminRequest(`rest/v1/admin_audit_logs?${countQuery}`, {
        headers: { Prefer: 'count=exact', Range: '0-0' },
        signal: requestAbort.signal,
      });
      if (!countResponse.ok) {
        await countResponse.text();
        throw new Error(`Audit export count query failed (${countResponse.status}).`);
      }
      const contentRange = countResponse.headers.get('content-range');
      const totalRecordsText = contentRange?.split('/')[1];
      const expectedCount = totalRecordsText && totalRecordsText !== '*' ? Number(totalRecordsText) : NaN;
      await countResponse.body?.cancel();
      if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
        throw new Error('The audit export record count was unavailable.');
      }

      const filenameTimestamp = exportedAt.slice(0, 19).replace(/:/g, '') + 'Z';
      const filename = `neargrowads-security-audit-${filenameTimestamp}.${format}`;
      if (req.query.preview === '1') {
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.json({ recordCount: expectedCount, snapshotCutoff, filename });
        return;
      }
      res.status(200);
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Expected-Records', String(expectedCount));
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');

      const exportFilters = dateRange
        ? { scope, from: dateRange.from, to: dateRange.to, timeZone: dateRange.timeZone }
        : { scope, timeZone: null };
      if (format === 'json') {
        await writeChunk(`${JSON.stringify({
          schemaVersion: '1.0',
          exportedAt,
          filters: exportFilters,
          recordCount: expectedCount,
          snapshotCutoff: { createdAtBeforeExclusive: snapshotCutoff, ordering: 'created_at DESC, id DESC' },
          records: [],
        }).replace(/,"records":\[\]$/, ',"records":[')}`);
      } else {
        await writeChunk(`\uFEFF${AUDIT_CSV_COLUMNS.join(',')}\r\n`);
      }

      let actualCount = 0;
      let redactedValueCount = 0;
      const redactedKeys = new Set<string>();
      for await (const rawRecord of iterateAuditLogRecords(async (cursor) => {
        const pageQuery = new URLSearchParams(filters);
        pageQuery.set('order', 'created_at.desc,id.desc');
        pageQuery.set('limit', String(AUDIT_EXPORT_PAGE_SIZE));
        if (dateRange) pageQuery.set('created_at', `gte.${dateRange.startUtc}`);
        if (cursor) {
          pageQuery.set('or', buildAuditLogCursorFilter(cursor.createdAt, cursor.id));
        }
        const pageResponse = await supabaseAdminRequest(`rest/v1/admin_audit_logs?${pageQuery}`, {
          signal: requestAbort.signal,
        });
        if (!pageResponse.ok) {
          await pageResponse.text();
          throw new Error(`Audit export page failed (${pageResponse.status}).`);
        }
        return await readSupabaseJson<Array<Record<string, unknown>>>(pageResponse);
      }, expectedCount)) {
        const safeRecord = sanitizeAuditRecord(normalizeAuditExportRecord(rawRecord));
        redactedValueCount += safeRecord.redactionCount;
        safeRecord.redactedKeys.forEach((key) => redactedKeys.add(key));
        if (format === 'json') {
          await writeChunk(`${actualCount ? ',' : ''}\n${JSON.stringify(safeRecord.record)}`);
        } else {
          await writeChunk(serializeAuditRecordCsv(safeRecord));
        }
        actualCount += 1;
      }

      await writeAdminAudit(identity.id, 'security.audit_logs.export_generated', 'security', undefined, {
        format,
        scope,
        recordCount: actualCount,
        ...(dateRange ? { from: dateRange.from, to: dateRange.to, timeZone: dateRange.timeZone } : {}),
        snapshotCutoff,
      });

      if (format === 'json') {
        await writeChunk(`\n],"redactions":${JSON.stringify({
          marker: '[REDACTED]',
          redactedValueCount,
          redactedKeys: [...redactedKeys].sort(),
          policy: 'Sensitive fields in event metadata are redacted server-side; source audit records are unchanged.',
        })}}\n`);
      }
      res.end();
    } catch (error) {
      if (!clientDisconnected) {
        console.error('[NearGrow Ads] Security audit export failed:', error);
        if (res.headersSent) res.destroy(error instanceof Error ? error : undefined);
        else res.status(503).json({ message: 'The audit-log export failed. No complete file was generated; retry the export.' });
      }
    } finally {
      res.removeListener('close', abortForDisconnect);
      req.removeListener('aborted', abortForDisconnect);
    }
  });

  app.get('/api/admin/audit-logs', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    try {
      const query = new URLSearchParams({
        select: 'id,actor_id,target_id,action,section,details,created_at,actor:admin_users!admin_audit_logs_actor_id_fkey(email),target:admin_users!admin_audit_logs_target_id_fkey(email)',
        order: 'created_at.desc',
        limit: '1000',
      });
      const logs = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_audit_logs?${query}`));
      res.json({ logs });
    } catch (error) {
      console.error('[NearGrow Ads] Administrator audit log load failed:', error);
      res.status(503).json({ message: 'Security audit records are temporarily unavailable.' });
    }
  });

  app.get('/api/admin/ownership', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = currentAdmin(res)!;
    if (identity.role !== 'owner') {
      res.status(403).json({ message: 'Only active Owners can view ownership records.' });
      return;
    }
    try {
      const query = new URLSearchParams({
        or: `(from_user_id.eq.${identity.id},to_user_id.eq.${identity.id})`,
        select: 'id,from_user_id,to_user_id,status,created_at,expires_at,accepted_at,from_user:admin_users!admin_ownership_transfers_from_user_id_fkey(email),to_user:admin_users!admin_ownership_transfers_to_user_id_fkey(email)',
        order: 'created_at.desc',
        limit: '100',
      });
      const transfers = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_ownership_transfers?${query}`));
      const ownersQuery = new URLSearchParams({ role: 'eq.owner', status: 'eq.active', select: 'id,email,is_primary_owner', order: 'email.asc' });
      const owners = await readSupabaseJson<Array<Record<string, unknown>>>(await supabaseAdminRequest(`rest/v1/admin_users?${ownersQuery}`));
      res.json({ transfers, owners });
    } catch (error) {
      console.error('[NearGrow Ads] Ownership records load failed:', error);
      res.status(503).json({ message: 'Ownership records are temporarily unavailable.' });
    }
  });

  app.post('/api/admin/ownership/transfers', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    const actor = currentAdmin(res)!;
    if (!actor.isPrimaryOwner) {
      res.status(403).json({ message: 'Only the current primary Owner can initiate a transfer.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to initiate the transfer.')) return;
    const recipientId = typeof req.body?.recipientId === 'string' ? req.body.recipientId : '';
    try {
      const recipient = await readAdminIdentity(recipientId);
      if (!recipient || recipient.id === actor.id || recipient.role !== 'owner' || recipient.status !== 'active') {
        res.status(400).json({ message: 'Select another active Co-Owner to receive primary ownership.' });
        return;
      }
      const response = await supabaseAdminRequest('rest/v1/admin_ownership_transfers', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ from_user_id: actor.id, to_user_id: recipient.id }),
      });
      const rows = await readSupabaseJson<Array<{ id: string }>>(response);
      const transferId = rows[0]?.id;
      if (!transferId) throw new Error('The ownership transfer request was not returned by the database.');
      await writeAdminAudit(actor.id, 'ownership.transfer.initiated', 'ownership', recipient.id, { transferId });
      res.status(201).json({ message: 'Transfer initiated. The recipient must sign in and explicitly accept it.', transferId });
    } catch (error) {
      console.error('[NearGrow Ads] Ownership transfer initiation failed:', error);
      res.status(503).json({ message: 'The transfer could not be initiated. Resolve any existing pending transfer first.' });
    }
  });

  app.post('/api/admin/ownership/accept', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = currentAdmin(res)!;
    if (identity.role !== 'owner') {
      res.status(403).json({ message: 'Only the designated Co-Owner may accept this ownership transfer.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, identity, req.body?.currentPassword, 'Re-enter your current password to accept ownership.')) return;
    const transferId = typeof req.body?.transferId === 'string' ? req.body.transferId : '';
    try {
      const response = await supabaseAdminRequest('rest/v1/rpc/accept_admin_ownership_transfer', {
        method: 'POST',
        body: JSON.stringify({ p_transfer_id: transferId, p_recipient_id: identity.id }),
      });
      await readSupabaseJson<unknown>(response);
      res.json({ message: 'Primary ownership transferred. The former primary Owner remains an active Co-Owner.' });
    } catch (error) {
      console.error('[NearGrow Ads] Ownership transfer acceptance failed:', error);
      res.status(409).json({ message: 'This transfer is unavailable, expired, or no longer has two active Owners.' });
    }
  });

  app.post('/api/admin/ownership/cancel', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    const actor = currentAdmin(res)!;
    if (!actor.isPrimaryOwner) {
      res.status(403).json({ message: 'Only the current primary Owner can cancel this transfer.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, actor, req.body?.currentPassword, 'Re-enter your current password to cancel this transfer.')) return;
    const transferId = typeof req.body?.transferId === 'string' ? req.body.transferId : '';
    try {
      const query = new URLSearchParams({ id: `eq.${transferId}`, from_user_id: `eq.${actor.id}`, status: 'eq.pending' });
      const rows = await readSupabaseJson<Array<{ id: string }>>(await supabaseAdminRequest(`rest/v1/admin_ownership_transfers?${query}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'cancelled' }),
      }));
      if (!rows.length) {
        res.status(404).json({ message: 'Pending ownership transfer not found.' });
        return;
      }
      await writeAdminAudit(actor.id, 'ownership.transfer.cancelled', 'ownership', undefined, { transferId });
      res.json({ message: 'Ownership transfer cancelled.' });
    } catch (error) {
      console.error('[NearGrow Ads] Ownership transfer cancellation failed:', error);
      res.status(503).json({ message: 'The ownership transfer could not be cancelled.' });
    }
  });

  app.get('/api/blogs', async (_req: Request, res: Response): Promise<void> => {
    try {
      const posts = await readBlogPosts();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ posts: posts.filter((post) => post.status === 'published') });
    } catch (error) {
      console.error('[NearGrow Ads] Published blog API query failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Published blog data is temporarily unavailable.' });
    }
  });

  app.get('/api/case-study-images/:filename', async (req: Request, res: Response): Promise<void> => {
    const objectKey = caseStudyObjectKey(`/api/case-study-images/${req.params.filename}`);
    if (!objectKey) {
      res.status(404).end();
      return;
    }
    try {
      const params = new URLSearchParams({
        'published_content->>imageUrl': `eq.${objectKey}`,
        status: 'eq.published',
        select: 'id',
        limit: '1',
      });
      const references = await caseStudyResponse<{ id: string }[]>(
        await supabaseAdminRequest(`rest/v1/case_studies?${params.toString()}`),
      );
      if (!references.length) {
        res.status(404).end();
        return;
      }
      const image = await readCaseStudyImage(objectKey);
      if (!image) {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(image.bytes);
    } catch (error) {
      console.error('[NearGrow Ads] Public case study image query failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The case study image is temporarily unavailable.' });
    }
  });

  app.get('/api/case-studies', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ caseStudies: await readCaseStudies(true) });
    } catch (error) {
      console.error('[NearGrow Ads] Public case study query failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({
        message: caseStudyStorageMessage(error, 'Published case studies are temporarily unavailable.'),
      });
    }
  });

  app.get('/api/services', async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const services = await readWebsiteServices(false);
      res.json({ services: services.map((service) => ({
        id: service.id,
        ...service.publishedContent,
        status: 'published' as const,
      })) });
    } catch (error) {
      console.error('[NearGrow Ads] Public website services query failed.', {
        ...(error instanceof ServicePackageStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof ServicePackageStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Published services are temporarily unavailable.' });
    }
  });

  app.get('/api/site-content', async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ content: await readSiteContent() });
    } catch (error) {
      console.error('[NearGrow Ads] Public site content query error:', error);
      res.status(503).json({ message: 'Published page content is temporarily unavailable.' });
    }
  });

  app.post(
    '/api/admin/site-content/media/upload',
    (req: Request, res: Response, next) => {
      if (!isSameOriginRequest(req)) {
        res.status(403).json({ message: 'Media can only be uploaded from this website.' });
        return;
      }
      next();
    },
    express.raw({ type: 'multipart/form-data', limit: '106mb' }),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await uploadSiteMedia(req);
        if ('message' in stored) {
          res.status(415).json(stored);
          return;
        }
        res.status(201).json(stored);
      } catch (error) {
        console.error('[NearGrow Ads] Page content media upload error:', error);
        res.status(503).json({ message: 'The media could not be stored on the server.' });
      }
    },
  );

  app.get('/api/admin/mascot-settings', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!requireMascotPermission(res, 'view')) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(mascotSettingsAdminPayload(await readAdminSiteContent()));
    } catch (error) {
      console.error('[NearGrow Ads] Admin mascot settings query failed.', error);
      res.status(503).json({ message: 'Mascot settings are temporarily unavailable.' });
    }
  });

  app.put('/api/admin/mascot-settings/draft', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = requireMascotPermission(res, 'edit');
    if (!identity) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Mascot settings can only be changed from this website.' });
      return;
    }
    const expectedUpdatedAt = expectedMascotDraftVersion(req, res);
    if (expectedUpdatedAt === undefined) return;
    const settings = validateMascotSettings(req.body?.settings);
    if (!settings) {
      res.status(400).json({ message: `Choose whole-number desktop and mobile mascot sizes from ${MASCOT_SCALE_MIN}% to ${MASCOT_SCALE_MAX}%.` });
      return;
    }
    try {
      const result = await saveMascotSettingsDraft(settings, expectedUpdatedAt, identity.id, identity.email);
      if (result.conflict) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(409).json({
          message: 'Another editor saved a newer site-content draft. Your mascot changes were not saved; reload before trying again.',
          draftUpdatedAt: result.updatedAt ?? null,
        });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(mascotSettingsAdminPayload(result.state));
    } catch (error) {
      console.error('[NearGrow Ads] Admin mascot settings save failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        error: error instanceof Error ? error.message : 'Unknown save failure.',
      });
      res.status(503).json({
        message: error instanceof Error && error.message === siteContentDraftSchemaMessage
          ? siteContentDraftSchemaMessage
          : 'Mascot settings could not be saved on the server. Your draft values have not been changed.',
      });
    }
  });

  app.post('/api/admin/mascot-settings/publish', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = requireMascotPermission(res, 'edit');
    if (!identity) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Mascot settings can only be published from this website.' });
      return;
    }
    if (!hasPermission(identity, 'mascot', 'publish')) {
      res.status(403).json({ message: 'Your role does not have permission to publish mascot settings.'});
      return;
    }
    try {
      const response = await supabaseAdminRequest('rest/v1/rpc/publish_mascot_settings', {
        method: 'POST',
        body: JSON.stringify({ p_actor_id: identity.id }),
      });
      if (!response.ok) {
        const details = await response.text();
        if (details.includes('Other Page Content changes')) {
          res.status(409).json({ message: 'Other Page Content changes are saved in this draft. Publish those separately before publishing mascot settings.' });
          return;
        }
        if (response.status === 404 || details.includes('PGRST202')) {
          res.status(503).json({ message: 'Apply supabase/migrations/20261027110000_publish_mascot_settings_only.sql before publishing mascot settings.' });
          return;
        }
        if (details.includes('published site-content version is required')) {
          res.status(409).json({ message: 'A published Page Content version is required before publishing mascot settings.' });
          return;
        }
        throw new Error(`Mascot settings publish failed (${response.status}).`);
      }
      const result = await readSupabaseJson<{ content?: unknown; published_at?: unknown }>(response);
      const published = result?.content ? validateSiteContent(result.content) : undefined;
      if (!published || typeof result.published_at !== 'string') {
        throw new Error('Mascot settings publish returned an invalid published version.');
      }
      const state = await readAdminSiteContent();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...mascotSettingsAdminPayload(state), publishedAt: result.published_at });
    } catch (error) {
      console.error('[NearGrow Ads] Admin mascot settings publish failed.', error);
      res.status(503).json({ message: 'Mascot settings could not be published.' });
    }
  });

  app.post('/api/admin/mascot-settings/discard', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = requireMascotPermission(res, 'edit');
    if (!identity) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Mascot settings can only be discarded from this website.' });
      return;
    }
    try {
      const current = await readAdminSiteContent();
      if (!sameMascotSettings(current.draft.mascotSettings, current.published.mascotSettings)) {
        const saved = await saveMascotSettingsDraft(
          current.published.mascotSettings,
          current.draftUpdatedAt,
          identity.id,
          identity.email,
        );
        if (saved.conflict) {
          res.status(409).json({ message: 'The site-content draft changed while discarding mascot settings. Reload and try again.' });
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json(mascotSettingsAdminPayload(saved.state));
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(mascotSettingsAdminPayload(current));
    } catch (error) {
      console.error('[NearGrow Ads] Admin mascot settings discard failed.', error);
      res.status(503).json({ message: 'Mascot settings could not be discarded.' });
    }
  });

  app.get('/api/admin/mascot-settings/revisions', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!requireMascotPermission(res, 'view')) return;
    try {
      const query = new URLSearchParams({
        select: 'id,content,action,actor_label,created_at',
        order: 'created_at.desc',
        limit: '50',
      });
      const rows = await readSupabaseJson<Array<{
        id: number;
        content: unknown;
        action: string;
        actor_label: string;
        created_at: string;
      }>>(await supabaseAdminRequest(`rest/v1/site_content_revisions?${query}`));
      const revisions = rows.flatMap((row) => {
        const content = validateSiteContent(row.content);
        if (!content) return [];
        return [{
          id: row.id,
          action: row.action,
          actorLabel: row.actor_label || 'Administrator',
          createdAt: row.created_at,
          settings: content.mascotSettings,
        }];
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ revisions });
    } catch (error) {
      console.error('[NearGrow Ads] Mascot settings history query failed.', error);
      res.status(503).json({ message: 'Mascot version history is temporarily unavailable. Confirm the Page Content history migration is applied.' });
    }
  });

  app.post('/api/admin/mascot-settings/restore', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const identity = requireMascotPermission(res, 'edit');
    if (!identity) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Mascot settings can only be restored from this website.' });
      return;
    }
    const expectedUpdatedAt = expectedMascotDraftVersion(req, res);
    if (expectedUpdatedAt === undefined) return;
    const revisionId = req.body?.revisionId;
    if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
      res.status(400).json({ message: 'Select a valid saved mascot version to restore.' });
      return;
    }
    try {
      const query = new URLSearchParams({
        select: 'content',
        id: `eq.${revisionId}`,
        limit: '1',
      });
      const rows = await readSupabaseJson<Array<{ content: unknown }>>(
        await supabaseAdminRequest(`rest/v1/site_content_revisions?${query}`),
      );
      const revision = rows[0]?.content ? validateSiteContent(rows[0].content) : undefined;
      if (!revision) {
        res.status(404).json({ message: 'That saved mascot version no longer exists or is invalid.' });
        return;
      }
      const result = await saveMascotSettingsDraft(
        revision.mascotSettings,
        expectedUpdatedAt,
        identity.id,
        identity.email,
      );
      if (result.conflict) {
        res.status(409).json({ message: 'Another editor saved a newer site-content draft. Reload before restoring this mascot version.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(mascotSettingsAdminPayload(result.state));
    } catch (error) {
      console.error('[NearGrow Ads] Mascot settings version restore failed.', error);
      res.status(503).json({ message: 'The selected mascot version could not be restored as a draft.' });
    }
  });

  app.get('/api/admin/site-content', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      const state = await readAdminSiteContent();
      res.json({
        content: state.draft,
        draft: state.draft,
        published: state.published,
        publishedAt: state.publishedAt,
        draftUpdatedAt: state.draftUpdatedAt,
        draftUpdatedBy: state.draftUpdatedBy,
      });
    } catch (err) {
      console.error('[NearGrow Ads] Admin site content query error:', err);
      res.status(503).json({ message: 'Page content is temporarily unavailable.' });
    }
  });

  const saveSiteContentDraft = async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Page content can only be changed from this website.' });
      return;
    }
    const expectedUpdatedAtHeader = req.get('X-Draft-Updated-At');
    if (expectedUpdatedAtHeader === undefined) {
      res.status(428).json({ message: 'Reload the current draft before saving; its version is required to prevent overwriting another editor.' });
      return;
    }
    const expectedUpdatedAt = expectedUpdatedAtHeader === 'none' ? null : expectedUpdatedAtHeader;
    if (expectedUpdatedAt !== null && !Number.isFinite(Date.parse(expectedUpdatedAt))) {
      res.status(400).json({ message: 'The draft version is invalid. Reload the current draft and try again.' });
      return;
    }
    const content = validateSiteContent(req.body);
    if (!content) {
      res.status(400).json({ message: 'Review the page content fields and media URL, then try again.' });
      return;
    }
    try {
      const identity = currentAdmin(res);
      if (!identity) {
        res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
        return;
      }
      const saved = await writeSiteContentDraft(content, identity.id, identity.email, expectedUpdatedAt);
      if (saved.conflict) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(409).json({
          message: 'Another editor saved a newer draft. Your changes were not saved; copy them before reloading the latest version.',
          draftUpdatedAt: saved.updatedAt ?? null,
        });
        return;
      }
      if (!saved.content || !saved.updatedAt) throw new Error('Draft save completed without a valid version.');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ content: saved.content, draftUpdatedAt: saved.updatedAt });
    } catch (err) {
      console.error('[NearGrow Ads] Admin site content save error:', err);
      res.status(503).json({
        message: err instanceof Error && err.message.startsWith('Apply supabase/migrations/20261026120000')
          ? err.message
          : 'Page content could not be saved on the server.',
      });
    }
  };

  app.put('/api/admin/site-content', saveSiteContentDraft);
  app.put('/api/admin/site-content/draft', saveSiteContentDraft);

  app.post('/api/admin/site-content/publish', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Page content can only be published from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    if (!identity) {
      res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
      return;
    }
    try {
      const result = await publishSiteContent(identity.id);
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (err) {
      console.error('[NearGrow Ads] Admin site content publish error:', err);
      res.status(503).json({ message: 'Page content could not be published.' });
    }
  });

  app.get('/api/admin/site-content/revisions', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ revisions: await listSiteContentRevisions() });
    } catch (error) {
      console.error('[NearGrow Ads] Page content revision history failed:', error);
      res.status(503).json({ message: 'Revision history is temporarily unavailable. Confirm the Page Content history migration is applied.' });
    }
  });

  app.post('/api/admin/site-content/restore', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Page content can only be restored from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    const revisionId = req.body?.revisionId;
    if (!identity) {
      res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
      return;
    }
    if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
      res.status(400).json({ message: 'Select a valid saved version to restore.' });
      return;
    }
    try {
      const content = await restoreSiteContentRevision(revisionId, identity.id, identity.email);
      if (!content) {
        res.status(404).json({ message: 'That saved version no longer exists.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      const state = await readAdminSiteContent();
      res.json({ content, draftUpdatedAt: state.draftUpdatedAt });
    } catch (error) {
      console.error('[NearGrow Ads] Page content version restore failed:', error);
      res.status(503).json({ message: 'The saved version could not be restored as a draft.' });
    }
  });

  app.post('/api/admin/site-content/discard', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Page content changes can only be discarded from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    if (!identity) {
      res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
      return;
    }
    try {
      let content = await discardSiteContentDraft(identity.id, identity.email);
      if (!content) {
        const state = await readAdminSiteContent();
        const saved = await writeSiteContentDraft(
          await readLegacySiteContent(),
          identity.id,
          identity.email,
          state.draftUpdatedAt,
        );
        if (saved.conflict || !saved.content) throw new Error('The draft changed while its published version was being restored.');
        content = saved.content;
      }
      if (!content) {
        throw new Error('No existing site content could be restored.');
      }
      res.setHeader('Cache-Control', 'no-store');
      const state = await readAdminSiteContent();
      res.json({ content, draftUpdatedAt: state.draftUpdatedAt });
    } catch (error) {
      console.error('[NearGrow Ads] Page content draft discard failed:', error);
      res.status(503).json({ message: 'Draft changes could not be discarded.' });
    }
  });

  app.get('/api/admin/blog-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const [categories, posts] = await Promise.all([readBlogCategories(), readBlogPosts()]);
      res.json({
        categories: categories.map((category) => ({
          ...category,
          articleCount: posts.filter((post) => post.category === category.name).length,
        })),
      });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog category query error:', err);
      res.status(503).json({ message: 'Blog categories are temporarily unavailable.' });
    }
  });

  app.post('/api/admin/blog-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const category = validateBlogCategory(req.body);
    if (!category) {
      res.status(400).json({ message: 'Enter a category name, valid URL slug, and description up to 500 characters.' });
      return;
    }
    try {
      const categories = await readBlogCategories();
      if (categories.some((item) => item.slug === category.slug || item.name.toLowerCase() === category.name.toLowerCase())) {
        res.status(409).json({ message: 'A category with that name or slug already exists.' });
        return;
      }
      const updatedCategories = [...categories, category].sort((a, b) => a.name.localeCompare(b.name));
      await writeBlogCategories(updatedCategories);
      res.status(201).json({ category: { ...category, articleCount: 0 }, categories: updatedCategories });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog category create error:', err);
      res.status(503).json({ message: 'The category could not be saved.' });
    }
  });

  app.put('/api/admin/blog-categories/:slug', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const category = validateBlogCategory(req.body);
    if (!category) {
      res.status(400).json({ message: 'Enter a category name, valid URL slug, and description up to 500 characters.' });
      return;
    }
    try {
      const categories = await readBlogCategories();
      const existing = categories.find((item) => item.slug === req.params.slug);
      if (!existing) {
        res.status(404).json({ message: 'This category could not be found.' });
        return;
      }
      if (categories.some((item) => item.slug !== existing.slug &&
        (item.slug === category.slug || item.name.toLowerCase() === category.name.toLowerCase()))) {
        res.status(409).json({ message: 'A category with that name or slug already exists.' });
        return;
      }
      const affectedPosts = await withBlogMutation(async () => {
        const posts = await readBlogPosts();
        const affected = posts.filter((post) => post.category === existing.name);
        if (existing.name !== category.name && affected.length) {
          await writeBlogPosts(posts.map((post) => post.category === existing.name ? { ...post, category: category.name } : post));
        }
        return affected;
      });
      const updatedCategories = categories.map((item) => item.slug === existing.slug ? category : item)
        .sort((a, b) => a.name.localeCompare(b.name));
      await writeBlogCategories(updatedCategories);
      res.json({ category: { ...category, articleCount: affectedPosts.length }, categories: updatedCategories });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog category update error:', err);
      res.status(503).json({ message: 'The category could not be updated.' });
    }
  });

  app.delete('/api/admin/blog-categories/:slug', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const categories = await readBlogCategories();
      const existing = categories.find((item) => item.slug === req.params.slug);
      if (!existing) {
        res.status(404).json({ message: 'This category could not be found.' });
        return;
      }
      const posts = await readBlogPosts();
      const usageCount = posts.filter((post) => post.category === existing.name).length;
      if (usageCount > 0) {
        res.status(409).json({ message: `This category is assigned to ${usageCount} article${usageCount === 1 ? '' : 's'}. Reassign those articles before deleting it.` });
        return;
      }
      const updatedCategories = categories.filter((item) => item.slug !== existing.slug);
      await writeBlogCategories(updatedCategories);
      res.json({ categories: updatedCategories });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog category delete error:', err);
      res.status(503).json({ message: 'The category could not be deleted.' });
    }
  });

  app.get('/api/admin/blogs', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const posts = await readBlogPosts();
      const revision = contentRevision(posts);
      res.setHeader('ETag', revision);
      res.json({ posts: posts.map((post) => ({ ...post, id: post.id || stableBlogId(post.slug) })), revision });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog query error:', err);
      res.status(503).json({ message: 'Blog data is temporarily unavailable.' });
    }
  });

  app.get('/api/admin/blogs/seo-health', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const [posts, analyses] = await Promise.all([readBlogPosts(), readBlogSeoAnalyses()]);
      const postsById = new Map(posts.map((post) => [post.id || stableBlogId(post.slug), post]));
      const result = analyses.flatMap((analysis) => {
        const post = postsById.get(analysis.articleId);
        if (!post) return [];
        const sourceRevision = contentRevision({ ...post, id: post.id || stableBlogId(post.slug) });
        return [{
          ...analysis,
          stale: analysis.sourceRevision !== sourceRevision || analysis.analyzerVersion !== BLOG_SEO_ANALYZER_VERSION,
          currentStatus: post.status,
        }];
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ analyses: result, analyzerVersion: BLOG_SEO_ANALYZER_VERSION });
    } catch (error) {
      console.error('[NearGrow Ads] Blog SEO health results could not be read.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'SEO Health results are temporarily unavailable.' });
    }
  });

  app.post('/api/admin/blogs/seo-health/scan', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const body = req.body as { slugs?: unknown; includeDrafts?: unknown } | undefined;
    if (!Array.isArray(body?.slugs) || body.slugs.length < 1 || body.slugs.length > 25 ||
      body.slugs.some((slug) => typeof slug !== 'string' || !validSlug(slug)) ||
      typeof body.includeDrafts !== 'boolean') {
      res.status(400).json({ message: 'Choose between 1 and 25 valid article slugs and specify whether drafts are included.' });
      return;
    }
    try {
      const posts = await readBlogPosts();
      const selectedSlugs = new Set(body.slugs as string[]);
      const selectedPosts = posts.filter((post) => selectedSlugs.has(post.slug) &&
        (post.status === 'published' || body.includeDrafts === true));
      if (selectedPosts.length !== selectedSlugs.size) {
        res.status(404).json({ message: 'One or more selected articles are missing or drafts were not enabled.' });
        return;
      }

      const analyses = await readBlogSeoAnalyses();
      const origin = process.env.SITE_URL || process.env.VITE_SITE_URL || `${req.protocol}://${req.get('host')}`;
      let canonicalOrigin: string;
      try {
        const parsedOrigin = new URL(origin);
        if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password ||
          parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('invalid_origin');
        canonicalOrigin = parsedOrigin.origin;
      } catch {
        res.status(503).json({ message: 'The canonical website URL is not configured for safe SEO analysis.' });
        return;
      }
      const knownInternalPaths = new Set([
        '/', '/services', '/catalogue', '/about', '/work', '/blog', '/contact',
        '/get-started', '/privacy-policy', '/terms-and-conditions', '/thank-you',
        ...staticServices.map((service) => `/services/${service.slug}`),
        ...posts.filter((post) => post.status === 'published').map((post) => `/blog/${post.slug}`),
      ]);
      const scannedAt = new Date().toISOString();
      const updated = await Promise.all(selectedPosts.map(async (post): Promise<StoredBlogSeoAnalysis> => {
        const articleId = post.id || stableBlogId(post.slug);
        const missingLocalImageSources = new Set<string>();
        const sources = [
          post.featuredImage,
          ...Object.values(post.featuredImageVariants || {}).map((variant) => variant?.url),
          post.socialImage,
          ...Object.values(post.socialImageVariants || {}).map((variant) => variant?.url),
          ...(post.inlineImages || []).flatMap((image) => [
            image.url,
            ...Object.values(image.imageVariants || {}).map((variant) => variant?.url),
          ]),
        ].filter((source): source is string => Boolean(source));
        for (const source of new Set(sources)) {
          if (!source.startsWith('/uploads/blog/')) continue;
          const assetName = source.slice('/uploads/blog/'.length);
          if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(assetName)) {
            missingLocalImageSources.add(source);
            continue;
          }
          if (!await cmsUploadExists('blog', assetName)) missingLocalImageSources.add(source);
        }
        const withId = { ...post, id: articleId };
        return {
          ...analyzeBlogSeo(withId as BlogSeoArticle, posts as BlogSeoArticle[], {
            articleId,
            sourceRevision: contentRevision(withId),
            scannedAt,
            canonicalOrigin,
            knownInternalPaths,
            missingLocalImageSources,
          }),
          status: post.status,
        };
      }));
      await withBlogMutation(async () => {
        const latest = await readBlogSeoAnalyses();
        const byId = new Map(latest.map((analysis) => [analysis.articleId, analysis]));
        updated.forEach((analysis) => byId.set(analysis.articleId, analysis));
        await writeBlogSeoAnalyses([...byId.values()]);
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ analyses: updated, completed: updated.length, failed: 0 });
    } catch (error) {
      console.error('[NearGrow Ads] Blog SEO health scan failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The SEO scan could not be completed. Retry the failed batch.' });
    }
  });

  app.post(
    '/api/admin/blogs/upload',
    (req: Request, res: Response, next) => { if (requireAdmin(req, res)) next(); },
    express.raw({ type: 'multipart/form-data', limit: '16mb' }),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await storeMultipartImage(req, blogUploadDir);
        if ('message' in stored) { res.status(415).json(stored); return; }
        res.status(201).json(stored);
      } catch (err) {
        console.error('[NearGrow Ads] Blog image upload error:', err);
        res.status(503).json({ message: 'The blog image could not be stored on the server.' });
      }
    },
  );

  app.post('/api/admin/blogs', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const post = validateBlogPost(req.body);
    if (!post) { res.status(400).json({ message: 'Check the article title, slug, category and content sections.' }); return; }
    try {
      await withBlogMutation(async () => {
        const posts = await readBlogPosts();
        if (posts.some((item) => item.slug === post.slug)) {
          res.status(409).json({ message: 'That URL slug is already in use.' });
          return;
        }
        const expectedRevision = req.get('If-Match');
        if (!expectedRevision || expectedRevision !== contentRevision(posts)) {
          res.status(expectedRevision ? 409 : 428).json({ message: 'Blog content changed or the revision is missing. Reload the list before saving.' });
          return;
        }
        const next = [post, ...posts];
        await writeBlogPosts(next);
        const revision = contentRevision(next);
        res.setHeader('ETag', revision);
        res.status(201).json({ post, revision });
      });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog create error:', err);
      res.status(503).json({ message: 'The article could not be saved on the server.' });
    }
  });

  app.put('/api/admin/blogs/:slug', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const post = validateBlogPost(req.body);
    if (!post) { res.status(400).json({ message: 'Check the article title, slug, category and content sections.' }); return; }
    try {
      await withBlogMutation(async () => {
        const posts = await readBlogPosts();
        const index = posts.findIndex((item) => item.slug === req.params.slug);
        if (index < 0) { res.status(404).json({ message: 'This article could not be found.' }); return; }
        const existingId = posts[index].id || stableBlogId(posts[index].slug);
        if (post.id !== existingId) {
          res.status(409).json({ message: 'The article identity changed. Reload the article before saving.' });
          return;
        }
        if (posts.some((item) => item.slug === post.slug && item.slug !== req.params.slug)) {
          res.status(409).json({ message: 'That URL slug is already in use.' });
          return;
        }
        const expectedRevision = req.get('If-Match');
        if (!expectedRevision || expectedRevision !== contentRevision(posts)) {
          res.status(expectedRevision ? 409 : 428).json({ message: 'Blog content changed or the revision is missing. Reload the list before saving.' });
          return;
        }
        const next = [...posts];
        next[index] = post;
        await writeBlogPosts(next);
        const revision = contentRevision(next);
        res.setHeader('ETag', revision);
        res.json({ post, revision });
      });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog update error:', err);
      res.status(503).json({ message: 'The article could not be updated on the server.' });
    }
  });

  app.delete('/api/admin/blogs/:slug', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      await withBlogMutation(async () => {
        const posts = await readBlogPosts();
        const next = posts.filter((post) => post.slug !== req.params.slug);
        if (next.length === posts.length) {
          res.status(404).json({ message: 'This article could not be found.' });
          return;
        }
        const expectedRevision = req.get('If-Match');
        if (!expectedRevision || expectedRevision !== contentRevision(posts)) {
          res.status(expectedRevision ? 409 : 428).json({ message: 'Blog content changed or the revision is missing. Reload the list before deleting.' });
          return;
        }
        await writeBlogPosts(next);
        const revision = contentRevision(next);
        res.setHeader('ETag', revision);
        res.json({ success: true, revision });
      });
    } catch (err) {
      console.error('[NearGrow Ads] Admin blog delete error:', err);
      res.status(503).json({ message: 'The article could not be deleted from the server.' });
    }
  });

  // --- Leadership & Team ---
  app.get('/api/team', async (_req: Request, res: Response): Promise<void> => {
    try {
      const members = (await readTeam()).filter((m) => m.visible);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ members });
    } catch (error) {
      console.error('[NearGrow Ads] Public team API query failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Team data is temporarily unavailable.' });
    }
  });

  app.get('/api/admin/team', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      const members = await readTeam();
      const revision = contentRevision(members);
      res.setHeader('ETag', revision);
      res.json({ members, revision });
    } catch (err) {
      console.error('[NearGrow Ads] Admin team query error:', err);
      res.status(503).json({ message: 'Team data is temporarily unavailable.' });
    }
  });

  app.put('/api/admin/team', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const { members, message } = validateTeam(req.body);
    if (!members) { res.status(400).json({ message }); return; }
    try {
      await withTeamMutation(async () => {
        const currentMembers = await readTeam();
        const expectedRevision = req.get('If-Match');
        if (!expectedRevision || expectedRevision !== contentRevision(currentMembers)) {
          res.status(expectedRevision ? 409 : 428).json({ message: 'Team content changed or the revision is missing. Reload before saving to avoid overwriting newer edits.' });
          return;
        }
        await writeTeam(members);
        const revision = contentRevision(members);
        res.setHeader('ETag', revision);
        res.json({ members, revision });
      });
    } catch (err) {
      console.error('[NearGrow Ads] Admin team save error:', err);
      res.status(503).json({ message: 'The team could not be saved on the server.' });
    }
  });

  app.post(
    '/api/admin/team/upload',
    (req: Request, res: Response, next) => { if (requireAdmin(req, res)) next(); }, // authenticate BEFORE buffering the body
    express.raw({ type: 'multipart/form-data', limit: '16mb' }),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await storeMultipartImage(req, teamUploadDir);
        if ('message' in stored) { res.status(415).json(stored); return; }
        res.status(201).json(stored);
      } catch (err) {
        console.error('[NearGrow Ads] Team image upload error:', err);
        res.status(503).json({ message: 'The image could not be stored on the server.' });
      }
    },
  );

  app.post('/api/catalogue/enquiries', async (req: Request, res: Response): Promise<void> => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recentAttempts = (serviceEnquiryAttempts.get(clientIp) || [])
      .filter((timestamp) => now - timestamp < SERVICE_ENQUIRY_WINDOW_MS);
    if (recentAttempts.length >= SERVICE_ENQUIRY_MAX_ATTEMPTS) {
      res.status(429).json({ message: 'Too many service enquiries were submitted. Please try again shortly.' });
      return;
    }
    recentAttempts.push(now);
    serviceEnquiryAttempts.set(clientIp, recentAttempts);

    const input = validateServiceEnquiry(req.body);
    if (!input) {
      res.status(400).json({ message: 'Enter your name and phone, provide a valid email if desired, select a service, and accept the privacy notice.' });
      return;
    }
    try {
      const request = await createServiceEnquiry(input);
      res.status(201).json({
        success: true,
        ...request,
        message: 'Your enquiry was received. This is not a payment or a confirmed service order.',
      });
    } catch (error) {
      if (error instanceof InvalidServiceEnquiryError) {
        res.status(400).json({ message: error.message });
        return;
      }
      console.error('[NearGrow Ads] Public service enquiry submission failed.', {
        ...(error instanceof ServicePackageStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof ServicePackageStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The enquiry could not be submitted. Please try again later or contact our team.' });
    }
  });

  app.get('/api/catalogue/categories', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const categories = (await readCatalogueCategories())
        .filter((category) => category.active && category.showInCatalogue);
      res.json({ categories });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      console.error('[NearGrow Ads] Public catalogue categories query failed.', {
        ...(code ? { code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: serviceCatalogueStorageMessage(error, 'Catalogue categories are temporarily unavailable.') });
    }
  });

  app.get('/api/catalogue', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const configuredWhatsApp = (process.env.WHATSAPP_NUMBER || '919289810149').replace(/\D/g, '');
      const [packages, categories] = await Promise.all([
        readServicePackages(true),
        readCatalogueCategories().then((items) => items.filter((category) => category.active && category.showInCatalogue)),
      ]);
      res.json({
        packages,
        categories,
        whatsappNumber: /^[0-9]{8,15}$/.test(configuredWhatsApp) ? configuredWhatsApp : '919289810149',
      });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      const status = error instanceof ServicePackageStorageError ? error.status : undefined;
      console.error('[NearGrow Ads] Public catalogue query failed.', {
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: serviceCatalogueStorageMessage(error, 'The service catalogue is temporarily unavailable.') });
    }
  });

  app.get('/api/catalogue/payment-availability', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const config = getRazorpayTestConfig();
      const settings = await readServiceStorePaymentSettings();
      res.json({
        available: Boolean(config && settings.testGatewayEnabled),
        provider: 'razorpay',
        mode: 'test',
        realPaymentsEnabled: false,
        message: 'Online payment currently unavailable.',
      });
    } catch (error) {
      console.error('[NearGrow Ads] Public payment availability check failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ available: false, message: 'Online payment currently unavailable.' });
    }
  });

  app.get('/api/catalogue/:slug', async (req: Request, res: Response): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const packages = await readServicePackages(true);
      const item = packages.find((entry) => entry.slug === req.params.slug);
      if (!item) {
        res.status(404).json({ message: 'This service package is not available.' });
        return;
      }
      res.json({ package: item });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      const status = error instanceof ServicePackageStorageError ? error.status : undefined;
      console.error('[NearGrow Ads] Public service detail query failed.', {
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Service details are temporarily unavailable.' });
    }
  });

  app.post('/api/catalogue/orders', async (req: Request, res: Response): Promise<void> => {
    if (!serviceOrderRateLimit(req, res)) return;
    const input = validateServiceOrder(req.body);
    if (!input) {
      res.status(400).json({ message: 'Enter valid customer details, select eligible published packages, and accept the privacy notice.' });
      return;
    }
    try {
      const order = await createServiceOrder(input);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(order);
    } catch (error) {
      if (error instanceof InvalidServiceEnquiryError) {
        res.status(400).json({ message: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Online payment currently unavailable')) {
        res.status(503).json({ message: error.message });
        return;
      }
      console.error('[NearGrow Ads] Public service order creation failed.', {
        ...(error instanceof ServicePackageStorageError ? { status: error.status, code: error.code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Checkout could not be started. No payment was taken.' });
    }
  });

  app.post('/api/catalogue/orders/:reference/track', async (req: Request, res: Response): Promise<void> => {
    const reference = req.params.reference;
    const token = req.body?.trackingToken;
    if (!/^NGO-[A-F0-9]{24}$/.test(reference) || typeof token !== 'string' || token.length < 32 || token.length > 100) {
      res.status(404).json({ message: 'Order tracking details are invalid or unavailable.' });
      return;
    }
    try {
      const order = await readServiceOrderByTracking(reference, token);
      if (!order) {
        res.status(404).json({ message: 'Order tracking details are invalid or unavailable.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ order });
    } catch (error) {
      console.error('[NearGrow Ads] Public order tracking failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Order status is temporarily unavailable.' });
    }
  });

  app.post('/api/catalogue/orders/:reference/verify-payment', async (req: Request, res: Response): Promise<void> => {
    const reference = req.params.reference;
    const { trackingToken, razorpay_order_id: providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!/^NGO-[A-F0-9]{24}$/.test(reference) || typeof trackingToken !== 'string' ||
      trackingToken.length < 32 || typeof providerOrderId !== 'string' || providerOrderId.length > 80 ||
      typeof paymentId !== 'string' || paymentId.length > 80 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
      res.status(400).json({ message: 'Payment verification details are invalid.' });
      return;
    }
    const config = getRazorpayTestConfig();
    if (!config) {
      res.status(503).json({ message: 'Online payment currently unavailable.' });
      return;
    }
    try {
      const tokenHash = createHash('sha256').update(trackingToken).digest('hex');
      const query = new URLSearchParams({
        select: 'id,provider_order_id,total_amount_paise,payment_status,tracking_token_hash',
        order_reference: `eq.${reference}`,
        tracking_token_hash: `eq.${tokenHash}`,
        limit: '1',
      });
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/service_orders?${query}`),
      );
      const order = rows[0];
      if (!order || order.provider_order_id !== providerOrderId) {
        res.status(404).json({ message: 'Order tracking details are invalid or unavailable.' });
        return;
      }
      const expectedSignature = createHmac('sha256', config.keySecret)
        .update(`${providerOrderId}|${paymentId}`)
        .digest();
      const submittedSignature = Buffer.from(signature, 'hex');
      if (submittedSignature.length !== expectedSignature.length || !timingSafeEqual(submittedSignature, expectedSignature)) {
        res.status(400).json({ message: 'The payment response could not be verified.' });
        return;
      }
      const amountPaise = Number(order.total_amount_paise);
      if (!await verifyRazorpayPayment({ provider_order_id: providerOrderId, total_amount_paise: amountPaise }, paymentId, config)) {
        res.status(402).json({ message: 'Payment is not captured yet. Check the order status before retrying.' });
        return;
      }
      if (!await confirmServiceOrderPayment(providerOrderId, paymentId, amountPaise)) {
        res.status(409).json({ message: 'The payment did not match this order.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ verified: true, orderReference: reference, paymentStatus: 'paid', mode: 'test' });
    } catch (error) {
      console.error('[NearGrow Ads] Razorpay payment verification failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Payment verification is temporarily unavailable. Do not retry payment until you check order status.' });
    }
  });

  app.post('/api/payments/razorpay/test-webhook', async (req: Request, res: Response): Promise<void> => {
    const config = getRazorpayTestConfig();
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.header('x-razorpay-signature') || '';
    if (!config || !rawBody || !/^[a-f0-9]{64}$/i.test(signature)) {
      res.status(400).json({ message: 'Webhook verification failed.' });
      return;
    }
    const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(400).json({ message: 'Webhook verification failed.' });
      return;
    }
    try {
      const event = req.body as {
        event?: string;
        payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string; captured?: boolean } } };
      };
      if (event.event === 'payment.captured') {
        const payment = event.payload?.payment?.entity;
        if (payment?.id && payment.order_id && payment.amount && payment.currency === 'INR' &&
          payment.status === 'captured' && payment.captured === true) {
          await confirmServiceOrderPayment(payment.order_id, payment.id, payment.amount);
        }
      }
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('[NearGrow Ads] Razorpay test webhook processing failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Webhook processing failed.' });
    }
  });

  app.get('/api/admin/payment-settings', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    try {
      const settings = await readServiceStorePaymentSettings();
      const identity = currentAdmin(res);
      const updatedBy = settings.updatedBy && settings.updatedBy !== identity?.id
        ? await readAdminIdentity(settings.updatedBy)
        : undefined;
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        settings,
        provider: {
          name: 'Razorpay',
          mode: 'test',
          credentialsConfigured: Boolean(getRazorpayTestConfig()),
          webhookConfigured: Boolean(process.env.RAZORPAY_TEST_WEBHOOK_SECRET),
          directUpiSupported: false,
          livePaymentsSupported: false,
          settlementVerified: false,
        },
        lastUpdatedBy: updatedBy?.email || (settings.updatedBy === identity?.id ? identity.email : settings.updatedBy),
      });
    } catch (error) {
      console.error('[NearGrow Ads] Payment settings read failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Payment settings could not be loaded. Apply the service orders and payment settings migration.' });
    }
  });

  app.get('/api/admin/payment-settings/history', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ history: await readPaymentAuditHistory() });
    } catch (error) {
      console.error('[NearGrow Ads] Payment settings audit history read failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Payment configuration history could not be loaded.' });
    }
  });

  app.put('/api/admin/payment-settings', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Payment settings can only be changed from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    const { password, businessName, paymentContactPhone, confirmOldPhone, confirmNewPhone } = req.body || {};
    if (!identity || typeof businessName !== 'string' || businessName.trim().length < 2 || businessName.trim().length > 120 ||
      typeof paymentContactPhone !== 'string' || !/^[+0-9().\s-]{7,25}$/.test(paymentContactPhone.trim()) ||
      typeof confirmOldPhone !== 'string' || typeof confirmNewPhone !== 'string' ||
      confirmNewPhone.trim() !== paymentContactPhone.trim()) {
      res.status(400).json({ message: 'Enter a valid business display name and payment contact number, then confirm the proposed number.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, identity, password, 'Re-enter the Primary Owner password to update payment contact information.')) return;
    try {
      const response = await supabaseAdminRequest('rest/v1/rpc/update_service_store_payment_contact', {
        method: 'POST',
        body: JSON.stringify({
          p_actor_id: identity.id,
          p_business_name: businessName.trim(),
          p_payment_contact_phone: paymentContactPhone.trim(),
          p_confirm_old_phone: confirmOldPhone.trim(),
          p_confirm_new_phone: confirmNewPhone.trim(),
        }),
      });
      if (!response.ok) throw new ServicePackageStorageError(response.status, 'payment_contact_update_failed');
      if (!await response.json() as boolean) {
        res.status(409).json({ message: 'The current or proposed payment contact did not match the confirmation. Reload settings and try again.' });
        return;
      }
      recordSecurityEventSafely({
        eventType: 'payment.configuration.changed',
        severity: 'medium',
        actorId: identity.id,
        route: 'payment-settings',
        details: { operation: 'payment_contact_updated' },
      });
      res.json({ success: true, settings: await readServiceStorePaymentSettings() });
    } catch (error) {
      console.error('[NearGrow Ads] Payment contact update failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Payment contact information could not be updated.' });
    }
  });

  app.post('/api/admin/payment-settings/verify', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Payment settings can only be changed from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    const config = getRazorpayTestConfig();
    if (!identity || !config) {
      res.status(503).json({ message: 'Razorpay Test credentials and webhook secret must be configured server-side before verification.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, identity, req.body?.password, 'Re-enter the Primary Owner password to verify gateway configuration.')) return;
    try {
      const response = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        headers: { Authorization: razorpayAuthorization(config), Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        res.status(422).json({ message: 'Razorpay did not accept these Test credentials. Nothing was activated.' });
        return;
      }
      const identity = currentAdmin(res);
      if (!identity) {
        res.status(401).json({ message: 'Your Primary Owner session expired. Sign in again.' });
        return;
      }
      const verificationResponse = await supabaseAdminRequest('rest/v1/rpc/record_service_store_test_gateway_verification', {
        method: 'POST',
        body: JSON.stringify({ p_actor_id: identity.id, p_key_id: config.keyId }),
      });
      if (!verificationResponse.ok) throw new ServicePackageStorageError(verificationResponse.status, 'payment_verify_save_failed');
      if (!await verificationResponse.json() as boolean) throw new Error('payment_verify_record_failed');
      recordSecurityEventSafely({
        eventType: 'payment.configuration.verified',
        severity: 'low',
        actorId: identity.id,
        route: 'payment-settings',
        details: { mode: 'test' },
      });
      res.json({ success: true, message: 'Razorpay Test credentials verified. This does not verify a settlement account or activate payments.' });
    } catch (error) {
      console.error('[NearGrow Ads] Razorpay Test configuration verification failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Razorpay Test configuration could not be verified.' });
    }
  });

  app.post('/api/admin/payment-settings/gateway', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Payment settings can only be changed from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    const config = getRazorpayTestConfig();
    const { password, enable, confirmMode } = req.body || {};
    if (!identity || !config || typeof enable !== 'boolean' || confirmMode !== 'test') {
      res.status(400).json({ message: 'Only Razorpay Test mode is supported.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, identity, password, 'Re-enter the Primary Owner password to change gateway status.')) return;
    try {
      const response = await supabaseAdminRequest('rest/v1/rpc/set_service_store_test_gateway', {
        method: 'POST',
        body: JSON.stringify({ p_actor_id: identity.id, p_key_id: config.keyId, p_enable: enable }),
      });
      if (!response.ok) throw new ServicePackageStorageError(response.status, 'test_gateway_update_failed');
      if (!await response.json() as boolean) {
        res.status(409).json({ message: 'Verify the current Razorpay Test credentials before enabling this gateway.' });
        return;
      }
      recordSecurityEventSafely({
        eventType: 'payment.configuration.changed',
        severity: 'high',
        actorId: identity.id,
        route: 'payment-settings',
        details: { operation: enable ? 'test_gateway_enabled' : 'test_gateway_disabled', mode: 'test' },
      });
      res.json({ success: true, settings: await readServiceStorePaymentSettings() });
    } catch (error) {
      console.error('[NearGrow Ads] Razorpay Test gateway status update failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Gateway status could not be updated.' });
    }
  });

  app.post('/api/admin/payment-settings/settlement-change', async (req: Request, res: Response): Promise<void> => {
    if (!requireOwner(req, res)) return;
    if (!isSameOriginRequest(req)) {
      res.status(403).json({ message: 'Payment settings can only be changed from this website.' });
      return;
    }
    const identity = currentAdmin(res);
    if (!identity || req.body?.confirmProvider !== 'Razorpay dashboard') {
      res.status(400).json({ message: 'Confirm the Razorpay Dashboard handoff to continue.' });
      return;
    }
    if (!await reauthenticateAdminRequest(req, res, identity, req.body?.password, 'Re-enter the Primary Owner password to request settlement details guidance.')) return;
    try {
      await savePaymentAudit(identity.id, 'settlement_change_routed_to_provider', 'settlement_destination', '', '', 'provider_managed_workflow_required', 'not_changed');
      recordSecurityEventSafely({
        eventType: 'payment.configuration.change_requested',
        severity: 'medium',
        actorId: identity.id,
        route: 'payment-settings',
        details: { operation: 'provider_managed_settlement_change_requested' },
      });
      res.json({
        success: true,
        url: 'https://dashboard.razorpay.com/',
        message: 'Settlement bank details are provider-managed. Complete any change and verification in the official Razorpay Dashboard. This CMS did not change settlement details.',
      });
    } catch (error) {
      console.error('[NearGrow Ads] Settlement change handoff audit failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The settlement change request could not be audited.' });
    }
  });

  app.get('/api/admin/orders', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest('rest/v1/service_orders?select=id,order_reference,customer_name,customer_email,customer_phone,customer_business_name,customer_onboarding_notes,line_items,total_amount_paise,currency,provider,provider_mode,provider_order_id,provider_payment_id,payment_status,fulfillment_status,provider_snapshot,paid_at,created_at,updated_at&order=created_at.desc&limit=100'),
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ orders: rows });
    } catch (error) {
      console.error('[NearGrow Ads] Admin service orders read failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Orders could not be loaded. Apply the service orders migration.' });
    }
  });

  app.patch('/api/admin/orders/:id/fulfillment', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!isUuid(req.params.id) ||
      !['queued', 'in_progress', 'completed', 'cancelled'].includes(req.body?.fulfillmentStatus)) {
      res.status(400).json({ message: 'Choose a valid order and fulfillment status.' });
      return;
    }
    try {
      const query = new URLSearchParams({ id: `eq.${req.params.id}`, select: 'id,order_reference,payment_status,provider_mode,fulfillment_status' });
      const before = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/service_orders?${query}`),
      );
      if (!before[0]) {
        res.status(404).json({ message: 'The order could not be found.' });
        return;
      }
      if (before[0].payment_status !== 'paid') {
        res.status(409).json({ message: 'Only captured and verified payments can enter fulfillment.' });
        return;
      }
      if (before[0].provider_mode !== 'live') {
        res.status(409).json({ message: 'Test-mode orders do not represent real customer payments and cannot enter fulfillment.' });
        return;
      }
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/service_orders?id=eq.${encodeURIComponent(req.params.id)}&select=id,fulfillment_status`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ fulfillment_status: req.body.fulfillmentStatus, updated_at: new Date().toISOString() }),
        }),
      );
      if (!rows[0]) {
        res.status(409).json({ message: 'Order status changed before this update. Refresh and try again.' });
        return;
      }
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'service_order.fulfillment_updated', 'serviceStore', req.params.id, {
        orderReference: before[0].order_reference,
        oldStatus: before[0].fulfillment_status,
        newStatus: req.body.fulfillmentStatus,
      });
      res.json({ order: rows[0] });
    } catch (error) {
      console.error('[NearGrow Ads] Service order fulfillment update failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Order fulfillment status could not be updated.' });
    }
  });

  app.get('/api/admin/service-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ categories: await readCatalogueCategories(true) });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      console.error('[NearGrow Ads] Admin catalogue categories query failed.', {
        ...(code ? { code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: serviceCatalogueStorageMessage(error, 'Catalogue categories could not be loaded.') });
    }
  });

  app.post('/api/admin/service-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const value = validateCatalogueCategory(req.body);
    if (!value) {
      res.status(400).json({ message: 'Enter a category name, valid unique slug, description, display order and visibility.' });
      return;
    }
    try {
      res.status(201).json({ category: await createCatalogueCategory(value) });
    } catch (error) {
      const conflict = error instanceof ServicePackageStorageError && error.status === 409;
      if (!conflict) console.error('[NearGrow Ads] Catalogue category create failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(conflict ? 409 : 503).json({
        message: conflict ? 'A catalogue category with that name or slug already exists.' : 'The catalogue category could not be created. Confirm the category migration is applied.',
      });
    }
  });

  app.put('/api/admin/service-categories/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid catalogue category.' });
      return;
    }
    const value = validateCatalogueCategory(req.body);
    if (!value) {
      res.status(400).json({ message: 'Enter a category name, valid unique slug, description, display order and visibility.' });
      return;
    }
    try {
      const category = await updateCatalogueCategory(req.params.id, value);
      if (!category) {
        res.status(404).json({ message: 'This catalogue category could not be found.' });
        return;
      }
      res.json({ category });
    } catch (error) {
      const conflict = error instanceof ServicePackageStorageError && error.status === 409;
      if (!conflict) console.error('[NearGrow Ads] Catalogue category update failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(conflict ? 409 : 503).json({
        message: conflict ? 'A catalogue category with that name or slug already exists.' : 'The catalogue category could not be updated.',
      });
    }
  });

  app.delete('/api/admin/service-categories/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid catalogue category.' });
      return;
    }
    try {
      const packages = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/service_packages?category_id=eq.${encodeURIComponent(req.params.id)}&select=id&limit=1`),
      );
      if (packages.length) {
        res.status(409).json({ message: 'This category still has assigned packages. Reassign them or archive the category instead.' });
        return;
      }
      if (!await deleteCatalogueCategory(req.params.id)) {
        res.status(404).json({ message: 'This catalogue category could not be found.' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[NearGrow Ads] Catalogue category delete failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The catalogue category could not be deleted.' });
    }
  });

  app.get('/api/admin/service-packages', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ packages: await readServicePackages(false) });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      const status = error instanceof ServicePackageStorageError ? error.status : undefined;
      console.error('[NearGrow Ads] Admin service catalogue query failed.', {
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: serviceCatalogueStorageMessage(error, 'The service catalogue could not be loaded.') });
    }
  });

  app.get('/api/admin/services', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ services: await readWebsiteServices(true) });
    } catch (error) {
      console.error('[NearGrow Ads] Admin website services list failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Website services could not be loaded. Confirm the Services Management migration is applied.' });
    }
  });

  app.post('/api/admin/services', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const content = validateWebsiteServiceContent(req.body);
    if (!content) {
      res.status(400).json({ message: 'Enter valid service details before saving the draft.' });
      return;
    }
    try {
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest('rest/v1/website_services', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            id: typeof req.body?.id === 'string' && WEBSITE_SERVICE_UUID.test(req.body.id) ? req.body.id : randomUUID(),
            slug: content.slug,
            display_order: content.displayOrder,
            status: 'draft',
            draft_content: content,
            published_content: null,
          }),
        }),
      );
      const service = rows[0] ? websiteServiceFromRow(rows[0]) : undefined;
      if (!service) throw new ServicePackageStorageError(502, 'missing_website_service');
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'website_service.created', 'servicesManagement', undefined, { serviceId: service.id, slug: service.slug });
      res.status(201).json({ service });
    } catch (error) {
      console.error('[NearGrow Ads] Website service create failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(error instanceof ServicePackageStorageError && error.code === '23505' ? 409 : 503).json({
        message: error instanceof ServicePackageStorageError && error.code === '23505'
          ? 'A website service with this slug already exists.'
          : 'The website service draft could not be created. Confirm the Services Management migration is applied.',
      });
    }
  });

  app.put('/api/admin/services/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!WEBSITE_SERVICE_UUID.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid website service.' });
      return;
    }
    const content = validateWebsiteServiceContent(req.body);
    if (!content) {
      res.status(400).json({ message: 'Enter valid service details before saving the draft.' });
      return;
    }
    try {
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/website_services?id=eq.${encodeURIComponent(req.params.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            slug: content.slug,
            display_order: content.displayOrder,
            draft_content: content,
            updated_at: new Date().toISOString(),
          }),
        }),
      );
      if (!rows[0]) {
        res.status(404).json({ message: 'This website service could not be found.' });
        return;
      }
      const service = websiteServiceFromRow(rows[0]);
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'website_service.draft_saved', 'servicesManagement', undefined, { serviceId: service.id, slug: service.slug });
      res.json({ service });
    } catch (error) {
      console.error('[NearGrow Ads] Website service draft update failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(error instanceof ServicePackageStorageError && error.code === '23505' ? 409 : 503).json({
        message: error instanceof ServicePackageStorageError && error.code === '23505'
          ? 'A website service with this slug already exists.'
          : 'The website service draft could not be saved.',
      });
    }
  });

  app.patch('/api/admin/services/:id/status', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const status = req.body?.status;
    if (!WEBSITE_SERVICE_UUID.test(req.params.id) ||
      (status !== 'draft' && status !== 'published' && status !== 'archived')) {
      res.status(400).json({ message: 'Choose a valid website service and status.' });
      return;
    }
    try {
      const existing = await readWebsiteServiceById(req.params.id);
      if (!existing) {
        res.status(404).json({ message: 'This website service could not be found.' });
        return;
      }
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/website_services?id=eq.${encodeURIComponent(req.params.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            status,
            ...(status === 'published' ? { published_content: validateWebsiteServiceContent(existing) } : {}),
            published_at: status === 'published' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }),
        }),
      );
      if (!rows[0]) {
        res.status(404).json({ message: 'This website service could not be found.' });
        return;
      }
      const service = websiteServiceFromRow(rows[0]);
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(
        actor.id,
        status === 'published' ? 'website_service.published' : status === 'archived' ? 'website_service.archived' : 'website_service.unpublished',
        'servicesManagement',
        undefined,
        { serviceId: service.id, slug: service.slug, status },
      );
      res.json({ service });
    } catch (error) {
      console.error('[NearGrow Ads] Website service status update failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The website service status could not be changed.' });
    }
  });

  app.delete('/api/admin/services/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!WEBSITE_SERVICE_UUID.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid website service.' });
      return;
    }
    try {
      const rows = await servicePackageResponse<Record<string, unknown>[]>(
        await supabaseAdminRequest(`rest/v1/website_services?id=eq.${encodeURIComponent(req.params.id)}&select=id,slug`, {
          method: 'DELETE',
          headers: { Prefer: 'return=representation' },
        }),
      );
      if (!rows[0]) {
        res.status(404).json({ message: 'This website service could not be found.' });
        return;
      }
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'website_service.deleted', 'servicesManagement', undefined, { serviceId: req.params.id, slug: rows[0].slug });
      res.json({ success: true });
    } catch (error) {
      console.error('[NearGrow Ads] Website service delete failed.', {
        ...(error instanceof ServicePackageStorageError ? { code: error.code, status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The website service could not be removed.' });
    }
  });

  app.post(
    '/api/admin/services/upload',
    express.raw({ type: 'multipart/form-data', limit: '16mb' }),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await uploadWebsiteServiceImage(req);
        if ('message' in stored) {
          res.status(400).json({ message: stored.message });
          return;
        }
        res.status(201).json(stored);
      } catch (error) {
        console.error('[NearGrow Ads] Website service image upload failed.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(503).json({ message: 'The website service background image could not be uploaded.' });
      }
    },
  );

  app.get('/api/admin/case-studies/media/:filename', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const objectKey = caseStudyObjectKey(`/api/admin/case-studies/media/${req.params.filename}`);
    if (!objectKey) {
      res.status(404).end();
      return;
    }
    try {
      const image = await readCaseStudyImage(objectKey);
      if (!image) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(image.bytes);
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study image query failed.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The case study image is temporarily unavailable.' });
    }
  });

  app.get('/api/admin/case-studies', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ caseStudies: await readCaseStudies() });
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study list failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Case studies could not be loaded. Confirm the Case Studies migration is applied.' });
    }
  });

  app.get('/api/admin/case-study-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await readCaseStudyCategoryData());
    } catch (error) {
      console.error('[NearGrow Ads] Case study categories could not be loaded.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: caseStudyStorageMessage(error, 'Case study categories could not be loaded.') });
    }
  });

  app.post('/api/admin/case-study-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim().replace(/\s+/g, ' ') : '';
    if (!category || category.length > 100) {
      res.status(400).json({ message: 'Enter a category name between 1 and 100 characters.' });
      return;
    }
    if (normalizeCaseStudyCategory(category) === RESERVED_CASE_STUDY_CATEGORY) {
      res.status(400).json({ message: 'All Engagements is reserved for the public filter and cannot be assigned.' });
      return;
    }
    try {
      const savedCategory = await saveCaseStudyCategory(category);
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'case_study_category.saved', 'caseStudies', undefined, { category: savedCategory });
      res.status(201).json({ category: savedCategory, ...await readCaseStudyCategoryData() });
    } catch (error) {
      console.error('[NearGrow Ads] Case study category could not be saved.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: caseStudyStorageMessage(error, 'The case study category could not be saved.') });
    }
  });

  app.put('/api/admin/case-study-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim().replace(/\s+/g, ' ') : '';
    const newCategory = typeof req.body?.newCategory === 'string' ? req.body.newCategory.trim().replace(/\s+/g, ' ') : '';
    if (!category || category.length > 100 || !newCategory || newCategory.length > 100) {
      res.status(400).json({ message: 'Choose a saved category and enter a name between 1 and 100 characters.' });
      return;
    }
    if (normalizeCaseStudyCategory(newCategory) === RESERVED_CASE_STUDY_CATEGORY) {
      res.status(400).json({ message: 'All Engagements is reserved for the public filter and cannot be assigned.' });
      return;
    }
    try {
      const renamedCategory = await renameCaseStudyCategory(category, newCategory);
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'case_study_category.renamed', 'caseStudies', undefined, {
        previousCategory: category,
        category: renamedCategory,
      });
      res.json({ category: renamedCategory, ...await readCaseStudyCategoryData() });
    } catch (error) {
      console.error('[NearGrow Ads] Case study category could not be renamed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      const conflict = error instanceof CaseStudyStorageError && ['23505', 'P0001'].includes(error.code || '');
      const missing = error instanceof CaseStudyStorageError && error.code === 'P0002';
      res.status(conflict ? 409 : missing ? 404 : 503).json({
        message: conflict
          ? 'That category name already exists or the selected category is no longer available.'
          : caseStudyStorageMessage(error, 'The case study category could not be renamed.'),
      });
    }
  });

  app.delete('/api/admin/case-study-categories', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    if (!category || category.length > 100) {
      res.status(400).json({ message: 'Choose a saved category to remove.' });
      return;
    }
    try {
      if (!await deleteCaseStudyCategory(category)) {
        res.status(409).json({ message: 'This category is assigned to a case study and cannot be removed.' });
        return;
      }
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'case_study_category.deleted', 'caseStudies', undefined, { category });
      res.json(await readCaseStudyCategoryData());
    } catch (error) {
      console.error('[NearGrow Ads] Case study category could not be removed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({
        message: caseStudyStorageMessage(error, 'The case study category could not be removed.'),
      });
    }
  });

  app.post('/api/admin/case-studies', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const value = validateCaseStudy(req.body);
    if (!value || value.status === 'archived') {
      res.status(400).json({ message: 'Enter valid case study details and save as draft or publish.' });
      return;
    }
    try {
      const category = await getSavedCaseStudyCategory(value.category);
      if (!category) {
        res.status(400).json({ message: 'Choose an existing saved category or add a custom category first.' });
        return;
      }
      const caseStudy = await createCaseStudy({ ...value, category });
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'case_study.created', 'caseStudies', undefined, {
        caseStudyId: caseStudy.id,
        slug: caseStudy.slug,
        status: caseStudy.status,
      });
      res.status(201).json({ caseStudy });
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study create failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(error instanceof CaseStudyStorageError && error.status === 409 ? 409 : 503).json({
        message: error instanceof CaseStudyStorageError && error.code === '23505'
          ? 'A case study with this slug already exists.'
          : caseStudyStorageMessage(error, 'The case study could not be created.'),
      });
    }
  });

  app.patch('/api/admin/case-studies/:id/status', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id) ||
      (req.body?.status !== 'draft' && req.body?.status !== 'published' && req.body?.status !== 'archived')) {
      res.status(400).json({ message: 'Choose a valid case study and status.' });
      return;
    }
    try {
      const existing = await readCaseStudyById(req.params.id);
      if (!existing) {
        res.status(404).json({ message: 'This case study could not be found.' });
        return;
      }
      const caseStudy = await updateCaseStudyStatus(req.params.id, req.body.status);
      if (!caseStudy) {
        res.status(404).json({ message: 'This case study could not be found.' });
        return;
      }
      const actor = currentAdmin(res);
      if (actor) {
        const action = caseStudy.status === 'archived' && existing.status !== 'archived'
          ? 'case_study.archived'
          : existing.status !== 'published' && caseStudy.status === 'published'
            ? 'case_study.published'
            : existing.status === 'published' && caseStudy.status !== 'published'
              ? 'case_study.unpublished'
              : 'case_study.status_changed';
        await writeAdminAudit(actor.id, action, 'caseStudies', undefined, {
          caseStudyId: caseStudy.id,
          slug: caseStudy.slug,
          previousStatus: existing.status,
          status: caseStudy.status,
        });
      }
      res.json({ caseStudy });
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study status update failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({
        message: caseStudyStorageMessage(error, 'The case study status could not be changed.'),
      });
    }
  });

  app.put('/api/admin/case-studies/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid case study.' });
      return;
    }
    const value = validateCaseStudy(req.body);
    if (!value) {
      res.status(400).json({ message: 'Enter valid case study details before saving.' });
      return;
    }
    try {
      const existing = await readCaseStudyById(req.params.id);
      if (!existing) {
        res.status(404).json({ message: 'This case study could not be found.' });
        return;
      }
      const category = await getSavedCaseStudyCategory(value.category);
      if (!category) {
        res.status(400).json({ message: 'Choose an existing saved category or add a custom category first.' });
        return;
      }
      const caseStudy = await updateCaseStudy(req.params.id, { ...value, category }, existing.status);
      if (!caseStudy) {
        res.status(404).json({ message: 'This case study could not be found.' });
        return;
      }
      const actor = currentAdmin(res);
      if (actor) {
        const action = value.status === 'archived' && existing.status !== 'archived'
          ? 'case_study.archived'
          : existing.status !== 'published' && caseStudy.status === 'published'
            ? 'case_study.published'
            : existing.status === 'published' && caseStudy.status !== 'published'
              ? 'case_study.unpublished'
              : 'case_study.updated';
        await writeAdminAudit(actor.id, action, 'caseStudies', undefined, {
          caseStudyId: caseStudy.id,
          slug: caseStudy.slug,
          previousStatus: existing.status,
          status: caseStudy.status,
        });
      }
      if (existing.imageUrl && existing.imageUrl !== caseStudy.imageUrl) {
        try {
          await removeCaseStudyImageIfUnused(existing.imageUrl);
        } catch (error) {
          console.error('[NearGrow Ads] Replaced case study image could not be cleaned up.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }
      res.json({ caseStudy });
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study update failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(error instanceof CaseStudyStorageError && error.status === 409 ? 409 : 503).json({
        message: error instanceof CaseStudyStorageError && error.code === '23505'
          ? 'A case study with this slug already exists.'
          : caseStudyStorageMessage(error, 'The case study could not be updated.'),
      });
    }
  });

  app.delete('/api/admin/case-studies/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid case study.' });
      return;
    }
    try {
      const existing = await readCaseStudyById(req.params.id);
      if (!existing || !await deleteCaseStudy(req.params.id)) {
        res.status(404).json({ message: 'This case study could not be found.' });
        return;
      }
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'case_study.deleted', 'caseStudies', undefined, {
        caseStudyId: existing.id,
        slug: existing.slug,
      });
      if (existing.imageUrl) {
        try {
          await removeCaseStudyImageIfUnused(existing.imageUrl);
        } catch (error) {
          console.error('[NearGrow Ads] Deleted case study image could not be cleaned up.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study delete failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The case study could not be deleted.' });
    }
  });

  app.post('/api/admin/case-studies/reorder', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 ||
      ids.some((id: unknown) => typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
      new Set(ids).size !== ids.length) {
      res.status(400).json({ message: 'Choose a valid, unique case study order.' });
      return;
    }
    try {
      const current = await readCaseStudies();
      if (ids.length !== current.length || current.some((study) => !ids.includes(study.id))) {
        res.status(400).json({ message: 'The order must include every case study exactly once.' });
        return;
      }
      await caseStudyResponse<undefined>(await supabaseAdminRequest('rest/v1/rpc/reorder_case_studies', {
        method: 'POST',
        body: JSON.stringify({ p_ids: ids }),
      }));
      const actor = currentAdmin(res);
      if (actor) await writeAdminAudit(actor.id, 'case_study.reordered', 'caseStudies', undefined, { count: ids.length });
      res.json({ success: true });
    } catch (error) {
      console.error('[NearGrow Ads] Admin case study reorder failed.', {
        ...(error instanceof CaseStudyStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof CaseStudyStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The case studies could not be reordered.' });
    }
  });

  app.post(
    '/api/admin/case-studies/upload',
    express.raw({ type: 'multipart/form-data', limit: '16mb' }),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await uploadCaseStudyImage(req);
        if ('message' in stored) {
          res.status(415).json(stored);
          return;
        }
        const actor = currentAdmin(res);
        if (actor) await writeAdminAudit(actor.id, 'case_study.image_uploaded', 'caseStudies', undefined, {
          contentType: stored.url.endsWith('.png') ? 'image/png' : 'image/webp',
        });
        res.status(201).json(stored);
      } catch (error) {
        console.error('[NearGrow Ads] Case study image upload failed.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(503).json({ message: 'The case study image could not be uploaded.' });
      }
    },
  );

  app.get('/api/admin/service-enquiries', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ enquiries: await readServiceEnquiries() });
    } catch (error) {
      console.error('[NearGrow Ads] Admin service enquiry list failed.', {
        ...(error instanceof ServicePackageStorageError && error.code ? { code: error.code } : {}),
        ...(error instanceof ServicePackageStorageError ? { status: error.status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'Service enquiries could not be loaded. Confirm the service enquiry migration is applied.' });
    }
  });

  app.post('/api/admin/service-packages', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const rawSlug = req.body && typeof req.body === 'object' && typeof req.body.slug === 'string'
      ? req.body.slug
      : '';
    const title = req.body && typeof req.body === 'object' && typeof req.body.title === 'string'
      ? req.body.title
      : '';
    const slugBase = serviceCatalogueSlug(rawSlug) || serviceCatalogueSlug(title) || 'service-package';
    if (!title.trim()) {
      res.status(400).json({ message: 'Enter a package name so a valid URL slug can be generated.' });
      return;
    }
    try {
      const value = validateServicePackage({ ...req.body, slug: await uniquePackageSlug(slugBase) });
      if (!value) {
        res.status(400).json({ message: 'Enter valid package details, pricing, billing terms and deliverables.' });
        return;
      }
      const categorized = await resolveServiceCategory(value);
      if (!categorized) {
        res.status(400).json({ message: 'Choose a saved catalogue category before saving this package.' });
        return;
      }
      let created: ServicePackage | undefined;
      for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
        try {
          created = await createServicePackage(attempt === 0
            ? categorized
            : { ...categorized, slug: await uniquePackageSlug(slugBase) });
        } catch (error) {
          if (!(error instanceof ServicePackageStorageError && error.code === '23505') || attempt === 2) throw error;
        }
      }
      if (!created) throw new ServicePackageStorageError(500, 'empty_insert_result');
      res.status(201).json({ package: created });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      const status = error instanceof ServicePackageStorageError ? error.status : undefined;
      console.error('[NearGrow Ads] Admin service package create failed.', {
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(status === 409 ? 409 : 503).json({
        message: status === 409 ? 'A package with this slug or package code already exists. Retry to generate a fresh slug.' : 'The service package could not be created.',
      });
    }
  });

  app.put('/api/admin/service-packages/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid service package.' });
      return;
    }
    const value = validateServicePackage(req.body);
    if (!value) {
      res.status(400).json({ message: 'Enter valid package details, pricing, billing terms and deliverables.' });
      return;
    }
    try {
      const categorized = await resolveServiceCategory(value);
      if (!categorized) {
        res.status(400).json({ message: 'Choose a saved catalogue category before saving this package.' });
        return;
      }
      const updated = await updateServicePackage(req.params.id, categorized);
      if (!updated) {
        res.status(404).json({ message: 'This service package could not be found.' });
        return;
      }
      res.json({ package: updated });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      const status = error instanceof ServicePackageStorageError ? error.status : undefined;
      console.error('[NearGrow Ads] Admin service package update failed.', {
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(status === 409 ? 409 : 503).json({
        message: status === 409 ? 'A package with this slug already exists.' : 'The service package could not be updated.',
      });
    }
  });

  app.delete('/api/admin/service-packages/:id', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ message: 'Choose a valid service package.' });
      return;
    }
    try {
      if (!await deleteServicePackage(req.params.id)) {
        res.status(404).json({ message: 'This service package could not be found.' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      const code = error instanceof ServicePackageStorageError ? error.code : undefined;
      const status = error instanceof ServicePackageStorageError ? error.status : undefined;
      console.error('[NearGrow Ads] Admin service package delete failed.', {
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(503).json({ message: 'The service package could not be deleted.' });
    }
  });

  app.post(
    '/api/admin/service-packages/upload',
    (req: Request, res: Response, next) => { if (requireAdmin(req, res)) next(); },
    express.raw({ type: 'multipart/form-data', limit: '16mb' }),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await storeMultipartImage(req, servicePackageUploadDir);
        if ('message' in stored) { res.status(415).json(stored); return; }
        res.status(201).json(stored);
      } catch (error) {
        console.error('[NearGrow Ads] Service package image upload failed.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(503).json({ message: 'The service package image could not be stored.' });
      }
    },
  );

  app.get('/api/admin/leads/export/options', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      const storage = leadStorageMode();
      res.json({
        statuses: [
          { value: 'new', label: 'New' },
          { value: 'reviewed', label: 'In Review' },
          { value: 'contacted', label: 'Contacted' },
        ],
        ...(await readLeadExportOptions(storage)),
      });
    } catch (error) {
      logLeadStorageFailure('export-options', error);
      res.status(503).json({ message: leadStorageMessage(error) });
    }
  });

  app.post('/api/admin/leads/export/preview', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const filters = parseLeadExportFilters(req.body);
    if (!filters) {
      res.status(400).json({ message: 'Choose valid lead export filters. Selected exports require at least one selected lead.' });
      return;
    }
    try {
      const dateRange = leadExportDateRange(filters);
      const storage = leadStorageMode();
      const recordCount = await countLeadExportRecords(filters, dateRange, new Date().toISOString(), storage);
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.json({ recordCount, timeZone: LEAD_EXPORT_TIME_ZONE });
    } catch (error) {
      if (error instanceof Error && !(error instanceof LeadStorageFailure)) {
        res.status(400).json({ message: error.message });
        return;
      }
      logLeadStorageFailure('export-preview', error);
      res.status(503).json({ message: leadStorageMessage(error) });
    }
  });

  app.post('/api/admin/leads/export', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const filters = parseLeadExportFilters(req.body);
    const format: LeadExportFormat | undefined = req.body?.format === 'csv' || req.body?.format === 'xlsx'
      ? req.body.format
      : undefined;
    const columns = parseLeadExportColumns(req.body?.columns);
    if (!filters || !format || !columns?.length) {
      res.status(400).json({ message: 'Choose valid lead filters, export format and columns. Selected exports require at least one selected lead.' });
      return;
    }

    let temporaryDirectory: string | undefined;
    try {
      const dateRange = leadExportDateRange(filters);
      const storage = leadStorageMode();
      const exportedAt = new Date().toISOString();
      const expectedCount = await countLeadExportRecords(filters, dateRange, exportedAt, storage);
      if (expectedCount === 0) {
        res.status(404).json({ message: 'No leads found for the selected filters.' });
        return;
      }
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'neargrow-leads-export-'));
      await fs.chmod(temporaryDirectory, 0o700);
      const extension = format === 'xlsx' ? 'xlsx' : 'csv';
      const filePath = path.join(temporaryDirectory, `leads.${extension}`);
      const headings = columns.map((column) => LEAD_EXPORT_COLUMNS.find((entry) => entry.key === column)!.label);
      let actualCount = 0;

      if (format === 'csv') {
        const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
        try {
          await writeLeadExportChunk(output, `\uFEFF${headings.map(protectLeadCsvCell).join(',')}\r\n`);
          for await (const lead of iterateLeadExportRecords(filters, dateRange, exportedAt, expectedCount, storage)) {
            await writeLeadExportChunk(output, `${leadExportValues(lead, columns).map(protectLeadCsvCell).join(',')}\r\n`);
            actualCount += 1;
          }
          await finishLeadExportStream(output);
        } catch (error) {
          output.destroy();
          throw error;
        }
      } else {
        const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
        try {
          const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: output,
            useStyles: false,
            useSharedStrings: false,
          });
          let sheetNumber = 1;
          let sheetRowCount = 0;
          let worksheet = workbook.addWorksheet('Leads');
          worksheet.addRow(headings).commit();
          for await (const lead of iterateLeadExportRecords(filters, dateRange, exportedAt, expectedCount, storage)) {
            if (sheetRowCount >= 1_048_575) {
              sheetNumber += 1;
              sheetRowCount = 0;
              worksheet = workbook.addWorksheet(`Leads ${sheetNumber}`);
              worksheet.addRow(headings).commit();
            }
            worksheet.addRow(leadExportValues(lead, columns)).commit();
            sheetRowCount += 1;
            actualCount += 1;
          }
          await workbook.commit();
        } catch (error) {
          output.destroy();
          throw error;
        }
      }
      if (actualCount !== expectedCount) {
        throw new LeadStorageFailure('request', 'export-count-mismatch');
      }

      const identity = currentAdmin(res);
      if (!identity) {
        res.status(401).json({ message: 'Your admin session has expired. Please sign in again.' });
        return;
      }
      await writeAdminAudit(identity.id, 'leads.export.generated', 'leads', undefined, {
        format,
        scope: filters.scope,
        status: filters.status,
        source: filters.source || null,
        service: filters.service || null,
        searchApplied: Boolean(filters.search),
        recordCount: actualCount,
        timeZone: LEAD_EXPORT_TIME_ZONE,
        ...(dateRange ? { from: dateRange.from, to: dateRange.to } : {}),
      });

      const localDateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: LEAD_EXPORT_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(exportedAt)).map((part) => [part.type, part.value]));
      const localDate = `${localDateParts.year}-${localDateParts.month}-${localDateParts.day}`;
      const filename = `NearGrowAds_Leads_${localDate}.${extension}`;
      res.status(200);
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Expected-Records', String(actualCount));
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8');
      await pipeline(createReadStream(filePath), res);
    } catch (error) {
      logLeadStorageFailure('export', error);
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
      } else {
        const status = error instanceof Error && !(error instanceof LeadStorageFailure) ? 400 : 503;
        res.status(status).json({
          message: status === 400
            ? error instanceof Error ? error.message : 'The lead export filters are invalid.'
            : leadStorageMessage(error),
        });
      }
    } finally {
      if (temporaryDirectory) {
        try {
          await fs.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch (error) {
          console.error('[NearGrow Ads] Temporary lead export cleanup failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }
    }
  });

  app.get('/api/admin/leads', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1);
    const pageSize = 100;
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    if (!Number.isSafeInteger(page) || page < 1 ||
      !['all', 'new', 'reviewed', 'contacted'].includes(status)) {
      res.status(400).json({ message: 'Choose a valid lead page and status filter.' });
      return;
    }
    try {
      const storage = leadStorageMode();
      let leads: StoredLead[];
      let total: number;
      if (storage === 'supabase') {
        ({ leads, total } = await readSupabaseLeads({ page, pageSize, status, search }));
      } else {
        const normalizedSearch = search.toLowerCase();
        const filtered = memoryLeads.filter((lead) =>
          (status === 'all' || lead.status === status) &&
          (!normalizedSearch ||
            [lead.name, lead.businessName, lead.email, lead.serviceInterest, lead.phone || '', lead.sourcePage]
              .some((value) => value.toLowerCase().includes(normalizedSearch))),
        );
        total = filtered.length;
        leads = filtered.slice((page - 1) * pageSize, page * pageSize);
      }
      res.json({ leads, storage, page, pageSize, total });
    } catch (err: unknown) {
      logLeadStorageFailure('read', err);
      res.status(503).json({ message: leadStorageMessage(err) });
    }
  });

  app.patch('/api/admin/leads/:id/status', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const { status } = req.body || {};
    if (!['new', 'reviewed', 'contacted'].includes(status)) {
      res.status(400).json({ message: 'Choose a valid lead status.' });
      return;
    }

    try {
      const storage = leadStorageMode();
      let updated = false;
      if (storage === 'supabase') {
        updated = await updateSupabaseLeadStatus(req.params.id, status as LeadStatus);
      } else {
        const lead = memoryLeads.find((item) => item.id === req.params.id);
        if (lead) {
          lead.status = status as LeadStatus;
          lead.updatedAt = new Date().toISOString();
          updated = true;
        }
      }
      if (!updated) {
        res.status(404).json({ message: 'This lead could not be found.' });
        return;
      }
      res.json({ success: true });
    } catch (err: unknown) {
      logLeadStorageFailure('update', err);
      res.status(503).json({ message: leadStorageMessage(err) });
    }
  });

  app.post('/api/admin/leads/:id/notification/retry', async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const storage = leadStorageMode();
      const lead = storage === 'supabase'
        ? await findSupabaseLeadById(req.params.id)
        : memoryLeads.find((item) => item.id === req.params.id);
      if (!lead) {
        res.status(404).json({ message: 'This lead could not be found.' });
        return;
      }
      if (lead.notificationStatus === 'delivered') {
        res.json({ saved: true, leadId: lead.id, notificationStatus: 'delivered' });
        return;
      }
      const notificationStatus = await dispatchLeadNotification(lead);
      if (storage === 'supabase') {
        await updateSupabaseLeadNotificationStatus(lead.id, notificationStatus);
      } else {
        lead.notificationStatus = notificationStatus;
      }
      res.status(notificationStatus === 'delivered' ? 200 : 502).json({
        saved: true,
        leadId: lead.id,
        notificationStatus,
        message: notificationStatus === 'delivered'
          ? 'The saved lead notification was delivered.'
          : 'The lead remains saved, but its notification was not delivered.',
      });
    } catch (error) {
      logLeadStorageFailure('notification-retry', error);
      res.status(503).json({ saved: true, message: 'The lead remains saved, but notification delivery could not be retried.' });
    }
  });

  // Leads submission endpoint
  app.post('/api/leads', async (req: Request, res: Response): Promise<void> => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const {
        name,
        businessName,
        email,
        phone,
        websiteUrl,
        serviceInterest,
        budgetRange,
        message,
        preferredContactMethod,
        consent,
        submissionId,
        sourcePage,
        utmSource,
        utmMedium,
        utmCampaign,
        _hpTrap,
      } = req.body;

      // 2. Honeypot Bot Trap
      if (_hpTrap) {
        // Quietly accept to confuse spam bot
        res.status(200).json({ success: true, leadId: 'hp-discard' });
        return;
      }

      const isChatbotSubmission = sourcePage === 'NEO Chatbot';
      if (typeof submissionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
        res.status(400).json({ success: false, message: 'A valid enquiry submission identifier is required.' });
        return;
      }
      if (consent !== true) {
        res.status(400).json({ success: false, message: 'Consent is required before submitting an enquiry.' });
        return;
      }

      // Server-side validation
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ success: false, message: 'Full name is required.' });
        return;
      }
      if (!isChatbotSubmission && (!businessName || typeof businessName !== 'string' || businessName.trim().length === 0)) {
        res.status(400).json({ success: false, message: 'Business name is required.' });
        return;
      }
      if (!isChatbotSubmission && (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
        res.status(400).json({ success: false, message: 'A valid email address is required.' });
        return;
      }
      if (isChatbotSubmission && email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
        res.status(400).json({ success: false, message: 'A valid email address is required when one is provided.' });
        return;
      }
      if (isChatbotSubmission) {
        const phoneDigits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
        if (phoneDigits.length < 7 || phoneDigits.length > 15) {
          res.status(400).json({ success: false, message: 'A valid phone or WhatsApp number is required.' });
          return;
        }
      }
      if (!serviceInterest || typeof serviceInterest !== 'string') {
        res.status(400).json({ success: false, message: 'Service of interest is required.' });
        return;
      }
      if (!message || typeof message !== 'string' || message.trim().length < 10) {
        res.status(400).json({ success: false, message: 'Please provide a message of at least 10 characters.' });
        return;
      }

      const storage = leadStorageMode();
      const leadId = String(submissionId);
      const newLead: StoredLead = {
        id: leadId,
        name: name.trim().slice(0, 100),
        businessName: typeof businessName === 'string' ? businessName.trim().slice(0, 100) : '',
        email: typeof email === 'string' ? email.trim().toLowerCase().slice(0, 120) : '',
        phone: phone ? String(phone).trim().slice(0, 30) : undefined,
        websiteUrl: websiteUrl ? String(websiteUrl).trim().slice(0, 200) : undefined,
        serviceInterest: String(serviceInterest).slice(0, 80),
        budgetRange: budgetRange ? String(budgetRange).slice(0, 50) : undefined,
        message: message.trim().slice(0, 2000),
        preferredContactMethod: preferredContactMethod ? String(preferredContactMethod).slice(0, 20) : 'whatsapp',
        consentStatus: true,
        notificationStatus: 'pending',
        sourcePage: sourcePage ? String(sourcePage).slice(0, 100) : '/',
        utmSource: utmSource ? String(utmSource).slice(0, 80) : undefined,
        utmMedium: utmMedium ? String(utmMedium).slice(0, 80) : undefined,
        utmCampaign: utmCampaign ? String(utmCampaign).slice(0, 80) : undefined,
        createdAt: new Date().toISOString(),
        status: 'new',
      };

      const existingMemoryLead = memoryLeads.find((lead) => lead.id === leadId);
      const existingLead = storage === 'supabase'
        ? await findSupabaseLeadById(leadId)
        : existingMemoryLead;
      if (existingLead) {
        if (!isSameLeadSubmission(existingLead, newLead)) {
          res.status(409).json({ success: false, message: 'This enquiry identifier was already used for different details.' });
          return;
        }
        let notificationStatus = existingLead.notificationStatus;
        if (notificationStatus !== 'delivered') {
          notificationStatus = await dispatchLeadNotification(existingLead);
          try {
            if (storage === 'supabase') {
              await updateSupabaseLeadNotificationStatus(existingLead.id, notificationStatus);
            } else {
              existingLead.notificationStatus = notificationStatus;
            }
          } catch (error) {
            logLeadStorageFailure('notification-status-update', error);
            notificationStatus = 'failed';
          }
        }
        res.status(200).json({
          success: true,
          leadId: existingLead.id,
          saved: true,
          duplicate: true,
          notificationStatus,
          message: 'Your enquiry is already saved.',
        });
        return;
      }

      const now = Date.now();
      const clientTimestamps = (rateLimitMap.get(clientIp) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
      if (clientTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        res.status(429).json({
          success: false,
          message: 'Too many submissions from this connection. Please wait a minute or message on WhatsApp.',
        });
        return;
      }
      clientTimestamps.push(now);
      rateLimitMap.set(clientIp, clientTimestamps);

      let newlyPersisted = true;
      if (storage === 'supabase') {
        try {
          await saveLeadToSupabase(newLead);
        } catch (error) {
          if (!(error instanceof LeadStorageFailure) || error.code !== '23505') throw error;
          const existingLead = await findSupabaseLeadById(leadId);
          if (!existingLead || !isSameLeadSubmission(existingLead, newLead)) throw error;
          newlyPersisted = false;
          newLead.notificationStatus = existingLead.notificationStatus;
        }
      }
      if (storage === 'memory' && !memoryLeads.some((lead) => lead.id === leadId)) {
        memoryLeads.unshift(newLead);
        if (memoryLeads.length > 500) {
          memoryLeads.pop();
        }
      }

      if (newlyPersisted) console.log('[NearGrow Ads Lead] New inquiry received.');

      let notificationStatus = newLead.notificationStatus;
      if (newlyPersisted || notificationStatus !== 'delivered') {
        notificationStatus = await dispatchLeadNotification(newLead);
        try {
          if (storage === 'supabase') {
            await updateSupabaseLeadNotificationStatus(leadId, notificationStatus);
          } else {
            const savedLead = memoryLeads.find((lead) => lead.id === leadId);
            if (savedLead) savedLead.notificationStatus = notificationStatus;
          }
        } catch (error) {
          logLeadStorageFailure('notification-status-update', error);
          notificationStatus = 'failed';
        }
      }

      res.status(201).json({
        success: true,
        saved: true,
        leadId: newLead.id,
        notificationStatus,
        message: 'Your inquiry has been successfully received by NearGrow Ads.',
      });
    } catch (err: unknown) {
      logLeadStorageFailure('insert', err);
      res.status(err instanceof LeadStorageFailure ? 503 : 500).json({
        success: false,
        message: err instanceof LeadStorageFailure
          ? leadStorageMessage(err)
          : 'An internal server error occurred while processing your request.',
      });
    }
  });

  // --- Serve Frontend ---
  app.use('/api', (err: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (!err) { next(); return; }
    const error = err as NodeJS.ErrnoException & { status?: number };
    const status = error.status === 413 ? 413 : 400;
    console.error('[NearGrow Ads] API request parsing error:', err);
    res.status(status).json({ message: status === 413 ? 'The uploaded request is too large.' : 'The API request could not be parsed.' });
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ message: 'This API endpoint was not found.' });
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!serverless && !isProduction) {
    // Development mode: Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        ws: { port: hmrPort },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!serverless) {
    // Production mode: Static files
    const distPath = path.resolve(__dirname, 'dist');
    app.get('/robots.txt', (_req: Request, res: Response): void => {
      const origin = canonicalSiteOrigin();
      res.type('text/plain').send([
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /api',
        'Disallow: /thank-you',
        `Sitemap: ${origin}/sitemap.xml`,
        '',
      ].join('\n'));
    });
    app.get('/sitemap.xml', async (_req: Request, res: Response): Promise<void> => {
      try {
        const origin = canonicalSiteOrigin();
        const [services, posts, packages] = await Promise.all([
          readWebsiteServices(false),
          readBlogPosts(),
          readServicePackages(true),
        ]);
        const urls = [
          '/', '/services', '/catalogue', '/work', '/about', '/blog', '/contact',
          '/privacy-policy', '/terms-and-conditions',
          ...services.filter((item) => item.status === 'published').map((item) => `/services/${item.slug}`),
          ...posts.filter((item) => item.status === 'published').map((item) => `/blog/${item.slug}`),
          ...packages.filter((item) => item.status === 'published').map((item) => `/catalogue/${item.slug}`),
        ];
        const uniqueUrls = [...new Set(urls)];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueUrls
          .map((pathname) => `  <url><loc>${escapeXml(`${origin}${pathname}`)}</loc></url>`)
          .join('\n')}\n</urlset>`;
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.type('application/xml').send(xml);
      } catch (error) {
        console.error('[NearGrow Ads] Published-content sitemap could not be generated.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(503).type('text/plain').send('The sitemap is temporarily unavailable.');
      }
    });
    app.use(express.static(distPath, { index: false }));
    app.get('*', async (req: Request, res: Response): Promise<void> => {
      if (path.extname(req.path)) {
        res.status(404).end();
        return;
      }
      try {
        const indexHtml = await fs.readFile(path.resolve(distPath, 'index.html'), 'utf8');
        const result = await renderInitialPageHtml(req.path, indexHtml);
        if (req.path.startsWith('/admin')) res.setHeader('Cache-Control', 'no-store');
        res.status(result.found ? 200 : 404).type('html').send(result.html);
      } catch (error) {
        console.error('[NearGrow Ads] Initial page metadata could not be rendered.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(503).type('text/plain').send('The requested page is temporarily unavailable.');
      }
    });
  }

  return { app, port };
}

export async function createVercelApplication(): Promise<express.Express> {
  const { app } = await createApplication(true);
  return app;
}

async function startServer() {
  const { app, port } = await createApplication();
  if (port === undefined) throw new Error('The local server did not resolve a listening port.');
  app.listen(port, '0.0.0.0', () => {
    console.log(`[NearGrow Ads] Full-stack application running at http://localhost:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((err) => {
    console.error('[NearGrow Ads] Server startup failure:', err);
    process.exit(1);
  });
}
