import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CircleHelp,
  Globe2,
  GitCompareArrows,
  Heart,
  LoaderCircle,
  MapPin,
  Megaphone,
  MessageCircle,
  PackageOpen,
  PenTool,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  billingTypeLabel,
  finalServicePrice,
  formatServicePrice,
  hasServiceDiscount,
  type ServiceBillingType,
  type ServiceCatalogueBadge,
  type ServiceCatalogueCategory,
  type ServicePackage,
} from '../../data/serviceCatalogue';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';

type PackageFilter = 'all' | 'monthly' | 'one_time' | 'add_on';
type PackageSort = 'featured' | 'price_asc' | 'price_desc' | 'alphabetical';

interface CartEntry {
  item: ServicePackage;
  quantity: number;
}

interface EnquiryTarget {
  packageItem?: ServicePackage;
  serviceInterest?: string;
}

interface CheckoutOrderResult {
  id: string;
  orderReference: string;
  trackingToken: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
}

interface RazorpayCheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay checkout did not initialize.'));
    script.onerror = () => reject(new Error('Secure checkout could not be loaded. Please try again.'));
    document.head.append(script);
  });
  razorpayScriptPromise = loading.catch((error: unknown) => {
    razorpayScriptPromise = null;
    throw error;
  });
  return razorpayScriptPromise;
}

const WHATSAPP_NUMBER = '919289810149';
const PACKAGES_PER_PAGE = 3;
const cardStyle = { backgroundColor: 'var(--brand-surface)', borderColor: 'var(--brand-border)' };
const badgeLabel: Record<ServiceCatalogueBadge, string> = {
  featured: 'Featured',
  recommended: 'Recommended',
  most_popular: 'Most Popular',
};

const servicePreviews: { title: string; description: string; Icon: LucideIcon }[] = [
  { title: 'Google Maps Optimization', description: 'Google Business Profile management and local listing support for business discovery.', Icon: MapPin },
  { title: 'Local SEO', description: 'Local and multi-location search optimization shaped around your markets and business goals.', Icon: Search },
  { title: 'Google Ads', description: 'Paid search campaign planning and management for relevant audience and acquisition goals.', Icon: Megaphone },
  { title: 'Meta Ads', description: 'Paid campaign support across Meta platforms, aligned to your audience and objectives.', Icon: Share2 },
  { title: 'Social Media Management', description: 'Social channel planning and ongoing content publishing support for your brand.', Icon: Globe2 },
  { title: 'Website Development', description: 'Mobile-first website design and development with clear paths for customer enquiries.', Icon: PenTool },
];

interface CatalogueResponse {
  packages: ServicePackage[];
  categories: ServiceCatalogueCategory[];
  whatsappNumber?: string;
}

async function fetchCatalogue(): Promise<CatalogueResponse> {
  const response = await fetch('/api/catalogue', { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({})) as { packages?: ServicePackage[]; categories?: ServiceCatalogueCategory[]; whatsappNumber?: string; message?: string };
  if (!response.ok) throw new Error(body.message || `Could not load catalogue (${response.status}).`);
  if (!Array.isArray(body.packages)) throw new Error('The catalogue response was incomplete.');
  if (!Array.isArray(body.categories)) throw new Error('The catalogue category response was incomplete.');
  return { packages: body.packages, categories: body.categories, whatsappNumber: body.whatsappNumber };
}

function priceLabel(item: ServicePackage): string {
  const finalPrice = formatServicePrice(finalServicePrice(item));
  const original = hasServiceDiscount(item) ? ` (was ${formatServicePrice(item.priceInr)})` : '';
  return `${finalPrice}${original} / ${billingTypeLabel[item.billingType].toLowerCase()}`;
}

function whatsappUrl(message: string, number = WHATSAPP_NUMBER): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function WhatsAppLink({ message, children, className = '', number }: { message: string; children: React.ReactNode; className?: string; number?: string }) {
  return <a href={whatsappUrl(message, number)} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

function useAccessibleDialog(ref: { current: HTMLElement | null }, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableElements = () => [...(ref.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || [])].filter((element) => element.getClientRects().length > 0);
    focusableElements()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = oldOverflow;
      previouslyFocused?.focus();
    };
  }, [ref]);
}

export function CataloguePage({ slug, onNavigate, siteContent = DEFAULT_SITE_CONTENT }: { slug?: string; onNavigate: (path: string) => void; siteContent?: SiteContent }) {
  const text = (key: string) => publicText(siteContent.copy, key);
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [categories, setCategories] = useState<ServiceCatalogueCategory[]>([]);
  const [whatsappNumber, setWhatsappNumber] = useState(WHATSAPP_NUMBER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<PackageFilter>('all');
  const [sort, setSort] = useState<PackageSort>('featured');
  const [page, setPage] = useState(1);
  const packageGridRef = useRef<HTMLDivElement>(null);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem('neargrow-catalogue-saved') || '[]');
      return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [showCart, setShowCart] = useState(false);
  const [checkoutCart, setCheckoutCart] = useState<CartEntry[] | null>(null);
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [paymentAvailabilityChecked, setPaymentAvailabilityChecked] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [enquiryTarget, setEnquiryTarget] = useState<EnquiryTarget | null>(null);
  const [requestNote, setRequestNote] = useState('');
  const [toast, setToast] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchCatalogue().then((result) => {
      if (active) {
        setPackages(result.packages);
        setCategories(result.categories);
        if (result.whatsappNumber && /^[0-9]{8,15}$/.test(result.whatsappNumber)) {
          setWhatsappNumber(result.whatsappNumber);
        }
      }
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'The catalogue could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/catalogue/payment-availability', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { available?: boolean };
        if (active) setPaymentAvailable(response.ok && data.available === true);
      })
      .catch((error: unknown) => {
        console.error('[NearGrow Ads] Payment availability could not be checked.', error);
        if (active) setPaymentAvailable(false);
      })
      .finally(() => {
        if (active) setPaymentAvailabilityChecked(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('neargrow-catalogue-saved', JSON.stringify(favorites));
    } catch {
      setToast('Saved items are available for this session only.');
    }
  }, [favorites]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const item = packages.find((candidate) => candidate.slug === slug);
    const previousTitle = document.title;
    const description = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.href;
    const structuredData = item
      ? {
          '@context': 'https://schema.org',
          '@type': 'Service',
          name: item.title,
          description: item.summary || item.description,
          serviceType: item.category,
          provider: { '@type': 'Organization', name: 'NearGrow Ads' },
          url: window.location.href,
          offers: {
            '@type': 'Offer',
            priceCurrency: 'INR',
            price: finalServicePrice(item),
            url: window.location.href,
          },
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'NearGrow Ads Service Catalogue',
          itemListElement: packages.map((packageItem, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${window.location.origin}/catalogue/${encodeURIComponent(packageItem.slug)}`,
            item: {
              '@type': 'Service',
              name: packageItem.title,
              description: packageItem.summary || packageItem.description,
              serviceType: packageItem.category,
              offers: {
                '@type': 'Offer',
                priceCurrency: 'INR',
                price: finalServicePrice(packageItem),
              },
            },
          })),
        };
    const structuredDataScript = document.createElement('script');
    structuredDataScript.type = 'application/ld+json';
    structuredDataScript.dataset.catalogueStructuredData = 'true';
    structuredDataScript.textContent = JSON.stringify(structuredData).replace(/</g, '\\u003c');
    document.head.appendChild(structuredDataScript);
    document.title = item ? `${item.title} | NearGrow Ads Catalogue` : siteContent.seo.catalogue.title;
    description?.setAttribute('content', item?.summary || siteContent.seo.catalogue.description);
    canonical?.setAttribute('href', window.location.href);
    return () => {
      structuredDataScript.remove();
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
      if (canonical && previousCanonical) canonical.href = previousCanonical;
    };
  }, [slug, packages, siteContent.seo.catalogue]);

  const categoryOptions = useMemo(() => {
    return [
      { id: 'all', label: 'All Services' },
      ...categories.map((item) => ({ id: item.id, label: item.name })),
    ];
  }, [categories]);

  const filteredPackages = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result = packages.filter((item) => {
      const searchable = [
        item.title,
        item.category,
        item.summary,
        item.description,
        item.packageCode,
        ...item.deliverables,
        ...item.exclusions,
        ...item.clientRequirements,
      ].join(' ').toLowerCase();
      const matchesTerm = !term || searchable.includes(term);
      const selectedCategory = categories.find((candidate) => candidate.id === category);
      const matchesCategory = category === 'all' ||
        item.categoryId === category ||
        (!item.categoryId && Boolean(selectedCategory && item.category.trim().toLocaleLowerCase() === selectedCategory.name.trim().toLocaleLowerCase()));
      const matchesType = filter === 'all' ||
        (filter === 'monthly' && item.billingType === 'monthly') ||
        (filter === 'one_time' && item.billingType === 'one_time') ||
        (filter === 'add_on' && item.packageKind === 'add_on');
      return matchesTerm && matchesCategory && matchesType;
    });
    return result.sort((a, b) => {
      if (sort === 'price_asc') return finalServicePrice(a) - finalServicePrice(b) || a.title.localeCompare(b.title);
      if (sort === 'price_desc') return finalServicePrice(b) - finalServicePrice(a) || a.title.localeCompare(b.title);
      if (sort === 'alphabetical') return a.title.localeCompare(b.title);
      const badgeRank: Record<ServiceCatalogueBadge, number> = { featured: 0, recommended: 1, most_popular: 2 };
      return (a.catalogueBadge ? badgeRank[a.catalogueBadge] + 1 : 0) -
        (b.catalogueBadge ? badgeRank[b.catalogueBadge] + 1 : 0) || a.title.localeCompare(b.title);
    });
  }, [packages, categories, query, category, filter, sort]);

  const pageCount = Math.ceil(filteredPackages.length / PACKAGES_PER_PAGE);
  const validPage = Math.min(page, Math.max(1, pageCount));
  const visiblePackages = filteredPackages.slice(
    (validPage - 1) * PACKAGES_PER_PAGE,
    validPage * PACKAGES_PER_PAGE,
  );
  const paginationPages: (number | 'ellipsis')[] = pageCount <= 5
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : validPage <= 3
      ? [1, 2, 3, 'ellipsis', pageCount]
      : validPage >= pageCount - 2
        ? [1, 'ellipsis', pageCount - 2, pageCount - 1, pageCount]
        : [1, 'ellipsis', validPage - 1, validPage, validPage + 1, 'ellipsis', pageCount];

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, pageCount)));
  }, [pageCount]);

  const selectedPackage = slug ? packages.find((item) => item.slug === slug) : undefined;
  const savedPackages = packages.filter((item) => favorites.includes(item.id));
  const comparePackages = compare.map((id) => packages.find((item) => item.id === id)).filter((item): item is ServicePackage => Boolean(item));

  const addToCart = (item: ServicePackage) => {
    const found = cart.find((entry) => entry.item.id === item.id);
    if (found) {
      if (!item.quantitySupported) {
        setToast('This package is already in your enquiry cart.');
        return;
      }
      setCart((current) => current.map((entry) => entry.item.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry));
      setToast('Package quantity updated.');
      return;
    }
    setCart((current) => [...current, { item, quantity: 1 }]);
    setToast(`${item.title} added to your enquiry cart.`);
  };

  const removeFromCart = (id: string) => setCart((current) => current.filter((entry) => entry.item.id !== id));

  const toggleCompare = (item: ServicePackage) => {
    setCompare((current) => {
      if (current.includes(item.id)) return current.filter((id) => id !== item.id);
      if (current.length >= 3) {
        setToast('Compare up to three packages at a time.');
        return current;
      }
      return [...current, item.id];
    });
  };

  const toggleFavorite = (item: ServicePackage) => {
    setFavorites((current) => current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : [...current, item.id]);
    setToast(favorites.includes(item.id) ? 'Removed from saved services.' : 'Saved for later.');
  };

  const updateQuery = (value: string) => {
    setPage(1);
    setQuery(value);
  };

  const updateCategory = (value: string) => {
    setPage(1);
    setCategory(value);
  };

  const updateFilter = (value: PackageFilter) => {
    setPage(1);
    setFilter(value);
  };

  const updateSort = (value: PackageSort) => {
    setPage(1);
    setSort(value);
  };

  const resetFilters = () => {
    updateQuery('');
    updateCategory('all');
    updateFilter('all');
    updateSort('featured');
  };

  const scrollToCatalogue = () => {
    const catalogue = document.getElementById('catalogue-services');
    if (!catalogue) return;
    catalogue.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    packageGridRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  };

  const totalFor = (billingType: ServiceBillingType) =>
    cart.filter((entry) => entry.item.billingType === billingType)
      .reduce((total, entry) => total + finalServicePrice(entry.item) * entry.quantity, 0);

  const cartMessage = () => {
    const lines = cart.map(({ item, quantity }) =>
      `- ${item.title}${item.packageCode ? ` (${item.packageCode})` : ''}${quantity > 1 ? ` x${quantity}` : ''}: ${priceLabel(item)}`);
    return [
      'Hi NearGrow Ads, I would like to request an enquiry for these services:',
      ...lines,
      '',
      `Request: ${requestNote.trim() || 'Please share the next steps and any information you need from me.'}`,
      'I understand this is an enquiry and not a payment or confirmed order.',
    ].join('\n');
  };

  const singleItemMessage = (item: ServicePackage) =>
    `Hi NearGrow Ads, I would like to enquire about ${item.title}${item.packageCode ? ` (${item.packageCode})` : ''}. Listed price: ${priceLabel(item)}. Please share details.`;

  const detail = () => {
    if (loading) return <PageState title="Loading service details" description="Getting the latest published package information." busy />;
    if (error) return <PageState title="Service details unavailable" description={error} retry={() => window.location.reload()} />;
    if (!selectedPackage) return <PageState title="Package not found" description="This package may have been unpublished or removed." action={() => onNavigate('/catalogue')} actionLabel="Back to Catalogue" />;
    return <ServiceDetail item={selectedPackage} onBack={() => onNavigate('/catalogue')} onAdd={() => addToCart(selectedPackage)} onBuy={() => setCheckoutCart([{ item: selectedPackage, quantity: 1 }])} paymentAvailable={paymentAvailable} onEnquire={() => setEnquiryTarget({ packageItem: selectedPackage, serviceInterest: selectedPackage.category })} onCompare={() => toggleCompare(selectedPackage)} compared={compare.includes(selectedPackage.id)} whatsappNumber={whatsappNumber} />;
  };

  const activeChips = [
    query.trim() ? { label: `Search: ${query.trim()}`, clear: () => updateQuery('') } : undefined,
    category !== 'all' ? { label: categoryOptions.find((item) => item.id === category)?.label || 'Category', clear: () => updateCategory('all') } : undefined,
    filter !== 'all' ? {
      label: filter === 'monthly' ? 'Monthly packages' : filter === 'one_time' ? 'One-time services' : 'Add-ons',
      clear: () => updateFilter('all'),
    } : undefined,
    sort !== 'featured' ? {
      label: `Sort: ${sort === 'price_asc' ? 'Price low to high' : sort === 'price_desc' ? 'Price high to low' : 'Alphabetical'}`,
      clear: () => updateSort('featured'),
    } : undefined,
  ].filter((item): item is { label: string; clear: () => void } => Boolean(item));

  return (
    <div className="catalogue-page min-h-screen" style={{ backgroundColor: 'var(--brand-bg)', color: 'var(--brand-text)' }}>
      <section className="relative isolate overflow-hidden border-b px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24" style={{ borderColor: 'var(--brand-border)' }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-[#3EA259]/10 blur-3xl" />
        <HeroOrbitBackground ambient />
        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
          <div>
            <div className="inline-flex items-center rounded-full border border-[#3EA259]/30 bg-[#3EA259]/10 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-[#70BE55]">
              {text('catalogue.hero.eyebrow')}
            </div>
            <h1 className="mt-6 max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              {text('catalogue.hero.headlineBefore')} <span className="text-[#70BE55]">{text('catalogue.hero.headlineHighlight')}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--brand-text-muted)] sm:text-base sm:leading-8">
              {text('catalogue.hero.description')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
              <button type="button" onClick={scrollToCatalogue} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-5 text-sm font-bold text-white transition hover:bg-[#216F3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55] motion-reduce:transition-none sm:w-auto">
                {text('catalogue.hero.primaryCta')} <ArrowRight className="h-4 w-4" />
              </button>
              <a href={whatsappUrl('Hi NearGrow Ads, I would like to discuss your services.', whatsappNumber)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-5 text-sm font-semibold transition hover:border-[#3EA259] hover:text-[#3EA259] motion-reduce:transition-none sm:w-auto" style={{ borderColor: 'var(--brand-border)' }}>
                {text('catalogue.hero.secondaryCta')} <MessageCircle className="h-4 w-4" />
              </a>
            </div>
          </div>
          <div className="rounded-3xl border p-5 shadow-xl sm:p-7" style={cardStyle}>
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-widest text-[#70BE55]">{text('catalogue.hero.cardEyebrow')}</p><h2 className="mt-2 text-xl font-bold">{text('catalogue.hero.cardTitle')}</h2></div>
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#3EA259]/10 text-[#70BE55]"><PackageOpen className="h-6 w-6" /></div>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--brand-text-muted)]">{text('catalogue.hero.cardDescription')}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--brand-border)' }}><div className="text-2xl font-extrabold text-[#70BE55]">{loading ? '—' : packages.length}</div><div className="mt-1 text-xs text-[var(--brand-text-muted)]">Published packages</div></div>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--brand-border)' }}><div className="text-2xl font-extrabold text-[#70BE55]">{loading ? '—' : categories.length}</div><div className="mt-1 text-xs text-[var(--brand-text-muted)]">Service categories</div></div>
            </div>
          </div>
        </div>
      </section>

      <section id="catalogue-services" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#70BE55]">{text('catalogue.list.eyebrow')}</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">{text('catalogue.list.title')}</h2>
            <p className="mt-2 text-sm text-[var(--brand-text-muted)]">{loading ? 'Loading published packages…' : `${filteredPackages.length} ${filteredPackages.length === 1 ? 'package' : 'packages'} available`}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowSaved((value) => !value)} aria-pressed={showSaved} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition hover:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }}>
              <Bookmark className="h-4 w-4" /> Saved ({savedPackages.length})
            </button>
            <button type="button" onClick={() => setShowCart(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#3EA259] px-3.5 text-xs font-bold text-white transition hover:bg-[#216F3D]">
              <ShoppingCart className="h-4 w-4" /> Enquiry Cart ({cart.reduce((sum, entry) => sum + entry.quantity, 0)})
            </button>
          </div>
        </div>

        {error ? (
          <PageState title="Catalogue unavailable" description={error} retry={() => window.location.reload()} />
        ) : loading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading catalogue">
            {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-80 animate-pulse rounded-2xl border bg-[var(--brand-surface)]" style={{ borderColor: 'var(--brand-border)' }} />)}
          </div>
        ) : packages.length === 0 && categories.length === 0 ? (
          <section aria-labelledby="service-previews-title" className="rounded-3xl border p-5 sm:p-8" style={cardStyle}>
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#70BE55]">Service previews · not purchasable packages</p>
              <h3 id="service-previews-title" className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore What We Can Help With</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--brand-text-muted)]">There are no published or priced packages right now. These service areas are previews only; ask our team about scope and fit.</p>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {servicePreviews.map(({ title, description, Icon }) => (
                <article key={title} className="flex h-full flex-col rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:border-[#3EA259]/60 hover:shadow-lg motion-reduce:transition-none" style={{ borderColor: 'var(--brand-border)', backgroundColor: 'var(--brand-bg)' }}>
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#3EA259]/10 text-[#70BE55]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  <h4 className="mt-4 text-base font-bold">{title}</h4>
                  <p className="mt-2 flex-1 text-sm leading-6 text-[var(--brand-text-muted)]">{description}</p>
                  <button type="button" onClick={() => setEnquiryTarget({ serviceInterest: title })} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition hover:border-[#3EA259] hover:text-[#70BE55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]" style={{ borderColor: 'var(--brand-border)' }}>
                    Ask About This Service <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <>
            <nav aria-label="Quick service categories" className="-mx-4 mb-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              <div className="flex w-max min-w-full gap-2" role="group">
                {categoryOptions.map(({ id, label }) => (
                  <button key={id} type="button" onClick={() => updateCategory(id)} aria-pressed={category === id} className={`min-h-10 shrink-0 rounded-full border px-4 text-xs font-semibold transition motion-reduce:transition-none ${category === id ? 'border-[#3EA259] bg-[#3EA259]/10 text-[#70BE55]' : 'hover:border-[#3EA259] hover:text-[#70BE55]'}`} style={category === id ? undefined : { borderColor: 'var(--brand-border)' }}>
                    {label}
                  </button>
                ))}
              </div>
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-11 min-w-[min(100%,280px)] flex-1 items-center gap-2 rounded-xl border px-3.5 focus-within:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)', backgroundColor: 'var(--brand-surface)' }}>
                <Search className="h-4 w-4 shrink-0 text-[var(--brand-text-muted)]" />
                <input value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search packages, services or deliverables" aria-label="Search service packages" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--brand-text-muted)]" />
                {query && <button type="button" onClick={() => updateQuery('')} aria-label="Clear search" className="text-[var(--brand-text-muted)] hover:text-[#70BE55]"><X className="h-4 w-4" /></button>}
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--brand-border)', backgroundColor: 'var(--brand-surface)' }}>
                <SlidersHorizontal className="h-4 w-4" /><span className="sr-only">Sort packages</span>
                <select value={sort} onChange={(event) => updateSort(event.target.value as PackageSort)} className="bg-transparent text-xs outline-none">
                  <option value="featured">Featured</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="alphabetical">Alphabetical</option>
                </select>
              </label>
              <button type="button" onClick={() => setMobileFiltersOpen((open) => !open)} aria-expanded={mobileFiltersOpen} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold sm:hidden" style={{ borderColor: 'var(--brand-border)' }}><SlidersHorizontal className="h-4 w-4" /> Filters</button>
            </div>

            <div aria-label="Billing type filters" role="group" className={`${mobileFiltersOpen ? 'flex' : 'hidden'} mt-3 flex-wrap gap-2 sm:flex`}>
              {([
                ['all', 'All Billing Types'],
                ['monthly', 'Monthly Packages'],
                ['one_time', 'One-Time Services'],
                ['add_on', 'Add-ons'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => updateFilter(value)} aria-pressed={filter === value} className={`min-h-9 rounded-full border px-3.5 text-xs font-semibold transition ${filter === value ? 'border-[#3EA259] bg-[#3EA259]/10 text-[#70BE55]' : 'hover:border-[#3EA259]'}`} style={filter === value ? undefined : { borderColor: 'var(--brand-border)' }}>{label}</button>
              ))}
            </div>

            {activeChips.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Active filters">
                {activeChips.map((chip) => <button key={chip.label} type="button" onClick={chip.clear} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[#3EA259]/10 px-3 text-xs text-[#70BE55]">{chip.label}<X className="h-3 w-3" /></button>)}
                <button type="button" onClick={resetFilters} className="min-h-8 px-2 text-xs font-semibold text-[var(--brand-text-muted)] underline underline-offset-2">Reset All Filters</button>
              </div>
            )}

            {showSaved && savedPackages.length > 0 && (
              <section className="mt-8 rounded-2xl border p-5 sm:p-6" style={cardStyle}>
                <h3 className="mb-4 flex items-center gap-2 font-bold"><Heart className="h-4 w-4 text-[#70BE55]" /> Saved for later</h3>
                <div className="flex flex-wrap gap-3">
                  {savedPackages.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(`/catalogue/${item.slug}`)} className="rounded-xl border px-4 py-3 text-left text-sm hover:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }}><span className="block font-semibold">{item.title}</span><span className="mt-1 block text-xs text-[var(--brand-text-muted)]">{priceLabel(item)}</span></button>)}
                </div>
              </section>
            )}

            {showSaved && savedPackages.length === 0 && <p className="mt-6 rounded-xl border p-4 text-sm text-[var(--brand-text-muted)]" style={cardStyle}>No saved services yet. Use the bookmark button on a package to save it for later.</p>}

            {filteredPackages.some((item) => item.catalogueBadge) && (
              <section className="mt-8">
                <div className="mb-4"><p className="text-xs font-bold uppercase tracking-widest text-[#70BE55]">Selected services</p><h3 className="mt-1 text-xl font-bold">Featured Packages</h3></div>
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredPackages.filter((item) => item.catalogueBadge).map((item) => <FeaturedCard key={item.id} item={item} onOpen={() => onNavigate(`/catalogue/${item.slug}`)} />)}
                </div>
              </section>
            )}

            <div ref={packageGridRef} id="catalogue-package-grid" className="mt-8 grid scroll-mt-24 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visiblePackages.map((item) => (
                <PackageCard
                  key={item.id}
                  item={item}
                  favorite={favorites.includes(item.id)}
                  compared={compare.includes(item.id)}
                  onOpen={() => onNavigate(`/catalogue/${item.slug}`)}
                  onAdd={() => addToCart(item)}
                  onBuy={() => setCheckoutCart([{ item, quantity: 1 }])}
                  paymentAvailable={paymentAvailable}
                  onEnquire={() => setEnquiryTarget({ packageItem: item, serviceInterest: item.category })}
                  onCompare={() => toggleCompare(item)}
                  onFavorite={() => toggleFavorite(item)}
                  whatsappNumber={whatsappNumber}
                />
              ))}
            </div>
            {pageCount > 1 && (
              <nav aria-label="Catalogue pagination" className="mt-8 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(validPage - 1)}
                  disabled={validPage === 1}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition hover:border-[#3EA259] hover:bg-[#3EA259]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: 'var(--brand-border)', backgroundColor: 'var(--brand-surface)', color: 'var(--brand-text)' }}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </button>
                {paginationPages.map((pageNumber, index) => pageNumber === 'ellipsis'
                  ? <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-sm text-[var(--brand-text-muted)]">...</span>
                  : (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => goToPage(pageNumber)}
                      aria-label={`Page ${pageNumber}`}
                      aria-current={validPage === pageNumber ? 'page' : undefined}
                      className="min-h-10 min-w-10 rounded-xl border px-3 text-xs font-semibold transition hover:border-[#3EA259] hover:bg-[#3EA259]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]"
                      style={validPage === pageNumber
                        ? { borderColor: 'var(--brand-green-deep)', backgroundColor: 'var(--brand-green-deep)', color: '#FFFFFF' }
                        : { borderColor: 'var(--brand-border)', backgroundColor: 'var(--brand-surface)', color: 'var(--brand-text)' }}
                    >
                      {pageNumber}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => goToPage(validPage + 1)}
                  disabled={validPage === pageCount}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition hover:border-[#3EA259] hover:bg-[#3EA259]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: 'var(--brand-border)', backgroundColor: 'var(--brand-surface)', color: 'var(--brand-text)' }}
                >
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </nav>
            )}
            {filteredPackages.length === 0 && <PageState
              title={category !== 'all' ? `No published packages in ${categoryOptions.find((item) => item.id === category)?.label || 'this category'}` : packages.length === 0 ? 'No published packages yet' : 'No matching packages'}
              description={category !== 'all'
                ? 'This active Catalogue category does not currently have any published packages.'
                : packages.length === 0
                  ? 'There are no published packages in the Catalogue yet. Draft packages remain private.'
                  : 'Try another keyword or clear some filters to see the available published packages.'}
              action={category !== 'all' || query || filter !== 'all' || sort !== 'featured' ? resetFilters : undefined}
              actionLabel="Reset All Filters"
            />}
          </>
        )}
      </section>

      <section className="border-t px-4 py-12 sm:px-6 lg:px-8" style={{ borderColor: 'var(--brand-border)' }}>
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 rounded-3xl border p-6 sm:flex-row sm:items-center sm:p-8" style={cardStyle}>
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#70BE55]">Not sure where to start?</p><h2 className="mt-2 text-2xl font-extrabold">Talk through your goals with our team.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--brand-text-muted)]">Ask about scope, fit and next steps before choosing a package.</p></div>
          <a href={whatsappUrl('Hi NearGrow Ads, I would like help choosing a service.', whatsappNumber)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-5 text-sm font-bold text-white hover:bg-[#216F3D] sm:w-auto">Talk to Our Team <MessageCircle className="h-4 w-4" /></a>
        </div>
      </section>

      {cart.length > 0 && <button type="button" onClick={() => setShowCart(true)} className="fixed bottom-5 left-1/2 z-[75] flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-[#3EA259] px-5 text-sm font-bold text-white shadow-xl transition hover:bg-[#216F3D]"><ShoppingCart className="h-4 w-4" /> Enquiry Cart · {cart.reduce((sum, entry) => sum + entry.quantity, 0)} <ArrowRight className="h-4 w-4" /></button>}

      {slug && <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Service details" style={{ backgroundColor: 'var(--brand-bg)' }}>{detail()}</div>}

      {showCart && <CartDialog cart={cart} setCart={setCart} remove={removeFromCart} totalFor={totalFor} note={requestNote} setNote={setRequestNote} message={cartMessage()} paymentAvailable={paymentAvailable} paymentAvailabilityChecked={paymentAvailabilityChecked} onCheckout={() => { setCheckoutCart(cart); setShowCart(false); }} onClose={() => setShowCart(false)} />}
      {checkoutCart && <CheckoutDialog entries={checkoutCart} onPaid={() => {
        const purchasedIds = new Set(checkoutCart.map(({ item }) => item.id));
        setCart((current) => current.filter(({ item }) => !purchasedIds.has(item.id)));
      }} onClose={() => setCheckoutCart(null)} />}
      {enquiryTarget && <ServiceEnquiryDialog target={enquiryTarget} whatsappNumber={whatsappNumber} onClose={() => setEnquiryTarget(null)} />}
      {showCompare && <CompareDialog packages={comparePackages} onClose={() => setShowCompare(false)} remove={(id) => setCompare((current) => current.filter((item) => item !== id))} />}
      {compare.length > 0 && <button type="button" onClick={() => setShowCompare(true)} className="fixed bottom-24 right-4 z-[75] inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs font-bold shadow-lg sm:right-6" style={{ ...cardStyle, color: 'var(--brand-text)' }}><GitCompareArrows className="h-4 w-4" /> Compare ({compare.length})</button>}
      {toast && <div role="status" aria-live="polite" className="fixed bottom-20 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-[#14251A] px-4 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}
    </div>
  );
}

function PageState({ title, description, retry, action, actionLabel, busy = false }: { title: string; description: string; retry?: () => void; action?: () => void; actionLabel?: string; busy?: boolean }) {
  return (
    <div className="my-8 rounded-2xl border p-8 text-center sm:p-12" style={cardStyle}>
      {busy ? <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-[#70BE55]" /> : <PackageOpen className="mx-auto h-8 w-8 text-[#70BE55]" />}
      <h3 className="mt-4 text-xl font-bold">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--brand-text-muted)]">{description}</p>
      {retry && <button type="button" onClick={retry} className="mt-5 rounded-xl bg-[#3EA259] px-4 py-2.5 text-xs font-bold text-white">Try again</button>}
      {action && actionLabel && <button type="button" onClick={action} className="mt-5 rounded-xl bg-[#3EA259] px-4 py-2.5 text-xs font-bold text-white">{actionLabel}</button>}
    </div>
  );
}

function PackageCard({ item, favorite, compared, onOpen, onAdd, onBuy, paymentAvailable, onEnquire, onCompare, onFavorite, whatsappNumber }: {
  item: ServicePackage;
  favorite: boolean;
  compared: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onBuy: () => void;
  paymentAvailable: boolean;
  onEnquire: () => void;
  onCompare: () => void;
  onFavorite: () => void;
  whatsappNumber: string;
}) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border transition duration-200 hover:-translate-y-1 hover:shadow-xl" style={cardStyle}>
      <div className="relative aspect-[16/9] overflow-hidden bg-[#3EA259]/10">
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-[#70BE55]"><PackageOpen className="h-12 w-12" /></div>}
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {item.catalogueBadge && <span className="rounded-full bg-[#F59E0B] px-2.5 py-1 text-[10px] font-bold text-[#171A17]">{badgeLabel[item.catalogueBadge]}</span>}
          {item.packageKind === 'add_on' && <span className="rounded-full bg-[#14251A]/90 px-2.5 py-1 text-[10px] font-bold text-white">Add-on</span>}
          {item.packageKind !== 'add_on' && <span className="rounded-full bg-[#14251A]/90 px-2.5 py-1 text-[10px] font-bold text-white">{billingTypeLabel[item.billingType]}</span>}
        </div>
        <button type="button" onClick={onFavorite} aria-label={favorite ? 'Remove saved service' : 'Save service for later'} aria-pressed={favorite} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"><Bookmark className={`h-4 w-4 ${favorite ? 'fill-current text-[#F3B94F]' : ''}`} /></button>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#70BE55]">{item.category}</div>
        <h3 className="mt-2 text-lg font-bold leading-snug">{item.title}</h3>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--brand-text-muted)]">{item.summary}</p>
        <div className="mt-4">
          {hasServiceDiscount(item) && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-[var(--brand-text-muted)] line-through">{formatServicePrice(item.priceInr)}</span><span className="rounded-full bg-[#3EA259]/15 px-2 py-0.5 text-[10px] font-bold text-[#70BE55]">Save {formatServicePrice(item.priceInr - finalServicePrice(item))}</span></div>}
          <div className="text-lg font-extrabold">{formatServicePrice(finalServicePrice(item))} <span className="text-xs font-medium text-[var(--brand-text-muted)]">/ {billingTypeLabel[item.billingType].toLowerCase()}</span></div>
        </div>
        {item.deliverables.length > 0 && <ul className="mt-4 space-y-2 border-t pt-4 text-xs text-[var(--brand-text-muted)]" style={{ borderColor: 'var(--brand-border)' }}>{item.deliverables.slice(0, 4).map((detail) => <li key={detail} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#70BE55]" />{detail}</li>)}</ul>}
        <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
          <button type="button" onClick={onOpen} className="min-h-10 rounded-xl border px-3 text-xs font-bold transition hover:border-[#3EA259] hover:text-[#70BE55]" style={{ borderColor: 'var(--brand-border)' }}>View Details</button>
          <button type="button" onClick={onAdd} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#3EA259] px-3 text-xs font-bold text-white transition hover:bg-[#216F3D]"><ShoppingBag className="h-3.5 w-3.5" /> Add to Cart</button>
          <button type="button" onClick={onBuy} disabled={!paymentAvailable} title={paymentAvailable ? 'Start a secure Razorpay Test checkout' : 'Online payment currently unavailable'} className="col-span-2 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-[#3EA259]/40 px-3 text-xs font-bold text-[#70BE55] transition hover:bg-[#3EA259]/10 disabled:cursor-not-allowed disabled:opacity-50">
            {paymentAvailable ? 'Buy Now · Secure Test Checkout' : 'Online payment currently unavailable'}
          </button>
          <button type="button" onClick={onEnquire} className="col-span-2 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-[#3EA259]/40 px-3 text-xs font-bold text-[#70BE55] transition hover:bg-[#3EA259]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]"><MessageCircle className="h-3.5 w-3.5" /> Enquire About This Package</button>
          <button type="button" onClick={onCompare} aria-pressed={compared} className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold ${compared ? 'bg-[#3EA259]/10 text-[#70BE55]' : 'text-[var(--brand-text-muted)] hover:text-[#70BE55]'}`}><GitCompareArrows className="h-3.5 w-3.5" /> {compared ? 'Added to Compare' : 'Compare'}</button>
          <WhatsAppLink number={whatsappNumber} message={`Hi NearGrow Ads, I would like to enquire about ${item.title}${item.packageCode ? ` (${item.packageCode})` : ''}. Listed price: ${priceLabel(item)}.`} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold text-[var(--brand-text-muted)] hover:text-[#70BE55]"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</WhatsAppLink>
        </div>
      </div>
    </article>
  );
}

function FeaturedCard({ item, onOpen }: { item: ServicePackage; onOpen: () => void }) {
  const badge = item.catalogueBadge || 'featured';
  return (
    <button type="button" onClick={onOpen} className="flex min-h-24 w-full min-w-0 items-center gap-4 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-[#3EA259] sm:p-5" style={cardStyle}>
      {item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />}
      <span className="min-w-0 flex-1"><span className="block text-[10px] font-bold uppercase tracking-widest text-[#70BE55]">{badgeLabel[badge]} · {item.category}</span><span className="mt-1 block truncate font-bold">{item.title}</span><span className="mt-1 block text-xs text-[var(--brand-text-muted)]">{priceLabel(item)}</span></span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[#70BE55]" />
    </button>
  );
}

function ServiceDetail({ item, onBack, onAdd, onBuy, paymentAvailable, onEnquire, onCompare, compared, whatsappNumber }: { item: ServicePackage; onBack: () => void; onAdd: () => void; onBuy: () => void; paymentAvailable: boolean; onEnquire: () => void; onCompare: () => void; compared: boolean; whatsappNumber: string }) {
  const discounted = hasServiceDiscount(item);
  const finalPrice = finalServicePrice(item);
  const billingLabel = item.billingType === 'monthly' ? 'MONTHLY' : item.billingType === 'one_time' ? 'ONE-TIME' : 'PER SESSION';
  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-xs text-[var(--brand-text-muted)]"><button type="button" onClick={onBack} className="hover:text-[#70BE55]">Catalogue</button><span aria-hidden>/</span><span aria-current="page" className="truncate">{item.title}</span></nav>
        <button type="button" onClick={onBack} className="mb-7 inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition hover:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }}><ArrowLeft className="h-4 w-4" /> Back to Catalogue</button>
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)] lg:gap-9">
          <div className="space-y-6">
            <article className="overflow-hidden rounded-3xl border shadow-lg" style={cardStyle}>
              <div className="relative isolate overflow-hidden bg-[#3EA259]/10">
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.title} fetchPriority="high" className="aspect-[16/9] w-full object-cover sm:aspect-[2/1]" />
                  : <div className="grid aspect-[16/9] place-items-center text-[#70BE55] sm:aspect-[2/1]"><PackageOpen className="h-16 w-16" /></div>}
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#101913]/75 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 sm:bottom-5 sm:left-6">
                  <span className="rounded-full border border-white/20 bg-[#101913]/75 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur">{item.category}</span>
                  {item.catalogueBadge && <span className="rounded-full bg-[#F3B94F] px-3 py-1.5 text-[10px] font-bold text-[#171A17]">{badgeLabel[item.catalogueBadge]}</span>}
                </div>
              </div>
              <div className="p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#70BE55]">
                  <span>{item.packageKind === 'add_on' ? 'Service add-on' : 'Service package'}</span>
                  {item.packageCode && <><span aria-hidden className="text-[var(--brand-text-muted)]">·</span><span className="font-medium tracking-[0.08em] text-[var(--brand-text-muted)]">Code {item.packageCode}</span></>}
                </div>
                <h1 className="mt-3 max-w-4xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">{item.title}</h1>
                <p className="mt-4 max-w-3xl text-sm font-medium leading-7 text-[var(--brand-text-muted)] sm:text-base">{item.summary}</p>
                {item.description && item.description !== item.summary && <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--brand-text-muted)]">{item.description}</p>}
                {item.targetAudience && <div className="mt-6 rounded-2xl border border-[#3EA259]/20 bg-[#3EA259]/[0.06] p-4 sm:p-5"><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[#70BE55]">Best for</h2><p className="mt-2 text-sm leading-6 text-[var(--brand-text-muted)]">{item.targetAudience}</p></div>}
              </div>
            </article>

            {item.deliverables.length > 0 && <DetailList title="What's included" values={item.deliverables} variant="included" />}
            {item.exclusions.length > 0 && <DetailList title="What's excluded" values={item.exclusions} variant="excluded" />}
            {item.clientRequirements.length > 0 && <DetailList title="What we need from you" values={item.clientRequirements} variant="requirements" />}
            {item.deliveryTimeline && <section className="rounded-2xl border p-5 sm:p-6" style={cardStyle}><h2 className="text-base font-bold">Estimated delivery</h2><p className="mt-2 text-sm leading-6 text-[var(--brand-text-muted)]">{item.deliveryTimeline}</p></section>}
            {item.faqs.length > 0 && <section className="rounded-2xl border p-5 sm:p-6" style={cardStyle}>
              <h2 className="flex items-center gap-2 text-base font-bold"><CircleHelp className="h-5 w-5 text-[#70BE55]" /> Frequently asked questions</h2>
              <div className="mt-4 divide-y" style={{ borderColor: 'var(--brand-border)' }}>{item.faqs.map((faq, index) => <details key={`${faq.question}-${index}`} className="group py-4 first:pt-2 last:pb-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]"><span>{faq.question}</span><span aria-hidden className="text-lg font-medium text-[#70BE55] transition-transform group-open:rotate-45">+</span></summary>
                <p className="mt-3 pr-7 text-sm leading-6 text-[var(--brand-text-muted)]">{faq.answer}</p>
              </details>)}</div>
            </section>}
          </div>

          <aside className="lg:sticky lg:top-24">
            <section className="rounded-3xl border p-5 shadow-xl sm:p-7" style={cardStyle}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full border border-[#3EA259]/30 bg-[#3EA259]/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#70BE55]">{billingLabel}</span>
                {item.catalogueBadge && <span className="rounded-full bg-[#F3B94F]/15 px-3 py-1.5 text-[10px] font-bold text-[#D89D24]">{badgeLabel[item.catalogueBadge]}</span>}
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--brand-text-muted)]">Package price</p>
              {discounted && <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--brand-text-muted)] line-through">{formatServicePrice(item.priceInr)}</span>
                <span className="rounded-full bg-[#3EA259]/15 px-2.5 py-1 text-[10px] font-bold text-[#70BE55]">Save {formatServicePrice(item.priceInr - finalPrice)}</span>
              </div>}
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-4xl font-extrabold tracking-tight sm:text-[2.75rem]">{formatServicePrice(finalPrice)}</span>
                <span className="text-sm font-semibold text-[var(--brand-text-muted)]">/ {billingTypeLabel[item.billingType].toLowerCase()}</span>
              </div>
              <p className="mt-4 border-t pt-4 text-xs leading-5 text-[var(--brand-text-muted)]" style={{ borderColor: 'var(--brand-border)' }}>Package price as listed. Confirm scope and any applicable taxes with the team before engagement.</p>
              <button type="button" onClick={onAdd} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-4 text-sm font-bold text-white transition hover:bg-[#216F3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]"><ShoppingCart className="h-4 w-4" /> Add to Enquiry Cart</button>
              <button type="button" onClick={onBuy} disabled={!paymentAvailable} className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#3EA259]/40 px-4 text-sm font-bold text-[#70BE55] transition hover:bg-[#3EA259]/10 disabled:cursor-not-allowed disabled:opacity-50">{paymentAvailable ? 'Buy Now · Secure Test Checkout' : 'Online payment currently unavailable'}</button>
              <button type="button" onClick={onEnquire} className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#3EA259]/40 px-4 text-sm font-bold text-[#70BE55] transition hover:bg-[#3EA259]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]"><MessageCircle className="h-4 w-4" /> Enquire About This Package</button>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={onCompare} aria-pressed={compared} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 text-xs font-semibold transition hover:border-[#3EA259] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]" style={{ borderColor: 'var(--brand-border)' }}><GitCompareArrows className="h-4 w-4" /> {compared ? 'Remove Compare' : 'Compare'}</button>
                <WhatsAppLink number={whatsappNumber} message={`Hi NearGrow Ads, I would like to ask about ${item.title}${item.packageCode ? ` (${item.packageCode})` : ''}. Listed price: ${priceLabel(item)}.`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 text-xs font-semibold transition hover:border-[#3EA259] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#70BE55]" ><MessageCircle className="h-4 w-4" /> Ask on WhatsApp</WhatsAppLink>
              </div>
              <p className="mt-5 text-center text-[11px] leading-5 text-[var(--brand-text-muted)]">Razorpay Test checkouts are simulated and do not transfer real funds.</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DetailList({ title, values, variant }: { title: string; values: string[]; variant: 'included' | 'excluded' | 'requirements' }) {
  const Icon = variant === 'excluded' ? X : Check;
  const iconColor = variant === 'excluded' ? 'text-rose-400' : 'text-[#70BE55]';
  const tone = variant === 'excluded' ? 'border-rose-400/20 bg-rose-400/[0.035]' : variant === 'included' ? 'border-[#3EA259]/25 bg-[#3EA259]/[0.045]' : 'border-[var(--brand-border)]';
  return <section className={`rounded-2xl border p-5 sm:p-6 ${tone}`} style={{ backgroundColor: 'var(--brand-surface)' }}>
    <h2 className="text-base font-bold">{title}</h2>
    <ul className="mt-4 space-y-3">{values.map((value, index) => <li key={`${value}-${index}`} className="flex items-start gap-3 text-sm leading-6 text-[var(--brand-text-muted)]">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${variant === 'excluded' ? 'bg-rose-400/10' : 'bg-[#3EA259]/10'}`}><Icon className={`h-3.5 w-3.5 ${iconColor}`} aria-hidden="true" /></span>
      <span>{value}</span>
    </li>)}</ul>
  </section>;
}

function ServiceEnquiryDialog({ target, whatsappNumber, onClose }: {
  target: EnquiryTarget;
  whatsappNumber: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerBusinessName, setCustomerBusinessName] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const item = target.packageItem;
  const serviceInterest = target.serviceInterest || item?.category || 'Digital marketing services';

  useAccessibleDialog(dialogRef, onClose);

  const submitEnquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[+0-9().\s-]{7,25}$/.test(customerPhone.trim())) {
      setSubmitError('Enter a valid phone or WhatsApp number.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/catalogue/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          customerBusinessName,
          serviceInterest,
          requestNote,
          consent,
          packages: item ? [{ packageId: item.id, quantity: 1 }] : [],
        }),
      });
      const body = await response.json().catch(() => ({})) as { requestReference?: string; message?: string };
      if (!response.ok) throw new Error(body.message || `Could not submit enquiry (${response.status}).`);
      if (typeof body.requestReference !== 'string') throw new Error('The server did not return an enquiry reference.');
      setRequestReference(body.requestReference);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The enquiry could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  const whatsappMessage = `Hi NearGrow Ads, I would like to enquire about ${item ? `${item.title}${item.packageCode ? ` (${item.packageCode})` : ''}, listed at ${priceLabel(item)}` : serviceInterest}. Please share details.`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/60 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="service-enquiry-title" className="my-auto max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-3xl border shadow-2xl outline-none" style={{ backgroundColor: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b p-5 sm:p-6" style={{ backgroundColor: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#70BE55]">Service enquiry</p>
            <h2 id="service-enquiry-title" className="mt-1 text-xl font-extrabold sm:text-2xl">Enquire About This Package</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close enquiry" className="rounded-lg p-2 hover:bg-[#3EA259]/10"><X className="h-5 w-5" /></button>
        </header>

        {requestReference ? (
          <div className="p-6 sm:p-8">
            <div role="status" aria-live="polite" className="rounded-2xl border border-[#3EA259]/30 bg-[#3EA259]/10 p-5">
              <div className="flex items-center gap-2 font-bold text-[#70BE55]"><Check className="h-5 w-5" /> Enquiry received</div>
              <p className="mt-3 text-sm">Your reference: <strong>{requestReference}</strong></p>
              <p className="mt-2 text-xs leading-5 text-[var(--brand-text-muted)]">This confirms receipt of your enquiry only. No payment was taken and no service delivery is confirmed.</p>
            </div>
            <button type="button" onClick={onClose} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#3EA259] px-4 text-sm font-bold text-white hover:bg-[#216F3D]">Done</button>
          </div>
        ) : (
          <form onSubmit={(event) => void submitEnquiry(event)} className="space-y-4 p-5 sm:p-6">
            <section className="rounded-2xl border p-4" style={cardStyle}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#70BE55]">{item ? item.category : 'Service interest'}</p>
              <h3 className="mt-1 font-bold">{item?.title || serviceInterest}</h3>
              {item && <p className="mt-1 text-xs text-[var(--brand-text-muted)]">{priceLabel(item)}</p>}
              <p className="mt-2 text-sm leading-6 text-[var(--brand-text-muted)]">{item?.summary || 'Tell us what you are looking for and our team will follow up to discuss scope and next steps.'}</p>
            </section>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold">Your name
                <input required minLength={2} maxLength={120} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
              <label className="block text-xs font-semibold">Phone / WhatsApp number
                <input required type="tel" minLength={7} maxLength={25} autoComplete="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
              <label className="block text-xs font-semibold">Email (optional)
                <input type="email" maxLength={255} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
              <label className="block text-xs font-semibold">Business name (optional)
                <input maxLength={160} autoComplete="organization" value={customerBusinessName} onChange={(event) => setCustomerBusinessName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
            </div>
            <label className="block text-xs font-semibold">Message or specific requirements (optional)
              <textarea maxLength={1000} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Share a little about your goals or questions." className="mt-1.5 min-h-24 w-full rounded-xl border bg-transparent p-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
            </label>
            <label className="flex items-start gap-2.5 text-xs leading-5 text-[var(--brand-text-muted)]">
              <input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-[#3EA259]" />
              <span>I agree that NearGrow Ads may use these details to respond to this enquiry, as described in the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#70BE55] underline">Privacy Policy</a>.</span>
            </label>
            {submitError && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-950/20 p-3 text-xs text-rose-300">{submitError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="submit" disabled={submitting} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-4 text-sm font-bold text-white transition hover:bg-[#216F3D] disabled:cursor-wait disabled:opacity-60">
                {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} {submitting ? 'Sending enquiry…' : 'Submit Enquiry'}
              </button>
              <WhatsAppLink number={whatsappNumber} message={whatsappMessage} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:border-[#3EA259] hover:text-[#70BE55]" >
                <MessageCircle className="h-4 w-4" /> Continue on WhatsApp
              </WhatsAppLink>
            </div>
            <p className="text-center text-[11px] leading-5 text-[var(--brand-text-muted)]">This is an enquiry only—not a payment, booking or confirmed service order.</p>
          </form>
        )}
      </section>
    </div>
  );
}

function CartDialog({ cart, setCart, remove, totalFor, note, setNote, message, paymentAvailable, paymentAvailabilityChecked, onCheckout, onClose }: {
  cart: CartEntry[];
  setCart: Dispatch<SetStateAction<CartEntry[]>>;
  remove: (id: string) => void;
  totalFor: (billingType: ServiceBillingType) => number;
  note: string;
  setNote: (note: string) => void;
  message: string;
  paymentAvailable: boolean;
  paymentAvailabilityChecked: boolean;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBusinessName, setCustomerBusinessName] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const checkoutBillingTypes = new Set(cart.map(({ item }) => item.billingType));
  const checkoutHasMixedTypes = checkoutBillingTypes.size > 1;

  useAccessibleDialog(dialogRef, onClose);

  const submitEnquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[+0-9().\s-]{7,25}$/.test(customerPhone.trim())) {
      setSubmitError('Enter a valid phone or WhatsApp number.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/catalogue/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          customerName,
          customerEmail,
          customerPhone,
          customerBusinessName,
          serviceInterest: [...new Set(cart.map(({ item }) => item.category))].length === 1
            ? cart[0]?.item.category || 'Multiple services'
            : 'Multiple services',
          requestNote: note,
          consent,
          packages: cart.map(({ item, quantity }) => ({ packageId: item.id, quantity })),
        }),
      });
      const body = await response.json().catch(() => ({})) as { requestReference?: string; message?: string };
      if (!response.ok) throw new Error(body.message || `Could not submit enquiry (${response.status}).`);
      if (typeof body.requestReference !== 'string') throw new Error('The server did not return an enquiry reference.');
      setRequestReference(body.requestReference);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The enquiry could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/55" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="catalogue-cart-title" className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l p-5 outline-none sm:p-7" style={{ backgroundColor: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}>
        <header className="flex items-start justify-between gap-4"><div><h2 id="catalogue-cart-title" className="text-2xl font-extrabold">Service Cart</h2><p className="mt-1 text-sm text-[var(--brand-text-muted)]">Choose secure checkout or keep using the existing enquiry workflow.</p></div><button type="button" onClick={onClose} aria-label="Close cart" className="rounded-lg p-2 hover:bg-[#3EA259]/10"><X className="h-5 w-5" /></button></header>
        {cart.length === 0 ? <div className="my-auto"><PageState title="Your cart is empty" description="Browse the catalogue and add packages to request an enquiry." action={onClose} actionLabel="Continue Browsing" /></div> : <>
          <div className="mt-6 space-y-3">
            {cart.map(({ item, quantity }) => <article key={item.id} className="flex gap-3 rounded-2xl border p-4" style={cardStyle}>
              {item.imageUrl && <img src={item.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />}
              <div className="min-w-0 flex-1"><h3 className="font-bold">{item.title}</h3><p className="mt-1 text-xs text-[var(--brand-text-muted)]">{priceLabel(item)}{quantity > 1 ? ` · quantity ${quantity}` : ''}</p></div>
              {item.quantitySupported && <div className="flex items-center gap-2"><button type="button" aria-label={`Decrease ${item.title} quantity`} onClick={() => setCart((current) => current.map((entry) => entry.item.id === item.id ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))} className="grid h-8 w-8 place-items-center rounded-lg border">−</button><span className="text-sm">{quantity}</span><button type="button" aria-label={`Increase ${item.title} quantity`} onClick={() => setCart((current) => current.map((entry) => entry.item.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry))} className="grid h-8 w-8 place-items-center rounded-lg border">+</button></div>}
              <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.title}`} className="self-start rounded-lg p-2 text-[var(--brand-text-muted)] hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
            </article>)}
          </div>
          <section className="mt-6 rounded-2xl border p-4" style={cardStyle}>
            <h3 className="text-sm font-bold">Price summary</h3>
            {(['monthly', 'one_time', 'per_session'] as const).map((type) => totalFor(type) > 0 && <div key={type} className="mt-2 flex justify-between gap-3 text-sm"><span className="text-[var(--brand-text-muted)]">{billingTypeLabel[type]} subtotal</span><strong>{formatServicePrice(totalFor(type))}{type === 'monthly' ? ' / month' : type === 'per_session' ? ' / session' : ''}</strong></div>)}
            <p className="mt-3 text-xs leading-5 text-[var(--brand-text-muted)]">Recurring, one-time and per-session amounts are shown separately. The server recalculates the payable amount from current published package prices before creating an order.</p>
          </section>
          <section className="mt-5 rounded-2xl border p-4" style={cardStyle}>
            <h3 className="text-sm font-bold">Secure checkout</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--brand-text-muted)]">Monthly packages are charged for one cycle only; automatic renewal is not enabled. One-time, monthly and per-session items must be checked out separately.</p>
            {paymentAvailable ? (
              <>
                {checkoutHasMixedTypes && <p role="alert" className="mt-3 text-xs text-amber-200">Check out one-time, monthly, or per-session services separately.</p>}
                <button type="button" onClick={onCheckout} disabled={checkoutHasMixedTypes} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-4 text-sm font-bold text-white transition hover:bg-[#216F3D] disabled:cursor-not-allowed disabled:opacity-50">Continue to Secure Test Checkout <ArrowRight className="h-4 w-4" /></button>
              </>
            ) : (
              <p role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100">{paymentAvailabilityChecked ? 'Online payment currently unavailable. You can still submit an enquiry or continue on WhatsApp.' : 'Checking secure payment availability…'}</p>
            )}
          </section>
          {requestReference ? (
            <div role="status" className="mt-6 rounded-2xl border border-[#3EA259]/30 bg-[#3EA259]/10 p-5">
              <div className="flex items-center gap-2 font-bold text-[#70BE55]"><Check className="h-5 w-5" /> Enquiry received</div>
              <p className="mt-2 text-sm">Reference: <strong>{requestReference}</strong></p>
              <p className="mt-2 text-xs leading-5 text-[var(--brand-text-muted)]">This confirms receipt of your enquiry only. No payment was taken and no service delivery is confirmed.</p>
            </div>
          ) : (
            <form onSubmit={(event) => void submitEnquiry(event)} className="mt-5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold">Your name
                  <input required minLength={2} maxLength={120} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
                </label>
                <label className="block text-xs font-semibold">Email (optional)
                  <input type="email" maxLength={255} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
                </label>
              </div>
              <label className="block text-xs font-semibold">Phone / WhatsApp number
                <input required type="tel" minLength={7} maxLength={25} autoComplete="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
              <label className="block text-xs font-semibold">Business name (optional)
                <input maxLength={160} autoComplete="organization" value={customerBusinessName} onChange={(event) => setCustomerBusinessName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
              <label className="block text-xs font-semibold">What would you like us to know?
                <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Share your goals or questions (optional)" className="mt-1.5 min-h-20 w-full rounded-xl border bg-transparent p-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
              </label>
                <label className="flex items-start gap-2.5 text-xs leading-5 text-[var(--brand-text-muted)]">
                  <input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-[#3EA259]" />
                  <span>I agree that NearGrow Ads may use these details to respond to this enquiry, as described in the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#70BE55] underline">Privacy Policy</a>.</span>
                </label>
              {submitError && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-950/20 p-3 text-xs text-rose-300">{submitError}</p>}
              <button type="submit" disabled={submitting} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-4 text-sm font-bold text-white transition hover:bg-[#216F3D] disabled:cursor-wait disabled:opacity-60">
                {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? 'Submitting…' : 'Submit Enquiry Request'}
              </button>
              <WhatsAppLink message={message} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold hover:border-[#3EA259]"><MessageCircle className="h-4 w-4" /> Continue on WhatsApp instead</WhatsAppLink>
            </form>
          )}
          <div className="mt-auto pt-4">
            <button type="button" onClick={onClose} className="min-h-11 w-full rounded-xl border text-sm font-semibold hover:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }}>Continue Browsing</button>
          </div>
        </>}
      </section>
    </div>
  );
}

function CheckoutDialog({ entries, onPaid, onClose }: {
  entries: CartEntry[];
  onPaid: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerBusinessName, setCustomerBusinessName] = useState('');
  const [onboardingNotes, setOnboardingNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [order, setOrder] = useState<CheckoutOrderResult | null>(null);
  const [trackedOrder, setTrackedOrder] = useState<Record<string, unknown> | null>(null);

  useAccessibleDialog(dialogRef, onClose);

  const totalFor = (billingType: ServiceBillingType) => entries
    .filter(({ item }) => item.billingType === billingType)
    .reduce((total, { item, quantity }) => total + finalServicePrice(item) * quantity, 0);
  const hasMixedBilling = new Set(entries.map(({ item }) => item.billingType)).size > 1;

  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasMixedBilling) {
      setError('Choose one billing arrangement per checkout.');
      return;
    }
    if (!/^[+0-9().\s-]{7,25}$/.test(customerPhone.trim())) {
      setError('Enter a valid phone or WhatsApp number.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setTrackedOrder(null);
    try {
      const response = await fetch('/api/catalogue/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          customerName,
          customerEmail,
          customerPhone,
          customerBusinessName,
          onboardingNotes,
          consent,
          packages: entries.map(({ item, quantity }) => ({ packageId: item.id, quantity })),
        }),
      });
      const body = await response.json().catch(() => ({})) as CheckoutOrderResult & { message?: string };
      if (!response.ok) throw new Error(body.message || `Could not start checkout (${response.status}).`);
      if (!body.providerOrderId || !body.keyId || !body.trackingToken || !body.orderReference) {
        throw new Error('The server did not return complete secure checkout details.');
      }
      setOrder(body);
      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error('Razorpay checkout is unavailable. No payment was taken.');
      const checkout = new window.Razorpay({
        key: body.keyId,
        amount: body.amountPaise,
        currency: body.currency,
        name: 'NearGrow Ads',
        description: entries.map(({ item }) => item.title).join(', ').slice(0, 255),
        order_id: body.providerOrderId,
        prefill: { name: customerName, email: customerEmail, contact: customerPhone },
        theme: { color: '#3EA259' },
        handler: async (payment) => {
          setVerifying(true);
          setError('');
          try {
            const verification = await fetch(`/api/catalogue/orders/${encodeURIComponent(body.orderReference)}/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                trackingToken: body.trackingToken,
                razorpay_order_id: payment.razorpay_order_id,
                razorpay_payment_id: payment.razorpay_payment_id,
                razorpay_signature: payment.razorpay_signature,
              }),
            });
            const result = await verification.json().catch(() => ({})) as { message?: string; verified?: boolean };
            if (!verification.ok || result.verified !== true) throw new Error(result.message || 'Payment is not confirmed yet.');
            setNotice('Razorpay Test payment captured and verified. This is a simulated payment; no real funds were transferred.');
            onPaid();
            await refreshOrderStatus(body);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Payment verification could not be completed.');
          } finally {
            setVerifying(false);
          }
        },
        modal: {
          ondismiss: () => setNotice('Checkout closed. Payment is not confirmed; use Track Order to check the latest status.'),
        },
      });
      checkout.open();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Secure checkout could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const refreshOrderStatus = async (currentOrder = order) => {
    if (!currentOrder) return;
    setError('');
    try {
      const response = await fetch(`/api/catalogue/orders/${encodeURIComponent(currentOrder.orderReference)}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ trackingToken: currentOrder.trackingToken }),
      });
      const result = await response.json().catch(() => ({})) as { order?: Record<string, unknown>; message?: string };
      if (!response.ok || !result.order) throw new Error(result.message || 'Order status could not be loaded.');
      setTrackedOrder(result.order);
      if (result.order.payment_status === 'paid') {
        setNotice('Test payment is verified. This does not transfer real funds.');
        onPaid();
      } else {
        setNotice('No captured payment is recorded for this order yet.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Order status could not be loaded.');
    }
  };

  return <div className="fixed inset-0 z-[95] flex justify-end bg-black/60" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy && !verifying) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="catalogue-checkout-title" className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l p-5 outline-none sm:p-7" style={{ backgroundColor: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}>
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-[#70BE55]">Razorpay Test · no real funds</p><h2 id="catalogue-checkout-title" className="mt-1 text-2xl font-extrabold">Secure Checkout</h2><p className="mt-1 text-sm text-[var(--brand-text-muted)]">The server checks current published package prices and creates the provider order.</p></div>
        <button type="button" onClick={onClose} aria-label="Close checkout" className="rounded-lg p-2 hover:bg-[#3EA259]/10"><X className="h-5 w-5" /></button>
      </header>

      <section className="mt-6 space-y-2 rounded-2xl border p-4" style={cardStyle}>
        <h3 className="text-sm font-bold">Order summary</h3>
        {entries.map(({ item, quantity }) => <div key={item.id} className="flex justify-between gap-4 text-xs">
          <span>{item.title}{quantity > 1 ? ` × ${quantity}` : ''} · {item.billingType === 'monthly' ? 'one monthly cycle only' : item.billingType === 'per_session' ? 'one session' : 'one-time'}</span>
          <span className="shrink-0">{formatServicePrice(finalServicePrice(item) * quantity)}</span>
        </div>)}
        {(['one_time', 'monthly', 'per_session'] as const).map((type) => totalFor(type) > 0 && <p key={type} className="flex justify-between border-t pt-2 text-xs" style={{ borderColor: 'var(--brand-border)' }}>
          <span>{type === 'monthly' ? 'Single monthly cycle subtotal' : type === 'per_session' ? 'Single-session subtotal' : 'One-time subtotal'}</span><strong>{formatServicePrice(totalFor(type))}</strong>
        </p>)}
        <p className="pt-1 text-[10px] leading-4 text-[var(--brand-text-muted)]">Displayed amounts are estimates. The server-calculated Razorpay order is authoritative. Monthly services do not auto-renew.</p>
      </section>

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl border border-[#3EA259]/30 bg-[#3EA259]/10 p-3 text-xs leading-5 text-[#70BE55]">{notice}</p>}

      {order && <section className="mt-4 rounded-xl border p-4 text-xs" style={cardStyle}>
        <p className="font-bold">Order reference: <span className="select-all">{order.orderReference}</span></p>
        <p className="mt-1 text-[var(--brand-text-muted)]">Secure tracking token (keep private): <span className="select-all break-all">{order.trackingToken}</span></p>
        <p className="mt-2 text-[var(--brand-text-muted)]">Server-calculated Test total: <strong>{formatServicePrice(order.amountPaise / 100)}</strong></p>
        <button type="button" onClick={() => void refreshOrderStatus()} disabled={verifying} className="mt-3 min-h-9 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: 'var(--brand-border)' }}>Track Order Status</button>
        {trackedOrder && <p className="mt-2">Payment: <strong>{String(trackedOrder.payment_status)}</strong> · Fulfilment: <strong>{String(trackedOrder.fulfillment_status)}</strong></p>}
      </section>}

      {!order && <form onSubmit={(event) => void startCheckout(event)} className="mt-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold">Full name
            <input required minLength={2} maxLength={120} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
          </label>
          <label className="block text-xs font-semibold">Email
            <input required type="email" maxLength={255} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
          </label>
        </div>
        <label className="block text-xs font-semibold">Phone / WhatsApp number
          <input required type="tel" minLength={7} maxLength={25} autoComplete="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
        </label>
        <label className="block text-xs font-semibold">Business name
          <input required minLength={2} maxLength={160} autoComplete="organization" value={customerBusinessName} onChange={(event) => setCustomerBusinessName(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
        </label>
        <label className="block text-xs font-semibold">Onboarding information (optional)
          <textarea maxLength={2000} value={onboardingNotes} onChange={(event) => setOnboardingNotes(event.target.value)} placeholder="Share relevant goals or onboarding details." className="mt-1.5 min-h-24 w-full rounded-xl border bg-transparent p-3 text-sm outline-none focus:border-[#3EA259]" style={{ borderColor: 'var(--brand-border)' }} />
        </label>
        <label className="flex items-start gap-2.5 text-xs leading-5 text-[var(--brand-text-muted)]">
          <input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-[#3EA259]" />
          <span>I agree that NearGrow Ads may use these details to process this Test checkout and respond about the service, as described in the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#70BE55] underline">Privacy Policy</a>. The email address is not independently verified by this checkout.</span>
        </label>
        <button type="submit" disabled={busy || verifying || !consent} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3EA259] px-4 text-sm font-bold text-white transition hover:bg-[#216F3D] disabled:cursor-wait disabled:opacity-60">
          {busy || verifying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Creating secure order…' : verifying ? 'Verifying payment…' : 'Continue to Secure Test Checkout'}
        </button>
      </form>}

      <p className="mt-auto pt-5 text-center text-[10px] leading-5 text-[var(--brand-text-muted)]">Only Razorpay Test mode is enabled. No live payment, direct UPI, or verified real settlement destination is configured.</p>
    </section>
  </div>;
}

function CompareDialog({ packages, onClose, remove }: { packages: ServicePackage[]; onClose: () => void; remove: (id: string) => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const rows: { label: string; value: (item: ServicePackage) => React.ReactNode }[] = [
    { label: 'Price', value: (item) => priceLabel(item) },
    { label: 'Category', value: (item) => item.category },
    { label: 'Package type', value: (item) => item.packageKind === 'add_on' ? 'Add-on' : 'Service package' },
    { label: 'Target audience', value: (item) => item.targetAudience || 'Not specified' },
    { label: 'Included deliverables', value: (item) => item.deliverables.length ? <ul className="space-y-1">{item.deliverables.map((value) => <li key={value}>• {value}</li>)}</ul> : 'Not specified' },
    { label: 'Exclusions', value: (item) => item.exclusions.length ? <ul className="space-y-1">{item.exclusions.map((value) => <li key={value}>• {value}</li>)}</ul> : 'Not specified' },
    { label: 'Description', value: (item) => item.description || item.summary },
  ];
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-3 sm:p-6" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="package-compare-title" className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-3xl border shadow-2xl" style={{ backgroundColor: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}>
        <header className="flex items-center justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--brand-border)' }}><div><h2 id="package-compare-title" className="text-xl font-extrabold">Compare Packages</h2><p className="mt-1 text-xs text-[var(--brand-text-muted)]">Compare published package details as configured by NearGrow Ads.</p></div><button type="button" onClick={onClose} aria-label="Close comparison" className="rounded-lg p-2 hover:bg-[#3EA259]/10"><X className="h-5 w-5" /></button></header>
        {packages.length < 2 ? <p className="p-8 text-sm text-[var(--brand-text-muted)]">Select at least two packages to compare them.</p> : <div className="max-h-[70vh] overflow-auto"><table className="min-w-[720px] table-fixed border-collapse text-left text-sm"><thead><tr><th className="sticky left-0 top-0 z-20 w-40 border-b border-r p-4" style={{ backgroundColor: 'var(--brand-surface)', borderColor: 'var(--brand-border)' }}>Details</th>{packages.map((item) => <th key={item.id} className="sticky top-0 z-10 min-w-56 border-b p-4 align-top" style={{ backgroundColor: 'var(--brand-surface)', borderColor: 'var(--brand-border)' }}><div className="font-bold">{item.title}</div><button type="button" onClick={() => remove(item.id)} className="mt-2 text-xs text-[#70BE55]">Remove</button></th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th className="sticky left-0 border-b border-r p-4 align-top text-xs font-bold" style={{ backgroundColor: 'var(--brand-surface)', borderColor: 'var(--brand-border)' }}>{row.label}</th>{packages.map((item) => <td key={`${item.id}-${row.label}`} className="border-b p-4 align-top text-xs leading-5 text-[var(--brand-text-muted)]" style={{ borderColor: 'var(--brand-border)' }}>{row.value(item)}</td>)}</tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}
