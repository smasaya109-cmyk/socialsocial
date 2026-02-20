create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'social_provider') then
    create type social_provider as enum ('instagram', 'x', 'threads', 'tiktok');
  end if;
end $$;

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brand_members (
  brand_id uuid not null references brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

create table if not exists social_connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  provider social_provider not null,
  provider_account_id text not null,
  access_token_enc text not null,
  refresh_token_enc text,
  key_version integer not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, provider, provider_account_id)
);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  r2_key text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  retention_until timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (brand_id, r2_key)
);

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  connection_id uuid not null references social_connections(id) on delete cascade,
  body text not null,
  body_preview text not null,
  previous_post_body text,
  safe_mode_enabled boolean not null default true,
  scheduled_at timestamptz not null,
  status text not null check (status in ('scheduled', 'processing', 'posted', 'failed', 'canceled')),
  idempotency_key uuid not null unique,
  error_code text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_posts_brand_sched on scheduled_posts(brand_id, scheduled_at);
create index if not exists idx_scheduled_posts_status_sched on scheduled_posts(status, scheduled_at);

create table if not exists post_deliveries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  scheduled_post_id uuid not null references scheduled_posts(id) on delete cascade,
  provider social_provider not null,
  provider_post_id text,
  status text not null check (status in ('posted', 'failed')),
  idempotency_key uuid not null,
  error_message text,
  created_at timestamptz not null default now(),
  unique (provider, idempotency_key)
);

create table if not exists idempotency_keys (
  key uuid primary key,
  brand_id uuid not null references brands(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now()
);

alter table brands enable row level security;
alter table brand_members enable row level security;
alter table social_connections enable row level security;
alter table media_assets enable row level security;
alter table scheduled_posts enable row level security;
alter table post_deliveries enable row level security;
alter table idempotency_keys enable row level security;

create policy "members can select brands"
  on brands for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = brands.id
      and bm.user_id = auth.uid()
    )
  );

create policy "owners can update brands"
  on brands for update
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = brands.id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin')
    )
  );

create policy "members can select brand_members"
  on brand_members for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = brand_members.brand_id
      and bm.user_id = auth.uid()
    )
  );

create policy "owners can manage brand_members"
  on brand_members for all
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = brand_members.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin')
    )
  );

create policy "members can manage social_connections"
  on social_connections for all
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = social_connections.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "members can manage media_assets"
  on media_assets for all
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = media_assets.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "members can select scheduled_posts"
  on scheduled_posts for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = scheduled_posts.brand_id
      and bm.user_id = auth.uid()
    )
  );

create policy "editors can manage scheduled_posts"
  on scheduled_posts for all
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = scheduled_posts.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "members can select post_deliveries"
  on post_deliveries for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = post_deliveries.brand_id
      and bm.user_id = auth.uid()
    )
  );

create policy "members can select idempotency_keys"
  on idempotency_keys for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = idempotency_keys.brand_id
      and bm.user_id = auth.uid()
    )
  );

create policy "members can insert idempotency_keys"
  on idempotency_keys for insert
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = idempotency_keys.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );
