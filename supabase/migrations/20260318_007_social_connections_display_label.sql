alter table public.social_connections
  add column if not exists provider_account_label text;
