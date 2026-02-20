create table if not exists publish_logs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  scheduled_post_id uuid not null references scheduled_posts(id) on delete cascade,
  result text not null check (result in ('published', 'failed')),
  provider_response_masked text,
  error_code text,
  created_at timestamptz not null default now()
);

alter table publish_logs enable row level security;

create policy "members can select publish_logs"
  on publish_logs for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = publish_logs.brand_id
      and bm.user_id = auth.uid()
    )
  );

create policy "authenticated can create brands"
  on brands for insert
  with check (auth.uid() is not null);

create policy "self owner bootstrap for brand_members"
  on brand_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (select 1 from brands b where b.id = brand_members.brand_id)
  );

create policy "members can insert social_connections"
  on social_connections for insert
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = social_connections.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "members can update social_connections"
  on social_connections for update
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = social_connections.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = social_connections.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "members can insert media_assets"
  on media_assets for insert
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = media_assets.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "members can update media_assets"
  on media_assets for update
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = media_assets.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = media_assets.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create policy "editors can insert scheduled_posts"
  on scheduled_posts for insert
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = scheduled_posts.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
    and created_by = auth.uid()
  );

create policy "editors can update scheduled_posts"
  on scheduled_posts for update
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = scheduled_posts.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = scheduled_posts.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
  );

create unique index if not exists uq_social_connections_id_brand
  on social_connections (id, brand_id);

alter table scheduled_posts
  drop constraint if exists scheduled_posts_connection_id_fkey;

alter table scheduled_posts
  add constraint scheduled_posts_connection_brand_fkey
  foreign key (connection_id, brand_id)
  references social_connections (id, brand_id)
  on delete cascade;
