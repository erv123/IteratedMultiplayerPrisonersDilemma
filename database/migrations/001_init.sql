BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  stage INTEGER NOT NULL,
  current_turn INTEGER DEFAULT 0,
  max_turns INTEGER,
  history_limit INTEGER DEFAULT 5,
  payoff_matrix TEXT NOT NULL DEFAULT '[]',
  error_chance INTEGER DEFAULT 0,
  max_players INTEGER NOT NULL,
  current_players INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_games_stage ON games(stage);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  reset_bypass INTEGER DEFAULT 0,
  last_reset_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  user_id TEXT,
  username TEXT NOT NULL,
  total_score INTEGER DEFAULT 0,
  ready_for_next_turn INTEGER DEFAULT 0,
  is_host INTEGER DEFAULT 0,
  score_history TEXT DEFAULT '[]',
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_game ON participants(game_id);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  player_name TEXT,
  target_name TEXT,
  choice TEXT NOT NULL,
  applied_choice TEXT,
  opponent_choice TEXT,
  points_awarded INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES participants(id),
  FOREIGN KEY (target_id) REFERENCES participants(id)
);

COMMIT;
