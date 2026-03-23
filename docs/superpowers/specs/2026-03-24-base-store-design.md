# BaseStore Abstract Class — Design Spec

**Date:** 2026-03-24
**Scope:** Introduce `BaseStore` as the abstract base for all AnyTrunk store implementations. Enforce the provider contract via inheritance, eliminate static method calls from app code, and unify the `init()` return contract across all stores.

---

## Background

The multi-backend spec (2026-03-23) established `GoogleDriveStore` alongside `GitHubStore` and introduced a shared capability contract. That spec defined static UI utilities (`hasToken()`, `getRecentSpaces()`, etc.) as required methods on each store class, but provided no enforcement mechanism. It also left `AnyTrunk.init()` unable to route `WorkerGitHubStore`, and left app code calling static methods on specific store classes after init — defeating the goal of backend-agnostic app code.

This spec adds `BaseStore` to enforce the contract, eliminates post-init static calls from app code, and removes `AnyTrunk.init()` in favour of direct class imports.

---

## Goals

1. Introduce `lib/base-store.js` as the abstract base all stores must extend.
2. Enforce the provider contract at definition time (throwing stubs), not at runtime.
3. Eliminate all store-class references from app code after the `init()` call.
4. Unify the `init()` return contract: one pattern across all stores.
5. Apply consistent naming: data-returning methods use `getX()`.
6. Delete `lib/anytrunk.js` — no longer needed.

---

## Non-goals

- Multiple authenticated users per store class per session (see Known Limitations).
- Plugin/registry system for dynamic store registration.
- Any changes to the capability tiers or `lib/capabilities.js` beyond renaming `capabilities()` → `getCapabilities()`.

---

## File Changes

### New files

| File | Role |
|---|---|
| `lib/base-store.js` | Abstract base class for all AnyTrunk stores. |

### Updated files

| File | Change |
|---|---|
| `lib/github-store.js` | Extend `BaseStore`. Rename `_repoFullName` → `_spaceId`. Add `get userId()`. Rename `capabilities()` → `getCapabilities()`. Remove `hasToken()`, `saveRecentSpace`, `getRecentSpaces` (last two inherited). Rename `onboardingUrl`/`onboardingHint`. Update `init()` signature and return contract. |
| `lib/github-store-worker.js` | Rename `getCapabilities()`. Remove `hasToken()`. Update `init()` return contract. Rename `this._repoFullName` → `this._spaceId` in `register()` and `join()`. Update `saveRecentSpace` call to `this.constructor.saveRecentSpace(id)`. |
| `lib/google-drive-store.js` | Extend `BaseStore`. Rename `_folderId` → `_spaceId` throughout. Add `get userId()`. Rename `getCapabilities()`, `getOnboardingUrl()`, `getOnboardingHint()`. Remove `hasToken()`, `saveRecentSpace`, `getRecentSpaces` (last two inherited). Override `setSpace()` to persist to sessionStorage. Update `init()` signature and return contract. |
| `lib/capabilities.js` | Update `store.capabilities()` → `store.getCapabilities()` inside `assertCapabilities`. |
| `apps/potluck/main.js` | Remove `hasToken()` pre-check. Handle `{ status: 'onboarding' }` from `init()`. |
| `apps/potluck/participant.js` | Update `renderOnboardingGate` signature to accept `{ url, hint }` result object instead of store-specific config. |
| `apps/gifts/main.js` | Remove `hasToken()` pre-check. Handle `{ status: 'onboarding' }` from `init()`. |
| `apps/gifts/participant.js` | Update `renderOnboardingGate` signature to accept `{ url, hint }` result object. |
| `apps/gifts/main-drive.js` | Remove static `getRecentSpaces()` call → `store.getRecentSpaces()`. Replace `store._folderId =` → `store.setSpace()`. Add `{ status: 'onboarding' }` handling for participant mode. |

### Deleted files

| File | Reason |
|---|---|
| `lib/anytrunk.js` | Replaced by direct class imports. Base class contract makes the routing layer redundant. |

---

## `lib/base-store.js`

```js
export class BaseStore {

  // ── Shared state ──────────────────────────────────────────────────────────
  _spaceId = null

  // ── Shared implementations ────────────────────────────────────────────────
  setSpace(id) { this._spaceId = id }

  getRecentSpaces() {
    return JSON.parse(localStorage.getItem(`${this.constructor._storageKey}:recentSpaces`) ?? '[]')
  }

  static saveRecentSpace(id) {
    const key     = `${this._storageKey}:recentSpaces`
    const updated = [id, ...JSON.parse(localStorage.getItem(key) ?? '[]').filter(s => s !== id)].slice(0, 5)
    localStorage.setItem(key, JSON.stringify(updated))
  }

  // ── Required overrides ────────────────────────────────────────────────────
  static get _storageKey() { throw new Error(`${this.name} must declare static _storageKey`) }

  static async init(config)     { throw new Error(`${this.name}.init() not implemented`) }
  static getOnboardingUrl()     { throw new Error(`${this.name}.getOnboardingUrl() not implemented`) }
  static getOnboardingHint()    { throw new Error(`${this.name}.getOnboardingHint() not implemented`) }

  get userId()                  { throw new Error(`${this.constructor.name}.userId not implemented`) }

  getCapabilities()             { throw new Error('not implemented') }
  async read(path)              { throw new Error('not implemented') }
  async readAll()               { throw new Error('not implemented') }
  async append(data, opts)      { throw new Error('not implemented') }
  async write(path, data)       { throw new Error('not implemented') }
  async createSpace(name, opts) { throw new Error('not implemented') }
  async join(spaceId, opts)     { throw new Error('not implemented') }
  async deleteSpace()           { throw new Error('not implemented') }
}
```

### Shared implementations

**`setSpace(id)`** — sets `this._spaceId` in memory only. Lightweight sync operation; no network call. Distinct from `join()` which verifies access. Used by the organizer flow to switch the active space without re-joining.

Stores that must also persist the space to sessionStorage (currently `GoogleDriveStore`) override `setSpace()`:

```js
// GoogleDriveStore override
setSpace(id) {
  super.setSpace(id)
  if (id) sessionStorage.setItem('gd:folderId', id)
  else    sessionStorage.removeItem('gd:folderId')
}
```

`init()` Branch 2 (rehydration) continues to read from sessionStorage directly — `setSpace()` is for runtime changes only.

**`getRecentSpaces()`** — reads from `localStorage` under `${_storageKey}:recentSpaces`. Instance method; uses `this.constructor._storageKey` so it always reads the correct namespace for the concrete class.

**`static saveRecentSpace(id)`** — writes to the same key. Called internally by `createSpace()` and `join()` on each store. Apps do not call this directly.

**Calling convention:** inside instance methods, always call `this.constructor.saveRecentSpace(id)` — never `BaseStore.saveRecentSpace(id)` or a hardcoded subclass name. This ensures the correct `_storageKey` is used regardless of subclassing depth.

### Storage key safety

`_storageKey` is defined as a throwing static getter on `BaseStore`. Any subclass that forgets to declare `static _storageKey = '...'` will throw on first use of `getRecentSpaces()` or `saveRecentSpace()` — loud failure at dev time, not silent data corruption.

Each store declares a unique short prefix:
- `GitHubStore`: `static _storageKey = 'gh'`
- `GoogleDriveStore`: `static _storageKey = 'gd'`

### Optional capabilities

`closeSubmissions`, `archiveSpace`, and `addCollaborator` are **not** stubbed on `BaseStore`. They are optional capabilities — stores that implement them declare them in `getCapabilities()`. Apps guard calls with `store.getCapabilities()` before invoking.

### `list()` — not part of the base contract

`GitHubStore` exposes a public `list(prefix)` method used internally. `GoogleDriveStore` has no equivalent public method (listing is internal). `list()` is not added to `BaseStore` and is not part of the provider contract. Apps that call `list()` directly are using a `GitHubStore`-specific API and must import `GitHubStore` accordingly.

---

## `init()` Return Contract

All stores follow the same signature and return one of four outcomes from `init()`:

```js
static async init({ ..., mode = null } = {})
```

| Situation | Return value |
|---|---|
| OAuth callback in URL (`?code=`) | `null` — store completes auth and redirects away |
| Already authenticated | `store` — fully initialised `BaseStore` instance |
| Not authenticated + `mode: 'participant'` | `{ status: 'onboarding', url, hint }` |
| Not authenticated + organizer flow | `null` — redirects directly to OAuth |

The `onboarding` branch triggers only when `init()` receives `{ mode: 'participant' }`. Without it, unauthenticated calls redirect to OAuth immediately (existing behaviour preserved).

### App-side pattern

```js
const result = await StoreClass.init({ ...config, mode })
if (!result) return                          // null: redirecting to OAuth
if (result.status === 'onboarding') {
  renderOnboardingGate(repoParam, result)    // result.url, result.hint
  return
}
const store = result                         // BaseStore instance — no class name needed again
```

`renderOnboardingGate` receives the result object for `url` and `hint`. The `repoParam` argument is retained where the UI needs to display the space name/ID in the onboarding screen — its presence depends on the app. Store-specific config (`clientId`, `workerUrl`, `clientSecret`, `corsProxy`) is no longer passed.

Since `potluck/main.js` uses `GitHubStore` and `gifts/main.js` uses `WorkerGitHubStore`, the import line and config object differ per app — the pattern above is identical, only those two details change.

---

## Naming Convention

All methods that return data use `getX()`:

| Old name | New name |
|---|---|
| `onboardingUrl()` | `getOnboardingUrl()` |
| `onboardingHint()` | `getOnboardingHint()` |
| `capabilities()` | `getCapabilities()` |
| `getRecentSpaces()` | unchanged ✓ |

`userId` is a property getter (`get userId()`), not a method — idiomatic JS for a simple field-backed value.

---

## Store-Specific Changes

### `GitHubStore`

- `extends BaseStore`
- `static _storageKey = 'gh'`
- `this._repoFullName` renamed to `this._spaceId` throughout
- `get userId()` returns `this._username`
- `hasToken()` removed — logic absorbed into `init()`
- `saveRecentSpace` / `getRecentSpaces` removed (inherited from `BaseStore`)
- All hardcoded `GitHubStore.saveRecentSpace(...)` calls in `join()` updated to `this.constructor.saveRecentSpace(...)`
- `onboardingUrl()` → `getOnboardingUrl()`, `onboardingHint()` → `getOnboardingHint()`
- `capabilities()` → `getCapabilities()`
- `init()` updated: accepts `{ mode }`, returns `{ status: 'onboarding', url: GitHubStore.getOnboardingUrl(), hint: GitHubStore.getOnboardingHint() }` when `mode === 'participant'` and no token

### `WorkerGitHubStore` *(extends `GitHubStore`)*

- `getCapabilities()` rename only
- `hasToken()` removed
- `init()` updated for same onboarding return contract
- `this._repoFullName` renamed to `this._spaceId` in `register()` and `join()`
- Internal `saveRecentSpace` call updated to `this.constructor.saveRecentSpace(id)`

### `GoogleDriveStore`

- `extends BaseStore`
- `static _storageKey = 'gd'`
- `this._folderId` renamed to `this._spaceId` throughout (including `_subfolderFor`, `createSpace`, `join`, `readAll`, `addCollaborator`, `archiveSpace`, `deleteSpace`, `read`, `write`)
- The `sessionStorage` key `'gd:folderId'` is **retained unchanged** to avoid breaking existing sessions. The field name changes; the storage key does not.
- `setSpace(id)` overridden to also write/remove `'gd:folderId'` in sessionStorage (see base-store section above)
- `get userId()` returns `this._userEmail`
- `hasToken()` removed — logic absorbed into `init()`
- `saveRecentSpace` / `getRecentSpaces` removed (inherited from `BaseStore`)
- All hardcoded `GoogleDriveStore.saveRecentSpace(...)` calls in `createSpace()` and `join()` updated to `this.constructor.saveRecentSpace(...)`
- `onboardingUrl()` → `getOnboardingUrl()`, `onboardingHint()` → `getOnboardingHint()`
- `capabilities()` → `getCapabilities()`
- `init()` updated: accepts `{ mode }`, returns onboarding sentinel for participant flow

---

## App Changes

### `apps/potluck/main.js`

Remove the `hasToken()` pre-check block and replace with unified result handling:

```js
// BEFORE
if (!GitHubStore.hasToken() && !hasCode) {
  renderOnboardingGate(repoParam, { clientId, clientSecret, corsProxy })
  return
}
const store = await GitHubStore.init({ clientId, clientSecret, corsProxy, repoFullName: repoParam })
if (!store) return

// AFTER
const result = await GitHubStore.init({ clientId, clientSecret, corsProxy, repoFullName: repoParam, mode })
if (!result) return
if (result.status === 'onboarding') {
  renderOnboardingGate(repoParam, result)
  return
}
const store = result
```

### `apps/gifts/main.js`

Same pattern, different class and config:

```js
// BEFORE
if (!WorkerGitHubStore.hasToken() && !hasCode) {
  renderOnboardingGate(repoParam, { clientId, workerUrl })
  return
}
const store = await WorkerGitHubStore.init({ clientId, workerUrl, repoFullName: repoParam })
if (!store) return

// AFTER
const result = await WorkerGitHubStore.init({ clientId, workerUrl, repoFullName: repoParam, mode })
if (!result) return
if (result.status === 'onboarding') {
  renderOnboardingGate(repoParam, result)
  return
}
const store = result
```

### `apps/gifts/main-drive.js`

Three changes plus onboarding handling:

```js
// BEFORE (init)
const store = await GoogleDriveStore.init({ clientId, clientSecret })
if (!store) return

// AFTER (init)
const result = await GoogleDriveStore.init({ clientId, clientSecret, mode })
if (!result) return
if (result.status === 'onboarding') {
  renderOnboardingGate(null, result)
  return
}
const store = result
```

```js
// BEFORE (organizer space restore)
const recentSpaces = GoogleDriveStore.getRecentSpaces()
let activeSpace    = spaceParam ?? recentSpaces[0] ?? null
if (activeSpace) store._folderId = activeSpace

// AFTER
const recentSpaces = store.getRecentSpaces()
let activeSpace    = spaceParam ?? recentSpaces[0] ?? null
if (activeSpace) store.setSpace(activeSpace)
```

After these changes, each `main*.js` references its store class exactly twice: the `import` line and the `init()` call.

### `apps/potluck/participant.js` and `apps/gifts/participant.js`

`renderOnboardingGate` signature updated from store-specific config to the `init()` result object:

```js
// BEFORE
function renderOnboardingGate(repoParam, { clientId, workerUrl }) { ... }

// AFTER
function renderOnboardingGate(repoParam, { url, hint }) { ... }
```

---

## `lib/capabilities.js`

One change: `store.capabilities()` → `store.getCapabilities()` inside `assertCapabilities`.

---

## Known Limitations

| # | Issue |
|---|---|
| L1 | One authenticated user per store class per session. Two instances of the same store class share sessionStorage auth keys (`gh:token`, `gd:token`, etc.). Running two separate GitHub-authenticated users simultaneously in one page is not supported. |
| L2 | `_storageKey` uniqueness is enforced by convention, not by the framework. Two stores that choose the same prefix would silently share their `recentSpaces` list. |
| L3 | `WorkerGitHubStore` is not routable via a provider string. Apps that need the Worker backend import it directly. A provider registry should be designed when a third backend is introduced. |
| L4 | `binaryData: true` is declared in `getCapabilities()` for both stores but `GoogleDriveStore` currently only handles JSON. The flag signals intent for Spec 2 (scavenger hunt). Apps must not gate binary upload features on this flag until the method surface is defined. |
