UPDATE entries
SET image_key = NULL
WHERE image_key = user_id || '/entries/' || id || '.png';
