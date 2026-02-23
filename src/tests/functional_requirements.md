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

Notes / future additions
- Each service or utility file should be added here with one function block per exported function.
- When migrating to Promises, include requirements for promise behaviors (e.g., `getAsync` rejects on DB error).

Recorded: 2026-02-23
