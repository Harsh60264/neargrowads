ALTER TABLE public.case_study_categories
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;

INSERT INTO public.case_study_categories (category_name, normalized_name)
SELECT DISTINCT ON (normalized_name)
  category_name,
  normalized_name
FROM (
  SELECT
    trim(category) AS category_name,
    lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g')) AS normalized_name
  FROM public.case_studies
  WHERE trim(category) <> ''
  UNION ALL
  SELECT
    trim(published_content->>'category') AS category_name,
    lower(regexp_replace(trim(published_content->>'category'), '[[:space:]]+', ' ', 'g')) AS normalized_name
  FROM public.case_studies
  WHERE trim(COALESCE(published_content->>'category', '')) <> ''
) AS existing_categories
ORDER BY normalized_name, category_name
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO public.case_study_categories (category_name, normalized_name, is_custom)
VALUES
  ('Google Maps & Local', 'google maps & local', false),
  ('Google Ads', 'google ads', false),
  ('Website Engineering', 'website engineering', false)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE public.case_study_categories AS saved
SET is_custom = true
WHERE saved.is_custom = false;

UPDATE public.case_study_categories
SET is_custom = false
WHERE normalized_name IN ('google maps & local', 'google ads', 'website engineering');

GRANT UPDATE, DELETE ON TABLE public.case_study_categories TO service_role;

CREATE OR REPLACE FUNCTION public.rename_case_study_category(
  p_old_normalized_name text,
  p_category_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  old_normalized_name text := lower(regexp_replace(trim(p_old_normalized_name), '[[:space:]]+', ' ', 'g'));
  new_category_name text := regexp_replace(trim(p_category_name), '[[:space:]]+', ' ', 'g');
  new_normalized_name text;
BEGIN
  IF old_normalized_name IS NULL OR length(old_normalized_name) > 100 OR
    old_normalized_name = '' OR new_category_name IS NULL OR
    length(new_category_name) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid case study category name' USING ERRCODE = '22023';
  END IF;

  new_normalized_name := lower(regexp_replace(new_category_name, '[[:space:]]+', ' ', 'g'));
  LOCK TABLE public.case_studies IN SHARE ROW EXCLUSIVE MODE;

  PERFORM 1
  FROM public.case_study_categories
  WHERE normalized_name = old_normalized_name
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case study category not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.case_study_categories
    WHERE normalized_name = new_normalized_name
      AND normalized_name <> old_normalized_name
  ) THEN
    RAISE EXCEPTION 'Case study category already exists' USING ERRCODE = '23505';
  END IF;

  UPDATE public.case_studies
  SET category = CASE
        WHEN lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g')) = old_normalized_name
          THEN new_category_name
        ELSE category
      END,
      published_content = CASE
        WHEN published_content ? 'category'
          AND lower(regexp_replace(trim(published_content->>'category'), '[[:space:]]+', ' ', 'g')) = old_normalized_name
          THEN jsonb_set(published_content, '{category}', to_jsonb(new_category_name), true)
        ELSE published_content
      END,
      updated_at = now()
  WHERE lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g')) = old_normalized_name
     OR (
       published_content ? 'category'
       AND lower(regexp_replace(trim(published_content->>'category'), '[[:space:]]+', ' ', 'g')) = old_normalized_name
     );

  UPDATE public.case_study_categories
  SET category_name = new_category_name,
      normalized_name = new_normalized_name
  WHERE normalized_name = old_normalized_name;

  RETURN new_category_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_unused_case_study_category(p_normalized_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized_value text := lower(regexp_replace(trim(p_normalized_name), '[[:space:]]+', ' ', 'g'));
  deleted_count integer;
BEGIN
  IF normalized_value IS NULL OR normalized_value = '' THEN
    RETURN false;
  END IF;

  LOCK TABLE public.case_studies IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.case_studies
    WHERE lower(regexp_replace(trim(category), '[[:space:]]+', ' ', 'g')) = normalized_value
       OR (
         published_content ? 'category'
         AND lower(regexp_replace(trim(published_content->>'category'), '[[:space:]]+', ' ', 'g')) = normalized_value
       )
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.case_study_categories
  WHERE normalized_name = normalized_value
    AND is_custom = true;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_case_study_category(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_case_study_category(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.delete_unused_case_study_category(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unused_case_study_category(text) TO service_role;

NOTIFY pgrst, 'reload schema';
