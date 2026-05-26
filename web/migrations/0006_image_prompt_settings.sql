ALTER TABLE queue_settings
  ADD COLUMN prompt_missing_images INTEGER NOT NULL DEFAULT 1;
