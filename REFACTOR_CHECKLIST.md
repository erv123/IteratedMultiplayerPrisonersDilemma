## Refactor Checklist

Purpose: Provide a minimal, ordered checklist to refactor the project for clarity, maintainability and testability. Follow items in order.

**1. Folder Structure & Project Outline**
- [x] Adopt clear top-level layout: `server/`, `routes/`, `public/`, `utils/`, `database/`, `tests/`, `docs/` (recommended).
- [x] Standardize file naming: use `kebab-case` for front-end assets, `camelCase` or `snake_case` for DB columns; use `.js` everywhere.
- [x] Move environment and config into `config/` or `.env` (use `dotenv`). Decision: prefer `config/` + `.env` for local secrets.
- [x] Add an entry `src/` only if moving to TypeScript or large refactor; keep small project flat for now.

**2. Database Structure**
- [x] Define canonical schema in `server/db.js` and add SQL migration scripts in `database/migrations/`.
- [x] Add explicit column comments in schema file and keep a `schema.md` in `docs/`.
- [x] Use JSON columns only when necessary (e.g., `payoff_matrix`, `score_history`); prefer normalized columns when querying often.
- [x] Decision point: Keep using SQLite for simple deployments; migrate to PostgreSQL if concurrent usage or ACID requirements grow.

**3. API Structure**
- [x] Group route handlers by resource: `routes/games.js`, `routes/auth.js`, `routes/participants.js`, `routes/admin.js`.
- [x] Ensure each route is small and focused; extract DB logic into `services/` (e.g., `services/gameService.js`).
- [x] Add input validation (use `express-validator` or `Joi`). Decision: prefer lightweight `express-validator` for minimal deps.
- [x] Standardize JSON response format: `{ success: boolean, data?:..., error?: { message, code } }`.

**4. Server Startup, Game Logic, UI Polling**
- [x] Centralize DB initialization and migrations in `server/db.js` and call migrations at startup.
- [x] Extract game logic `services/` with pure functions where possible (`turnResolver` already exists — make it return results and side-effect DB in a single well-documented function).
- [x] Replace ad-hoc polling with a single `polling` module in `public/` that centralizes intervals and backoff policy.
- [x] Decision point: Keep polling.

**5. UI Fixes to Fit Backend (short-term)**
- [x] Centralize API calls in `public/api.js` wrapper to handle `fetch`, sessions, and error handling.
- [x] Keep DOM rendering simple: small renderer functions per page (`game.js`, `gameInfo.js`, `createGame.js`).
- [ ] Add defensive checks for missing fields (e.g., `score_history` might be null) to avoid UI breakage.
- [x] Decision point: UI framework? For now keep vanilla JS; if complexity grows, consider React with small components.

**6. Code Quality & Style**
- [ ] Add ESLint config and Prettier; enforce on commit with Husky (pre-commit hook).
- [ ] Add JSDoc comments for all public functions and modules; keep function responsibilities small.
- [x] Replace callback-style DB access with Promises (or keep wrappers that return Promises) to simplify flow. Decision: gradual migration—introduce a thin `db.promise()` wrapper.

**7. Testing & CI**
- [ ] Add `tests/` with unit tests for `turnResolver`, `gameRoutes` (use supertest), and DB helpers (use a temp SQLite file).
- [ ] Add integration tests that simulate a short game: create game, add participants, submit choices, resolve turns, verify scores and score_history.
- [ ] Add a `npm test` script and a basic GitHub Action that runs lint + tests on PRs.

**8. Backwards Compatibility & Migrations**
- [ ] Implement migration scripts (SQL or JS) for schema changes; avoid `ALTER TABLE` ad-hoc in `server.js` when possible.
- [ ] Version the DB schema (`PRAGMA user_version` or a migrations table) so startup can apply only needed migrations.

**9. Observability & Error Handling**
- [ ] Add structured logging (small logger wrapper around `console`), and return helpful error messages from APIs.
- [ ] Add monitoring hooks or basic healthcheck endpoint (`/healthz`).

**10. Documentation & Handoff**
- [ ] Write `docs/architecture.md` summarizing components and control flow (server start → game loop → UI polling).
- [ ] Add `README.md` run, test and debug instructions.

**Minimal Migration Plan (practical steps)**
- [ ] Stage 1: Read-only audits — inventory files, list public APIs, and add docs.
- [ ] Stage 2: Extract service layers and API wrappers; add tests for extracted functions.
- [ ] Stage 3: Replace DB calls with promise wrappers and add migrations.
- [ ] Stage 4: Add linting, formatting and CI.

**Testing checklist**
- [ ] Unit tests for `turnResolver` covering edge cases (missing opponent, error chance toggles).
- [ ] Integration test: full game flow for 3 players across 3 turns.
- [ ] UI smoke: open `public/gameInfo.html` and `public/game.html` with test DB and verify no uncaught exceptions in console.

End: Keep checklist iterative — convert each checked item into a small PR with tests and CI before merging.

---
Generated checklist. No code changes made by this file.
