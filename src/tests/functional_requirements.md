# Functional Requirements (living document)

Purpose: collect function-level requirements for the codebase. Each function in the final code should have an entry with:
- Function name and file path
- Short description of responsibility
- Preconditions (what must be true before call)
- Inputs and expected types
- Postconditions / outputs
- Side effects (DB writes, network, session changes)
- Error cases and how they should be signaled
- Minimal tests to verify behavior

How to add entries
1. Append a section with the function header: `## filePath - functionName()`
2. Fill the bullets above. Keep entries short and test-oriented.

Example template
```
## src/services/exampleService.js - doSomething(paramA, paramB)
- Description: short purpose.
- Preconditions: e.g., `paramA` non-empty, DB connected.
- Inputs: `paramA` (string), `paramB` (number)
- Postconditions: returns `{ success: true, id }`, writes a row to `example` table.
- Side effects: inserts into DB, may update cache.
- Errors: throws / returns error envelope `{ success:false, error: { code, message } }` on validation fail or DB error.
- Tests:
  - invalid inputs → validation error (400)
  - DB insert failure simulated → returns SERVER_ERROR
  - success path → row created and returned id exists
```

---

Current entries

## src/server/db.js - db (initializer and migration runner)
- Description: Opens/creates the SQLite database at `database/game.db`, enables foreign keys, and runs SQL migrations from `database/migrations/` in order. Exports the `sqlite3.Database` instance.
- Preconditions: filesystem writable for `database/` path; Node process has permission to create files.
- Inputs: none (module-side initialization). Optionally reads migrations from `database/migrations/`.
- Postconditions: DB file exists and required baseline tables created if migrations applied; `PRAGMA foreign_keys` is set to `ON`.
- Side effects: may create/modify `database/game.db`; executes SQL migration files which may create or alter tables and indexes; updates `PRAGMA user_version` to migration version after each migration.
- Errors: any failure to open DB or apply migration should be logged to console. Service functions should detect and surface DB connection failure as an error.
- Minimal tests:
  - When `database/` is empty, require the module and assert `database/game.db` is created and schema tables exist (check `PRAGMA table_info(games)` returns rows).
  - Provide a test migration file (e.g., `database/migrations/999_test.sql`) and ensure it applies and sets `PRAGMA user_version` accordingly.
  - Simulate migration SQL error (malformed SQL) and assert that the error is logged and subsequent migrations are not applied (or that process fails safely).

## src/services/dbWrapper.js
- Description: Promise-based thin wrapper around the existing `sqlite3` Database instance exported by `src/server/db.js`. Provides `getAsync`, `allAsync`, `runAsync`, `execAsync` and `transaction(fn)` helpers used by services.
- Preconditions: `src/server/db.js` has been required and a `sqlite3.Database` instance is available and open.
- Inputs:
  - `getAsync(sql, params?)` — returns a single row or `undefined`.
  - `allAsync(sql, params?)` — returns an array of rows.
  - `runAsync(sql, params?)` — returns `{ lastID, changes }` on success.
  - `execAsync(sql)` — executes a batch of SQL.
  - `transaction(fn)` — accepts an async function `fn` which performs DB operations; wrapper begins transaction, awaits `fn()`, commits on success or rolls back on error and re-throws.
- Postconditions: convenience Promise API for DB operations; `transaction(fn)` ensures either full commit or rollback for the sequence of operations inside `fn`.
- Side effects: executes SQL statements against `database/game.db`.
- Errors: all functions reject with the underlying sqlite error on failure. `transaction(fn)` will attempt `ROLLBACK` and rethrow the original error.
- Tests:
  - `getAsync` resolves with a row for a known query and rejects on SQL error.
  - `allAsync` returns an array for multi-row queries.
  - `runAsync` returns `changes` matching an `UPDATE` and `lastID` on `INSERT` where applicable.
  - `transaction(fn)` commits when `fn` resolves and rolls back when `fn` throws; simulate error inside `fn` and assert no partial side effects.


Notes / future additions
- Each service or utility file should be added here with one function block per exported function.
- When migrating to Promises, include requirements for promise behaviors (e.g., `getAsync` rejects on DB error).

## src/services/gameService.js
- `createGame(payload, hostUser)`
  - Description: create a new game row and host participant atomically.
  - Preconditions: `payload.payoffMatrix` valid JSON/object; `hostUser` is an object with `userId` and `username`. DB writable.
  - Inputs: `payload` { payoffMatrix, errorChance, maxTurns, maxPlayers, historyLimit }, `hostUser` { userId?, username }
  - Postconditions: inserts new `games` row, inserts `participants` host row, increments `games.current_players`, returns `{ success:true, gameId, participantId }`.
  - Side effects: writes to `games` and `participants` tables, may set session values in caller.
  - Errors: validation error for missing fields -> return envelope with `VALIDATION_ERROR`; DB insert failure -> `SERVER_ERROR`.
  - Tests:
    - invalid payload -> fail validation
    - DB insert failure simulated -> returns SERVER_ERROR
    - success -> rows exist in `games` and `participants` and `current_players` incremented

- `getGame(gameId)`
  - Description: fetch game metadata and config (does not include participants list by default).
  - Preconditions: `gameId` non-empty string.
  - Inputs: `gameId` string
  - Postconditions: returns `{ success:true, game }` with fields from `games` table mapped to camelCase.
  - Side effects: read-only
  - Errors: missing game -> `NOT_FOUND`.
  - Tests: existing game -> returns expected fields; non-existent -> NOT_FOUND

- `startGame(gameId, hostParticipantId)`
  - Description: validate caller is host and set `stage = 2`.
  - Preconditions: `gameId` exists; `hostParticipantId` belongs to host participant record.
  - Inputs: `gameId`, `hostParticipantId`
  - Postconditions: `games.stage` updated to `2` and returned success.
  - Side effects: updates `games` table
  - Errors: unauthorized -> `FORBIDDEN`; missing game -> `NOT_FOUND`.
  - Tests: host starts -> stage changes; non-host -> FORBIDDEN

## src/services/participantService.js
- `createParticipant(gameId, userId, username, isHost)`
  - Description: insert a participant row, return `participantId`.
  - Preconditions: `gameId` exists and has capacity (current_players < max_players).
  - Inputs: `gameId`, `userId` (nullable), `username`, `isHost` boolean
  - Postconditions: participant row created, `games.current_players` incremented.
  - Side effects: writes to `participants` and updates `games`.
  - Errors: game full -> `CONFLICT`; DB error -> `SERVER_ERROR`.
  - Tests: normal join -> participant inserted & current_players incremented; joining when full -> CONFLICT

- `findParticipantForUser(gameId, userId)`
  - Description: returns participant row for given `userId` and `gameId` or null.
  - Preconditions: none
  - Inputs: `gameId`, `userId`
  - Postconditions: returns participant object or null
  - Tests: existing mapping -> returns participant; missing -> null

- `markReady(participantId)`
  - Description: set `ready_for_next_turn = 1` for participant
  - Preconditions: participant exists
  - Inputs: `participantId`
  - Postconditions: participant ready flag set
  - Side effects: write to `participants`
  - Tests: flag toggled; non-existent -> NOT_FOUND

- `updateTotalScore(participantId, delta)`
  - Description: increment participant `total_score` by delta
  - Preconditions: participant exists
  - Inputs: `participantId`, `delta` integer
  - Postconditions: `total_score` increased by delta and returned
  - Side effects: write to `participants`
  - Tests: positive and negative delta cases; integer validation

- `appendScoreHistory(participantId, totalScore)`
  - Description: append numeric `totalScore` to JSON array in `score_history`
  - Preconditions: participant exists, `totalScore` numeric
  - Inputs: `participantId`, `totalScore`
  - Postconditions: participant.score_history JSON contains appended value
  - Side effects: writes to `participants`
  - Tests: history initially empty -> contains one element; successive appends preserve order

## src/services/turnService.js
- `saveChoice(gameId, turnNumber, playerId, targetId, choice)`
  - Description: insert or update a choice row for the specified turn/player/target.
  - Preconditions: `gameId` exists and `turnNumber` equals `games.current_turn` (caller ensures current turn), `choice` is 'peace'|'war'
  - Inputs: `gameId`, `turnNumber`, `playerId`, `targetId`, `choice`
  - Postconditions: a `turns` row exists with `choice` set; `created_at` set on insert
  - Side effects: writes to `turns`
  - Errors: validation error if turn mismatch or invalid choice
  - Tests: insert path, update path, invalid choice -> validation error

- `getChoicesForTurn(gameId, turnNumber)`
  - Description: returns all turn entries for a game/turn (used by resolver)
  - Preconditions: none
  - Inputs: `gameId`, `turnNumber`
  - Postconditions: returns array of rows
  - Tests: returns expected rows; empty when none

- `getPlayerHistory(gameId, playerId, limit)`
  - Description: return resolved turns for a player respecting `limit` (if `limit=-1` return all)
  - Preconditions: player exists
  - Inputs: `gameId`, `playerId`, `limit` integer
  - Postconditions: returns array ordered ascending by `turn_number` (caller may request descending and reverse)
  - Tests: returns only resolved rows; limit enforced; -1 returns all

## src/services/resolveService.js
- `resolveTurn(gameId, turnNumber)`
  - Description: core resolver orchestrating scoring for a turn. Reads all choices, computes payoffs per payoff_matrix, updates `turns` rows (`opponent_choice`, `points_awarded`), updates participants' `total_score`, appends to `score_history`, resets `ready_for_next_turn`, and increments `games.current_turn`.
  - Preconditions: game exists, all participants marked ready (or caller enforces readiness)
  - Inputs: `gameId`, `turnNumber`
  - Postconditions: all affected `turns` rows have `opponent_choice` and `points_awarded` set; participants' `total_score` and `score_history` updated; `games.current_turn` incremented.
  - Side effects: writes across `turns`, `participants`, `games` and must run within a transaction to avoid partial updates.
  - Errors: if payoffs cannot be computed due to missing applied_choice entries, resolver should abort and return descriptive error.
  - Tests: complete resolution with expected score deltas; partial data -> abort; idempotence checks if called twice

## src/services/authService.js
- `createUser(username, password)`
  - Description: create a global user with bcrypt-hashed password
  - Preconditions: username not already taken; password meets strength rules
  - Inputs: `username`, `password`
  - Postconditions: user row created with hashed password
  - Errors: username conflict -> `CONFLICT`; validation -> `VALIDATION_ERROR`
  - Tests: conflict handling; success creates row

- `verifyPassword(username, password)`
  - Description: verify credentials; returns user object on success
  - Preconditions: username exists
  - Inputs: `username`, `password`
  - Postconditions: returns user id and flags on success; falsey / error on failure
  - Tests: correct password -> success; wrong -> fail

- `canResetPassword(username)`
  - Description: determine if password reset is allowed per rules (admin or last_reset_at > 24h or reset_bypass)
  - Preconditions: user exists
  - Inputs: `username`
  - Postconditions: returns boolean
  - Tests: cases for bypass, last_reset_at absent, within 24h

- `setPassword(userId, newPassword)`
  - Description: set password to new bcrypt hash and update `last_reset_at`
  - Preconditions: caller authorized
  - Inputs: `userId`, `newPassword`
  - Postconditions: password updated, `last_reset_at` written
  - Tests: success updates fields

---

Recorded additions: services function requirements. Add more entries when new service functions are implemented.

Recorded: 2026-02-23

## src/routes/validators - validator chains (express-validator)
- Description: reusable validator chains to be used as middleware in route handlers. Each validator returns HTTP 400 with the standard error envelope on failure and calls `next()` on success. Validators must produce machine-friendly `details` describing each field error.

### src/routes/validators/gameCreateValidator.js - `gameCreateValidator`
- Purpose: validate `POST /games` payload when creating a game.
- Preconditions: request has `Content-Type: application/json` and body parsed.
- Inputs (body):
  - `payoffMatrix` — required; object/JSON describing pairwise payoffs (structure validated to be an object with numeric values matching expected keys).
  - `errorChance` — required; integer or numeric between 0 and 100 inclusive.
  - `maxTurns` — required; integer >= 1 or null for unlimited.
  - `maxPlayers` — required; integer >= 1.
  - `historyLimit` — required; integer >= -1 (where -1 means unlimited). Default applied by service: 5.
- Postconditions: validation passed; `req.body` contains values
- Errors: on validation failure return HTTP 400 with `{ success:false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [ { field, message, value } ] } }`.
- Tests:
  - missing `payoffMatrix` → validation error for required field
  - `maxPlayers` non-integer or <1 → validation error
  - `errorChance` outside 0..100 → validation error
  - `historyLimit` string non-numeric or < -1 → validation error
  - valid payload → passes and middleware chain continues

### src/routes/validators/choiceValidator.js - `choiceValidator`
- Purpose: validate a player's choice payload (`POST /participants/:participantId/choice`).
- Preconditions: session or request context identifies `participantId` in path and body parsed.
- Inputs (body):
  - `targetId` — required; UUID/participant id format (string). Validate presence and that it references a participant in the same game in the service layer.
  - `choice` — required; one of the allowed strings `['peace','war']`.
- Postconditions: sanitized `req.body.choice` and `req.params.participantId` available for controller.
- Errors: invalid `choice` or missing `targetId` → HTTP 400 VALIDATION_ERROR with details.
- Tests:
  - invalid `choice` -> 400 with details
  - missing `targetId` -> 400
  - valid values -> passes

### src/routes/validators/authValidator.js - `authValidator`
- Purpose: validate authentication-related payloads: register, login, resetPassword.
- Preconditions: body parsed.
- Inputs:
  - `username` — required; string length limits (3-64 chars), sanitized (trim).
  - `password` — required for register/login/resetPassword; min length (3).
- Postconditions: sanitized credentials available to auth service.
- Errors: weak password or missing username/password -> HTTP 400 VALIDATION_ERROR with details.
- Tests:
  - short password -> 400
  - missing username -> 400
  - valid credentials -> passes

Notes:
- Implement validators as named exports that return an array of `check()` rules so they can be reused in route definitions.
- Validators should be accompanied by unit tests that exercise failing and passing examples and assert the response envelope shape on failure.

## public/api.js - fetchJSON(path, options)
- Description: Centralized wrapper for frontend API calls. Handles JSON envelope, errors, and credentials.
- Preconditions: Browser environment with `fetch` and cookies enabled; `Content-Type: application/json` when sending JSON.
- Inputs: `path` (string, relative to `/api`), `options` (method, body, headers).
- Postconditions: resolves with parsed response `{ success, data?, error? }` or rejects on network error.
- Side effects: performs network request, may trigger client-side logout handling on 401.
- Errors: network failures reject the promise; HTTP responses with `success:false` are returned as resolved values.
- Tests:
  - 200 JSON envelope `{ success:true }` -> resolves with data.
  - 401 response -> client handles session expiration (clear session UI or prompt login).
  - network failure -> promise rejects.

## public/polling.js - central polling manager
- Purpose: centralize frontend polling behavior, intervals, backoff, and subscription so pages reuse a single implementation.

- `startPolling(key, fn, intervalMs, opts)`
  - Description: start a named poller that repeatedly calls `fn()` at `intervalMs` and notifies subscribers with results.
  - Preconditions: `fn` is an async function returning a result or throwing on error.
  - Inputs: `key` (string unique id), `fn` (async fetch function), `intervalMs` (number), `opts` (optional { backoff: { maxMs, factor }, immediate: boolean }).
  - Postconditions: returns an object `{ stop(), subscribe(listener), unsubscribe(listener) }` or an id; `fn` is invoked on schedule.
  - Side effects: runs timers, calls `fn`, emits events to subscribers.
  - Errors: if `fn` throws, poller applies backoff and continues; listeners receive error notifications.
  - Tests:
    - start a poller that fetches a mocked endpoint -> subscriber receives data repeatedly.
    - simulate intermittent failures -> poller increases interval up to `maxMs` and recovers on success.

- `stopPolling(key)`
  - Description: stop and clear poller identified by `key`.
  - Preconditions: poller with `key` exists.
  - Inputs: `key`.
  - Postconditions: timers cleared, no more invocations.
  - Tests: start then stop -> ensure timer cleared and no further calls.

- `subscribe(key, listener)` / `unsubscribe(key, listener)`
  - Description: add/remove listeners for poll results. Listeners are called with `(err, data)`.
  - Preconditions: none.
  - Inputs: `key`, `listener` (function).
  - Postconditions: listener invoked on each poll result.
  - Tests: multiple listeners receive same result; unsubscribe stops receiving updates.

## public/game.js - polling integration helpers
- `initGamePolling(gameId)`
  - Description: start necessary pollers for the game view (scores, turn status, score history) using `public/api.js` and `public/polling.js`.
  - Preconditions: `gameId` available and UI components mounted.
  - Inputs: `gameId` string.
  - Postconditions: pollers started and UI updated on data events.
  - Side effects: subscribes UI components to poller events.
  - Tests: mock API responses and verify UI update callbacks called.

- `stopGamePolling(gameId)`
  - Description: stop all pollers for a game view (called on navigation away).
  - Preconditions: polling started.
  - Inputs: `gameId`.
  - Postconditions: pollers stopped.
  - Tests: ensure no further API calls after stop.

Notes on backoff policy
- The polling manager should implement an exponential backoff with jitter when `fn` fails. Default policy: factor=2, maxMs=60_000, initial interval=provided `intervalMs`. On success the interval resets to configured `intervalMs`.

Manual verification
- Add a manual test plan: run the app, open game view, disable network for a moment, verify the UI continues polling with backoff, restore network and verify it resumes normal interval.

## Frontend pages and required files — implementation plan

The section below contains per-function functional requirements for all frontend files. Each entry follows the file header rules: function name, short description, preconditions, inputs, postconditions, side effects, errors, and minimal tests.

## public/api.js - fetchJSON(path, options)
- Description: low-level fetch wrapper that sends/receives JSON to `/api/*` endpoints and normalizes the project's response envelope.
- Preconditions: `fetch` available in environment; cookies enabled for session auth.
- Inputs: `path` string (relative path, e.g., '/games'), `options` object (method, headers, body).
- Postconditions: resolves with parsed envelope object `{ success, data, error }` or rejects on network error.
- Side effects: performs network request; may dispatch a `sessionExpired` event on 401.
- Errors: network errors reject; malformed JSON rejects.
- Tests:
  - mock 200 JSON envelope -> resolves with data.
  - mock 401 -> emits `sessionExpired` and returns envelope with success:false.

## public/api.js - get(path)
- Description: convenience wrapper for GET requests.
- Preconditions: see `fetchJSON`.
- Inputs: `path` string.
- Postconditions: resolves with envelope.
- Tests: call to `/games` returns array.

## public/api.js - post(path, body)
- Description: convenience wrapper for POST JSON requests.
- Inputs: `path`, `body` object.
- Postconditions: JSON body sent with correct headers.
- Tests: create game returns `{ success:true, data: { gameId } }`.

## public/polling.js - startPolling(key, fn, intervalMs, opts)
- Description: start a named poller that repeatedly executes `fn()` on a schedule and emits results to subscribers.
- Preconditions: `fn` is an async function returning a value or throwing on error.
- Inputs: `key` string, `fn` async function, `intervalMs` integer, `opts` optional object { backoff: { factor, maxMs }, immediate }.
- Postconditions: poller registered and running; returns control object `{ stop, subscribe, unsubscribe }`.
- Side effects: timers scheduled; `fn` executed; listeners notified with `(err, data)`.
- Errors: on error `fn` may throw; poller applies exponential backoff with jitter and continues.
- Tests:
  - successful calls invoke listener with data.
  - failing `fn` retries with backoff up to `maxMs` and recovers on success.

## public/polling.js - stopPolling(key)
- Description: stop and remove poller identified by `key`.
- Preconditions: poller exists.
- Inputs: `key`.
- Postconditions: poller stopped and removed.
- Tests: stopped poller no longer calls `fn`.

## public/polling.js - subscribe(key, listener) / unsubscribe(key, listener)
- Description: add/remove listeners for poll results.
- Inputs: `key`, `listener` function.
- Postconditions: listener invoked on each tick.
- Tests: subscription receives updates; unsubscribe stops receiving.

## public/gameInfo.js - initGameInfoPage(gameId)
- Description: initialize the game info page: fetch static metadata and start polling dynamic data.
- Preconditions: DOM ready, `gameId` provided, `public/api.js` & `public/polling.js` available.
- Inputs: `gameId` string.
- Postconditions: page renders metadata and starts pollers for score history and game state; returns `{ success:true }` when initial load completes.
- Side effects: subscribes to pollers, modifies DOM, may start chart rendering.
- Errors: network errors surface via UI helpers.
- Tests:
  - valid `gameId` loads metadata and score history and renders chart.
  - network failure invokes backoff and recovers.

## public/gameInfo.js - fetchGameMetadata(gameId)
- Description: GET `/api/games/:gameId` via `public/api.get` and return parsed metadata.
- Preconditions: `gameId` string.
- Inputs: `gameId`.
- Postconditions: returns `{ id, stage, currentTurn, historyLimit, maxPlayers, ... }`.
- Tests: non-existent `gameId` returns NOT_FOUND envelope.

## public/gameInfo.js - fetchScoreHistory(gameId)
- Description: GET `/api/scores/:gameId/score-history` and normalize `scoreHistory` arrays per participant.
- Preconditions: `gameId` string.
- Inputs: `gameId`.
- Postconditions: returns array `[ { id, username, scoreHistory: [n,n,...] } ]`.
- Tests: empty history returns empty arrays; populated history returns arrays of equal lengths per participant over time.

## public/gameInfo.js - renderScoreChart(scoreHistory)
- Description: draw score history chart using a minimal chart helper; handle missing data gracefully.
- Preconditions: chart container exists in DOM.
- Inputs: `scoreHistory` array.
- Postconditions: chart updated to reflect latest history.
- Tests: empty data clears chart; incremental updates append new points.

## public/gameInfo.js - startGameInfoPolling(gameId)
- Description: start pollers for dynamic game info: score history (every 3s), game state/status (every 1s), using `public/polling.js` and `public/api.js`.
- Preconditions: `gameId` and `initGameInfoPage` completed.
- Inputs: `gameId`.
- Postconditions: pollers running and UI subscribed; returns control handles for stopping.
- Side effects: invokes `fetchScoreHistory` and re-renders chart on updates.
- Tests: pollers trigger UI updates; stopGameInfoPolling stops them.

## public/gameInfo.js - stopGameInfoPolling(gameId)
- Description: stop all pollers started by `startGameInfoPolling` for `gameId`.
- Preconditions: pollers running.
- Inputs: `gameId`.
- Postconditions: pollers stopped; listeners unsubscribed.
- Tests: no further API calls after stop.

## public/game.js - initGamePage(gameId, participantId)
- Description: initialize active game UI and start gameplay pollers (turn status, scores).
- Preconditions: `gameId` and `participantId` present.
- Inputs: `gameId`, `participantId`.
- Postconditions: pollers started; UI binds choice submission handlers.
- Tests: actions update server and UI updates propagate from polls.

## public/game.js - submitChoice(participantId, targetId, choice)
- Description: POST choice via `public/api.post('/participants/:participantId/choice')`.
- Preconditions: valid choice and participant.
- Inputs: `participantId`, `targetId`, `choice`.
- Postconditions: returns envelope; local UI reflects stored choice.
- Tests: invalid target -> validation error; valid -> success.

## public/createGame.js - submitCreateGame(formData)
- Description: POST `/api/games` to create game with `historyLimit` and other params.
- Preconditions: validated inputs per `gameCreateValidator` rules.
- Inputs: formData object.
- Postconditions: on success navigate to game page.
- Tests: invalid payload shows errors; valid creates game.

## public/common/ui.js - showToast(message, type)
- Description: lightweight non-blocking user messages.
- Preconditions: DOM container for toasts exists.
- Inputs: `message` string, `type` string ('info','error','success').
- Postconditions: toast visible briefly.
- Tests: showing and auto-dismiss.

## public/index.js - Lobby page functions
- `initLobby()`
  - Description: initialize lobby UI, wire auth and navigation buttons, start centralized polling for session and games, and subscribe UI update handlers.
  - Preconditions: `window.api` and `window.polling` are loaded and available. DOM contains elements `#loginBtn`, `#registerBtn`, `#logoutBtn`, `#profileBtn`, `#createGameBtn`, `#gamesContainer`, `#loginForm`, `#loggedInActions`, `#welcomeMsg`.
  - Inputs: none
  - Postconditions: pollers for `lobby.session` and `lobby.games` are started; auth UI reflects current session state; game list rendered.
  - Side effects: registers DOM event listeners and starts polling loops via `window.polling`.
  - Errors: network errors are logged; UI falls back to single-shot fetches when poller creation fails.
  - Tests:
    - When not authenticated, `#loginForm` visible and `#loggedInActions` hidden.
    - When authenticated, `#welcomeMsg` shows username and `#loggedInActions` visible.

- `refreshSession()`
  - Description: fetch current session user via `GET /api/auth/whoami` using `window.api.get` and update local `session` object.
  - Preconditions: `window.api` available
  - Inputs: none
  - Postconditions: `session` updated to `{ loggedIn: true, user }` or `{ loggedIn: false }` and `updateAuthUI()` invoked.
  - Errors: network errors set `session.loggedIn = false` and are logged.
  - Tests: simulate `whoami` returning user -> `session.user` set; simulate error -> `session.loggedIn=false`.

- `updateAuthUI()`
  - Description: update DOM elements to reflect `session` state.
  - Preconditions: `session` exists
  - Inputs: none
  - Postconditions: shows/hides appropriate auth elements.
  - Tests: call with loggedIn true/false and assert DOM visibility.

- `login()`
  - Description: POST credentials to `/api/auth/login` using `window.api.post`, then refresh session and game list on success.
  - Preconditions: username/password inputs non-empty
  - Inputs: reads values from `#username` and `#password`
  - Postconditions: session refreshed and games reloaded on success.
  - Errors: shows `alert` on failure (network or server-side). Test by mocking `window.api.post` responses.

- `register()`
  - Description: POST credentials to `/api/auth/register` then refresh session and game list on success.
  - Preconditions/Inputs/Postconditions similar to `login()`.

- `logout()`
  - Description: POST `/api/auth/logout` and refresh session and games.
  - Preconditions: none
  - Tests: after logout, `session.loggedIn=false` and `#loginForm` visible.

- `fetchGameList()` / `renderGameListFromRows(rows)`
  - Description: load games list via `GET /api/games`, fetch per-game metadata `GET /api/games/:gameId` and player lists via `GET /api/scores/:gameId/scores`, then render categorized lists for not_started/started/completed and split by `My Games` vs `Other Games` when logged in.
  - Preconditions: `window.api` available
  - Inputs: none (fetchGameList) or `rows` array (renderGameListFromRows)
  - Postconditions: DOM `#gamesContainer` updated with links to `gameInfo.html?gameId=` and player/host information when available.
  - Errors: network failures are caught and an error message displayed in `#gamesContainer`.
  - Tests:
    - Provide mocked `/api/games` and `/api/games/:gameId` responses to assert correct categorization and link targets.

- `makeGameLink(gameId)` and `stageKey(stageNum)`
  - Simple helpers: link generation and stage mapping. Test expected string outputs and link hrefs.



