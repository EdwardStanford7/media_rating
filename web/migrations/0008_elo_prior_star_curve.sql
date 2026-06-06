ALTER TABLE queue_settings
  ADD COLUMN star_rating_curve TEXT;

UPDATE entries AS e
SET free_rank_elo = (
  SELECT CASE
    WHEN COUNT(*) <= 1 THEN 1500
    ELSE ROUND(1500 + (1 - (2.0 * e.rank_position / (COUNT(*) - 1))) * 400)
  END
  FROM entries AS sibling
  WHERE sibling.user_id = e.user_id
    AND sibling.category_id = e.category_id
    AND sibling.status = 'active'
)
WHERE e.status = 'active'
  AND e.free_rank_wins = 0
  AND e.free_rank_losses = 0
  AND e.free_rank_elo = 1500;
