ALTER TABLE "user" ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE "user" ADD COLUMN banReason TEXT;
ALTER TABLE "user" ADD COLUMN banExpires INTEGER;

ALTER TABLE session ADD COLUMN impersonatedBy TEXT;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_label TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN (
    'ban_user',
    'unban_user',
    'revoke_session',
    'revoke_sessions',
    'promote_user',
    'demote_user'
  )),
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES "user"(id) ON DELETE SET NULL,
  FOREIGN KEY(target_user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created
  ON admin_audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_target_created
  ON admin_audit_events(target_user_id, created_at DESC);
