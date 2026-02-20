alter table media_assets
  add column if not exists owner_user_id uuid references auth.users(id),
  add column if not exists object_key text,
  add column if not exists file_name text,
  add column if not exists kind text,
  add column if not exists status text default 'pending',
  add column if not exists uploaded_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists deleted_at timestamptz;

update media_assets
set owner_user_id = coalesce(owner_user_id, created_by)
where owner_user_id is null;

update media_assets
set object_key = coalesce(object_key, r2_key)
where object_key is null;

update media_assets
set file_name = coalesce(file_name, split_part(object_key, '/', array_length(string_to_array(object_key, '/'), 1)))
where file_name is null;

update media_assets
set kind = coalesce(kind, 'image')
where kind is null;

update media_assets
set status = coalesce(status, 'uploaded')
where status is null;

update media_assets
set expires_at = coalesce(expires_at, retention_until)
where expires_at is null;

alter table media_assets
  alter column owner_user_id set not null,
  alter column object_key set not null,
  alter column file_name set not null,
  alter column kind set not null,
  alter column status set not null,
  alter column expires_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_kind_check'
  ) then
    alter table media_assets
      add constraint media_assets_kind_check
      check (kind in ('video', 'image', 'thumbnail'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_status_check'
  ) then
    alter table media_assets
      add constraint media_assets_status_check
      check (status in ('pending', 'uploaded', 'deleted'));
  end if;
end $$;

create unique index if not exists uq_media_assets_object_key on media_assets (object_key);
create index if not exists idx_media_assets_brand_active on media_assets (brand_id, status, deleted_at);
create index if not exists idx_media_assets_expiry on media_assets (expires_at, deleted_at);

drop policy if exists "members can manage media_assets" on media_assets;
drop policy if exists "members can insert media_assets" on media_assets;
drop policy if exists "members can update media_assets" on media_assets;

create policy "members can select media_assets"
  on media_assets for select
  using (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = media_assets.brand_id
      and bm.user_id = auth.uid()
    )
  );

create policy "members can insert media_assets_v2"
  on media_assets for insert
  with check (
    exists (
      select 1 from brand_members bm
      where bm.brand_id = media_assets.brand_id
      and bm.user_id = auth.uid()
      and bm.role in ('owner', 'admin', 'editor')
    )
    and owner_user_id = auth.uid()
  );

create policy "members can update media_assets_v2"
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
