export interface CaseStudy {
  id: string;
  slug: string;
  title: string;
  category: string;
  clientDescriptor: string;
  timeframe: string;
  location: string;
  challenge: string;
  strategy: string;
  deliverablesExecuted: string[];
  resultsContext: string;
  metrics: { label: string; value: string; period: string; evidence?: string }[];
  toolsUsed: string[];
  testimonialQuote?: { quote: string; author: string; role: string };
  imagePlaceholderColor?: string;
  serviceSlug: string;
  summary?: string;
  approvedClientName?: string;
  testimonialApproved?: boolean;
  ctaLabel?: string;
  ctaLink?: string;
  featured?: boolean;
  displayOrder?: number;
  status?: 'draft' | 'published' | 'archived';
  hasUnpublishedChanges?: boolean;
  imageUrl?: string;
  imageAlt?: string;
  imagePositionX?: number;
  imagePositionY?: number;
  imageSize?: 'cover' | 'contain';
  imagePlacement?: 'top' | 'background-cover' | 'background-watermark';
  imageOpacity?: number;
}

export const CASE_STUDIES: CaseStudy[] = [
  {
    id: 'case-1',
    slug: 'artisanal-retail-local-search',
    title: 'Local Map Pack Visibility for an Artisanal Home & Lifestyle Store',
    category: 'Local SEO & Google Business Profile',
    clientDescriptor: 'Independent Lifestyle & Home Decor Retailer',
    timeframe: '4-Month Campaign Period',
    location: 'Delhi NCR (South Delhi)',
    challenge:
      'Despite high in-store customer satisfaction, new neighborhood residents rarely discovered the boutique because its Google Business Profile had unverified attributes, missing secondary categories, and low review frequency compared to mall-based retailers.',
    strategy:
      'Rebuilt the Google Business Profile from the ground up: added 45+ professional geo-tagged store photos, structured product collections, updated weekly in-store promotions, and launched an ethical in-store QR review program.',
    deliverablesExecuted: [
      'Google Business Profile category audit & NAP synchronization',
      'High-resolution store interior and product showcase photo staging',
      'Setup of physical counter cards with clean Google review short-links',
      'Local schema implementation on store website with store operating hours',
    ],
    resultsContext:
      'Documented direct actions in Google Business Profile Insights over 120 days of consistent listing optimization.',
    metrics: [
      { label: 'Map Profile Views', value: '+142%', period: 'Over 120 Days' },
      { label: 'Inbound Direction Requests', value: '+88%', period: 'Customer Navigations' },
      { label: 'Direct Phone Inquiries', value: '+65%', period: 'In-Store Product Checks' },
    ],
    toolsUsed: ['Google Business Profile Manager', 'Canva Pro', 'Google Search Console'],
    testimonialQuote: {
      quote:
        'NearGrow Ads gave our boutique the local visibility we were missing. Customers now regularly tell us they found our store directly through Google Maps while searching for artisanal gifts in our area.',
      author: 'Retail Store Director',
      role: 'South Delhi Home Decor Studio',
    },
    serviceSlug: 'google-business-profile',
  },
  {
    id: 'case-2',
    slug: 'commercial-supplier-google-ads',
    title: 'Cost-Per-Inquiry Reduction for an Industrial Packaging Manufacturer',
    category: 'Google Ads & Conversion Optimization',
    clientDescriptor: 'B2B Corrugated & Custom Packaging Supplier',
    timeframe: '90-Day Optimization Sprint',
    location: 'Gurgaon, Haryana / Industrial Hub',
    challenge:
      'The company was spending ₹45,000 monthly on Google Ads through a legacy agency but received 60% spam leads, consumer job inquiries, and retail single-box requests rather than bulk wholesale buyers.',
    strategy:
      'Restructured the Google Ads account into tightly themed ad groups with exact and phrase match commercial keywords. Added over 400 negative keywords (blocking terms like "single box", "jobs", "syllabus", "DIY") and redesigned the quote inquiry form.',
    deliverablesExecuted: [
      'Comprehensive search query audit eliminating negative search waste',
      'Dedicated B2B landing page with minimum order quantity (MOQ) disclosure',
      'Call conversion tracking and server-side lead notification to sales team',
      'Weekly negative keyword pruning and responsive search ad testing',
    ],
    resultsContext:
      'Tracked via Google Ads conversion tracking and internal sales CRM over 90 days.',
    metrics: [
      { label: 'Waste Spend Reduction', value: '-54%', period: 'Non-Commercial Clicks Eliminated' },
      { label: 'Cost Per B2B Quote Request', value: '-38%', period: 'Lower Acquisition Cost' },
      { label: 'Qualified Wholesale Inquiries', value: '+74%', period: 'Verified Bulk Inquiries' },
    ],
    toolsUsed: ['Google Ads', 'Google Tag Manager', 'Next.js', 'Google Sheets Lead Pipeline'],
    testimonialQuote: {
      quote:
        'The difference was night and day. Instead of students asking for packaging projects or retail buyers asking for 1 box, our sales team now receives inquiries from genuine factory procurement managers.',
      author: 'Managing Partner',
      role: 'Gurgaon Industrial Packaging',
    },
    serviceSlug: 'google-ads',
  },
  {
    id: 'case-3',
    slug: 'healthcare-clinic-website-rebuild',
    title: 'Mobile Appointment Conversion Rebuild for a Multi-Specialty Dental Clinic',
    category: 'Website Development & Local SEO',
    clientDescriptor: 'Multi-Doctor Dental & Implant Clinic',
    timeframe: '6-Week Architecture Rebuild',
    location: 'Noida, Uttar Pradesh',
    challenge:
      'Their existing WordPress website took 7.8 seconds to load on mobile devices, lacked clear doctor credentials, and had a broken booking form that failed to deliver emails on mobile browsers.',
    strategy:
      'Built a custom, lightweight Next.js responsive website with sub-second page loads, accessible doctor bio cards, treatment pricing guidance, and instant WhatsApp appointment booking.',
    deliverablesExecuted: [
      'Next.js 15 frontend architecture with 98/100 Mobile Performance score',
      'Doctor credential and patient treatment guide pages with medical schema',
      'Click-to-WhatsApp booking integration with pre-filled consultation questions',
      'Automated email and SMS notification pipeline on form submission',
    ],
    resultsContext:
      'Google Analytics 4 and direct clinic appointment logs comparing 60 days pre-launch vs 60 days post-launch.',
    metrics: [
      { label: 'Mobile Page Load Time', value: '1.1s', period: 'From 7.8s on 4G' },
      { label: 'Mobile Conversion Rate', value: '4.6%', period: 'From 1.2% previously' },
      { label: 'Online Appointment Requests', value: '+115%', period: 'First 60 Days' },
    ],
    toolsUsed: ['React', 'Next.js', 'Tailwind CSS', 'Google Analytics 4', 'WhatsApp Business API'],
    testimonialQuote: {
      quote:
        'NearGrow Ads rebuilt our digital presence with clinical precision. Our patients repeatedly compliment how fast and easy it is to review treatment options and book consultations on their phones.',
      author: 'Clinical Director',
      role: 'Noida Dental & Implant Center',
    },
    serviceSlug: 'website-development',
  },
];
