-- Abilita XBRL/XML mantenendo i tipi preesistenti, il limite di 30 MB
-- e tutte le policy di accesso del bucket practice-files.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT mime
  FROM unnest(
    allowed_mime_types || ARRAY[
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip', 'application/x-zip-compressed',
      'application/xbrl+xml', 'application/xml', 'text/xml'
    ]::text[]
  ) AS supported(mime)
  ORDER BY mime
)
WHERE id = 'practice-files'
  AND allowed_mime_types IS NOT NULL;
