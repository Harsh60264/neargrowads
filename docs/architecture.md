# NearGrow Ads — System Architecture & Design System

## 1. Overview & Positioning

NearGrow Ads is a conversion-focused digital marketing and technology agency website for ambitious businesses growing across markets, with an India-based operating team and borderless digital delivery.

- **Brand Motto**: `PEOPLE · IDEAS · GROWTH`
- **Official Tagline**: `BUILDING BRANDS TOGETHER`
- **Primary Domain**: `neargrowads.com`

## 2. Technology Stack

- **Frontend**: React 19, TypeScript (strict mode), Tailwind CSS v4, Lucide React icons, Motion animations.
- **Backend & API**: Node.js, Express, tsx runtime.
- **Form Handling & Validation**: Client-side field validation, regex verification, honeypot spam prevention (`_hp_company_trap`), server-side validation.
- **Persistence Layer**: Structured Supabase PostgreSQL schema with Row Level Security (RLS) policies.
- **Automation Pipeline**: Direct n8n webhook dispatcher for real-time team notifications and CRM routing.

## 3. Brand Identity & Visual Design Tokens

Colors derived directly from the official NearGrow Ads logo:
- **Brand Green**: `#3EA259` (Vibrant growth green from the left & center leaves)
- **Deep Green**: `#216F3D` (Accessible interactive hover state)
- **Amber Orange**: `#F59E0B` / `#D97706` (Warm accent leaf on the right)
- **Primary Text**: `#171A17` (High-contrast charcoal)
- **Secondary Text**: `#626A63` (Muted readable body prose)
- **Neutral Background**: `#FFFFFF` / Soft `#F7F9F6`
- **Border**: `#E5E9E4`

## 4. Route Matrix

| Route | View Component | Purpose |
|---|---|---|
| `/` | `HomePage` | Full 13-section agency home presentation |
| `/services` | `ServicesIndexPage` | Complete catalog of 8 core services |
| `/services/[slug]` | `ServiceDetailPage` | Dedicated service pages with deliverables & FAQs |
| `/about` | `AboutPage` | Agency philosophy and commitments |
| `/work` | `WorkPage` | Documented client case studies & metrics |
| `/blog` | `BlogIndexPage` | Educational marketing insights |
| `/blog/[slug]` | `BlogPostPage` | Deep long-form articles |
| `/contact` | `ContactPage` | Direct communication channels & inquiry form |
| `/get-started` | `GetStartedPage` | 4-step business discovery wizard |
| `/privacy-policy` | `PrivacyPolicy` | Transparent privacy terms |
| `/terms-and-conditions` | `TermsPage` | Agency terms & ranking disclaimers |
| `/thank-you` | `ThankYouPage` | Post-submission confirmation |
