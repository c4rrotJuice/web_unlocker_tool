alter table if exists unlock_history
  add column if not exists source text not null default 'web';

alter table if exists unlock_history
  add column if not exists event_id uuid;

create unique index if not exists unlock_history_user_event_id_uniq
  on unlock_history (user_id, event_id)
  where event_id is not null;
