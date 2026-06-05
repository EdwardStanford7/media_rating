ALTER TABLE queue_settings
  DROP COLUMN show_star_ratings;

ALTER TABLE queue_settings
  DROP COLUMN star_rating_curve;

ALTER TABLE categories
  DROP COLUMN star_rating_curve;
