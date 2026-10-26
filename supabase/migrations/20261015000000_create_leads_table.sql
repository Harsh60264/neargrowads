-- NearGrow Ads: Leads Table Migration
-- Production schema with strict Row Level Security (RLS)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    business_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    website_url VARCHAR(255),
    service_interest VARCHAR(100) NOT NULL,
    budget_range VARCHAR(80),
    message TEXT NOT NULL,
    preferred_contact_method VARCHAR(50) DEFAULT 'whatsapp',
    consent_status BOOLEAN NOT NULL DEFAULT true,
    source_page VARCHAR(150) DEFAULT '/',
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for searching and filtering leads by status and created date
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_service ON public.leads (service_interest);

-- Enable Row Level Security (RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Security Policy: Public / Anonymous can ONLY insert valid leads (no reading or updating other records)
CREATE POLICY "Public anonymous insert of leads"
    ON public.leads
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        length(name) > 0 AND
        length(business_name) > 0 AND
        email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    );

-- Security Policy: Only authenticated agency staff can read and update lead records
CREATE POLICY "Staff read access to leads"
    ON public.leads
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Staff update access to leads"
    ON public.leads
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);
