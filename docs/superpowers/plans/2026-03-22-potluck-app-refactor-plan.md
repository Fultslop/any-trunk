# Potluck App Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `apps/potluck/index.html` from a monolithic file into separate CSS and ES module files with zero behaviour change.

**Architecture:** Extract the inline `<style>` block verbatim to `potluck.css`, split the inline `<script>` into five focused ES modules (`main.js`, `helpers.js`, `organizer.js`, `participant.js`, `observer.js`), then strip `index.html` to a minimal shell. Tasks 1–6 create new files without touching `index.html`; Task 7 does the atomic switchover. The app does not work in the split form until Task 7 completes — that is expected.

**Tech Stack:** Vanilla ES modules, no bundler, served via `npx serve` (see `serve.json`). No test framework for app-layer code — verification is manual smoke testing.

**Spec:** `docs/superpowers/specs/2026-03-22-potluck-app-refactor-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/potluck/potluck.css` | Verbatim move of `<style>` block |
| Create | `apps/potluck/helpers.js` | `esc()`, `setStatus()`, `startPolling()` (stub) |
| Create | `apps/potluck/observer.js` | `renderObserver(repoParam)` stub |
| Create | `apps/potluck/participant.js` | `renderParticipant()`, `renderHistory()`, `renderOnboardingGate()` stub |
| Create | `apps/potluck/organizer.js` | `renderOrganizer()`, `renderOrganizerDashboard()` |
| Create | `apps/potluck/main.js` | Config constants, URL params, `main()`, top-level `.catch()` |
| Modify | `apps/potluck/index.html` | Strip to shell — `<link>`, `<div id="app">`, `<script src="main.js">` |

---

### Task 1: Extract CSS

**Files:**
- Create: `apps/potluck/potluck.css`

No behaviour change — verbatim copy of the `<style>` block. `index.html` is not touched yet.

- [ ] **Step 1: Create `potluck.css`**

```css
body { font-family: system-ui, sans-serif; max-width: 520px; margin: 2rem auto; padding: 0 1rem; }
h1   { font-size: 1.2rem; margin-bottom: 0.25rem; }
.sub { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
label { display: block; margin-top: 1rem; font-size: 0.9rem; }
input { width: 100%; box-sizing: border-box; padding: 0.4rem; margin-top: 0.25rem; border: 1px solid #ccc; border-radius: 4px; }
button { margin-top: 1rem; padding: 0.5rem 1.2rem; cursor: pointer; }
table  { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
td, th { padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; text-align: left; }
.section { margin-top: 2rem; }
hr { border: none; border-top: 1px solid #eee; margin: 1.5rem 0; }
.badge { background: #e6ffe6; color: #2a7a2a; padding: 0.1rem 0.5rem; border-radius: 3px; font-size: 0.8rem; }
#status { margin-top: 0.75rem; font-size: 0.9rem; }
.err { color: #c00; }
.ok  { color: #2a7a2a; }
```

- [ ] **Step 2: Verify it matches the source**

Open `apps/potluck/index.html` lines 8–22 (the CSS rules between the `<style>` tags) and confirm the CSS is identical character-for-character.

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/potluck.css
git commit -m "refactor(potluck): extract inline CSS to potluck.css"
```

---

### Task 2: Create helpers.js

**Files:**
- Create: `apps/potluck/helpers.js`

Exports three utilities. `esc` and `setStatus` are moved verbatim from `index.html`. `startPolling` is a new stub — it is exported but **not called anywhere in this refactor**; `organizer.js` keeps its existing `setInterval` call unchanged.

- [ ] **Step 1: Create `helpers.js`**

```js
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function setStatus(msg, isError = true) {
  let el = document.getElementById('status')
  if (!el) {
    el = document.createElement('div')
    el.id = 'status'
    document.getElementById('app').appendChild(el)
  }
  el.className = isError ? 'err' : 'ok'
  el.textContent = msg
}

// stub — implemented in GitHub experience improvements plan
export function startPolling(fn, interval) {}
```

- [ ] **Step 2: Verify source match**

`esc` lives at lines 39–46 and `setStatus` at lines 55–64 of `index.html`. Confirm both functions are identical.

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/helpers.js
git commit -m "refactor(potluck): extract esc/setStatus/startPolling to helpers.js"
```

---

### Task 3: Create observer.js (stub)

**Files:**
- Create: `apps/potluck/observer.js`

This module does not exist yet in the original. It is a stub — the implementation is part of the GitHub experience improvements plan.

- [ ] **Step 1: Create `observer.js`**

```js
import { GitHubStore } from '../../lib/github-store.js'
import { esc, setStatus } from './helpers.js'

// stub — implemented in GitHub experience improvements plan
export function renderObserver(repoParam) {}
```

- [ ] **Step 2: Verify the file**

This is a new file (no counterpart in the original). Confirm:
- The two import lines are present
- `renderObserver` is exported and has an empty body
- No other code is added

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/observer.js
git commit -m "refactor(potluck): add observer.js stub"
```

---

### Task 4: Create participant.js

**Files:**
- Create: `apps/potluck/participant.js`

Moves `renderParticipant` and `renderHistory` verbatim from `index.html`, adding the new `repoParam` and `inviteParam` parameters (previously module-level globals). Adds a `renderOnboardingGate` stub.

Key changes from the original:
- `renderParticipant(store)` → `renderParticipant(store, repoParam, inviteParam)` — params received as arguments, not read from module globals
- `renderHistory(store)` — unchanged signature

- [ ] **Step 1: Create `participant.js`**

```js
import { GitHubStore } from '../../lib/github-store.js'
import { esc, setStatus } from './helpers.js'

export async function renderParticipant(store, repoParam, inviteParam) {
  const app = document.getElementById('app')

  if (!repoParam) {
    app.innerHTML = `<p>Invalid join link — missing <code>repo</code> parameter.</p>`
    return
  }

  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">
      <strong>${esc(repoParam)}</strong><br>
      Signed in as <strong>${esc(store.username)}</strong>
      &nbsp;·&nbsp; <span id="join-status">Joining...</span>
    </p>
    <div id="status"></div>
  `

  try {
    if (inviteParam) {
      await store.join(repoParam, inviteParam)
    } else {
      store._repoFullName = repoParam
    }
    document.getElementById('join-status').innerHTML = `<span class="badge">joined ✓</span>`
  } catch(e) {
    setStatus(`Join failed: ${e.message}`)
    return
  }

  app.insertAdjacentHTML('beforeend', `
    <hr>
    <div class="section">
      <strong>What are you bringing?</strong>
      <label>Dish
        <input id="dish-input" type="text" placeholder="e.g. tiramisu" />
      </label>
      <label>Note <span style="color:#999;font-size:0.8rem">(optional)</span>
        <input id="note-input" type="text" placeholder="e.g. contains nuts" />
      </label>
      <button id="submit-btn">Submit</button>
    </div>
    <hr>
    <div class="section">
      <strong>Your submissions</strong>
      <div id="history">Loading...</div>
    </div>
  `)

  document.getElementById('submit-btn').onclick = async () => {
    const btn = document.getElementById('submit-btn')
    const dish = document.getElementById('dish-input').value.trim()
    if (!dish) { setStatus('Dish name required'); return }
    const note = document.getElementById('note-input').value.trim()
    btn.disabled = true
    setStatus('Submitting...', false)
    try {
      await store.append({ dish, note: note || undefined }, { prefix: store.username })
      document.getElementById('dish-input').value = ''
      document.getElementById('note-input').value = ''
      setStatus('Submitted!', false)
      await renderHistory(store)
    } catch(e) {
      setStatus(e.message)
    } finally {
      btn.disabled = false
    }
  }

  await renderHistory(store)
}

export async function renderHistory(store) {
  const el = document.getElementById('history')
  if (!el) return
  try {
    const files = await store.list(store.username)
    if (!files.length) {
      el.innerHTML = '<p style="color:#888">No submissions yet.</p>'
      return
    }
    const entries = await Promise.all(
      files.map(async f => ({ path: f.path, data: await store.read(f.path) }))
    )
    const latestPath = entries[entries.length - 1].path
    el.innerHTML = `<table>
      <thead><tr><th>Time</th><th>Dish</th><th>Note</th><th></th></tr></thead>
      <tbody>
        ${entries.map(e => {
          const time = new Date((e.path.split('/').pop() ?? '').replace('.json','')
            .replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'))
            .toLocaleTimeString()
          const isCurrent = e.path === latestPath
          return `<tr${isCurrent ? ' style="font-weight:bold"' : ''}>
            <td>${time}</td>
            <td>${esc(e.data?.dish ?? '—')}</td>
            <td>${esc(e.data?.note ?? '')}</td>
            <td>${isCurrent ? '← current' : ''}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
  } catch(e) {
    el.innerHTML = `<p class="err">Could not load history: ${e.message}</p>`
  }
}

// stub — implemented in GitHub experience improvements plan
export function renderOnboardingGate(repoParam) {}
```

- [ ] **Step 2: Verify source match**

Compare against `renderParticipant` (lines 229–299) and `renderHistory` (lines 301–334) in `index.html`. Confirm:
- All HTML template strings are identical
- Event handler logic is identical
- The only differences are: `repoParam` and `inviteParam` are now parameters, not globals; `import` statements added at top

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/participant.js
git commit -m "refactor(potluck): extract renderParticipant/renderHistory to participant.js"
```

---

### Task 5: Create organizer.js

**Files:**
- Create: `apps/potluck/organizer.js`

Moves `renderOrganizer` and `renderOrganizerDashboard` from `index.html`.

Key changes from the original:
- `renderOrganizer(store)` → `renderOrganizer(store, repoParam)` — `repoParam` received as argument; forwarded to `renderOrganizerDashboard`
- `renderOrganizerDashboard(store, app)` → `renderOrganizerDashboard(store, repoParam)` — `app` param dropped; gets DOM element internally via `document.getElementById('app')`
- `setInterval(refreshTable, 30_000)` is **unchanged** — do not replace with `startPolling`

- [ ] **Step 1: Create `organizer.js`**

```js
import { GitHubStore } from '../../lib/github-store.js'
import { esc, setStatus } from './helpers.js'

export async function renderOrganizer(store, repoParam) {
  const app = document.getElementById('app')

  if (store._repoFullName) {
    await renderOrganizerDashboard(store, repoParam)
    return
  }

  const recent = GitHubStore.getRecentRepos()
  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">Signed in as <strong>${esc(store.username)}</strong></p>

    <div class="section">
      <strong>Create new event</strong>
      <label>Event name
        <input id="event-name" type="text"
          value="potluck-${new Date().toISOString().slice(0,10)}" />
      </label>
      <button id="create-btn">Create</button>
    </div>

    ${recent.length ? `
    <hr>
    <div class="section">
      <strong>Resume recent event</strong>
      <ul style="margin:0.5rem 0;padding-left:1.2rem">
        ${recent.map(r => `<li><a href="?mode=organizer&repo=${encodeURIComponent(r)}">${esc(r)}</a></li>`).join('')}
      </ul>
    </div>` : ''}
    <div id="status"></div>
  `

  document.getElementById('create-btn').onclick = async () => {
    const name = document.getElementById('event-name').value.trim()
    if (!name) { setStatus('Event name required'); return }
    setStatus('Creating...', false)
    try {
      await store.createSpace(name)
      await renderOrganizerDashboard(store, repoParam)
    } catch(e) { setStatus(e.message) }
  }
}

export async function renderOrganizerDashboard(store, repoParam) {
  const app = document.getElementById('app')
  const patUrl = `https://github.com/settings/personal-access-tokens/new`
    + `?description=potluck-invite-${encodeURIComponent(store._repoFullName?.split('/')[1] ?? '')}`
  const joinBase = `${location.origin}${location.pathname}`
    + `?mode=participant&repo=${store._repoFullName}`

  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">
      Signed in as <strong>${esc(store.username)}</strong> &nbsp;·&nbsp;
      <strong>${esc(store._repoFullName)}</strong>
    </p>

    <div class="section">
      <strong>Share join link</strong>
      <ol style="font-size:0.9rem;line-height:2">
        <li>Create an invite token:
          <a href="${patUrl}" target="_blank">→ GitHub PAT (administration:write, this repo only)</a>
        </li>
        <li>Paste it here:
          <input id="pat-input" type="text" placeholder="ghp_..." style="display:inline;width:260px" />
        </li>
        <li>
          <button id="copy-btn" disabled>Copy join link</button>
          <span id="link-preview" style="font-size:0.8rem;color:#666;margin-left:0.5rem"></span>
        </li>
      </ol>
      <p style="font-size:0.8rem;color:#c00;margin-top:0.5rem">
        ⚠ This link contains a secret token. Anyone with it can join the event.
        Revoke the token at GitHub after the signup window closes.
      </p>
    </div>

    <hr>

    <div class="section">
      <strong>Responses</strong>
      <span style="font-size:0.8rem;color:#888"> (refreshes every 30s)</span>
      <div id="responses-table">Loading...</div>
    </div>
    <div id="status"></div>
  `

  const patInput = document.getElementById('pat-input')
  const copyBtn  = document.getElementById('copy-btn')
  const preview  = document.getElementById('link-preview')

  patInput.addEventListener('input', () => {
    const val = patInput.value.trim()
    copyBtn.disabled = !val
    const full = `${joinBase}&invite=${val}`
    preview.textContent = val ? (full.length > 70 ? full.slice(0, 70) + '…' : full) : ''
  })

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(`${joinBase}&invite=${patInput.value.trim()}`)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => { copyBtn.textContent = 'Copy join link' }, 2000)
  }

  async function refreshTable() {
    const el = document.getElementById('responses-table')
    if (!el) return
    try {
      const participants = await store.readAll()
      if (!participants.length) {
        el.innerHTML = '<p style="color:#888;margin-top:0.5rem">No responses yet.</p>'
        return
      }
      el.innerHTML = `<table>
        <thead><tr><th>Participant</th><th>Dish</th><th>Note</th><th>Time</th></tr></thead>
        <tbody>
          ${participants.map(p => {
            const last = p.entries[p.entries.length - 1]
            const time = last
              ? new Date((last.path.split('/').pop() ?? '').replace('.json','')
                  .replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'))
                .toLocaleTimeString()
              : '—'
            return `<tr>
              <td>${esc(p.username)}</td>
              <td>${esc(p.latest?.dish ?? '—')}</td>
              <td>${esc(p.latest?.note ?? '')}</td>
              <td>${time}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>`
    } catch(e) {
      const el2 = document.getElementById('responses-table')
      if (el2) el2.innerHTML = `<p class="err">Error: ${e.message}</p>`
    }
  }

  await refreshTable()
  setInterval(refreshTable, 30_000)
}
```

- [ ] **Step 2: Verify source match**

Compare against `renderOrganizer` (lines 85–127) and `renderOrganizerDashboard` (lines 129–225) in `index.html`. Confirm:
- All HTML template strings are identical
- PAT URL construction and join link logic are identical
- `setInterval(refreshTable, 30_000)` is present and unchanged
- The only differences are: `repoParam` parameter added; `app` param removed from `renderOrganizerDashboard`; `app` obtained via `document.getElementById('app')` inside both functions; `import` statements at top

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/organizer.js
git commit -m "refactor(potluck): extract renderOrganizer/renderOrganizerDashboard to organizer.js"
```

---

### Task 6: Create main.js

**Files:**
- Create: `apps/potluck/main.js`

Moves config constants, URL param parsing, `main()`, and the top-level `.catch()` from `index.html`. Imports all render functions from sibling modules.

Key changes from the original:
- `mode`, `repoParam`, `inviteParam` are still parsed here from `location.search` — but now passed as arguments to render functions rather than accessed as globals
- `main()` dispatches to `renderParticipant` or `renderOrganizer` with explicit params
- `observer` mode is wired up (calls `renderObserver(repoParam)`) even though the function is a stub

- [ ] **Step 1: Create `main.js`**

```js
import { GitHubStore } from '../../lib/github-store.js'
import { renderOrganizer } from './organizer.js'
import { renderParticipant } from './participant.js'
import { renderObserver } from './observer.js'

// ── CONFIG ────────────────────────────────────────────────────────────────
// Register a GitHub OAuth App at github.com/settings/developers
// Callback URL must match the URL where this file is served.
// Note these are just placeholders, this client does not exist
const CLIENT_ID     = 'Ov23lihjQ0R8Ms2wJBWM'
const CLIENT_SECRET = 'e01faf5fc2d09c675090f8109cccf5e0edf6664b'  // ⚠ exposed in client — see D1 in design spec
// Local dev: run `npm run proxy` then set to 'http://localhost:8080'
// Production: deploy a Cloudflare Worker (see D2 in design spec)
const CORS_PROXY    = 'http://localhost:8080'
// ─────────────────────────────────────────────────────────────────────────

const params      = new URLSearchParams(location.search)
const mode        = params.get('mode')     // 'organizer' | 'participant' | 'observer'
const repoParam   = params.get('repo')
const inviteParam = params.get('invite')

async function main() {
  if (mode === 'observer') {
    await renderObserver(repoParam)
    return
  }

  const store = await GitHubStore.init({
    clientId:     CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    corsProxy:    CORS_PROXY,
    repoFullName: repoParam,
    inviteToken:  inviteParam,
  })
  if (!store) return  // redirecting to GitHub

  if (mode === 'participant') {
    await renderParticipant(store, repoParam, inviteParam)
  } else {
    await renderOrganizer(store, repoParam)
  }
}

main().catch(e => {
  document.getElementById('app').innerHTML =
    `<p class="err">Startup error: ${e.message}</p>`
  console.error(e)
})
```

- [ ] **Step 2: Verify source match**

Compare against the constants block (lines 29–37), `main()` (lines 66–81), and the `.catch()` call (lines 336–340) in `index.html`. Confirm:
- Config constants are identical (`CLIENT_ID`, `CLIENT_SECRET`, `CORS_PROXY`)
- URL param parsing is identical
- The `.catch()` handler is identical
- The `mode === 'observer'` branch is **new** — it has no counterpart in the original file. This is expected: the spec requires wiring up the `renderObserver` stub so `observer` mode is routable from the start.

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/main.js
git commit -m "refactor(potluck): extract config/params/main entry point to main.js"
```

---

### Task 7: Strip index.html to shell (atomic switchover)

**Files:**
- Modify: `apps/potluck/index.html`

This is the only step that modifies existing code. After this commit the app runs entirely from the new modules. The original `<style>` and `<script type="module">` blocks are deleted and replaced with a `<link>` and a `<script src>`.

- [ ] **Step 1: Replace `index.html` with the shell**

Write the following as the complete new content of `apps/potluck/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potluck</title>
  <link rel="stylesheet" href="potluck.css">
</head>
<body>
  <div id="app">Authenticating...</div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Start the dev server**

```bash
npx serve .
```

Expected: server starts on `http://localhost:3000` (or as configured by `serve.json`). Open the URL in a browser.

- [ ] **Step 3: Smoke test — organizer mode**

Navigate to `http://localhost:3000/apps/potluck/?mode=organizer`

Expected:
- Page shows "Authenticating..." briefly, then redirects to GitHub OAuth (or rehydrates if already logged in)
- After auth: "Potluck Organizer" heading visible
- Styles applied (max-width, fonts, spacing match the original)
- No JavaScript errors in DevTools console

- [ ] **Step 4: Smoke test — participant mode**

Navigate to `http://localhost:3000/apps/potluck/?mode=participant&repo=<owner>/<repo>`

Expected:
- Redirects to GitHub OAuth if no session token
- After auth: "Potluck" heading, event name shown, join flow proceeds
- No JavaScript errors in DevTools console

- [ ] **Step 5: Verify no regressions in DevTools**

Open DevTools → Network tab. Confirm:
- `potluck.css` loads (HTTP 200)
- `main.js` loads (HTTP 200)
- `organizer.js`, `participant.js`, `helpers.js` load as ES module imports (HTTP 200)
- No 404s for any module

- [ ] **Step 6: Commit**

```bash
git add apps/potluck/index.html
git commit -m "refactor(potluck): strip index.html to shell; wire up potluck.css and main.js"
```

---

## Smoke Test Summary

| Scenario | How to verify |
|---|---|
| Organizer creation form | `?mode=organizer` — form renders, "Create" button present |
| Organizer dashboard | `?mode=organizer&repo=<owner>/<repo>` — responses table + PAT section render |
| Participant join flow | `?mode=participant&repo=<r>&invite=<pat>` — join status shows "joined ✓" |
| Participant submission | Fill dish + note, click Submit — submission appears in history table |
| CSS applied | Font, max-width, button styles, table styles all match original |
| No console errors | DevTools shows no uncaught exceptions |
| All modules load | Network tab shows 200 for each `.js` file |
