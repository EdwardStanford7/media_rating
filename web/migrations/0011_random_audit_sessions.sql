ALTER TABLE ranking_sessions
  ADD COLUMN operation_kind TEXT NOT NULL DEFAULT 'single';

ALTER TABLE ranking_sessions
  ADD COLUMN secondary_entry_id TEXT;

ALTER TABLE ranking_sessions
  ADD COLUMN secondary_original_rank_position INTEGER;

ALTER TABLE ranking_sessions
  ADD COLUMN operation_state TEXT;
