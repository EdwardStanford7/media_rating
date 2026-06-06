ALTER TABLE categories
  ADD COLUMN star_rating_curve TEXT;

ALTER TABLE ranking_sessions
  ADD COLUMN comparison_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ranking_sessions
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'binary';

ALTER TABLE ranking_sessions
  ADD COLUMN original_rank_position INTEGER;
