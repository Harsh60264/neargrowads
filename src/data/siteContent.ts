import { DEFAULT_PUBLIC_COPY } from './publicCopy';
import { DEFAULT_PUBLIC_MEDIA, type ManagedMedia } from './publicMedia';

export type ManagedPage = 'home' | 'services' | 'catalogue' | 'work' | 'about' | 'blog' | 'contact';

export interface PublicFaq {
  id: string;
  question: string;
  answer: string;
}

export interface PageSeo {
  title: string;
  description: string;
  ogImage: string;
}

export interface AnimationSettings {
  globeEnabled: boolean;
  globeRotationSpeed: number;
  globeSize: number;
  globePositionX: number;
  globePositionY: number;
  globeLandColor: string;
  globeHighlightColor: string;
  globeHighlightGlowColor: string;
  globeLightAppearance: GlobeLightAppearance;
  globePopupTitle: string;
  globePopupDetail: string;
  heroEnabled: boolean;
  heroSpeed: number;
}

export interface GlobeLightAppearance {
  oceanColor: string;
  landColor: string;
  countryBorderColor: string;
  countryBorderOpacity: number;
  gridEnabled: boolean;
  gridOpacity: number;
  routeColor: string;
  routeOpacity: number;
  markerColor: string;
  selectionOutlineColor: string;
  selectionGlowColor: string;
  selectionGlowIntensity: number;
  atmosphereIntensity: number;
}

export const DEFAULT_GLOBE_LIGHT_APPEARANCE: GlobeLightAppearance = {
  oceanColor: '#EEF0DF',
  landColor: '#346B47',
  countryBorderColor: '#C7D8C1',
  countryBorderOpacity: 0.42,
  gridEnabled: true,
  gridOpacity: 0.14,
  routeColor: '#82CF50',
  routeOpacity: 0.72,
  markerColor: '#82CF50',
  selectionOutlineColor: '#F5A623',
  selectionGlowColor: '#F5A623',
  selectionGlowIntensity: 0.42,
  atmosphereIntensity: 0.18,
};

export interface PublicNavigationItem {
  id: 'home' | 'services' | 'catalogue' | 'work' | 'about' | 'blog' | 'contact';
  label: string;
  destination: string;
}

export interface PublicFooterSettings {
  phone: string;
  phoneDestination: string;
  email: string;
  emailDestination: string;
  location: string;
  hours: string;
  mapDestination: string;
  whatsappDestination: string;
  secondaryEmail: string;
  secondaryEmailDestination: string;
  socialLinks: { id: 'instagram' | 'facebook' | 'linkedin'; label: string; destination: string }[];
}

export interface MascotSettings {
  renderer: '3d' | '2d';
  desktopScalePercent: number;
  mobileScalePercent: number;
}

export interface SiteContent {
  copy: Record<string, string>;
  faqs: PublicFaq[];
  media: Record<string, ManagedMedia>;
  animations: AnimationSettings;
  mascotSettings: MascotSettings;
  seo: Record<ManagedPage, PageSeo>;
  navigation: PublicNavigationItem[];
  ctaDestinations: Record<string, string>;
  footerSettings: PublicFooterSettings;
  hero: {
    eyebrow: string;
    headlineBefore: string;
    headlineHighlight: string;
    headlineAfter: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
    videoUrl: string;
  };
  philosophy: {
    eyebrow: string;
    title: string;
    description: string;
    peopleTitle: string;
    peopleDescription: string;
    ideasTitle: string;
    ideasDescription: string;
    growthTitle: string;
    growthDescription: string;
  };
  missionVision: {
    eyebrow: string;
    title: string;
    missionTitle: string;
    missionDescription: string;
    visionTitle: string;
    visionDescription: string;
  };
  services: {
    eyebrow: string;
    title: string;
    description: string;
    cta: string;
  };
  methodology: {
    eyebrow: string;
    title: string;
    description: string;
  };
  servicesPage: {
    eyebrow: string;
    headlineBefore: string;
    headlineHighlight: string;
    description: string;
    primaryCta: string;
    supportingText: string;
  };
  aboutPage: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
  };
  workPage: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: string;
  };
  contactPage: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: string;
  };
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  copy: DEFAULT_PUBLIC_COPY,
  faqs: Array.from({ length: 7 }, (_, index) => ({
    id: `faq-${index + 1}`,
    question: DEFAULT_PUBLIC_COPY[`home.faqs.q${index + 1}`],
    answer: DEFAULT_PUBLIC_COPY[`home.faqs.a${index + 1}`],
  })),
  media: DEFAULT_PUBLIC_MEDIA,
  animations: {
    globeEnabled: true,
    globeRotationSpeed: 100,
    globeSize: 100,
    globePositionX: 0,
    globePositionY: 0,
    globeLandColor: '#53697d',
    globeHighlightColor: '#70c442',
    globeHighlightGlowColor: '#70c442',
    globeLightAppearance: DEFAULT_GLOBE_LIGHT_APPEARANCE,
    globePopupTitle: '{country}',
    globePopupDetail: '{clicks} clicks',
    heroEnabled: true,
    heroSpeed: 100,
  },
  mascotSettings: {
    renderer: '3d',
    desktopScalePercent: 100,
    mobileScalePercent: 100,
  },
  seo: {
    home: {
      title: 'NearGrow Ads — Digital Growth & Marketing Agency',
      description: 'NearGrow Ads helps ambitious businesses grow across markets with international and multi-location SEO, performance advertising, scalable web engineering, and practical AI automation.',
      ogImage: '',
    },
    services: {
      title: 'Digital Growth Services | NearGrow Ads',
      description: 'Explore international SEO, Google Ads, social media marketing, web development, content, AI automation, and growth strategy services.',
      ogImage: '',
    },
    catalogue: {
      title: 'Service Catalogue | NearGrow Ads',
      description: 'Explore NearGrow Ads digital marketing service packages, deliverables and billing terms.',
      ogImage: '',
    },
    work: {
      title: 'Work & Case Studies | NearGrow Ads',
      description: 'Explore documented NearGrow Ads client outcomes across retail, B2B, healthcare, search visibility, paid acquisition, and web engineering.',
      ogImage: '',
    },
    about: {
      title: 'About NearGrow Ads | A Practical Growth Partner',
      description: 'Meet NearGrow Ads, a digital growth agency combining international SEO, performance advertising, web engineering, and reliable automation.',
      ogImage: '',
    },
    blog: {
      title: 'Growth Insights & Strategies | NearGrow Ads',
      description: 'Clear, practical thinking on international search, customer acquisition, and the systems that help ambitious businesses grow.',
      ogImage: '',
    },
    contact: {
      title: 'Contact NearGrow Ads | Start a Growth Conversation',
      description: 'Contact NearGrow Ads about international SEO, multi-location discovery, performance advertising, and web engineering.',
      ogImage: '',
    },
  },
  navigation: [
    { id: 'home', label: 'Home', destination: '/' },
    { id: 'services', label: 'Services', destination: '/services' },
    { id: 'catalogue', label: 'Catalogue', destination: '/catalogue' },
    { id: 'work', label: 'Work', destination: '/work' },
    { id: 'about', label: 'About', destination: '/about' },
    { id: 'blog', label: 'Blog', destination: '/blog' },
    { id: 'contact', label: 'Contact', destination: '/contact' },
  ],
  ctaDestinations: {
    'header.consultation': '/get-started',
    'header.whatsapp': 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20would%20like%20to%20discuss%20digital%20marketing%20for%20my%20business.',
    'home.hero.primary': '/get-started',
    'home.hero.secondary': '/services',
    'home.hero.caseStudies': '#home-case-studies',
    'home.services.browse': '/services',
    'home.hospitality': '/get-started',
    'home.faqs': '/get-started',
    'home.closing.primary': '/get-started',
    'home.closing.secondary': 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20would%20like%20to%20discuss%20digital%20marketing%20services.',
    'services.primary': '/get-started',
    'about.primary': '/get-started',
    'about.secondary': '/contact',
    'work.primary': '/get-started',
    'contact.whatsapp': 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20would%20like%20to%20discuss%20digital%20growth%20services.',
    'thankYou.whatsapp': 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20just%20submitted%20a%20consultation%20form.',
  },
  footerSettings: {
    phone: '+91 92898 10149',
    phoneDestination: 'tel:+919289810149',
    email: 'info@neargrowads.in',
    emailDestination: 'mailto:info@neargrowads.in',
    location: 'Pillar No. 781, B-1, Bhagwati Garden Road, near Dwarka Mor, Uttam Nagar, Nawada, New Delhi, Delhi 110059',
    hours: 'Mon – Fri, 9:00 AM – 6:00 PM IST',
    mapDestination: 'https://www.google.com/maps/search/?api=1&query=Pillar%20no.%20781%2C%20B-1%2C%20Bhagwati%20Garden%20Rd%2C%20near%20dwarka%20mor%2C%20Uttam%20Nagar%2C%20Bhagwati%20Garden%2C%20Nawada%2C%20New%20Delhi%2C%20Delhi%2C%20110059',
    whatsappDestination: 'https://wa.me/919289810149?text=Hi%20NearGrow%20Ads%2C%20I%20would%20like%20to%20discuss%20services.',
    secondaryEmail: 'admin@neargrowads.in',
    secondaryEmailDestination: 'mailto:admin@neargrowads.in',
    socialLinks: [
      { id: 'instagram', label: 'Instagram', destination: 'https://instagram.com/neargrowads' },
      { id: 'facebook', label: 'Facebook', destination: 'https://facebook.com/neargrowads' },
      { id: 'linkedin', label: 'LinkedIn', destination: 'https://linkedin.com/company/neargrowads/' },
    ],
  },
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
