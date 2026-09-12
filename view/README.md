# view/ — the app's real UI, openable in a browser

This folder is an exact, generated mirror of `src/` — the HTML, CSS,
JavaScript, fonts and images that Tauri bundles into the Windows app.
Nothing here is simplified or re-styled.

**To view:** double-click `index.html` (Chrome / Edge). The backend is
simulated by `js/browser-preview.js`, so install actions are demo-only.
Toggle theme/language from the title bar; `Ctrl+Shift+R` reloads styles.

**Do not edit files here.** Edit `src/` and run `npm run view` — CI fails
if `view/` drifts from `src/` (`node scripts/sync-view.js --check`).

Design tokens and rules: `../docs/DESIGN.md`.
