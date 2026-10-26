ALTER TABLE public.case_studies
  ADD COLUMN IF NOT EXISTS image_placement text NOT NULL DEFAULT 'top'
    CHECK (image_placement IN ('top', 'background-cover', 'background-watermark')),
  ADD COLUMN IF NOT EXISTS image_opacity smallint NOT NULL DEFAULT 18
    CHECK (image_opacity BETWEEN 0 AND 100);

UPDATE public.case_studies
SET published_content = published_content || jsonb_build_object(
  'imagePlacement', COALESCE(published_content->>'imagePlacement', 'top'),
  'imageOpacity', COALESCE((published_content->>'imageOpacity')::integer, 18)
)
WHERE published_content IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.case_study_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text NOT NULL CHECK (length(trim(category_name)) BETWEEN 1 AND 100),
  normalized_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.case_study_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.case_study_categories FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT ON TABLE public.case_study_categories TO service_role;

INSERT INTO public.case_study_categories (category_name, normalized_name)
SELECT DISTINCT ON (lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g')))
  trim(category),
  lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g'))
FROM public.case_studies
WHERE trim(category) <> ''
ORDER BY lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g')), trim(category)
ON CONFLICT (normalized_name) DO NOTHING;

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
        'imageSize', study.image_size,
        'imagePlacement', study.image_placement,
        'imageOpacity', study.image_opacity
      ) ELSE study.published_content END,
      updated_at = now()
  WHERE study.id = p_id
  RETURNING study.*;
END;
$$;

REVOKE ALL ON FUNCTION public.set_case_study_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_case_study_status(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
