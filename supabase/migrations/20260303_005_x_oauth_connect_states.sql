create table if not exists oauth_connect_states (
  state text primary key,
  provider social_provider not null,
  brand_id uuid not null references brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists idx_oauth_connect_states_expires
  on oauth_connect_states (expires_at, used_at);

