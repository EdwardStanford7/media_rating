UPDATE entries
SET created_at = first_consumed_at
WHERE first_consumed_at IS NOT NULL;

UPDATE entry_queue
SET created_at = first_consumed_at
WHERE first_consumed_at IS NOT NULL;

ALTER TABLE entries DROP COLUMN first_consumed_at;
ALTER TABLE entry_queue DROP COLUMN first_consumed_at;
