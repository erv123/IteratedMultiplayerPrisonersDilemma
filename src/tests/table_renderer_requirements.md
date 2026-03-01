# Table Renderer — Functional & Test Requirements

This document specifies detailed functional requirements, API surface, behavior, and test cases for the new lightweight `TableRenderer` component described in the refactor decisions. Tests should be added under `src/tests` and implement the checks below.

1. Overview
- Purpose: provide a minimal, dependency-free DOM table renderer used by small UI surfaces (payoff matrices, game settings, small leaderboards). It centralizes markup generation, event wiring, and enforces class-based styling using `public/table-styles.css`.
- Location for implementation: `public/tableRenderer.js`. CSS file: `public/table-styles.css`.

2. API Surface (public functions to test)
- `createTable(container, schema, rows, options)`
  - `container`: DOM element or CSS selector.
  - `schema`: object describing columns (see Schema below).
  - `rows`: array of row objects.
  - `options`: { compact?: boolean, tableClass?: string }
  - Returns: created table element (or container reference).

- `updateRows(container, rows)`
  - Replace or efficiently update body rows. Must remove and rebind event handlers to avoid leaks.

- `registerCellType(name, rendererFn)`
  - `rendererFn(cellSpec)` returns a DOM node for the cell.

3. Schema & cellSpec (tested fields)
- `schema` shape:
  - `{ columns: [ { key, title, width?, type?, className? } ], options?: { compact?: boolean } }`
- Row shape:
  - object with keys matching column `key` values.
  - Each cell value may be a primitive (text/number) or a `cellSpec` object with fields below.
- `cellSpec` fields to validate:
  - `type`: built-in type name (e.g., `text`, `number`, `input`, `readonlyInput`, `button`, `checkbox`, `select`, `dot`, `custom`). If omitted, use `text`.
  - `value`: primitive value or structured value for the type.
  - `className` / `classes`: string or array of classes applied to the `<td>` element.
  - `format`: object with formatting rules (e.g., `{ precision: 2, suffix: '%' }`) for built-in types.
  - `color`: optional CSS color string (used by `dot` type and optionally apply as `--row-color` data attribute).
  - `onClick(event, ctx)`: click handler for text/number cells.
  - `onChange(event, ctx)`: change handler for editable inputs.
  - `meta`: free-form metadata passed to renderer and test harness.

4. Styling & CSS contract
- The renderer must not inline primary presentation styles. Instead it must apply classes given by `className`/`classes`, plus table-level classes:
  - table element gets `.tbl` and optionally `.tbl-compact`.
  - header cells use `.tbl-header`.
  - body rows use `.tbl-row` and cells use `.tbl-cell`.
  - color swatch uses `.tbl-dot`.
- Tests must assert that these classes are present and that `className` values provided in `cellSpec` appear on the correct `<td>` elements.
- Confirm that `public/table-styles.css` exists and contains at least placeholder definitions for `.tbl`, `.tbl-header`, `.tbl-row`, `.tbl-cell`, `.tbl-compact`, `.tbl-dot`, `.muted`, `.accent` (test may simply check file presence and non-empty content).

5. Built-in cell types behavior (tests should cover):
- `text`: renders text, supports `onClick` handler.
- `number`: renders a formatted number according to `format` (precision, thousands). Supports `onClick`.
- `readonlyInput`: renders `<input disabled>` with value; `className` applied to `<td>` and input.
- `input`: renders editable `<input>` with `name` attribute when provided in `cellSpec.value.name`; `onChange` fired when changed.
- `button`: renders a `<button>` element; support `onClick`.
- `checkbox`: renders `<input type="checkbox">` and `onChange`.
- `select`: renders `<select>` with `options` provided in `cellSpec.value.options`.
- `dot`: renders a small color swatch element with class `.tbl-dot` and label; accepts `cellSpec.color` or `row.meta.color` and applies that color to the swatch element via `style` or CSS variable. Tests must assert the swatch exists and its color value is present on DOM (style attribute or computed CSS variable present).
- `custom`: uses `registerCellType` renderer to create the cell node. Tests should register a dummy renderer and ensure it is called with expected `cellSpec`.

6. Event lifecycle and updateRows
- `updateRows` must remove existing event handlers previously bound to cells (to avoid duplicate handlers or memory leaks) and rebind handlers for new rows.
- Tests:
  - Bind a handler that increments a counter on click; call `updateRows` with modified rows; verify clicking a cell triggers the handler exactly once.
  - Ensure replacing rows removes prior DOM nodes (no duplicate ids) and previous handlers no longer fire.

7. Accessibility
- Table must render `role="table"`, header row using `<thead>` and `<th>` elements with appropriate scope attributes.
- Interactive inputs/buttons must include `aria-label` when column title is ambiguous; tests should assert `aria-label` presence when `cellSpec.ariaLabel` provided.

8. Leaderboard & color integration tests
- Render a small leaderboard using `dot` cells. Test cases:
  - Row meta color used when cell color not provided.
  - `dot` label text is present.
  - `dot` element has the computed color present (either as inline style `background` or a data attribute for CSS to apply).

9. Integration test scenarios (end-to-end style)
- Payoff matrix display test:
  - Given a nested matrix data, renderer constructs table with header row/col labels, `readonlyInput` cells, and `.tbl` classes. Take DOM snapshot and assert structure.
- Create-game matrix editable test:
  - When used in `createGame.html`, renderer produces enabled `<input>` elements with ids/names matching expected names (for backward compatibility). On submit, values are collectible via `form` serialization.
- Game settings editable test (host only):
  - When user is host and game stage = 1, renderer shows editable `input` cells for settings and an `Update` button triggers a POST to `/api/games/:gameId/updateSettings` (test may mock `window.api.post` and assert body sent).

10. Performance & limits
- Rendering large rows is not the primary use-case, but `updateRows` should avoid full table re-creation where possible. Tests should include a small benchmark that renders 200 rows and measures completion (assert completes within a reasonable time threshold suitable for CI environment — e.g., < 1000ms on dev CI; this is advisory).

11. Test artifacts & fixtures
- Provide the following fixtures in `src/tests/fixtures/`:
  - `payoff-sample.json` — small 2x2 and 3x3 matrices.
  - `leaderboard-sample.json` — sample players with colors and scores.
  - `settings-sample.json` — sample settings payloads for host and non-host.

12. Acceptance criteria (tests must pass):
- Unit tests validate each built-in cell type renders correct DOM structure and classes.
- Event tests confirm `onClick` and `onChange` are invoked and not duplicated after `updateRows`.
- Integration tests for payoff matrix, create-game form compatibility, and leaderboard color swatches pass.
- `public/table-styles.css` exists and contains expected class definitions (non-empty file).

13. Test tooling notes
- Use the project's existing test framework (if present). If no JS test harness is in repo, create lightweight tests using `jsdom` and a test runner (e.g., `mocha` or `jest`) under `src/tests` and provide `package.json` scripts to run them. Keep tests deterministic and avoid network access — mock `window.api` and other globals.

---

Date recorded: 2026-03-01
