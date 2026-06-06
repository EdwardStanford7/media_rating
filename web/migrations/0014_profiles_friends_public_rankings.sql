CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_slug
  ON user_profiles(slug);

ALTER TABLE categories
  ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_categories_user_public_sort
  ON categories(user_id, is_public, sort_order, name);

CREATE TABLE IF NOT EXISTS user_friends (
  user_id TEXT NOT NULL,
  friend_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, friend_user_id),
  CHECK(user_id != friend_user_id),
  FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY(friend_user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_friends_friend
  ON user_friends(friend_user_id, user_id);
