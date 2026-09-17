-- 직접 분석을 부탁해 등록한 공고 표시 + 운세 판정. 본인 계정에서만 보인다.
-- Supabase 대시보드 > SQL Editor에서 한 번만 실행한다.
create table if not exists jobboard_my_notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id text not null,
  fortune text,          -- 예: "🟡 지원"
  fortune_note text,     -- 한 줄 이유
  checked_at date,       -- 판정일
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table jobboard_my_notes enable row level security;

create policy "select own notes" on jobboard_my_notes
  for select using (auth.uid() = user_id);
create policy "insert own notes" on jobboard_my_notes
  for insert with check (auth.uid() = user_id);
create policy "update own notes" on jobboard_my_notes
  for update using (auth.uid() = user_id);
create policy "delete own notes" on jobboard_my_notes
  for delete using (auth.uid() = user_id);
