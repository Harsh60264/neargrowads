CREATE OR REPLACE FUNCTION public.publish_mascot_settings(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_row public.site_content_cms%ROWTYPE;
  actor_label text;
  revision_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.site_content_cms.draft'));

  SELECT * INTO current_row
  FROM public.site_content_cms
  WHERE id = true
  FOR UPDATE;

  IF NOT FOUND OR current_row.draft_content IS NULL OR current_row.published_content IS NULL THEN
    RAISE EXCEPTION 'A published site-content version is required before publishing mascot settings.'
      USING ERRCODE = 'P0001';
  END IF;

  IF (current_row.draft_content - 'mascotSettings') IS DISTINCT FROM
     (current_row.published_content - 'mascotSettings') THEN
    RAISE EXCEPTION 'Other Page Content changes must be published separately before mascot settings.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO actor_label FROM public.admin_users WHERE id = p_actor_id;

  UPDATE public.site_content_cms
  SET published_content = current_row.draft_content,
      published_by = p_actor_id,
      published_at = now()
  WHERE id = true
  RETURNING * INTO current_row;

  INSERT INTO public.site_content_revisions (content, action, actor_id, actor_label)
  VALUES (
    current_row.published_content,
    'published',
    p_actor_id,
    COALESCE(NULLIF(trim(actor_label), ''), 'Administrator')
  )
  RETURNING id INTO revision_id;

  RETURN jsonb_build_object(
    'content', current_row.published_content,
    'published_at', current_row.published_at,
    'revision_id', revision_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_mascot_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_mascot_settings(uuid) TO service_role;
