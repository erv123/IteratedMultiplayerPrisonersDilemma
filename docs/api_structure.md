# API Structure (recommended)

This document describes a cleaned, resource-oriented API structure for the project. Each line is a route or resource. Short explanation follows each route.

/api
- /auth
  - POST /auth/register — create a global user account. Validate `username` and `password`. Returns session on success.
  - POST /auth/login — authenticate user. Returns session token in cookie and `success` boolean.
  - POST /auth/resetPassword — reset password (admin or reset policy). Validates `username` + `newPassword` and enforces reset rules.
  - GET  /auth/whoami — (optional) return current session user info.

- /games
  - POST /games — create a new game (was `/api/register`). Body: `payoffMatrix`, `errorChance`, `maxTurns`, `maxPlayers`, `historyLimit`. Host is session user. Returns `gameId` and host `participantId`.
  - GET  /games — list games (admin/debug) or with query filters (stage, host).
  - GET  /games/:gameId — return game metadata (id, stage, players count, max_players, history_limit, etc.). (maps to `publicGame`).
  - POST /games/:gameId/start — host-only: set game to started. (maps to `startGame`).
  - POST /games/:gameId/join — join by credentials OR session (maps to `joinGame`, `joinGameAsUser`). Should be transactional.

- /participants
  - GET  /participants/me — return participant record for current session user (maps to `myPlayer`).
  - GET  /participants/:participantId/myChoices — current player's saved choices for current turn (maps to `myChoices`).
  - POST /participants/:participantId/choice — save or update choice for current turn for a particular target (maps to `saveChoice`). Body: `targetId`, `choice`.
  - POST /participants/:participantId/submit — submit all choices, mark ready; if all ready, trigger resolution (maps to `submitChoices`).
  - GET  /participants/:participantId/history — player's turn history (maps to `turnHistory`) — returns only resolved turns and respects `games.history_limit`.

- /turns
  - GET /turns/resolve-status?gameId=&turnNumber — utility for clients to know whether a turn is resolved.
  - POST /turns/resolve — admin/debug hook to force resolve (use with caution).

- /scores
  - GET /games/:gameId/scores — current participant totals (maps to `gameScores`).
  - GET /games/:gameId/score-history — per-participant score_history arrays (maps to `/api/scoreHistory/:gameId`).

- /admin
  - GET  /admin/users — list users (maps to `_listUsers`), admin-only.
  - POST /admin/setResetBypass — set/reset bypass flag for a user. Admin-only.

- /debug
  - GET /_whoami — returns session user details and admin flags.
  - GET /listGames — convenience route listing game IDs.

Notes on mapping from existing `routes/gameRoutes.js`:
- Keep feature parity for endpoints listed above; rename and group under the resourceful endpoints to improve clarity (e.g., move `/api/register` → `POST /api/games`).
- Remove or deprecate duplicate routes (e.g., `/api/joinGame` vs `/api/joinGameAsUser`) and provide a single `POST /games/:gameId/join` that supports both credential-based and session-based joins.

Service / DB boundaries (what to move into `src/services/`)
- `services/gameService.js`
  - createGame(payload, hostUser) — inserts into `games`, creates host participant, updates `current_players`.
  - getGame(gameId) — read game metadata and configuration.
  - startGame(gameId, hostParticipantId) — validate host -> set `stage = 2`.

- `services/participantService.js`
  - createParticipant(gameId, userId, username, isHost)
  - findParticipantForUser(gameId, userId)
  - markReady(participantId)
  - updateTotalScore(participantId, delta)
  - appendScoreHistory(participantId, totalScore)

- `services/turnService.js`
  - saveChoice(gameId, turnNumber, playerId, targetId, choice) — upsert logic.
  - getChoicesForTurn(gameId, turnNumber) — used by resolver.
  - getPlayerHistory(gameId, playerId, limit) — returns only resolved turns.

- `services/resolveService.js` (or keep `utils/turnResolver.js`, but call via service)
  - resolveTurn(gameId, turnNumber) — orchestrates reading choices, computing points, writing `turns.points_awarded`, updating participants' `total_score` and appending `score_history`, resetting ready flags and incrementing `games.current_turn` atomically (within a transaction where possible).

- `services/authService.js`
  - createUser, verifyPassword, canResetPassword, setPassword

Why move to services
- Centralizes DB logic and transactions and makes route handlers thin (validation -> service call -> response).
- Easier to unit test pure data-layer logic (resolve algorithm, scoring) without HTTP layer.

DB layer recommendations
- Create a thin `db` wrapper that provides Promise-based helpers: `db.getAsync`, `db.allAsync`, `db.runAsync` returning Promises.
- Keep parameterized SQL with `?` placeholders to avoid injection.
- Implement a small data-mapping layer that converts `snake_case` DB rows to `camelCase` JS objects and vice-versa (`toDb`, `fromDb`).
- Use transactions for multi-step operations and expose a way to run queries in a transaction context (e.g., `db.transaction(async (tx) => { await tx.run(...); })`).

Validation recommendations
- Use `express-validator` to validate and sanitize all incoming API payloads.
- Create reusable validator chains in `src/routes/validators/` for common patterns:
  - `gameCreateValidator`: checks `maxPlayers` (integer >=1), `maxTurns` (integer or null), `errorChance` (0..100), `historyLimit` (integer or -1), `payoffMatrix` shape.
  - `choiceValidator`: `targetId` is UUID, `choice` in `['peace','war']`.
  - `authValidator`: username length, password strength rules (min length).
- On validation failure return HTTP 400 with JSON `{ success: false, error: { message: 'Validation failed', details: [ ... ] } }`.

JSON response format & error handling
- Standard response envelope for all API routes:
  - Success: HTTP 200 (or 201 for resource creation)
    ```json
    { "success": true, "data": { /* resource-specific */ } }
    ```
  - Error: use appropriate HTTP status and envelope with machine-friendly code
    ```json
    { "success": false, "error": { "message": "User not found", "code": "USER_NOT_FOUND", "details": {} } }
    ```
- Use consistent error codes (string constants) for programmatic handling: `VALIDATION_ERROR`, `AUTH_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `SERVER_ERROR`.
- Always return useful `message` and optional `details` array for client display and debugging.

Other recommendations
- Deprecation: mark old routes as deprecated in docs and add thin compatibility handlers forwarding to the new services until clients are migrated.
- Tests: unit tests for service functions and integration tests for full game flow. Use an in-memory or temp SQLite DB for tests.

Recorded: 2026-02-23
