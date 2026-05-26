DELETE FROM matches
WHERE match_type = 'free_rank';

UPDATE entries
SET
  free_rank_elo = 1500,
  free_rank_wins = 0,
  free_rank_losses = 0,
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE status != 'deleted';
