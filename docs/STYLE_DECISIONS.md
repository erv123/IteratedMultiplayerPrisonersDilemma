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
