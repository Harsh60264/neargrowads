ALTER TABLE public.case_studies
  ADD COLUMN IF NOT EXISTS published_content jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'case_studies_published_content_object_check'
      AND conrelid = 'public.case_studies'::regclass
  ) THEN
    ALTER TABLE public.case_studies
      ADD CONSTRAINT case_studies_published_content_object_check
      CHECK (published_content IS NULL OR jsonb_typeof(published_content) = 'object');
  END IF;
END;
$$;

UPDATE public.case_studies
SET published_content = jsonb_build_object(
  'slug', slug,
  'title', title,
  'category', category,
  'clientDescriptor', client_descriptor,
  'approvedClientName', approved_client_name,
  'timeframe', timeframe,
  'location', location,
  'summary', summary,
  'challenge', challenge,
  'strategy', strategy,
  'deliverablesExecuted', deliverables_executed,
  'resultsContext', results_context,
  'metrics', metrics,
  'toolsUsed', tools_used,
  'testimonialQuote', testimonial_quote,
  'testimonialApproved', testimonial_approved,
  'serviceSlug', service_slug,
  'ctaLabel', cta_label,
  'ctaLink', cta_link,
  'featured', featured,
  'displayOrder', display_order,
  'imageUrl', image_url,
  'imageAlt', image_alt,
  'imagePositionX', image_position_x,
  'imagePositionY', image_position_y,
  'imageSize', image_size
)
WHERE status = 'published'
  AND published_content IS NULL;

CREATE OR REPLACE FUNCTION public.set_case_study_status(p_id uuid, p_status text)
RETURNS SETOF public.case_studies
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('draft', 'published', 'archived') THEN
    RAISE EXCEPTION 'Invalid case study status';
  END IF;

  RETURN QUERY
  UPDATE public.case_studies AS study
  SET status = p_status,
      published_at = CASE WHEN p_status = 'published' THEN now() ELSE NULL END,
      published_content = CASE WHEN p_status = 'published' THEN jsonb_build_object(
        'slug', study.slug,
        'title', study.title,
        'category', study.category,
        'clientDescriptor', study.client_descriptor,
        'approvedClientName', study.approved_client_name,
        'timeframe', study.timeframe,
        'location', study.location,
        'summary', study.summary,
        'challenge', study.challenge,
        'strategy', study.strategy,
        'deliverablesExecuted', study.deliverables_executed,
        'resultsContext', study.results_context,
        'metrics', study.metrics,
        'toolsUsed', study.tools_used,
        'testimonialQuote', study.testimonial_quote,
        'testimonialApproved', study.testimonial_approved,
        'serviceSlug', study.service_slug,
        'ctaLabel', study.cta_label,
        'ctaLink', study.cta_link,
        'featured', study.featured,
        'displayOrder', study.display_order,
        'imageUrl', study.image_url,
        'imageAlt', study.image_alt,
        'imagePositionX', study.image_position_x,
        'imagePositionY', study.image_position_y,
        'imageSize', study.image_size
      ) ELSE study.published_content END,
      updated_at = now()
  WHERE study.id = p_id
  RETURNING study.*;
END;
$$;

REVOKE ALL ON FUNCTION public.set_case_study_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_case_study_status(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
