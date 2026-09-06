create table jobboard_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table jobboard_data enable row level security;

create policy "select own row" on jobboard_data
  for select using (auth.uid() = user_id);
create policy "insert own row" on jobboard_data
  for insert with check (auth.uid() = user_id);
create policy "update own row" on jobboard_data
  for update using (auth.uid() = user_id);
