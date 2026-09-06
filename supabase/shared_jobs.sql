-- 공고 제보: 누구나 올리고 모두가 보는 공용 목록.
-- (개인 지원 기록은 jobboard_data에 계정별로 따로 저장된다 — 이 표와 무관하다.)

create table jobboard_shared_jobs (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  roles text[] not null default '{}',
  url text not null,
  end_date date,
  note text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table jobboard_shared_jobs enable row level security;

-- 로그인한 사람은 모두 볼 수 있다
create policy "read all shared jobs" on jobboard_shared_jobs
  for select using (auth.uid() is not null);

-- 올리는 건 누구나, 단 본인 이름으로만
create policy "insert own shared job" on jobboard_shared_jobs
  for insert with check (auth.uid() = created_by);

-- 고치고 지우는 건 올린 사람만
create policy "update own shared job" on jobboard_shared_jobs
  for update using (auth.uid() = created_by);
create policy "delete own shared job" on jobboard_shared_jobs
  for delete using (auth.uid() = created_by);

create index on jobboard_shared_jobs (created_at desc);
