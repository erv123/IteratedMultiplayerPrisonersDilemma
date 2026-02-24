# Refactor Decisions

This file records the project-wide decisions agreed during the refactor. It is the authoritative place to add or change conventions going forward.

Decisions (finalized):

- File update strategy:
  - Treat code in src old as completely obsolete.
  - code in src should eventually reproduce the same functionality as src old in full except with applied fixes as required
  - src old will be deleted by user after the user determines that the refactor is complete. do not delete any of it.
- Naming conventions:
  - Files, functions, variables: use camelCase.
  - Database columns and UI element IDs: use snake_case.

- Folder layout:
  - Move all source code into `src/` except the following directories which remain at repo root:
    - `docs/`
    - `database/`
    - `node_modules/`
  - After move, coderoots will be: `src/server`, `src/routes`, `src/public`, `src/utils`, etc.

- Configuration:
  - Use a central config file for environment-specific values.
  - Decision: Keep a `config/` directory at repo root with environment files (e.g., `config/default.js`, `config/production.js`) and support `.env` for secrets; read via `dotenv` at startup.

- Validation conventions (express-validator)
  - Location: place validators under `src/routes/validators/`.
  - Exports: validators MUST export named arrays of `check()`/`body()`/`param()` rules (not middleware that sends responses). Example export: `module.exports = { gameCreateValidator }` where `gameCreateValidator` is an array of rules.
  - Shared handler: use a single `handleValidation` middleware (`src/routes/validators/handleValidation.js`) to format and return validation failures using the project's standard error envelope. This keeps error formatting consistent across routes.
  - Coercion & sanitization: validators should coerce numeric fields using `.toInt()` / `.toFloat()`, trim strings with `.trim()`, and normalize field names to camelCase in JS code (DB will remain snake_case).
  - Error envelope: on validation failure return HTTP 400 with:
    ```json
    { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [ { "field": "...", "message": "...", "value": ... } ] } }
    ```
  - Common checks to standardize:
    - `gameCreateValidator`: `historyLimit` integer >= -1; `maxPlayers` int >=1; `errorChance` 0..100; `payoffMatrix` object structure validated at least as object.
    - `choiceValidator`: `choice` in `['peace','war']`; `targetId` string/UUID; validate `participantId` path param via `param()`.
    - `authValidator`: username length and trim; password min length 8 for register/reset.
  - Tests: each validator must have unit tests asserting both passing and failing payloads and that failures produce the standard envelope.

Usage notes:
- This file should be referenced by tooling, README, and new code PRs to ensure consistency.
- When adding new conventions, append them here with a short rationale and date.

Date recorded: 2026-02-23

API routing conventions
- Route files live under `src/routes/` and MUST export an Express `Router` instance as `module.exports = router`.
- Mounting: route modules are mounted under `/api` in the server entrypoint (e.g., `app.use('/api/auth', require('./src/routes/auth'))`).
- Response envelope: all route handlers MUST return `{ success: boolean, data?, error? }` and use the error codes documented earlier.
- Route naming: match `docs/api_structure.md` (resources: `/auth`, `/games`, `/participants`, `/turns`, `/scores`, `/admin`, `/debug`).

Security & sessions
- Use `express-session` for session management in `src/server/server.js`. Route handlers should read/write `req.session.user` to track logged-in user when applicable. Auth tokens/cookies should be set by `POST /auth/login` and cleared by `POST /auth/logout`.

Date recorded: 2026-02-24

Frontend conventions
- All frontend API calls should go through a centralized `public/api.js` wrapper that performs `fetch`, attaches credentials, and normalizes the response envelope to `{ success, data?, error? }`. This keeps client code resilient to small server changes.
- Use `window.api` as the public surface for legacy pages that are not bundled. Provide `get`, `post`, `put`, `del`, and `fetchJSON` methods.
- Polling must be centralized in `public/polling.js` exposing `startPolling(key, fn, intervalMs, opts)` and `stopPolling(key)` and subscription helpers. Use an exponential backoff with jitter for error recovery and reset interval on success.
- UI components should subscribe to pollers for updates rather than creating independent timers. This avoids duplicate network traffic and simplifies debugging.
- Pages must include `public/common/ui.js` for consistent toasts, error handling, and loading indicators.

Date recorded: 2026-02-24
