BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY,
  last_action TEXT DEFAULT (datetime('now')),
  is_online INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_action ON user_presence(last_action);

COMMIT;
