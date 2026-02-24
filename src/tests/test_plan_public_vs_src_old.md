## Test Plan: Verify parity between `public` + `src` and `src old`

Purpose: manual checklist to confirm the new `public/` and `src/` deliver the same functionality as `src old/` (and to assist debugging).

Prerequisites:
- App runs locally (start server from project root, e.g. `npm start` or `node server/server.js`).
- Browser with DevTools available.
- Test accounts or simple participants available.

How to use this checklist:
- For each step, perform the action on the running app using the current codebase (new `public` + `src`), mark result, then repeat the same step with `src old` served (or compare against expected behavior captured previously).

General checks (perform on every page):
- [ ] Load page (new): no uncaught exceptions in Console.
- [ ] Load page (old): no uncaught exceptions in Console.
- [ ] Network tab: main API calls return HTTP 200 with expected JSON shape.
- [ ] Page UI elements render and match expected labels/buttons.

Index / Landing ([public/index.html]):
- [ ] Action: Open landing page.
  - Expected (new): list of active games (or empty message) is visible; Create Game link/button present.
  - Expected (old): same visible list/message and Create Game link/button.
- [ ] Action: Click Create Game (navigates to create page).
  - Expected (new): navigation succeeds, form loads.
  - Expected (old): same.

Create Game ([public/createGame.html]):
- [ ] Action: Open create game page.
  - Expected (new): form fields for game name, players, turns, payoff matrix present.
  - Expected (old): same fields present.
- [ ] Action: Submit valid form to create a new game.
  - Expected (new): API returns success, redirect or link to game page, new game appears on index.
  - Expected (old): identical outcome (same data persisted and list updated).
- [ ] Action: Submit invalid form (missing required field).
  - Expected (new): client-side validation prevents submit or server returns validation error; UI shows helpful error message.
  - Expected (old): same.

Game Play ([public/game.html]):
- [ ] Action: Open a game's play page for a game with at least 2 participants.
  - Expected (new): current turn info, participant list, and choice UI (cooperate/defect) visible.
  - Expected (old): same.
- [ ] Action: Submit a choice as a participant.
  - Expected (new): API call to submit choice returns success; UI updates to reflect choice submitted (or disabled inputs); server logs show turn recorded.
  - Expected (old): same behavior and server-side persistence.
- [ ] Action: Wait for turn resolution (or trigger resolution endpoint if manual).
  - Expected (new): scores update, score_history updated, resolved turn displayed.
  - Expected (old): same score changes and history.
- [ ] Action: Inspect Web/API polling behavior.
  - Expected (new): polling requests sent at expected intervals; no duplicate/conflicting updates; backoff works if server returns errors.
  - Expected (old): polling behavior matches or is functionally equivalent.

Game Info / Summary ([public/gameInfo.html]):
- [ ] Action: Open game info page for a resolved game.
  - Expected (new): leaderboard, history, and per-player stats are visible and match DB.
  - Expected (old): same visualized data.
- [ ] Action: Click any interactive control (expand history, view player details).
  - Expected (new): controls respond, no JS errors, correct data shown.
  - Expected (old): same.

API wrapper and network contract ([public/api.js] & server routes):
- [ ] Action: From DevTools, capture the JSON response of the key endpoints used by UI: `/games`, `/game/:id`, `/participants`, `/turns`.
  - Expected (new): responses include required fields: e.g., `{ success: true, data: {...} }` or documented shape from `REFACTOR_CHECKLIST.md`.
  - Expected (old): identical field names and semantics (or documentable differences).
- [ ] Action: Introduce a simulated server error (e.g., stop DB, force 500) and observe client behavior.
  - Expected (new): UI displays an error message or retry behavior; no uncaught exceptions.
  - Expected (old): comparable error handling.

Server-side verification (logs and DB):
- [ ] Action: After creating a game and playing a turn, query DB for created records (`games`, `participants`, `turns`, `score_history`).
  - Expected (new): rows exist with expected values.
  - Expected (old): identical rows for the same flows.
- [ ] Action: Check server console logs for error stack traces during the steps.
  - Expected: no unexpected stack traces; errors are descriptive.

Debugging checklist (use when things differ):
- [ ] Reproduce the issue and capture Console + Network screenshot/recording.
- [ ] Compare requests (URL, method, payload) between new and old flows; note differences.
- [ ] Check server route handlers invoked (enable extra logging in `src/routes/*` and `src old/server/*`).
- [ ] Run server with verbose logs or in debugger: `node --inspect server/server.js` (or use `nodemon --inspect`).
- [ ] If client code differs, open corresponding JS files and compare: `public/game.js` vs `src old/public/game.js`.
- [ ] If DB mismatch suspected, export rows from both runs and diff.

Advanced / automation notes:
- [ ] Consider automating these manual steps later with a headless browser test (Puppeteer / Playwright) that asserts DOM states and network responses.
- [ ] Add small unit tests for `turnResolver` and services to catch logic regressions separately from UI parity.

Sign-off:
- [ ] After completing all checks and resolving differences, sign off with a one-line summary and list of outstanding issues (if any).

---
Generated test plan file.
