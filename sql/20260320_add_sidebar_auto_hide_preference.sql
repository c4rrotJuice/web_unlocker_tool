alter table public.user_preferences
add column if not exists sidebar_auto_hide boolean not null default false;
