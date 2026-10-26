import type { ServiceCatalogueCategory, ServicePackage } from './serviceCatalogue';

export const RESERVED_CATALOGUE_SLUGS = new Set([
  'all',
  'all-services',
  'add-ons',
  'cart',
  'categories',
  'checkout',
  'enquiries',
  'orders',
  'payment-availability',
  'success',
]);

export function serviceCatalogueSlug(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return normalized.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}

export function uniqueServiceCatalogueSlug(value: string, used: ReadonlySet<string>): string {
  let base = serviceCatalogueSlug(value) || 'service-package';
  if (RESERVED_CATALOGUE_SLUGS.has(base)) base = `${base}-service`;
  base = base.slice(0, 100).replace(/-+$/g, '');
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const candidate = `${base.slice(0, 100 - String(suffix).length - 1).replace(/-+$/g, '')}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not generate a unique catalogue slug.');
}

export function normalizeCatalogueCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function publicCataloguePackages<T extends ServicePackage>(
  packages: T[],
  categories: ServiceCatalogueCategory[],
): T[] {
  const visibleCategories = new Map(
    categories
      .filter((category) => category.active && category.showInCatalogue)
      .map((category) => [category.id, category]),
  );
  return packages.flatMap((item): T[] => {
    if (item.status !== 'published' || !item.categoryId) return [];
    const category = visibleCategories.get(item.categoryId);
    return category ? [{ ...item, category: category.name }] : [];
  });
}

export function validServiceCatalogueSlug(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    value.length <= 100 &&
    !RESERVED_CATALOGUE_SLUGS.has(value);
}
