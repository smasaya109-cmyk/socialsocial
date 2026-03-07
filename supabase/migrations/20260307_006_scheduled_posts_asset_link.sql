alter table scheduled_posts
  add column if not exists asset_id uuid references media_assets(id) on delete set null;

create index if not exists idx_scheduled_posts_asset_id on scheduled_posts(asset_id);
