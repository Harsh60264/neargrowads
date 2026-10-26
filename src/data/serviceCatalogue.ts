export type ServiceBillingType = 'monthly' | 'one_time' | 'per_session';
export type ServicePackageKind = 'service' | 'add_on';
export type ServicePackageStatus = 'draft' | 'published';
export type ServiceCatalogueBadge = 'featured' | 'recommended' | 'most_popular';

export interface ServiceCatalogueCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  displayOrder: number;
  active: boolean;
  showInCatalogue: boolean;
  packageCount?: number;
}

export interface ServicePackage {
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
  createdAt?: string;
  updatedAt?: string;
}

export const formatServicePrice = (price: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);

export const hasServiceDiscount = (item: Pick<ServicePackage, 'priceInr' | 'discountedPriceInr'>): boolean =>
  typeof item.discountedPriceInr === 'number' &&
  Number.isFinite(item.discountedPriceInr) &&
  item.discountedPriceInr >= 0 &&
  item.discountedPriceInr < item.priceInr;

export const finalServicePrice = (item: Pick<ServicePackage, 'priceInr' | 'discountedPriceInr'>): number => {
  const discountedPrice = item.discountedPriceInr;
  return typeof discountedPrice === 'number' &&
    Number.isFinite(discountedPrice) &&
    discountedPrice >= 0 &&
    discountedPrice < item.priceInr
    ? discountedPrice
    : item.priceInr;
};

export const billingTypeLabel: Record<ServiceBillingType, string> = {
  monthly: 'Monthly',
  one_time: 'One-time',
  per_session: 'Per session',
};
