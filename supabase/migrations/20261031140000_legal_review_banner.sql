-- Uses the existing public-read / staff-write feature flag policies.
insert into public.feature_flags (key, enabled, description) values
  ('legal_review_banner', true, 'Show the legal review notice on all legal documents.')
on conflict (key) do nothing;
