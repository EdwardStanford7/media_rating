CREATE TABLE IF NOT EXISTS user_follows (
  follower_user_id TEXT NOT NULL,
  followed_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY(follower_user_id, followed_user_id),
  CHECK(follower_user_id != followed_user_id),
  FOREIGN KEY(follower_user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY(followed_user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO user_follows (
  follower_user_id,
  followed_user_id,
  status,
  created_at,
  accepted_at
)
SELECT
  user_id,
  friend_user_id,
  'accepted',
  created_at,
  created_at
FROM user_friends;

CREATE INDEX IF NOT EXISTS idx_user_follows_followed_status
  ON user_follows(followed_user_id, status, follower_user_id);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_status
  ON user_follows(follower_user_id, status, followed_user_id);

DROP TABLE user_friends;
