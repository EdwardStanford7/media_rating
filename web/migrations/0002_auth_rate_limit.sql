CREATE TABLE IF NOT EXISTS rateLimit (
  id TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_key
  ON rateLimit("key");
