// server/db.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// absolute path: /project-root/database/game.db
const dbPath = path.join(__dirname, "..", "database", "game.db");

// ensure database directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(
  dbPath,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error("Failed to open SQLite database:", err);
    } else {
      console.log("SQLite database opened at:", dbPath);
    }
  }
);

module.exports = db;
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      stage INTEGER,
      current_turn INTEGER DEFAULT 0,
      max_turns INTEGER,
      payoff_matrix TEXT,
      error_chance INTEGER,
      max_players INTEGER,
      current_players INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      game_id TEXT,
      username TEXT,
      password TEXT,
      total_score INTEGER DEFAULT 0,
      ready_for_next_turn INTEGER DEFAULT 0,
      is_host INTEGER,
      score_history TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      game_id TEXT,
      turn_number INTEGER,
      player_id TEXT,
      target_id TEXT,
      player_name TEXT,
      target_name TEXT,
      choice TEXT,
      applied_choice TEXT,
      opponent_choice TEXT,
      points_awarded INTEGER
    )
  `);
});

module.exports = db;