# Style Decisions

This document records the global styling choices applied to the UI overhaul.

- **Central stylesheet**: `public/styles.css` is the single source for global UI styles. Pages may keep small page-specific adjustments but should rely on the central stylesheet for shared primitives.
- **Typography**: Use a system font stack (Inter/system-ui/Segoe UI/Roboto/Arial). This keeps things lightweight and consistent across platforms.
- **Color system**: Defined CSS variables in `:root` for primary accents, success, danger, and muted text. Use semantic names (`--accent`, `--danger`) so colours can be changed centrally.
- **Spacing & radii**: Use consistent spacing via utility class patterns and a `--radius` for card corners.
- **Cards & shadows**: Lightweight cards (`.card`) with subtle elevation for content grouping.
- **Buttons**: Primary solid button, secondary and danger variants. Buttons have rounded corners and accessible hit targets.
- **Forms**: Inputs, selects, and textareas share the same padding and border radius to create a unified look.
- **Responsiveness**: Layout adjusts at 800px breakpoint — `.container` stacks vertically for mobile. Canvas and lists scale to available width.
- **No external libraries**: Intentionally avoided web fonts and CSS frameworks to keep the bundle small and dependency-free.
- **Accessibility**: Buttons use sufficiently large hit areas and color contrast is considered for primary/disabled states. Further a11y audits recommended.

If you'd like a stricter design system (spacing scale, type scale, tokens exported to JS), I can expand this into a small design tokens file and a short checklist for components.

## Alerts & Modals — Implementation Plan

### Goals
- Provide a consistent, accessible replacement for native `alert`/`confirm`/`prompt` across the app.
- Support two primary UX patterns: blocking modal dialogs (confirm/prompt) and non-blocking toasts (info/success/error).
- Ensure minimal DOM churn and integrate with the existing polling/focus-restore improvements so dialogs don't cause unexpected scroll or focus jumps.

### Visual tokens
- Add CSS variables to `:root` in `public/styles.css`:
  - `--ui-bg-overlay: rgba(0,0,0,0.45)`
  - `--ui-modal-bg: #ffffff`
  - `--ui-modal-radius: 8px`
  - `--ui-modal-pad: 16px`
  - `--ui-toast-bg-success`, `--ui-toast-bg-error`, `--ui-toast-bg-info`
  - `--ui-z-modal: 9000`, `--ui-z-toast: 9100`

### Component styles
- `.ui-overlay` — full-viewport semi-opaque layer
- `.ui-modal` — centered card with `role="dialog"`, `aria-modal="true"`, and proper spacing
- `.ui-modal__header`, `__body`, `__footer` — structured layout with predictable button placement
- `.ui-btn--primary` / `--secondary` / `--danger` — consistent action buttons and keyboard focus style
- `.ui-toast-container` and `.ui-toast` — fixed-position stack for transient messages

### Behavior & accessibility
- Focus management: trap focus inside modal while open; autofocus the primary control or the first focusable element; restore focus to the invoking element on close.
- Keyboard: `Esc` closes (cancels) non-destructive dialogs; `Enter` triggers the primary action when appropriate.
- ARIA: dialogs use `role="dialog"` with `aria-labelledby` and `aria-describedby` for the title and message; toasts use `aria-live="polite"`.
- Queueing: modal service serializes blocking dialogs; toasts stack with automatic dismissal.

### API contract
- Add `public/js/alertService.js` with a promise-based API:
  - `alert(message, options)` → Promise<void>
  - `confirm(message, options)` → Promise<boolean>
  - `prompt(message, { placeholder, defaultValue })` → Promise<string|null>
  - `toast(message, { type = 'info'|'success'|'error', duration = 4000 })` → void
- The service mounts a single modal/toast container into `document.body` and exposes a short compatibility shim for `window.alert`/`window.confirm` that can be toggled.

### Integration notes
- Replace direct uses of `window.alert` / `window.confirm` / `window.prompt` in `public/js/*.js` with `alertService` calls. Start with high-impact pages: `public/js/game.js`, `public/js/gameInfo.js`, `public/js/createGame.js`.
- Include the toast container or let the service create it on-demand; for predictability add the container markup to the main HTML files (`public/index.html`, `public/game.html`, `public/gameInfo.html`, `public/createGame.html`).

### Implementation steps (high level)
1. Add CSS tokens and component styles to `public/styles.css`.
2. Implement `public/js/ui/alertService.js` (modal rendering, focus-trap, ARIA, queueing, toasts).
3. Bootstrap the service on page load and provide `window.uiAlertsEnabled = true` feature flag for staged rollout.
4. Replace native dialog usages across `public/js` files; keep a small compatibility shim if needed.
5. Add automated and manual tests: keyboard-only flows, mobile viewport, screen reader smoke checks.
6. Update `REFACTOR_CHECKLIST.md` and this `STYLE_DECISIONS.md` with usage examples and patterns.

### Testing and rollout
- Start with manual verification in a development branch using `window.uiAlertsEnabled` and confirm:
  - Modal focus trap and restore behave correctly while polling runs.
  - Toast placement and stacking on small screens.
  - Confirm/prompt flows return expected Promise values and integrate cleanly with existing code paths.
- After verification, flip the feature flag and remove the compatibility shim.

Notes
- Keep the implementation minimal; prefer a small audited focus-trap helper or a concise in-house implementation rather than a large dependency.
- The API is intentionally Promise-based so code looks synchronous and is easy to refactor.
