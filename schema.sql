-- NutriTrack Supabase Schema
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/zqvgsbmcxrelednrtjmk/sql

-- Profiles table (stores per-user settings like Anthropic API key)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  anthropic_api_key text,
  updated_at timestamp with time zone default now()
);
alter table profiles enable row level security;
create policy "Users can manage own profile" on profiles
  for all using (auth.uid() = id);

-- Food logs table (stores daily food entries per user)
create table if not exists food_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  date text not null,  -- 'YYYY-MM-DD'
  entry jsonb not null,
  created_at timestamp with time zone default now()
);
alter table food_logs enable row level security;
create policy "Users can manage own logs" on food_logs
  for all using (auth.uid() = user_id);
create index if not exists food_logs_user_date_idx on food_logs (user_id, date);
