alter table scheduled_posts
  add column if not exists trigger_run_id text,
  add column if not exists trigger_task_id text,
  add column if not exists trigger_enqueued_at timestamptz,
  add column if not exists last_attempt_at timestamptz;

alter table scheduled_posts
  drop constraint if exists scheduled_posts_status_check;

alter table scheduled_posts
  add constraint scheduled_posts_status_check
  check (status in ('scheduled', 'queued', 'processing', 'posted', 'failed', 'canceled'));

create index if not exists idx_scheduled_posts_due_lookup
  on scheduled_posts (status, scheduled_at, trigger_run_id);
