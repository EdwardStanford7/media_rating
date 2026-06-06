CREATE INDEX IF NOT EXISTS idx_matches_free_rank_history
  ON matches(user_id, category_id, match_type, created_at DESC);
