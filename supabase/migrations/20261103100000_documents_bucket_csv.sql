-- Accounting exports upload CSV files to the private `documents` bucket, but the bucket only
-- allowed PDFs, Office documents, images, audio and video, so every export failed with
-- "mime type text/csv is not supported". Allow text/csv alongside the existing types.
update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct m) from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['text/csv']) as m
       )
 where id = 'documents';
