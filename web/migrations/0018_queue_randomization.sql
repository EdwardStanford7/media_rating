ALTER TABLE queue_settings
  ADD COLUMN randomize_ready_entries INTEGER NOT NULL DEFAULT 0;
