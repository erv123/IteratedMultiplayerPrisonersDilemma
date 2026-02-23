# Refactor Decisions

This file records the project-wide decisions agreed during the refactor. It is the authoritative place to add or change conventions going forward.

Decisions (finalized):

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

Usage notes:
- This file should be referenced by tooling, README, and new code PRs to ensure consistency.
- When adding new conventions, append them here with a short rationale and date.

Date recorded: 2026-02-23
