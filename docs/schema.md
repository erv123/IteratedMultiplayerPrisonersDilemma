# Database Schema (Improved)

This document describes the recommended canonical schema and conventions for the project. Column names use snake_case; application code uses camelCase and should map consistently to DB names.

General notes
- Engine: SQLite (file: `database/game.db`) for current deployments. Keep migrations in `database/migrations/` and track applied version with `PRAGMA user_version`.
- Enable foreign keys on connect: `PRAGMA foreign_keys = ON`.
- Use ISO-8601 timestamps stored as TEXT (e.g. `2026-02-23T12:34:56Z`).
- Prefer readable TEXT columns for enums/choices (e.g., `'peace'|'war'`) rather than numeric codes unless space/perf requires it.

Tables (detailed)

1) `games`
- `id` TEXT PRIMARY KEY — UUID v4 string identifying the game.
- `stage` INTEGER NOT NULL — numeric enum mapping: 1 = not_started, 2 = started, 3 = completed.
- `current_turn` INTEGER DEFAULT 0 — index of the current turn (0-based: 0 = pre-first-turn).
- `max_turns` INTEGER NULL — configured maximum turns for the game (NULL for unlimited).
- `history_limit` INTEGER DEFAULT 5 — controls how many past resolved turns to show in the UI; `-1` = unlimited.
- `payoff_matrix` TEXT NOT NULL DEFAULT '[]' — JSON-encoded object mapping outcome keys to numeric points. Example: `{ "peace_peace": 2, "peace_war": 0, "war_peace": 3, "war_war": 1 }`.
- `error_chance` INTEGER DEFAULT 0 — integer percent (0–100) used by resolver when applying random errors.
- `max_players` INTEGER NOT NULL — configured maximum participants.
- `current_players` INTEGER DEFAULT 0 — current number of participants (maintained under transaction when joining/leaving).
- `created_at` TEXT DEFAULT (datetime('now')) — creation timestamp.

Indexes
- `CREATE INDEX IF NOT EXISTS idx_games_stage ON games(stage);`

2) `users`
- `id` TEXT PRIMARY KEY — UUID for global user identity.
- `username` TEXT NOT NULL UNIQUE — login name.
- `password` TEXT NOT NULL — bcrypt hash.
- `is_admin` INTEGER DEFAULT 0 — 0/1 flag.
- `reset_bypass` INTEGER DEFAULT 0 — 0/1; grants immediate password reset privilege.
- `last_reset_at` TEXT NULL — timestamp of last reset.
- `created_at` TEXT DEFAULT (datetime('now'))

Indexes
- `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`

3) `participants`
- `id` TEXT PRIMARY KEY — UUID for the participant record (distinct from `users.id`).
- `game_id` TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE — owning game.
- `user_id` TEXT NULL REFERENCES users(id) ON DELETE SET NULL — global user mapping.
- `username` TEXT NOT NULL — display name captured at join time.
- `total_score` INTEGER DEFAULT 0 — accumulated score for this participant.
- `ready_for_next_turn` INTEGER DEFAULT 0 — 0/1 flag used during turn submission.
- `is_host` INTEGER DEFAULT 0 — 0/1 flag.
- `score_history` TEXT DEFAULT '[]' — JSON array of numeric `total_score` snapshots after each resolved turn. Keep as JSON for plotting; normalize into a separate `scores` table later if querying is required.

Indexes
- `CREATE INDEX IF NOT EXISTS idx_participants_game ON participants(game_id);`

4) `turns`
- `id` TEXT PRIMARY KEY — UUID for the turn entry (one row per player-target per turn).
- `game_id` TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE
- `turn_number` INTEGER NOT NULL — which turn this entry belongs to (should correspond to `games.current_turn` when created).
- `player_id` TEXT NOT NULL REFERENCES participants(id) — who made the choice.
- `target_id` TEXT NOT NULL REFERENCES participants(id) — the choice target.
- `choice` TEXT NOT NULL — raw submitted choice; recommended values: `'peace'` or `'war'`.
- `applied_choice` TEXT NULL — actual choice after applying `error_chance` (NULL until submit/processing).
- `opponent_choice` TEXT NULL — the opponent's applied_choice for this pairing (NULL until resolver runs).
- `points_awarded` INTEGER NULL — points awarded to `player_id` for this entry after resolver runs.
- `is_resolved` INTEGER DEFAULT 0 — 0/1 flag indicates if turn is resolved
- `created_at` TEXT DEFAULT (datetime('now'))


Common queries
- Player's finished history (most recent N resolved turns):
	```sql
	SELECT turn_number, target_id, player_name, target_name, choice, opponent_choice, points_awarded
	FROM turns
	WHERE is_resolved = 1
	ORDER BY turn_number DESC
	LIMIT ?;
	```
	Reverse results client-side for ascending order.

Migration notes
- Maintain `database/migrations/` with ordered SQL files (e.g., `001_init.sql`, `002_add_history_limit.sql`).
- On startup, read `PRAGMA user_version` and apply missing migrations in a transaction. Prefer explicit migration files over ad-hoc `ALTER TABLE` in application code.

Validation & API decision
- Use `express-validator` for request input validation. Implement reusable validator chains in `src/routes/validators/` and apply them as middleware per route.

Possible future impovements
- Immediately enable `PRAGMA foreign_keys = ON` when opening the DB connection.
- Use transactions for multi-step operations that modify `participants` and `games.current_players` (e.g., join flow) to avoid race conditions.
- Keep `score_history` as JSON on `participants` for plotting convenience. If you need to run analytics across players/turns, introduce a normalized `scores` table with columns `(id, game_id, participant_id, turn_number, total_score, created_at)`.

Notes about naming and mapping
- Follow `REFACTOR_DECISIONS.md`: `snake_case` in DB, `camelCase` in source. Provide small serialization helpers in the data layer (`toDb()` / `fromDb()`) to keep mapping consistent.

This schema file is a living document — update when migrations or API changes require it.

Recorded: 2026-02-23

