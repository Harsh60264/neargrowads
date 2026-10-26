export interface BlogCategory {
  name: string;
  slug: string;
  description: string;
}

export const BLOG_CATEGORIES: BlogCategory[] = [
  { name: 'Business Growth', slug: 'business-growth', description: 'Actionable growth tips for startups, local businesses and entrepreneurs.' },
  { name: 'Case Studies', slug: 'case-studies', description: 'Real client success stories, rankings, leads and growth results.' },
  { name: 'Digital Marketing', slug: 'digital-marketing', description: 'PPC, lead generation, campaign optimization and marketing strategy.' },
  { name: 'Google Ads', slug: 'google-ads', description: 'Paid search strategy, campaign optimization and advertising insights.' },
  { name: 'Google Business Profile', slug: 'google-business-profile', description: 'Tips, optimization guides, suspension recovery, verification and ranking strategies.' },
  { name: 'Healthcare Marketing', slug: 'healthcare-marketing', description: 'Marketing solutions for doctors, clinics, hospitals and healthcare providers.' },
  { name: 'Hotels & Hospitality Marketing', slug: 'hotels-hospitality-marketing', description: 'Digital growth strategies for hotels, hospitality brands and travel businesses.' },
  { name: 'Local SEO', slug: 'local-seo', description: 'Local search visibility, maps optimization and multi-location SEO.' },
  { name: 'NearGrow Ads Updates', slug: 'neargrow-ads-updates', description: 'Company news, announcements and updates from NearGrow Ads.' },
  { name: 'Real Estate Marketing', slug: 'real-estate-marketing', description: 'Digital marketing strategies for real estate businesses and property brands.' },
  { name: 'Restaurant Marketing', slug: 'restaurant-marketing', description: 'Customer acquisition and visibility strategies for restaurants and dining brands.' },
  { name: 'Social Media Marketing', slug: 'social-media-marketing', description: 'Social content, campaigns and audience growth strategies.' },
];
