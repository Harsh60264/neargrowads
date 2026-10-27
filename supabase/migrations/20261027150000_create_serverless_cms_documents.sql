CREATE TABLE IF NOT EXISTS public.serverless_cms_documents (
  document_key text PRIMARY KEY
    CHECK (document_key IN ('blog-posts', 'blog-categories', 'blog-seo-health', 'site-content', 'team')),
  document_value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.serverless_cms_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.serverless_cms_documents FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.serverless_cms_documents TO service_role;

CREATE OR REPLACE FUNCTION public.set_serverless_cms_document_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER serverless_cms_documents_updated_at
BEFORE UPDATE ON public.serverless_cms_documents
FOR EACH ROW
EXECUTE FUNCTION public.set_serverless_cms_document_updated_at();

REVOKE ALL ON FUNCTION public.set_serverless_cms_document_updated_at() FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cms-uploads',
  'cms-uploads',
  true,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];
