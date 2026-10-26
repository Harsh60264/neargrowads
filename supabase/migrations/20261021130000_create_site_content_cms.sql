CREATE TABLE IF NOT EXISTS public.site_content_cms (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  draft_content jsonb,
  published_content jsonb,
  updated_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

ALTER TABLE public.site_content_cms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_content_cms FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.site_content_cms TO service_role;

CREATE OR REPLACE FUNCTION public.publish_site_content(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  published_row public.site_content_cms%ROWTYPE;
BEGIN
  UPDATE public.site_content_cms
  SET published_content = draft_content,
      published_by = p_actor_id,
      published_at = now()
  WHERE id = true
    AND draft_content IS NOT NULL
  RETURNING * INTO published_row;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'content', published_row.published_content,
    'published_at', published_row.published_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_site_content(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_site_content(uuid) TO service_role;
