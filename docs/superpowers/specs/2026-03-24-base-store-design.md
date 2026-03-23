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
| `lib/github-store.js` | Extend `BaseStore`. Rename `_repoFullName` → `_spaceId`. Add `get userId()`. Rename `capabilities()` → `getCapabilities()`. Remove `saveRecentSpace`/`getRecentSpaces` (inherited). Rename `onboardingUrl`/`onboardingHint`. Update `init()` return contract. |
| `lib/github-store-worker.js` | Rename `getCapabilities()`. Update `init()` return contract. Update `saveRecentSpace` call sites. |
| `lib/google-drive-store.js` | Extend `BaseStore`. Rename `_folderId` → `_spaceId`. Add `get userId()`. Rename `getCapabilities()`, `getOnboardingUrl()`, `getOnboardingHint()`. Remove `saveRecentSpace`/`getRecentSpaces` (inherited). Remove `hasToken()`. Update `init()` return contract. |
| `lib/capabilities.js` | Update `store.capabilities()` → `store.getCapabilities()` inside `assertCapabilities`. |
| `apps/potluck/main.js` | Remove `hasToken()` pre-check. Handle `{ status: 'onboarding' }` from `init()`. |
| `apps/gifts/main.js` | Same as potluck. |
| `apps/gifts/main-drive.js` | Remove `GoogleDriveStore.getRecentSpaces()` call → `store.getRecentSpaces()`. Replace `store._folderId =` → `store.setSpace()`. Handle `{ status: 'onboarding' }` from `init()`. |

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

**`setSpace(id)`** — sets `this._spaceId`. Lightweight sync operation; no network call. Distinct from `join()` which verifies access. Used by the organizer flow to switch the active space without re-joining.

**`getRecentSpaces()`** — reads from `localStorage` under `${_storageKey}:recentSpaces`. Instance method; uses `this.constructor._storageKey` so it always reads the correct namespace for the concrete class.

**`static saveRecentSpace(id)`** — writes to the same key. Called internally by `createSpace()` and `join()` on each store. Apps do not call this directly.

### Storage key safety

`_storageKey` is defined as a throwing static getter on `BaseStore`. Any subclass that forgets to declare `static _storageKey = '...'` will throw on first use of `getRecentSpaces()` or `saveRecentSpace()` — loud failure at dev time, not silent data corruption.

Each store declares a unique short prefix:
- `GitHubStore`: `static _storageKey = 'gh'`
- `GoogleDriveStore`: `static _storageKey = 'gd'`

### Optional capabilities

`closeSubmissions`, `archiveSpace`, and `addCollaborator` are **not** stubbed on `BaseStore`. They are optional capabilities — stores that implement them declare them in `getCapabilities()`. Apps guard calls with `store.getCapabilities()` before invoking.

---

## `init()` Return Contract

All stores return one of three values from `init()`:

| Situation | Return value |
|---|---|
| OAuth callback in URL (`?code=`) | `null` — store completes auth and redirects away |
| Already authenticated | `store` — fully initialised `BaseStore` instance |
| Not authenticated + `mode: 'participant'` | `{ status: 'onboarding', url, hint }` |
| Not authenticated + organizer flow | `null` — redirects directly to OAuth |

The `onboarding` branch triggers only when `init()` receives `{ mode: 'participant' }` in its config. Without it, unauthenticated calls redirect to OAuth immediately (existing behaviour preserved).

### App-side pattern

```js
// Each main*.js — store class mentioned only on these two lines:
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'

const result = await WorkerGitHubStore.init({ ...config, mode })
if (!result) return                          // null: redirecting to OAuth
if (result.status === 'onboarding') {
  renderOnboardingGate(result)               // result.url, result.hint
  return
}
const store = result                         // BaseStore instance — no class name needed again
```

`renderOnboardingGate` receives the result object directly. It no longer needs `clientId`, `workerUrl`, or any store-specific config — only `url` and `hint`.

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
- `saveRecentSpace` / `getRecentSpaces` removed (inherited from `BaseStore`)
- `onboardingUrl()` → `getOnboardingUrl()`, `onboardingHint()` → `getOnboardingHint()`
- `capabilities()` → `getCapabilities()`
- `init()` updated: returns `{ status: 'onboarding', url: GitHubStore.getOnboardingUrl(), hint: GitHubStore.getOnboardingHint() }` when `mode === 'participant'` and no token

### `WorkerGitHubStore` *(extends `GitHubStore`)*

- `getCapabilities()` rename only
- `init()` updated for same onboarding return contract
- Internal `saveRecentSpace` call updated (`WorkerGitHubStore.saveRecentSpace` → inherited via `this.constructor.saveRecentSpace`)

### `GoogleDriveStore`

- `extends BaseStore`
- `static _storageKey = 'gd'`
- `this._folderId` renamed to `this._spaceId` throughout
- `get userId()` returns `this._userEmail`
- `saveRecentSpace` / `getRecentSpaces` removed (inherited from `BaseStore`)
- `onboardingUrl()` → `getOnboardingUrl()`, `onboardingHint()` → `getOnboardingHint()`
- `capabilities()` → `getCapabilities()`
- `hasToken()` removed — logic absorbed into `init()`
- `init()` updated for same onboarding return contract

---

## App Changes

### `apps/potluck/main.js` and `apps/gifts/main.js`

Remove the `hasToken()` pre-check block:

```js
// BEFORE
if (!StoreClass.hasToken() && !hasCode) {
  renderOnboardingGate(repoParam, { clientId, workerUrl })
  return
}
const store = await StoreClass.init(config)
if (!store) return

// AFTER
const result = await StoreClass.init({ ...config, mode })
if (!result) return
if (result.status === 'onboarding') {
  renderOnboardingGate(repoParam, result)
  return
}
const store = result
```

### `apps/gifts/main-drive.js`

Three changes:

```js
// BEFORE
const recentSpaces = GoogleDriveStore.getRecentSpaces()
let activeSpace    = spaceParam ?? recentSpaces[0] ?? null
if (activeSpace) store._folderId = activeSpace

// AFTER
const recentSpaces = store.getRecentSpaces()
let activeSpace    = spaceParam ?? recentSpaces[0] ?? null
if (activeSpace) store.setSpace(activeSpace)
```

After these changes, each `main*.js` references its store class exactly twice: the `import` line and the `init()` call.

---

## `lib/capabilities.js`

One change: `store.capabilities()` → `store.getCapabilities()` inside `assertCapabilities`.

---

## Known Limitations

| # | Issue |
|---|---|
| L1 | One authenticated user per store class per session. Two instances of the same store class share sessionStorage auth keys (`gh:token`, `gd:token`, etc.). Running two separate GitHub-authenticated users simultaneously in one page is not supported. |
| L2 | `_storageKey` uniqueness is enforced by convention, not by the framework. Two third-party stores that happen to choose the same prefix would silently share their `recentSpaces` list. |
| L3 | `WorkerGitHubStore` is not routable via a provider string. Apps that need the Worker backend import it directly. A provider registry should be designed when a third backend is introduced. |