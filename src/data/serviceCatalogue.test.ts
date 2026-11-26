import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPublicServicePackage,
  GMB_AUDIT_PACKAGE_CODE,
  publicServicePackagePath,
  type ServicePackage,
} from './serviceCatalogue';
import { CANONICAL_PRODUCTION_ORIGIN, resolveCanonicalPageOrigin } from './siteCanonical';

const packageRecord = (overrides: Partial<ServicePackage> = {}): ServicePackage => ({
  id: 'gmb-audit',
  slug: 'gmb-audit',
  packageCode: GMB_AUDIT_PACKAGE_CODE,
  title: 'CMS package title',
  category: 'Audit',
  packageKind: 'service',
  summary: '',
  description: '',
  priceInr: 599,
  discountedPriceInr: 99,
  billingType: 'one_time',
  imageUrl: '/package.png',
  deliverables: [],
  exclusions: [],
  clientRequirements: [],
  targetAudience: '',
  deliveryTimeline: '',
  faqs: [],
  featured: false,
  catalogueBadge: null,
  quantitySupported: false,
  status: 'published',
  ...overrides,
});

test('uses the short public route only for GMB Audit while preserving other catalogue paths', () => {
  assert.equal(publicServicePackagePath(packageRecord()), '/gmb-audit');
  assert.equal(publicServicePackagePath(packageRecord({ slug: 'edited-gmb-slug' })), '/gmb-audit');
  assert.equal(publicServicePackagePath(packageRecord({ packageCode: 'OTHER', slug: 'managed-seo' })), '/catalogue/managed-seo');
});

test('resolves the GMB route from the CMS package code after a slug edit', () => {
  const packageWithEditedSlug = packageRecord({ slug: 'edited-gmb-slug' });
  assert.equal(findPublicServicePackage([packageWithEditedSlug], 'gmb-audit'), packageWithEditedSlug);
});

test('uses the production canonical origin only for the GMB Audit alias', () => {
  assert.equal(resolveCanonicalPageOrigin('/gmb-audit', 'https://preview.example'), CANONICAL_PRODUCTION_ORIGIN);
  assert.equal(resolveCanonicalPageOrigin('/catalogue/managed-seo', 'https://preview.example'), 'https://preview.example');
});
