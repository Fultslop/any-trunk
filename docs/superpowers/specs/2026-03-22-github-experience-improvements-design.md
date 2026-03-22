# GitHub Experience Improvements — Design Spec

**Date:** 2026-03-22  
**Status:** Approved

---

## Overview

Improve the GitHub backend experience across all three roles — app dev, organizer, participant — without requiring the Cloudflare Worker (D1–D3). Changes are layered: library API first, then app UX, then small fixes. Each step has a smoke test.

### Roles

| Role | Technical level | Notes |
|---|---|---|
| App dev | High | Deploys CORS proxy, registers OAuth app |
| Organizer | Low–medium | Starts, monitors, and ends sessions |
| Participant | Low | Joins via invite link |

### Deferred items this spec does NOT address

| # | Item | Addressed by |
|---|---|---|
| D1 | `clientSecret` in client code | Cloudflare Worker |
| D2 | Public CORS proxy | Cloudflare Worker |
| D3 | PAT creation eliminated entirely | Cloudflare Worker |

---

## Layer 1 — Library API additions (`lib/github-store.js`)

### 1.1 Public space option

`createSpace()` already accepts `{ private: true }`. Add `{ private: false }` as a valid option. Public repos are readable via the GitHub API without authentication.

```js
await store.createSpace('my-event', { private: false })
```

### 1.2 Session lifecycle methods

Three new organizer-only methods. The app enforces that these are only called by the organizer; the library does not.

```js
// Soft close — writes closed:true to _event.json
await store.closeSubmissions()

// Read-only — calls PATCH /repos/{owner}/{repo} with { archived: true }
await store.archiveSpace()

// Permanent teardown — calls DELETE /repos/{owner}/{repo}
await store.deleteSpace()
```

**`closeSubmissions()` detail:** Reads the current `_event.json`, merges `{ closed: true }`, and writes it back. Idempotent.

**`archiveSpace()` detail:** Requires the organizer's token to have `repo` scope (already granted by the OAuth flow). Archived repos reject all write attempts at the GitHub layer.

**`closeSubmissions()` on an already-archived repo:** The sequential unlock UI in section 2.1 is the sole guard — "Lock event" only appears after "Close submissions" succeeds. The library itself does not check archive state; if called on an archived repo, the underlying `read` + `write` sequence will fail with a GitHub 403, which propagates as a thrown error.

**`archiveSpace()` error surface:** Requires `repo` scope (already granted). Non-organizer tokens receive a GitHub 403, which the library propagates as a thrown error. No library-level permission pre-check is added.

**`deleteSpace()` detail:** Requires `delete_repo` scope. This scope must be added to the OAuth app's requested scopes. **Breaking change for existing OAuth apps** — document clearly in app dev release notes. If called without this scope, GitHub returns 403; the library catches it and throws: `"Cannot delete repo: your OAuth token is missing the 'delete_repo' scope. Re-authorise the app to grant this permission."`. App devs must verify this scope is being requested by opening the OAuth authorisation URL and confirming `delete_repo` appears in the permissions list.

### 1.3 Read-only init

```js
const store = await GitHubStore.initReadOnly({ repoFullName })
```

No `corsProxy` parameter — `api.github.com` supports CORS for unauthenticated GET requests in the browser. The proxy is only required for OAuth token exchange, which `initReadOnly()` never performs.

Returns a `GitHubStore` instance with no token. Read operations (`read`, `readAll`, `list`) work normally on public repos. Any write operation (`write`, `append`, `closeSubmissions`, etc.) throws immediately with a clear message: `"This store is read-only. initReadOnly() does not support write operations."`.

When `token` is null, `_apiCall` must omit the `Authorization` header entirely so that requests are genuinely unauthenticated. A `Bearer null` header is malformed and may cause GitHub to reject otherwise-public requests.

Works only on public repos. On a 404 response (which the GitHub API returns for both private repos and non-existent repos when unauthenticated), throws: `"Repo not found or is private. Use GitHubStore.init() to access private repos."` The library cannot distinguish the two cases without authentication.

### 1.4 Auth state helper

```js
GitHubStore.hasToken()  // → boolean
```

Static method. Returns `true` if a token is present in `sessionStorage` (key `gh:token`). Does not make any network call and does not trigger an OAuth redirect. Used by the participant app to decide whether to show the onboarding gate before calling `init()`. If the stored token is stale or revoked, `hasToken()` returns `true` but the subsequent `init()` call will receive a 401 from GitHub and fall through to `beginAuth()` — the existing auth retry path already handles this without additional error handling in the app.

### 1.5 Onboarding helpers

```js
GitHubStore.onboardingUrl()
// → 'https://github.com/signup'

GitHubStore.onboardingHint()
// → 'You\'ll need a free GitHub account. Google sign-in is supported on the signup page.'
```

Static methods — no instance required. App owns the UI; library provides the backend-specific strings. These exist so multi-backend apps can call `BackendStore.onboardingUrl()` without knowing which backend is active.

---

### Layer 1 smoke tests

| Test | Expected |
|---|---|
| `createSpace('x', { private: false })` | Unauthenticated `GET /repos/{owner}/x` returns 200 |
| `closeSubmissions()` | `_event.json` contains `closed: true` |
| `archiveSpace()` — archived state | `GET /repos/{owner}/{repo}` returns `"archived": true` |
| `archiveSpace()` — write rejected | Call `write('test.json', {})` after archiving; throws with GitHub API 403 (no library-level pre-check) |
| `deleteSpace()` with correct scope | Repo deleted; GitHub returns 204 |
| `deleteSpace()` without `delete_repo` scope | Throws with message referencing missing `delete_repo` scope |
| `initReadOnly({ repoFullName })` on public repo | `readAll()` returns data; `write()` throws with read-only message |
| `initReadOnly({ repoFullName })` on private or missing repo | Throws with "Repo not found or is private" message |
| `GitHubStore.hasToken()` with token in sessionStorage | Returns `true` |
| `GitHubStore.hasToken()` with no token | Returns `false` |
| `GitHubStore.onboardingUrl()` | Returns `'https://github.com/signup'` |
| `GitHubStore.onboardingHint()` | Returns non-empty string mentioning Google sign-in |

---

## Layer 2 — Potluck app UX (`apps/potluck/index.html`)

### 2.1 Organizer lifecycle controls

Three buttons added to the organizer dashboard below the responses table. Each is shown only when the previous stage is complete — they unlock sequentially.

```
[Close submissions]  →  [Lock event]  →  [Delete event]
```

**Close submissions:**
- Calls `store.closeSubmissions()`
- Button label changes to "Submissions closed ✓" and becomes disabled
- A banner appears above the participant form: "Submissions are closed. No new entries are being accepted."

**Lock event:**
- Shown only after submissions are closed
- Confirmation dialog: "This will archive the event on GitHub, making it permanently read-only. You will not be able to reopen submissions. Continue?"
- On confirm: calls `store.archiveSpace()`
- Button becomes "Event locked ✓" and is disabled

**Delete event:**
- Shown only after event is locked
- Confirmation dialog requires the organizer to type the event name: "Type `{repoName}` to confirm permanent deletion."
- On match: calls `store.deleteSpace()`
- On success: clears localStorage entry for this repo, redirects organizer to `?mode=organizer` with no `repo` param (the event creation form state)
- On failure (e.g. missing `delete_repo` scope): organizer stays on the page; an error banner appears with the thrown error message; the typed repo-name input is cleared and the Delete button resets (forcing re-confirmation before any retry)

### 2.2 Participant onboarding gate

When a participant opens an invite link (`?mode=participant&repo=...&invite=...`), the app must show the onboarding gate **before** calling `GitHubStore.init()`. The current `init()` immediately redirects unauthenticated users to GitHub OAuth, so the gate would never render if `init()` is called first.

**Revised participant app initialisation flow:**
1. Check `GitHubStore.hasToken()` and whether `?code=` is in the URL
2. If either is true → call `GitHubStore.init()` normally (rehydration or code-exchange path)
3. If both are false → render the onboarding gate; do NOT call `init()` yet
4. User clicks "Yes, sign in" → call `GitHubStore.init()` → triggers OAuth redirect
5. User clicks "No, create a free account" → show hint + signup link; stay on page

**Gate UI:**

```
┌─────────────────────────────────────────┐
│  You've been invited to a Potluck event │
│                                         │
│  Do you have a GitHub account?          │
│                                         │
│  [Yes, sign in with GitHub]             │
│  [No, create a free account]            │
└─────────────────────────────────────────┘
```

- **Yes:** proceeds to the existing OAuth flow, unchanged.
- **No:** shows `GitHubStore.onboardingHint()` text and a link to `GitHubStore.onboardingUrl()`. After account creation, the participant returns to the same invite URL — the join flow is idempotent and proceeds normally.

If the participant is already authenticated (token in sessionStorage), skip the gate entirely.

### 2.3 Observer mode

New URL parameter: `?mode=observer&repo={owner}/{repo}`

- Calls `GitHubStore.initReadOnly({ repoFullName })`
- Renders the organizer's submissions table (read-only, no lifecycle controls)
- Polls `readAll()` every 30s (same as organizer mode)
- No GitHub account required — works on public repos only
- If repo is private: shows "This event is private. You need an invitation to participate." — no silent failure
- If `_event.json` contains `closed: true`: renders the same "Submissions are closed" banner as the participant view, above the submissions table
- If repo is archived: the GitHub API still returns full read access; observer renders normally. The "Submissions closed" banner will be visible if `closed: true` was written before archiving (which the sequential unlock ensures)

---

### Layer 2 smoke tests

| Test | Expected |
|---|---|
| Organizer clicks "Close submissions" | Participant form replaced with closed banner; `_event.json` has `closed: true` |
| Organizer clicks "Lock event" | Confirmation dialog appears; after confirm, `archiveSpace()` called; button disabled |
| Organizer clicks "Delete event" — success | Name input required; on match repo deleted; organizer redirected to `?mode=organizer` with no repo param |
| Organizer clicks "Delete event" — missing scope | Error banner shown with missing-scope message; Delete button resets |
| Open invite link without session token and no `?code=` | Onboarding gate appears; no OAuth redirect occurs |
| "No" path on gate | `onboardingHint()` text and signup link shown; user stays on page |
| "Yes" path on gate | `GitHubStore.init()` called; OAuth redirect occurs |
| Return to invite URL after signup | `?code=` present → `init()` called → join flow proceeds normally |
| `?mode=observer` on public repo | Submissions table renders without auth; polls every 30s |
| `?mode=observer` on private repo | "This event is private" message shown |

---

## Layer 3 — Small fixes

### 3.1 Repo naming conflicts

`createSpace()` currently propagates a raw GitHub 422 error when the repo name is taken. Instead:
- Catch the 422
- Surface a clear message: `"An event named '{name}' already exists in your account. Try '{name}-2' or choose a different name."`
- Suggest the auto-incremented alternative (do not auto-create — let the organizer confirm)

### 3.2 Rate limiting

Two additions to the organizer and observer polling loops:

- **Page Visibility API:** pause `readAll()` polling when `document.visibilityState === 'hidden'`; resume on `visibilitychange` to `'visible'`
- **429 handling:** on a 429 response from any GitHub API call, back off for 60 seconds and show a non-alarming status line: "Refreshing paused briefly…"; resume automatically

### 3.3 Enhanced PAT creation guidance

After `createSpace()` succeeds, the organizer must create a Fine-Grained PAT to generate the invite link. Reduce this burden without changing the security model (no Classic PAT — all-repo access is not acceptable):

**Step-by-step in-app checklist** rendered alongside the GitHub tab, using the known repo name:

```
Create your invite token on GitHub:

 1. [ ] Click → [Open GitHub token page]   (links to github.com/settings/personal-access-tokens/new)
 2. [ ] Token name: [potluck-2026-03-22-invite]  [Copy]
 3. [ ] Expiration: 7 days
 4. [ ] Repository access: Only select repositories → {owner}/{repo-name}
 5. [ ] Permissions: Repository permissions → Administration → Read and write
 6. [ ] Click "Generate token" and copy it here:
         [______________________________] [Validate]
```

**Validate button:** on paste, calls `GET /repos/{owner}/{repo}` using the pasted token and checks that `response.permissions.admin === true`. This confirms the token has admin access on the specific repo. Three failure cases all map to the same user-facing message ("Token cannot access this repo — check steps 4 and 5"):
- Token lacks admin scope: `permissions.admin` is `false` or absent
- Token is scoped to a different repo: GitHub returns 404
- Token is invalid: GitHub returns 401

A 401 response (invalid or expired token) produces a distinct message: `"Token is invalid or expired — re-generate it at step 1."` All other failure cases (404 wrong repo, missing/false `permissions.admin`) map to: `"Token cannot access this repo — check steps 4 and 5."`

**PAT expiry reminder (existing, unchanged):** guidance text already planned in the invite link generation step: "Set this token to expire in 7 days — you can revoke it earlier from GitHub Settings when the event is over."

---

### Layer 3 smoke tests

| Test | Expected |
|---|---|
| `createSpace()` with existing name | Friendly error with suggested alternative; no raw API error |
| Switch to another tab during organizer polling | Network requests pause (visible in DevTools network tab); switch back → polling resumes |
| Switch to another tab during observer polling | Same pause/resume behaviour as organizer |
| Simulate 429 response | "Refreshing paused briefly…" shown; auto-resumes after 60s |
| Open PAT creation step | Checklist renders with repo name and suggested token name pre-filled |
| Paste valid PAT with correct repo + admin scope → Validate | `permissions.admin === true`; "Token valid ✓" shown; invite link generated |
| Paste PAT with wrong repo → Validate | GitHub returns 404; error referencing steps 4 and 5 |
| Paste PAT missing admin scope → Validate | `permissions.admin` absent or false; error referencing steps 4 and 5 |
| Paste invalid/expired token → Validate | GitHub returns 401; message says "Token is invalid or expired — re-generate it at step 1" |

---

## Scope boundaries

**In scope:**
- All items above

**Out of scope (deferred to Worker or future spec):**
- D1, D2, D3 (see top of doc)
- Participant removal from collaborators (requires Worker or manual GitHub action)
- Multiple simultaneous events per organizer
- Real-time updates (polling at 30s remains)
- Provider abstraction layer

---

## Implementation order

Layer 1 → Layer 2 → Layer 3. Each layer's smoke tests must pass before starting the next.
