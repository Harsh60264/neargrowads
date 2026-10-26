CREATE OR REPLACE FUNCTION public.save_site_content_draft(
  p_content jsonb,
  p_actor_id uuid,
  p_actor_label text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  saved_row public.site_content_cms%ROWTYPE;
  existing_row public.site_content_cms%ROWTYPE;
  had_existing boolean;
  revision_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.site_content_cms.draft'));

  SELECT * INTO existing_row
  FROM public.site_content_cms
  WHERE id = true
  FOR UPDATE;
  had_existing := FOUND;

  IF (p_expected_updated_at IS NULL AND had_existing) OR
    (p_expected_updated_at IS NOT NULL AND
      (NOT had_existing OR existing_row.updated_at IS DISTINCT FROM p_expected_updated_at)) THEN
    RETURN jsonb_build_object(
      'conflict', true,
      'updated_at', existing_row.updated_at
    );
  END IF;

  INSERT INTO public.site_content_cms (id, draft_content, updated_by, updated_at)
  VALUES (true, p_content, p_actor_id, now())
  ON CONFLICT (id) DO UPDATE
  SET draft_content = EXCLUDED.draft_content,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
  RETURNING * INTO saved_row;

  IF NOT had_existing OR existing_row.draft_content IS DISTINCT FROM p_content THEN
    INSERT INTO public.site_content_revisions (content, action, actor_id, actor_label)
    VALUES (p_content, 'draft_saved', p_actor_id, COALESCE(NULLIF(trim(p_actor_label), ''), 'Administrator'))
    RETURNING id INTO revision_id;
  END IF;

  RETURN jsonb_build_object(
    'content', saved_row.draft_content,
    'updated_at', saved_row.updated_at,
    'revision_id', revision_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_site_content_draft(jsonb, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_site_content_draft(jsonb, uuid, text, timestamptz) TO service_role;
