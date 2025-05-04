-- Migration to strip query parameters from imageUrl values
CREATE OR REPLACE FUNCTION strip_query_params(url TEXT) RETURNS TEXT AS $$
BEGIN
  -- Extract the part of the URL before the question mark (if any)
  RETURN regexp_replace(url, '([^?]*)(\?.+)?', '\1');
END;
$$ LANGUAGE plpgsql;

-- Update all imageUrl values in the shows table
UPDATE shows
SET imageUrl = strip_query_params(imageUrl)
WHERE imageUrl LIKE '%?%';

-- Drop the function after use
DROP FUNCTION strip_query_params; 