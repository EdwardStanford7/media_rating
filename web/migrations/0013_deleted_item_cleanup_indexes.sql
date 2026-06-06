CREATE INDEX IF NOT EXISTS idx_entries_deleted_cleanup
  ON entries(user_id, updated_at)
  WHERE status = 'deleted';

CREATE INDEX IF NOT EXISTS idx_entry_queue_deleted_cleanup
  ON entry_queue(user_id, updated_at)
  WHERE status = 'deleted';
