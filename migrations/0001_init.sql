-- Core schema for Clydeford Habits (CLAUDE.md §12).
-- All timestamps are TEXT (ISO-8601 UTC). Every user-owned table cascades on
-- user deletion so account deletion (CLAUDE.md §13) is a single DELETE.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  plan TEXT,
  active_habit_cap INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_magic_links_email ON magic_links (email);

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  library_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  identity_statement TEXT NOT NULL,
  tiny_version TEXT NOT NULL,
  standard_version TEXT NOT NULL,
  ambitious_version TEXT,
  cue_suggestion TEXT,
  time_of_day TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  difficulty INTEGER NOT NULL,
  frequency_default TEXT NOT NULL DEFAULT 'daily',
  stack_anchors TEXT NOT NULL DEFAULT '[]',
  prerequisites TEXT
);
CREATE INDEX idx_habits_category ON habits (category);
CREATE INDEX idx_habits_library_version ON habits (library_version);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_stacks_user_id ON stacks (user_id);

CREATE TABLE user_habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'tiny',
  custom_cue TEXT,
  stack_id TEXT REFERENCES stacks (id) ON DELETE SET NULL,
  position INTEGER,
  adopted_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX idx_user_habits_user_id ON user_habits (user_id);
CREATE INDEX idx_user_habits_stack_id ON user_habits (stack_id);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  user_habit_id TEXT NOT NULL REFERENCES user_habits (id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_habit_id, local_date)
);

CREATE TABLE streaks (
  user_habit_id TEXT PRIMARY KEY REFERENCES user_habits (id) ON DELETE CASCADE,
  current INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  repair_available INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE qa_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  transcript TEXT NOT NULL DEFAULT '[]',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_qa_sessions_user_id ON qa_sessions (user_id);

CREATE TABLE suggestion_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  score REAL NOT NULL,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  shown_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome TEXT
);
CREATE INDEX idx_suggestion_log_user_id ON suggestion_log (user_id);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys TEXT NOT NULL,
  platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions (user_id);
