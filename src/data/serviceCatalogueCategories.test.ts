import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCatalogueCategoryName, publicCataloguePackages, serviceCatalogueSlug, uniqueServiceCatalogueSlug, validServiceCatalogueSlug } from './serviceCatalogueCategories';
import {
  finalServicePrice,
  formatServicePrice,
  hasServiceDiscount,
  type ServiceCatalogueCategory,
  type ServicePackage,
} from './serviceCatalogue';

test('generates stable readable package slugs from names', () => {
  assert.equal(serviceCatalogueSlug('Google Maps Optimization Sprint'), 'google-maps-optimization-sprint');
  assert.equal(serviceCatalogueSlug('  SEO & Content—Growth! '), 'seo-content-growth');
  assert.equal(serviceCatalogueSlug('équipe locale'), 'equipe-locale');
  assert.equal(serviceCatalogueSlug('!?'), '');
});

test('rejects malformed and reserved catalogue route slugs', () => {
  assert.equal(validServiceCatalogueSlug('google-maps-optimization-sprint'), true);
  assert.equal(validServiceCatalogueSlug('all-services'), false);
  assert.equal(validServiceCatalogueSlug('payment-availability'), false);
  assert.equal(validServiceCatalogueSlug('-bad'), false);
  assert.equal(validServiceCatalogueSlug('Upper'), false);
});

test('adds unique suffixes and normalizes category whitespace', () => {
  assert.equal(uniqueServiceCatalogueSlug('all-services', new Set()), 'all-services-service');
  assert.equal(uniqueServiceCatalogueSlug('google-maps', new Set(['google-maps'])), 'google-maps-2');
  assert.equal(normalizeCatalogueCategoryName('  Google   Maps  '), 'Google Maps');
});

test('public catalogue exposes only published packages in active visible categories with synchronized labels', () => {
  const category: ServiceCatalogueCategory = {
    id: 'category-a',
    name: 'Renamed Category',
    slug: 'renamed-category',
    description: '',
    displayOrder: 1,
    active: true,
    showInCatalogue: true,
  };
  const hiddenCategory = { ...category, id: 'category-hidden', active: false };
  const packageBase: ServicePackage = {
    id: 'package-a',
    slug: 'package-a',
    packageCode: '',
    title: 'Package',
    category: 'Stale Label',
    categoryId: category.id,
    packageKind: 'service',
    summary: 'Summary',
    description: '',
    priceInr: 1,
    discountedPriceInr: null,
    billingType: 'one_time',
    imageUrl: '',
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
  };
  const result = publicCataloguePackages([
    packageBase,
    { ...packageBase, id: 'draft', slug: 'draft', status: 'draft' },
    { ...packageBase, id: 'hidden', slug: 'hidden', categoryId: hiddenCategory.id },
    { ...packageBase, id: 'unassigned', slug: 'unassigned', categoryId: undefined },
  ], [category, hiddenCategory]);
  assert.deepEqual(result.map((item) => item.id), ['package-a']);
  assert.equal(result[0].category, category.name);
});

test('uses only valid lower prices as package discounts', () => {
  assert.equal(hasServiceDiscount({ priceInr: 1200, discountedPriceInr: 900 }), true);
  assert.equal(finalServicePrice({ priceInr: 1200, discountedPriceInr: 900 }), 900);
  assert.equal(hasServiceDiscount({ priceInr: 1200, discountedPriceInr: 0 }), true);
  assert.equal(finalServicePrice({ priceInr: 1200, discountedPriceInr: 0 }), 0);

  for (const discountedPriceInr of [null, -1, 1200, 1500, Number.NaN, Number.POSITIVE_INFINITY]) {
    const item = { priceInr: 1200, discountedPriceInr };
    assert.equal(hasServiceDiscount(item), false);
    assert.equal(finalServicePrice(item), 1200);
  }
});

test('formats whole and fractional service prices as Indian rupees', () => {
  assert.equal(formatServicePrice(1200), '₹1,200');
  assert.equal(formatServicePrice(1200.5), '₹1,200.50');
});
