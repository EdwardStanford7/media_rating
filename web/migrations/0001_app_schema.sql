PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(userId) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_user
  ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  idToken TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(userId) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_user
  ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_user_sort
  ON categories(user_id, sort_order, name);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rank_position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ranking', 'deleted')),
  image_key TEXT,
  created_at INTEGER NOT NULL,
  first_consumed_at INTEGER,
  free_rank_elo REAL NOT NULL DEFAULT 1500,
  free_rank_wins INTEGER NOT NULL DEFAULT 0,
  free_rank_losses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_unique_live_name
  ON entries(user_id, category_id, name)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_entries_category_rank
  ON entries(user_id, category_id, status, rank_position);

CREATE INDEX IF NOT EXISTS idx_entries_category_elo
  ON entries(user_id, category_id, status, free_rank_elo DESC);

CREATE TABLE IF NOT EXISTS ranking_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  subject_entry_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('new_entry', 'rerank_entry', 'switch_category')),
  from_category_id TEXT,
  lower_bound INTEGER NOT NULL,
  upper_bound INTEGER NOT NULL,
  pivot_entry_id TEXT,
  pivot_rank_position INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
  final_rank_position INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY(subject_entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ranking_sessions_user_status
  ON ranking_sessions(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  entry_a_id TEXT NOT NULL,
  entry_b_id TEXT NOT NULL,
  winner_id TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK(match_type IN ('binary_search', 'free_rank')),
  ranking_session_id TEXT,
  entry_a_elo_before REAL,
  entry_b_elo_before REAL,
  entry_a_elo_after REAL,
  entry_b_elo_after REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY(entry_a_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY(entry_b_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY(winner_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY(ranking_session_id) REFERENCES ranking_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_user_category_created
  ON matches(user_id, category_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_matches_ranking_session
  ON matches(ranking_session_id, created_at);
