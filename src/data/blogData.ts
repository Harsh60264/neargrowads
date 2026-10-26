import { resolveThemeImage, type PublicImageTheme, type ThemeImageVariants } from './themeImages';

export function resolveBlogImage(
  url: string | undefined,
  altText: string,
  variants: ThemeImageVariants | undefined,
  theme: PublicImageTheme,
) {
  return resolveThemeImage({ url: url ?? '', altText }, variants, theme);
}

export function blogAuthorDisplayName(author: { name?: string } | null | undefined): string {
  return typeof author?.name === 'string' && author.name.trim() ? author.name.trim() : 'Not assigned';
}

export interface BlogPost {
  id?: string;
  slug: string;
  status?: 'draft' | 'published';
  featuredImage?: string;
  featuredImageAltText?: string;
  featuredImageVariants?: ThemeImageVariants;
  updatedAt?: string;
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
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  publishedDate: string;
  author: {
    name: string;
    role: string;
    imageUrl?: string;
    imageVariants?: ThemeImageVariants;
  };
  contentSections: {
    id?: string;
    heading: string;
    paragraphs: string[];
    callout?: string;
  }[];
  relatedServiceSlug: string;
  metaDescription: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'google-business-profile-optimization-guide',
    title: 'The Google Business Profile Optimization Playbook for Growing Brands',
    excerpt:
      'A practical, step-by-step audit of profile categories, content, and review operations for brands managing one or more business locations.',
    category: 'Google Maps & Multi-Location Search',
    readTime: '6 min read',
    publishedDate: 'October 10, 2026',
    author: {
      name: 'NearGrow Ads Growth Team',
      role: 'Search Growth Specialists',
    },
    metaDescription:
      'Learn how to manage Google Business Profiles to strengthen search visibility, maintain accurate location information, and earn customer trust.',
    relatedServiceSlug: 'google-business-profile',
    contentSections: [
      {
        heading: 'Why Google Maps Is Often Your Real Homepage',
        paragraphs: [
          'For many customers, a Google Business Profile is an important first touchpoint before they visit a website, contact a team, or visit a business location. They use the category, location details, opening hours, photos, and review responses to decide whether a business fits their needs.',
          'When profiles are neglected or contain conflicting business information, customers can lose confidence and search platforms may show less useful results. Consistent profile management becomes especially important as a brand adds locations.',
        ],
      },
      {
        heading: '1. Audit Your Primary and Secondary Categories',
        paragraphs: [
          'Your primary category is the single heaviest ranking signal in the Google local algorithm. A common mistake is choosing an overly broad category or stacking conflicting ones.',
          'If you are an artisanal bakery that also serves coffee, setting your primary category to "Bakery" and adding "Cafe" as a secondary category signals both offerings clearly to Google search crawlers without diluting your core ranking.',
        ],
        callout:
          'Pro tip: Review the categories used by relevant competitors in each market before choosing the most accurate categories for your business.',
      },
      {
        heading: '2. The Reality of Customer Reviews',
        paragraphs: [
          'Google looks for three review attributes: velocity (steady incoming reviews over time), diversity (different customers commenting on specific services), and owner response consistency.',
          'Never buy reviews or use automated bots. Google regularly purges fake reviews and can suspend listings without warning. Instead, establish a lightweight routine where happy in-store or post-service customers receive a direct link to leave honest feedback.',
        ],
      },
      {
        heading: '3. Weekly Updates and Visual Proof',
        paragraphs: [
          'Treat your Google Business Profile like a micro-publication. Upload genuine photos of your team at work, your retail storefront, recent projects, and seasonal updates every week. This active heartbeat signals to Google’s algorithm that your business is thriving and open for business.',
        ],
      },
    ],
  },
  {
    slug: 'local-seo-vs-google-ads-guide',
    title: 'Local SEO vs. Google Ads: Which Strategy Should Your Business Prioritize?',
    excerpt:
      'Compare timeline, cost structure, sustainability, and buyer intent between paid search ads and organic local search to allocate your budget wisely.',
    category: 'Marketing Strategy',
    readTime: '7 min read',
    publishedDate: 'September 28, 2026',
    author: {
      name: 'NearGrow Ads Strategy Team',
      role: 'Growth & Acquisition',
    },
    metaDescription:
      'Should you invest in Local SEO or Google Ads first? Compare timelines, cost structures, and ROI factors to make the right choice for your business.',
    relatedServiceSlug: 'google-ads',
    contentSections: [
      {
        heading: 'Understanding the Core Difference',
        paragraphs: [
          'The debate between SEO and Paid Advertising is rarely an either/or choice, but rather a question of timing and cash flow reality. Google Ads rents commercial placement at the very top of search results immediately; Local SEO builds permanent organic equity that continues producing inquiries long after upfront work is completed.',
          'If your business needs inquiries within 72 hours to sustain overhead, Google Ads is the immediate answer. If your goal is to reduce your cost per acquisition over the next two years, Local SEO is non-negotiable.',
        ],
      },
      {
        heading: 'When to Prioritize Google Ads First',
        paragraphs: [
          'Google Ads shines when: you have clear profit margins to absorb initial testing clicks, you are entering a brand new geographic territory where your domain has zero authority, or your service has urgent buying intent (e.g. emergency repairs, urgent legal support, immediate B2B procurement).',
          'The key discipline with Google Ads is avoiding broad match traps. You must ruthlessly filter negative keywords so you only pay for searchers who are ready to book or purchase.',
        ],
      },
      {
        heading: 'When to Prioritize Local SEO First',
        paragraphs: [
          'Local SEO is ideal when your customer search volume is steady, you serve a defined radius (e.g. 10–25 km), and your business model relies on sustainable, compounding margins rather than high-margin blitz scaling.',
          'By creating localized service pages and building verified business citations, you earn high rankings that do not vanish when your monthly ad spend pauses.',
        ],
        callout:
          'The hybrid model: Use Google Ads in Month 1–3 to capture immediate business while building out your Local SEO assets. As organic rankings climb, gradually reduce paid ad spend on low-margin keywords.',
      },
    ],
  },
  {
    slug: 'mobile-website-conversion-mistakes',
    title: '5 Subtle Website Flaws That Silently Kill Inquiries on Mobile Devices',
    excerpt:
      'From intrusive sticky banners to cumbersome forms, here is why your mobile website visitors leave without calling or submitting inquiries.',
    category: 'Website Development',
    readTime: '5 min read',
    publishedDate: 'September 14, 2026',
    author: {
      name: 'NearGrow Ads Engineering Team',
      role: 'Frontend & UX Architects',
    },
    metaDescription:
      'Learn the 5 critical mobile website usability mistakes that hurt conversions and how to fix them for more calls and qualified inquiries.',
    relatedServiceSlug: 'website-development',
    contentSections: [
      {
        heading: 'The 80% Mobile Reality',
        paragraphs: [
          'In India and across urban markets, over 80% of local service and retail searches happen on smartphones over cellular networks. Yet many agencies design websites exclusively on 27-inch desktop monitors, only testing mobile as an afterthought.',
          'When a prospect visits your site on a phone while walking or in traffic, friction points that seemed minor on desktop become instant dealbreakers.',
        ],
      },
      {
        heading: '1. Giant Sticky Headers Devouring Screen Real Estate',
        paragraphs: [
          'A header with two lines of navigation, promotional banners, and social icons often occupies 40% of a mobile screen. When the user scrolls, they have a tiny 60% viewport slot to read your actual content.',
          'Keep your mobile header to a lean, single-row height containing only your brand mark and a clean menu trigger.',
        ],
      },
      {
        heading: '2. Missing One-Tap Communication Options',
        paragraphs: [
          'On mobile, users do not want to fill out a 10-field form to ask a quick pricing question. If you do not provide a verified WhatsApp click-to-chat button or a direct tap-to-call link, users will click back to the Google search results and call your competitor.',
        ],
        callout:
          'Ensure all phone numbers on your site use the standard tel: protocol and WhatsApp links use direct wa.me formatting with polite pre-filled context.',
      },
      {
        heading: '3. Slow Initial Load Times on 4G Networks',
        paragraphs: [
          'Every additional second of page load time on cellular data drops conversion rates by over 12%. Uncompressed multi-megabyte hero images and bloated third-party tracking scripts are the most frequent culprits.',
        ],
      },
    ],
  },
  {
    slug: 'practical-ai-automation-for-small-business',
    title: 'Pragmatic AI Automation for Small Businesses: What Actually Works Today',
    excerpt:
      'Cut through the hype and discover real-world automation systems that save time, prevent lead drop-off, and streamline daily team communications.',
    category: 'AI & Automation',
    readTime: '6 min read',
    publishedDate: 'August 22, 2026',
    author: {
      name: 'NearGrow Ads Automation Team',
      role: 'Workflow Engineers',
    },
    metaDescription:
      'Discover real, practical AI automation workflows for small and medium businesses that reduce response times and eliminate manual data entry.',
    relatedServiceSlug: 'ai-automation',
    contentSections: [
      {
        heading: 'Separating Marketing Hype from Operational Utility',
        paragraphs: [
          'The internet is flooded with claims that artificial intelligence will magically automate entire companies overnight. In reality, attempting to build complex autonomous agent swarms for a 15-person business usually leads to maintenance headaches and erratic customer interactions.',
          'Where AI and modern automation genuinely excel is in high-frequency, structured operational workflows: capturing form data, categorizing inquiries, triggering instant mobile alerts, and eliminating manual copy-pasting between disparate software tools.',
        ],
      },
      {
        heading: 'Workflow 1: The 60-Second Lead Response Rule',
        paragraphs: [
          'Studies consistently show that contacting a prospect within 5 minutes of their inquiry makes them 21 times more likely to enter the sales pipeline than waiting 30 minutes. Yet most small businesses check form submission emails once at the end of the day.',
          'By using lightweight webhooks via n8n or Make, an incoming inquiry is instantly parsed, enriched, and sent directly to the sales director’s phone via WhatsApp or Telegram with one-tap dial buttons.',
        ],
      },
      {
        heading: 'Workflow 2: Automated Review and FAQ Categorization',
        paragraphs: [
          'Natural language models can read customer emails or reviews and instantly tag the core sentiment, service category, and urgency level. This allows customer service teams to address urgent inquiries immediately rather than sifting through a crowded inbox.',
        ],
        callout:
          'Start small: Automate one painful 15-minute daily manual task first, verify reliability for 30 days, then expand to the next workflow.',
      },
    ],
  },
];
