DROP INDEX IF EXISTS idx_matches_free_rank_history;
DROP INDEX IF EXISTS idx_matches_ranking_session;
DROP INDEX IF EXISTS idx_matches_user_category_created;
DROP TABLE IF EXISTS matches;

DROP INDEX IF EXISTS idx_entries_category_elo;
ALTER TABLE entries DROP COLUMN free_rank_elo;
ALTER TABLE entries DROP COLUMN free_rank_wins;
ALTER TABLE entries DROP COLUMN free_rank_losses;
