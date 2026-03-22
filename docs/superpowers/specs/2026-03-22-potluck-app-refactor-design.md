# Potluck App Refactor — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Split `apps/potluck/index.html` from a single monolithic file into separate CSS, HTML, and JavaScript modules. No behaviour changes — pure structural refactor. This establishes a clean file layout before the GitHub experience improvements are applied on top.

---

## Motivation

`apps/potluck/index.html` currently contains ~344 lines of inline CSS and JavaScript. The GitHub experience improvements plan will add substantially more code. Splitting now keeps each file focused, readable, and independently editable.

---

## File Structure

**Before:**
```
apps/potluck/
  index.html   ← HTML + <style> + <script type="module"> all inline
```

**After:**
```
apps/potluck/
  index.html        ← shell: <link>, <div id="app">, <script type="module" src="main.js">
  potluck.css       ← verbatim move of the existing <style> block
  main.js           ← config constants, URL param parsing, main() entry point
  helpers.js        ← esc(), setStatus(), startPolling()
  organizer.js      ← renderOrganizer(), renderOrganizerDashboard()
  participant.js    ← renderParticipant(), renderHistory(), renderOnboardingGate()
  observer.js       ← renderObserver()
```

`observer.js` and `renderOnboardingGate` do not exist yet — they are placeholders for the GitHub improvements plan. Their stubs are included here so the file map is complete before that plan executes.

---

## Module Responsibilities

### `index.html`
Minimal shell. Contains only:
- `<head>` with charset, viewport, title, and `<link rel="stylesheet" href="potluck.css">`
- `<body>` with `<div id="app">Authenticating...</div>`
- `<script type="module" src="main.js">`

### `potluck.css`
Verbatim copy of the existing `<style>` block. No changes to selectors or rules.

### `main.js`
- Config constants: `CLIENT_ID`, `CLIENT_SECRET`, `CORS_PROXY`
- URL param parsing: `mode`, `repoParam`, `inviteParam` (read once from `location.search`)
- `main()` entry point — reads params, calls `GitHubStore.init()` or render functions
- Top-level error handler: `main().catch(e => { document.getElementById('app').innerHTML = ...; console.error(e) })`
- Imports: `GitHubStore` from `../../lib/github-store.js`, render functions from sibling modules, helpers from `./helpers.js`

### `helpers.js`
Exports three pure utilities with no module-level side effects:
- `esc(str)` — HTML-escape a string
- `setStatus(msg, isError)` — write to `#status` element
- `startPolling(fn, interval)` — exported stub (empty function body); the GitHub improvements plan replaces it with a real implementation. This refactor does **not** call `startPolling` anywhere — `organizer.js` keeps its existing `setInterval(refreshTable, 30_000)` unchanged. Swapping `setInterval` for `startPolling` happens in the improvements plan.

### `organizer.js`
Exports:
- `renderOrganizer(store, repoParam)` — creation form + recent repos list. Calls `renderOrganizerDashboard(store, repoParam)` internally, forwarding `repoParam`.
- `renderOrganizerDashboard(store, repoParam)` — live responses table + PAT invite section. Obtains the app DOM element internally via `document.getElementById('app')` rather than receiving it as an argument (removes the existing `app` parameter). Keeps `setInterval(refreshTable, 30_000)` unchanged.

Imports: `GitHubStore` from `../../lib/github-store.js`, helpers from `./helpers.js`

### `participant.js`
Exports:
- `renderParticipant(store, repoParam, inviteParam)` — join flow + submission form. Uses `repoParam` to set `store._repoFullName` and `inviteParam` to conditionally call `store.join()`.
- `renderHistory(store)` — submission history table
- `renderOnboardingGate(repoParam)` — stub; implemented in the improvements plan

Imports: `GitHubStore` from `../../lib/github-store.js`, helpers from `./helpers.js`

### `observer.js`
Exports:
- `renderObserver(repoParam)` — stub; implemented in the improvements plan

Imports: `GitHubStore` from `../../lib/github-store.js`, helpers from `./helpers.js`

---

## Function Signature Changes

URL params are currently module-level globals inside the inline `<script>`. After the split they are parsed in `main.js` and passed explicitly as arguments:

| Function | Before | After |
|---|---|---|
| `renderOrganizer` | `(store)` | `(store, repoParam)` |
| `renderOrganizerDashboard` | `(store, app)` | `(store, repoParam)` — `app` param dropped; DOM element obtained internally |
| `renderParticipant` | `(store)` | `(store, repoParam, inviteParam)` |
| `renderObserver` | `()` (new) | `(repoParam)` (new) |
| `renderOnboardingGate` | `()` (new) | `(repoParam)` (new) |

`renderHistory(store)` and `setStatus(msg, isError)` signatures are unchanged.

---

## Constraints

- **No behaviour changes.** Logic, rendering output, and user-visible flow are identical before and after.
- **No build step.** Files are plain ES modules loaded directly by the browser. The existing `npx serve` / `serve.json` setup serves them correctly.
- **`file://` protocol not supported** for multi-file ES modules (CORS restriction). The app already requires a static server — this refactor does not change that requirement.
- **Stubs for new modules.** `observer.js` and `renderOnboardingGate` in `participant.js` export empty stub functions. The GitHub improvements plan fills them in.

---

## Scope Boundaries

**In scope:**
- Moving inline CSS to `potluck.css`
- Splitting inline JS into the five modules above
- Making URL params explicit function arguments
- Adding stub exports for `renderObserver` and `renderOnboardingGate`

**Out of scope:**
- Any logic changes
- CSS changes
- Adding new features
- Build tooling (bundler, transpiler)
- Test coverage for the app modules (no test framework for the app layer)
