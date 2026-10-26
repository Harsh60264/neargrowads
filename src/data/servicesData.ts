export interface ServiceItem {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  badge: string;
  icon: string;
  heroKicker: string;
  heroHeadline: string;
  heroSubheadline: string;
  targetAudience: string[];
  problemStatement: string;
  ourApproach: string[];
  deliverables: { title: string; desc: string }[];
  toolsUsed: string[];
  realisticOutcomes: string;
  faqs: { question: string; answer: string }[];
  relatedServices: string[];
  primaryCtaLabel?: string;
  primaryCtaLink?: string;
  secondaryCtaLabel?: string;
  secondaryCtaLink?: string;
}

export const SERVICES: ServiceItem[] = [
  {
    id: 'gbp',
    slug: 'google-business-profile',
    title: 'Google Business Profile Management',
    shortDescription:
      'Manage and optimize Google Business Profiles for single- and multi-location brands so customers can discover accurate, useful business information in the markets you serve.',
    badge: 'Local Presence',
    icon: 'MapPin',
    heroKicker: 'Google Search & Maps Visibility',
    heroHeadline: 'Make Every Business Location Easier to Discover.',
    heroSubheadline:
      'A well-managed Google Business Profile helps customers understand and connect with your business in the locations you serve. We keep profiles accurate, complete, and consistent across eligible locations and markets.',
    targetAudience: [
      'Consumer brands and retailers with one or more eligible business locations',
      'Healthcare, hospitality, and professional service organizations',
      'Multi-location companies coordinating profile accuracy and brand consistency',
      'Service-area businesses serving customers at their locations',
    ],
    problemStatement:
      'Inaccurate hours, inconsistent details, incomplete service information, and neglected reviews can weaken discovery and customer confidence across locations. These issues become harder to manage as brands expand.',
    ourApproach: [
      'Comprehensive verification and NAP (Name, Address, Phone) consistency audit',
      'Strategic selection of primary and secondary Google business categories',
      'High-quality geo-tagged photo uploads and weekly promotional updates',
      'Systematic review generation strategy and polite, professional response guidelines',
      'Product and service catalog configuration with clear inquiry CTAs',
      'Monthly performance monitoring of calls, direction requests, and search impressions',
    ],
    deliverables: [
      {
        title: 'Profile Audit & Complete Optimization',
        desc: 'Review of categories, hours, service areas, attributes, and descriptions tailored to each eligible location and market.',
      },
      {
        title: 'Weekly Posts & Media Updates',
        desc: 'Consistent publication of updates, seasonal offers, and team/facility photos to signal active business operations to Google.',
      },
      {
        title: 'Review System & Response Playbook',
        desc: 'Guidance and ethical templates to encourage real customer reviews, with rapid professional responses to all incoming feedback.',
      },
      {
        title: 'Call & Direction Analytics Reporting',
        desc: 'Transparent monthly breakdown of user actions: direct phone calls, website clicks, and navigation requests.',
      },
    ],
    toolsUsed: ['Google Business Profile Manager', 'Google Search Console', 'Canva Pro', 'Local Falcon / Grid Trackers'],
    realisticOutcomes:
      'Rankings in the local map pack depend on proximity, relevance, business category competition, and genuine review velocity. While no agency can guarantee the #1 spot, our systematic optimization maximizes your profile’s eligibility and drives verified phone calls and foot traffic over 60–90 days.',
    faqs: [
      {
        question: 'Can you guarantee that my business will be in the top 3 on Google Maps?',
        answer:
          'No reputable agency can guarantee specific Google rankings because Google’s algorithm weighs dynamic factors like the searcher’s exact physical location and ongoing competitor activity. We follow official Google guidelines to maximize your profile visibility and conversion rates.',
      },
      {
        question: 'Do I need a physical address to have a Google Business Profile?',
        answer:
          'Yes, Google requires a verified location or a defined service-area business (SAB) where you serve customers at their locations without showing your private residential address.',
      },
      {
        question: 'How do you handle negative reviews?',
        answer:
          'We do not fabricate fake reviews or attempt to unlawfully scrub genuine feedback. We craft calm, constructive, and resolution-oriented responses that show future customers how professionally you handle customer service.',
      },
    ],
    relatedServices: ['local-seo', 'website-development', 'google-ads'],
  },
  {
    id: 'local-seo',
    slug: 'local-seo',
    title: 'SEO & International Search',
    shortDescription:
      'Build organic visibility across international markets and multiple locations through technical SEO, market research, localized content, and scalable site architecture.',
    badge: 'Search Visibility',
    icon: 'Compass',
    heroKicker: 'International & Multi-Location SEO',
    heroHeadline: 'Build Search Visibility Across Markets and Locations.',
    heroSubheadline:
      'We align technical foundations, market-specific search intent, and useful content so your website can reach relevant audiences across countries, languages, and business locations.',
    targetAudience: [
      'Businesses entering new countries or expanding into additional markets',
      'Multi-location brands seeking consistent discovery and location-level visibility',
      'B2B and ecommerce companies competing for international search demand',
      'Organizations needing scalable technical SEO and content architecture',
    ],
    problemStatement:
      'Growth across markets can stall when site architecture, technical signals, and content do not reflect how customers search in each region. Inconsistent location information and duplicated pages can also dilute visibility and trust.',
    ourApproach: [
      'Market and language-specific keyword research mapped to commercial intent',
      'Technical SEO and international site architecture, including hreflang planning where applicable',
      'Scalable information architecture for country, language, and location pages',
      'Useful localized content that reflects each market without duplicative doorway pages',
      'Consistent location data and relevant citations for businesses with physical locations',
      'Performance and search visibility monitoring by market and audience',
    ],
    deliverables: [
      {
        title: 'Market & Search Opportunity Benchmark',
        desc: 'Research into market-specific queries, competitors, and opportunities, with a clear view of current search performance.',
      },
      {
        title: 'International & Multi-Location Architecture',
        desc: 'A scalable page and navigation structure for countries, languages, products, services, and business locations.',
      },
      {
        title: 'Market-Relevant Content & Listings',
        desc: 'Useful market-specific content and accurate business listings across relevant directories and industry platforms.',
      },
      {
        title: 'Technical SEO & Structured Data',
        desc: 'Technical and structured data improvements that help search engines understand your organization, pages, and eligible locations.',
      },
    ],
    toolsUsed: ['Google Search Console', 'Ahrefs / Semrush', 'Screaming Frog SEO Spider', 'Schema Validator'],
    realisticOutcomes:
      'SEO compounds over time rather than producing instant results. Timelines depend on market competition, site history, technical condition, and content depth; international and multi-location programs are measured market by market.',
    faqs: [
      {
        question: 'How does international SEO differ from local SEO?',
        answer:
          'International SEO helps search engines serve the right site or content to audiences in different countries or languages through appropriate architecture, technical signals, and market-relevant content. Local SEO focuses on discovery tied to a specific service area or physical location; both can be part of a multi-market strategy.',
      },
      {
        question: 'Will creating doorway pages for every small colony help my rankings?',
        answer:
          'No. Thin pages that only swap place names can create a poor user experience and risk search quality issues. We recommend distinct, useful content for each market or location, based on real customer needs and a clear business purpose.',
      },
    ],
    relatedServices: ['google-business-profile', 'seo-content-marketing', 'website-development'],
  },
  {
    id: 'google-ads',
    slug: 'google-ads',
    title: 'Google Ads & Paid Advertising',
    shortDescription:
      'Measurable, transparent search and performance advertising campaigns designed to generate qualified business leads without budget waste.',
    badge: 'Paid Acquisition',
    icon: 'TrendingUp',
    heroKicker: 'High-Intent Paid Acquisition',
    heroHeadline: 'Turn High-Intent Search Queries Into Qualified Inquiries.',
    heroSubheadline:
      'We design and manage disciplined Google Search and performance campaigns where media spend is tracked against qualified inquiries, form leads, and business outcomes.',
    targetAudience: [
      'B2B suppliers and manufacturers needing high-ticket inquiries',
      'Service businesses needing immediate lead flow while organic presence matures',
      'Local retailers and emergency service providers',
      'Brands launching new products or entering competitive territories',
    ],
    problemStatement:
      'Many businesses waste substantial advertising budgets on broad match keywords, click-fraud traffic, irrelevant search terms, and poorly structured landing pages that fail to convert visitors into callers.',
    ourApproach: [
      'Rigorous negative keyword research to block wasteful clicks from day one',
      'Granular ad group structure matching precise searcher intent with dedicated copy',
      'Full-funnel conversion tracking including phone call attribution and form completions',
      'Strict separation of client ad spend paid directly to Google from our management fee',
      'Bi-weekly bid adjustments, search query audits, and ad copy split testing',
      'Weekly transparent performance reports focused on Cost Per Qualified Lead (CPL)',
    ],
    deliverables: [
      {
        title: 'Account Architecture & Setup',
        desc: 'Clean campaign builds with tightly grouped keywords, responsive search ads, and relevant ad assets (callouts, sitelinks, structured snippets).',
      },
      {
        title: 'Conversion Tracking Setup',
        desc: 'Google Tag Manager and GA4 event tracking ensuring every form submission and call is recorded accurately.',
      },
      {
        title: 'Landing Page Conversion Recommendations',
        desc: 'Actionable design suggestions to improve headline clarity, mobile load speed, and contact form friction.',
      },
      {
        title: 'Negative Keyword & Query Sculpting',
        desc: 'Ongoing filtering to eliminate queries containing words like "free", "jobs", "syllabus", or irrelevant competitor lookups.',
      },
    ],
    toolsUsed: ['Google Ads', 'Google Tag Manager', 'Google Analytics 4', 'Looker Studio'],
    realisticOutcomes:
      'Google Ads delivers traffic immediately once campaigns are approved. However, achieving an optimal cost-per-lead requires an initial 2 to 4-week learning and query sculpting phase to filter out irrelevant searches.',
    faqs: [
      {
        question: 'Do you take a percentage of my ad spend or a flat fee?',
        answer:
          'We believe in total financial transparency. You pay your advertising budget directly to Google with your company card, and you pay NearGrow Ads a predictable, flat monthly management fee based on campaign complexity.',
      },
      {
        question: 'What is a reasonable starting ad budget?',
        answer:
          'There is no universal starting budget. We recommend a test budget based on your target markets, auction competition, margins, and conversion goals; you pay the platform directly and we report performance transparently.',
      },
    ],
    relatedServices: ['website-development', 'local-seo', 'ai-automation'],
  },
  {
    id: 'social-media',
    slug: 'social-media-marketing',
    title: 'Social Media Marketing',
    shortDescription:
      'Cohesive content strategy, authentic brand storytelling, short-form reels, and community engagement on Instagram, LinkedIn, and Facebook.',
    badge: 'Brand & Reach',
    icon: 'Share2',
    heroKicker: 'Social Strategy & Creative Direction',
    heroHeadline: 'Build an Authentic Brand People Recognize and Remember.',
    heroSubheadline:
      'Modern social media is about cultural resonance and practical value. We craft consistent visual assets, thoughtful video concepts, and clear narratives that establish authority in your niche.',
    targetAudience: [
      'Boutique retail brands and consumer goods',
      'Hospitality, lifestyle, and experiential services',
      'B2B founders and consultants building personal and company presence on LinkedIn',
      'Local institutions looking to build community trust',
    ],
    problemStatement:
      'Posting generic stock graphics with hashtag dumps does not build an audience or generate business. Without a clear content pillar strategy and native platform understanding, businesses waste creative energy with zero engagement.',
    ourApproach: [
      'Definition of 3–4 core content pillars matching customer questions and interests',
      'Monthly editorial calendar with clear publication cadence and copy drafts',
      'Concept scripts for vertical reels and behind-the-scenes business stories',
      'Custom visual templates aligned strictly with your brand palette and typography',
      'Engagement routines to interact with relevant local community accounts',
      'Quarterly review of reach, save rates, profile visits, and message inquiries',
    ],
    deliverables: [
      {
        title: 'Monthly Content Strategy & Calendar',
        desc: 'Planned themes, caption drafts, graphic briefs, and publication schedules approved in advance.',
      },
      {
        title: 'High-Resolution Brand Graphics & Carousels',
        desc: 'Clean, typography-driven informative carousels and brand assets designed for high save and share rates.',
      },
      {
        title: 'Reel Direction & Video Editing',
        desc: 'Pacing, subtitles, sound selection, and formatting for short-form mobile video content.',
      },
      {
        title: 'Bio & Profile Optimization',
        desc: 'Clear bio copy, link-in-bio hub setup, and custom highlight covers highlighting core offerings.',
      },
    ],
    toolsUsed: ['Canva Pro / Adobe Suite', 'CapCut / Premiere Pro', 'Meta Business Suite', 'Metricool'],
    realisticOutcomes:
      'Organic social growth is a compounding branding effort rather than an instant lead faucet. Expect increased profile credibility, higher brand recognition, and genuine engagement over 3–6 months of disciplined posting.',
    faqs: [
      {
        question: 'Do you shoot the videos for us at our office?',
        answer:
          'We can guide your team remotely through smartphone capture or coordinate an on-site session where available. Our editors then shape the footage into platform-ready content.',
      },
      {
        question: 'Do you buy followers or engagement?',
        answer:
          'Strictly no. Buying followers ruins your profile engagement rate, risks account suspension, and delivers zero real customers. We only pursue organic and legitimately promoted growth.',
      },
    ],
    relatedServices: ['website-development', 'google-ads', 'marketing-consultation'],
  },
  {
    id: 'web-dev',
    slug: 'website-development',
    title: 'Website Development',
    shortDescription:
      'Fast, mobile-responsive, conversion-focused websites engineered with modern React, Next.js, clean typography, and technical SEO foundations.',
    badge: 'Digital Foundation',
    icon: 'Laptop',
    heroKicker: 'Performance Web Engineering',
    heroHeadline: 'A Fast, Trustworthy Website Engineered to Convert Visitors.',
    heroSubheadline:
      'Your website is the digital storefront of your business. We engineer bespoke, lightning-fast web experiences built for high conversion, search engine crawlability, and seamless mobile use.',
    targetAudience: [
      'Established businesses needing to upgrade outdated legacy websites',
      'High-growth startups requiring clean, modern product or service landing pages',
      'Local service providers losing mobile leads due to slow load times',
      'Companies needing integrated inquiry capture and CRM routing',
    ],
    problemStatement:
      'Bulky template sites bloated with dozens of unmaintained plugins load slowly on mobile networks, break across screen sizes, and fail to clearly guide visitors toward taking action. This leaks qualified leads every single day.',
    ourApproach: [
      'Architecture discovery focusing on customer decision journey and primary CTA pathways',
      'Mobile-first responsive engineering tested across actual mobile and desktop viewports',
      'Core Web Vitals compliance targeting sub-2-second load times on 4G networks',
      'Clean semantic HTML, structured JSON-LD schemas, and technical SEO from day one',
      'Automated form validation, spam honey pots, and server-side lead routing',
      'Complete client ownership of all code, assets, and hosting accounts',
    ],
    deliverables: [
      {
        title: 'Custom Modern Web Architecture',
        desc: 'Engineered with clean code, React/Next.js or modern static stacks without brittle drag-and-drop builders.',
      },
      {
        title: 'Conversion-Focused UX & Copywriting',
        desc: 'Clear headline hierarchy, trust proof sections, and frictionless consultation forms.',
      },
      {
        title: 'Technical SEO & Performance Audit',
        desc: 'XML sitemap, robots.txt, OpenGraph social cards, and verified Google Search Console integration.',
      },
      {
        title: 'Lead Notification & WhatsApp Integrations',
        desc: 'Instant email delivery of new inquiries and direct one-click WhatsApp chat connection.',
      },
    ],
    toolsUsed: ['React', 'Next.js', 'Tailwind CSS', 'TypeScript', 'Vercel', 'Supabase'],
    realisticOutcomes:
      'A properly structured, fast website instantly increases the conversion rate of your existing organic and paid traffic. Development typically spans 2 to 4 weeks depending on scope and content availability.',
    faqs: [
      {
        question: 'Will I own the code and domain?',
        answer:
          'Yes, 100%. We do not lock clients into proprietary systems. You retain full ownership of your domain, code repository, hosting environment, and digital assets.',
      },
      {
        question: 'Is website maintenance included?',
        answer:
          'We provide 30 days of complimentary post-launch support and offer straightforward monthly maintenance plans for updates, backups, and security monitoring.',
      },
    ],
    relatedServices: ['local-seo', 'google-ads', 'ai-automation'],
  },
  {
    id: 'seo-content',
    slug: 'seo-content-marketing',
    title: 'SEO & Content Marketing',
    shortDescription:
      'In-depth search research, on-page optimization, and authoritative educational content that earns sustainable organic search rankings.',
    badge: 'Organic Authority',
    icon: 'FileText',
    heroKicker: 'Sustainable Organic Growth',
    heroHeadline: 'Earn Consistent Organic Traffic Through Authoritative Content.',
    heroSubheadline:
      'Search engines reward helpful, comprehensive content created for real humans. We develop in-depth educational resources that answer high-intent buyer questions and build domain authority.',
    targetAudience: [
      'B2B firms and specialized service providers educating prospective buyers',
      'E-commerce brands seeking organic category search visibility',
      'Consultancies looking to demonstrate deep subject matter expertise',
      'Businesses looking to reduce long-term reliance on paid advertising',
    ],
    problemStatement:
      'Publishing superficial AI-generated blog posts with no keyword research or internal linking achieves zero traction. Google prioritizes Experience, Expertise, Authoritativeness, and Trustworthiness (E-E-A-T).',
    ourApproach: [
      'Topical cluster research identifying customer questions throughout their buying process',
      'Comprehensive content briefs with clear search intent, headers, and semantic entities',
      'Editorial writing with real examples, verified figures, and actionable explanations',
      'Strict internal linking architecture passing authority to commercial service pages',
      'Technical SEO audits fixing crawl errors, broken redirects, and indexing barriers',
      'Regular content refresh cycles updating outdated statistics and expanding key guides',
    ],
    deliverables: [
      {
        title: 'Topical Authority Keyword Map',
        desc: 'Structured breakdown of pillar topics and supporting educational articles mapped against search intent.',
      },
      {
        title: 'Long-Form Educational Articles',
        desc: 'Deep, well-researched guides (1,200–2,500 words) written with genuine industry terminology and clear takeaways.',
      },
      {
        title: 'On-Page SEO Optimization',
        desc: 'Refining meta titles, header hierarchy, descriptive alt tags, and internal link anchors across your site.',
      },
      {
        title: 'Search Performance Reporting',
        desc: 'Monthly insights on keyword impressions, click trends, average ranking positions, and organic lead contributions.',
      },
    ],
    toolsUsed: ['Google Search Console', 'Ahrefs', 'Surfer / Frase', 'Screaming Frog'],
    realisticOutcomes:
      'SEO is a medium-to-long-term strategic investment. High-intent competitive keywords usually require 4 to 8 months of consistent publishing and technical health to mature into steady lead drivers.',
    faqs: [
      {
        question: 'Do you use automated AI to churn out hundreds of articles?',
        answer:
          'No. Low-quality mass-produced AI content often gets demoted in search updates. We use research tools for data gathering, but our content is carefully edited, verified, and structured by human marketing strategists.',
      },
      {
        question: 'Can you guarantee first page rankings?',
        answer:
          'No. Search engines change algorithms regularly and competitors continually update their websites. We follow white-hat, industry-tested methodologies to maximize your organic trajectory.',
      },
    ],
    relatedServices: ['website-development', 'local-seo', 'google-business-profile'],
  },
  {
    id: 'ai-automation',
    slug: 'ai-automation',
    title: 'AI Automation & Business Systems',
    shortDescription:
      'Practical, reliable automation workflows for lead capture, CRM routing, instant inquiry notifications, and repetitive administrative tasks.',
    badge: 'Operations & Tech',
    icon: 'Cpu',
    heroKicker: 'Practical Business Automation',
    heroHeadline: 'Eliminate Repetitive Work and Respond to Inquiries Instantly.',
    heroSubheadline:
      'We build pragmatic, real-world automation systems that connect your marketing funnels, customer forms, WhatsApp notifications, and internal spreadsheets without enterprise software complexity.',
    targetAudience: [
      'Growing agencies and service firms handling dozens of weekly inquiries',
      'Small business owners tired of manual data entry and slow lead follow-ups',
      'Sales teams losing deals because inquiry response time exceeds 2 hours',
      'Retailers needing automated order notifications and customer routing',
    ],
    problemStatement:
      'When an interested customer submits an inquiry, every hour of delay reduces the conversion probability significantly. Fragmented tools, missed emails, and manual copy-pasting into spreadsheets waste valuable team hours.',
    ourApproach: [
      'Workflow discovery to identify high-frequency, rule-based administrative bottlenecks',
      'Architecting dependable n8n or Make automations with secure error handling and logging',
      'Instant multi-channel alerts (WhatsApp/Telegram/Email) when a qualified lead submits a form',
      'Automated lead qualification and CRM insertion (HubSpot, Google Sheets, or Supabase)',
      'Fallback safeguards ensuring no lead data is lost during network or API hiccups',
      'Clear documentation and training so your team understands and controls the system',
    ],
    deliverables: [
      {
        title: 'Instant Lead Notification Pipeline',
        desc: 'Sends instant formatted notifications with lead details directly to your mobile phone via WhatsApp or Telegram.',
      },
      {
        title: 'Automated CRM & Spreadsheet Sync',
        desc: 'Logs incoming inquiries automatically into your centralized lead database with UTM attribution and timestamping.',
      },
      {
        title: 'Inquiry Qualification Routing',
        desc: 'Categorizes requests by budget and service interest, routing urgent high-ticket leads immediately to senior staff.',
      },
      {
        title: 'Workflow Documentation & Self-Hosting Guide',
        desc: 'Full export of n8n workflow JSONs, environment configuration, and failure-alerting playbooks.',
      },
    ],
    toolsUsed: ['n8n Cloud / Self-hosted', 'Webhooks', 'REST APIs', 'Supabase / PostgreSQL', 'Google Sheets'],
    realisticOutcomes:
      'Automations take effect immediately upon deployment, reducing lead response times from hours to under 30 seconds and saving 5–15 hours of manual team data entry per week.',
    faqs: [
      {
        question: 'Do I need expensive monthly software subscriptions?',
        answer:
          'No. We favor open and cost-effective tools like n8n, Supabase, and Google Workspace. In many cases, running costs are negligible or covered under generous free tiers.',
      },
      {
        question: 'What happens if an automation fails or a webhook goes down?',
        answer:
          'We engineer every workflow with error handling and retry queues. All submissions are stored primarily in your database before webhooks fire, ensuring zero lost leads.',
      },
    ],
    relatedServices: ['website-development', 'google-ads', 'marketing-consultation'],
  },
  {
    id: 'consultation',
    slug: 'marketing-consultation',
    title: 'Marketing Consultation & Growth Strategy',
    shortDescription:
      'Honest, experienced strategic advisory to audit your current digital footprint, diagnose acquisition bottlenecks, and prioritize high-ROI initiatives.',
    badge: 'Strategic Advisory',
    icon: 'Compass',
    heroKicker: 'Diagnostic Advisory',
    heroHeadline: 'Gain Clarity on Where to Invest Your Marketing Capital.',
    heroSubheadline:
      'Not every business needs every marketing service. We conduct an objective discovery into your customer acquisition channels to give you an unvarnished assessment of what will actually move the needle.',
    targetAudience: [
      'Founders uncertain whether to prioritize Google Ads, SEO, or social media',
      'Businesses dissatisfied with previous agency experiences and lack of transparency',
      'Established companies planning a brand refresh or market expansion',
      'Teams seeking an independent audit of their digital agency performance',
    ],
    problemStatement:
      'Business owners are constantly bombarded with sales pitches for tools and campaigns they don’t need. Without an unbiased audit of your actual customer unit economics and search demand, marketing budgets get scattered without focus.',
    ourApproach: [
      'Comprehensive digital audit analyzing website usability, local presence, and paid campaigns',
      'Customer acquisition economics review: customer lifetime value, margins, and inquiry targets',
      'Competitive benchmarking within your specific geographic and service niche',
      'Prioritized 90-day growth roadmap highlighting quick wins vs compound strategic investments',
      'Vendor and tool recommendation avoiding unnecessary recurring monthly software costs',
      'Direct, jargon-free consultation session with actionable takeaway documentation',
    ],
    deliverables: [
      {
        title: 'Digital Footprint Diagnostic Report',
        desc: 'Written evaluation of your current Google ranking viability, website conversion barriers, and local competitor positioning.',
      },
      {
        title: '90-Day Tactical Growth Roadmap',
        desc: 'Step-by-step priority matrix classifying initiatives by effort, cost, and anticipated revenue impact.',
      },
      {
        title: 'Channel Suitability Assessment',
        desc: 'Clear guidance on which channels to pursue immediately, which to defer, and which to eliminate.',
      },
      {
        title: '60-Minute Strategic Review Session',
        desc: 'A remote or in-person working session, subject to availability, to review findings and answer leadership questions.',
      },
    ],
    toolsUsed: ['Analytics Audits', 'Search Console Diagnostic', 'Competitor Landscape Review', 'Unit Economics Models'],
    realisticOutcomes:
      'Consultation provides immediate strategic clarity, preventing costly misallocations of advertising budget and establishing realistic benchmarks for agency or in-house execution.',
    faqs: [
      {
        question: 'Are we obligated to hire NearGrow Ads for implementation after the consultation?',
        answer:
          'Absolutely not. Our consultation delivers self-contained, actionable value. You are completely free to implement our recommendations in-house, with your existing partners, or with NearGrow Ads if you prefer.',
      },
      {
        question: 'What information do you need before our consultation?',
        answer:
          'We typically ask for your website URL, primary service focus, target geographic market, and a brief overview of past marketing efforts and current bottlenecks.',
      },
    ],
    relatedServices: ['google-business-profile', 'local-seo', 'google-ads'],
  },
];
