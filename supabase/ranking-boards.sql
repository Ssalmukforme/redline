-- Registers REDLINE in the shared ssalmuk_ranking Supabase leaderboard.
-- The core schema (games, boards, scores, get_leaderboard, submit_score) lives in the SKYHOOK repo:
-- supabase/migrations/20260915000000_ranking_core.sql. Safe to re-run.
-- Value: survival time in milliseconds, higher wins. Keep in sync with src/ranking-boards.js.
insert into public.games (id, name) values ('redline', 'REDLINE')
on conflict (id) do update set name = excluded.name;

insert into public.boards (game_id, id, name, higher_is_better, min_value, max_value) values
  ('redline', 'golden-bay', '골든 베이', true, 0, 7200000)
on conflict (game_id, id) do update set
  name = excluded.name, higher_is_better = excluded.higher_is_better, min_value = excluded.min_value,
  max_value = excluded.max_value, penalty_key = excluded.penalty_key, penalty_per = excluded.penalty_per;
