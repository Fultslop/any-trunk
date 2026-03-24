# BaseStore Abstract Class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `BaseStore` as the abstract base for all AnyTrunk store implementations, enforce the provider contract via inheritance, eliminate post-init store-class references from app code, and unify the `init()` return contract.

**Architecture:** A new `lib/base-store.js` provides shared implementations (`setSpace`, `getRecentSpaces`, `saveRecentSpace`) and throwing stubs for all required methods. `GitHubStore`, `WorkerGitHubStore`, and `GoogleDriveStore` each extend `BaseStore`, removing duplicated code and gaining the enforced contract. App entry points (`main.js`, `main-drive.js`) are simplified to reference their store class only twice — on the import line and in `init()`. The `init()` onboarding sentinel includes a `signIn` callback so `renderOnboardingGate` can trigger auth without receiving raw credentials.

**Tech Stack:** Vanilla ES modules (no bundler), Vitest for tests, `npm test` to run the suite.

**Spec:** `docs/superpowers/specs/2026-03-24-base-store-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `lib/base-store.js` | Abstract base — shared impls + throwing stubs |
| Create | `tests/base-store.test.mjs` | Tests for BaseStore shared logic |
| Modify | `lib/github-store.js` | Extend BaseStore, `_spaceId`, `userId`, `getCapabilities`, `init` with mode + `signIn` |
| Modify | `lib/github-store-worker.js` | `getCapabilities`, `init` with mode + `signIn`, `_spaceId` in `register`/`join`, delete own `saveRecentSpace`/`getRecentSpaces` |
| Modify | `lib/google-drive-store.js` | Extend BaseStore, `_spaceId`, `setSpace` override, `userId`, `getCapabilities`, `init` with mode + `signIn` |
| Modify | `lib/capabilities.js` | `store.capabilities()` → `store.getCapabilities()` |
| Delete | `lib/anytrunk.js` | No longer needed |
| Modify | `tests/github-store.test.mjs` | Rename methods, `userId`, onboarding sentinel test, `getRecentSpaces` instance |
| Modify | `tests/google-drive-store.test.mjs` | Same renames + new `userId` / `setSpace` tests |
| Modify | `apps/potluck/main.js` | Remove `hasToken` guard, handle `{ status: 'onboarding' }` |
| Modify | `apps/potluck/participant.js` | `renderOnboardingGate` accepts `{ url, hint, signIn }`, `store.username` → `store.userId`, `store._repoFullName =` → `store.setSpace()` |
| Modify | `apps/potluck/organizer.js` | `store._repoFullName` → `store._spaceId` (reads), `store.setSpace()` (writes), `store.username` → `store.userId` |
| Modify | `apps/gifts/main.js` | Same as potluck main (different store class / config) |
| Modify | `apps/gifts/participant.js` | `renderOnboardingGate` accepts `{ url, hint, signIn }`, `store.username` → `store.userId` |
| Modify | `apps/gifts/organizer.js` | `store._repoFullName` → `store._spaceId` (reads), `store.setSpace()` (writes), `store.username` → `store.userId` |
| Modify | `apps/gifts/main-drive.js` | Instance `getRecentSpaces`, `setSpace`, `store.userEmail` → `store.userId`, onboarding branch |
| Modify | `README.md` | `username` → `userId`, rename stale utility methods, update roadmap |
| Modify | `docs/tutorial-gifts.md` | `userEmail` → `userId`, `_folderId` → `_spaceId` in prose |

---

## The `signIn` callback pattern

When `init()` returns `{ status: 'onboarding' }`, the participant UI needs to trigger OAuth without knowing the raw credentials. The sentinel includes a `signIn` callback:

```js
// Inside init() when returning the onboarding sentinel:
return {
  status: 'onboarding',
  url:    StoreClass.getOnboardingUrl(),
  hint:   StoreClass.getOnboardingHint(),
  signIn: () => StoreClass.beginAuth(config),  // closure over the config
}
```

`renderOnboardingGate` then becomes:

```js
// potluck/participant.js
export function renderOnboardingGate(repoParam, { url, hint, signIn }) {
  // ...
  document.getElementById('yes-btn').onclick = () => signIn()
  document.getElementById('no-btn').onclick = () => {
    hint.style.display = 'block'
    // use url and hint from result, not static class methods
  }
}
```

---

## Task 1: `lib/base-store.js` + `tests/base-store.test.mjs`

**Files:**
- Create: `lib/base-store.js`
- Create: `tests/base-store.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/base-store.test.mjs`:

```js
import { test, expect, beforeEach } from 'vitest'
import { reset } from './helpers/mock-browser.mjs'
import { BaseStore } from '../lib/base-store.js'

beforeEach(() => reset())

// ── _storageKey safety ────────────────────────────────────────────────────

test('_storageKey throws if subclass does not declare it', () => {
  class BrokenStore extends BaseStore {}
  expect(() => BrokenStore._storageKey).toThrow(/BrokenStore must declare static _storageKey/)
})

test('_storageKey works when subclass declares it', () => {
  class GoodStore extends BaseStore { static _storageKey = 'gs' }
  expect(GoodStore._storageKey).toBe('gs')
})

// ── setSpace ─────────────────────────────────────────────────────────────

test('setSpace sets _spaceId on the instance', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  const store = new S()
  expect(store._spaceId).toBeNull()
  store.setSpace('abc-123')
  expect(store._spaceId).toBe('abc-123')
})

// ── saveRecentSpace / getRecentSpaces ─────────────────────────────────────

test('saveRecentSpace persists under storageKey namespace', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  S.saveRecentSpace('space-1')
  expect(localStorage.getItem('ts:recentSpaces')).toBe('["space-1"]')
})

test('getRecentSpaces reads from storageKey namespace', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  S.saveRecentSpace('space-1')
  const store = new S()
  expect(store.getRecentSpaces()).toEqual(['space-1'])
})

test('saveRecentSpace deduplicates and caps at 5', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  for (let i = 0; i < 7; i++) S.saveRecentSpace(`space-${i}`)
  expect(new S().getRecentSpaces()).toHaveLength(5)
})

test('saveRecentSpace moves existing entry to front', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  S.saveRecentSpace('a')
  S.saveRecentSpace('b')
  S.saveRecentSpace('a')
  const spaces = new S().getRecentSpaces()
  expect(spaces[0]).toBe('a')
  expect(spaces[1]).toBe('b')
  expect(spaces).toHaveLength(2)
})

test('two subclasses with different _storageKey have separate lists', () => {
  class A extends BaseStore { static _storageKey = 'aa' }
  class B extends BaseStore { static _storageKey = 'bb' }
  A.saveRecentSpace('space-a')
  B.saveRecentSpace('space-b')
  expect(new A().getRecentSpaces()).toEqual(['space-a'])
  expect(new B().getRecentSpaces()).toEqual(['space-b'])
})

// ── stubs throw ───────────────────────────────────────────────────────────

test('init stub throws not implemented', async () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  await expect(S.init({})).rejects.toThrow(/not implemented/)
})

test('getOnboardingUrl stub throws not implemented', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  expect(() => S.getOnboardingUrl()).toThrow(/not implemented/)
})

test('instance method stubs throw not implemented', async () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  const store = new S()
  await expect(store.read('x.json')).rejects.toThrow(/not implemented/)
  await expect(store.readAll()).rejects.toThrow(/not implemented/)
  await expect(store.append({}, { prefix: 'x' })).rejects.toThrow(/not implemented/)
  await expect(store.write('x.json', {})).rejects.toThrow(/not implemented/)
  await expect(store.createSpace('name')).rejects.toThrow(/not implemented/)
  await expect(store.join('id')).rejects.toThrow(/not implemented/)
  await expect(store.deleteSpace()).rejects.toThrow(/not implemented/)
  expect(() => store.getCapabilities()).toThrow(/not implemented/)
})

test('userId stub throws not implemented', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  const store = new S()
  expect(() => store.userId).toThrow(/not implemented/)
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test tests/base-store.test.mjs
```

Expected: fail with `Cannot find module '../lib/base-store.js'`

- [ ] **Step 3: Implement `lib/base-store.js`**

```js
// lib/base-store.js
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

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test tests/base-store.test.mjs
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add lib/base-store.js tests/base-store.test.mjs
git commit -m "feat: add BaseStore abstract base class with shared implementations"
```

---

## Task 2: Update `lib/github-store.js` + tests

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Update tests first**

In `tests/github-store.test.mjs`, make these changes:

**a) Add import for BaseStore at the top:**
```js
import { BaseStore } from '../lib/base-store.js'
```

**b) Line 19 — `username` → `userId`:**
```js
// before
expect(s.username).toBeNull()
// after
expect(s.userId).toBeNull()
```

**c) Line 69 — `username` → `userId`:**
```js
// before
expect(store.username).toBe('johndoe')
// after
expect(store.userId).toBe('johndoe')
```

**d) Line 97 — `username` → `userId`:**
```js
// before
expect(store.username).toBe('existinguser')
// after
expect(store.userId).toBe('existinguser')
```

**e) Lines 326–346 — `getRecentSpaces` is now an instance method:**
```js
// before
test('saveRecentSpace stores spaceId in localStorage', () => {
  GitHubStore.saveRecentSpace('johndoe/potluck-test')
  const stored = GitHubStore.getRecentSpaces()
  expect(stored).toEqual(['johndoe/potluck-test'])
})

test('getRecentSpaces deduplicates and caps at 5', () => {
  for (let i = 0; i < 7; i++) GitHubStore.saveRecentSpace(`owner/repo-${i}`)
  const stored = GitHubStore.getRecentSpaces()
  expect(stored.length <= 5).toBe(true)
})

test('saveRecentSpace moves existing entry to front on re-save', () => {
  GitHubStore.saveRecentSpace('owner/repo-a')
  GitHubStore.saveRecentSpace('owner/repo-b')
  GitHubStore.saveRecentSpace('owner/repo-a')
  const stored = GitHubStore.getRecentSpaces()
  expect(stored[0]).toBe('owner/repo-a')
  expect(stored[1]).toBe('owner/repo-b')
  expect(stored.length).toBe(2)
})

// after
test('saveRecentSpace stores spaceId in localStorage', () => {
  GitHubStore.saveRecentSpace('johndoe/potluck-test')
  const stored = new GitHubStore({}).getRecentSpaces()
  expect(stored).toEqual(['johndoe/potluck-test'])
})

test('getRecentSpaces deduplicates and caps at 5', () => {
  for (let i = 0; i < 7; i++) GitHubStore.saveRecentSpace(`owner/repo-${i}`)
  expect(new GitHubStore({}).getRecentSpaces().length <= 5).toBe(true)
})

test('saveRecentSpace moves existing entry to front on re-save', () => {
  GitHubStore.saveRecentSpace('owner/repo-a')
  GitHubStore.saveRecentSpace('owner/repo-b')
  GitHubStore.saveRecentSpace('owner/repo-a')
  const stored = new GitHubStore({}).getRecentSpaces()
  expect(stored[0]).toBe('owner/repo-a')
  expect(stored[1]).toBe('owner/repo-b')
  expect(stored.length).toBe(2)
})
```

**f) Lines 507–514 — replace `hasToken` tests with onboarding sentinel test:**
```js
// remove these two tests:
// test('hasToken returns true when token is in sessionStorage', ...)
// test('hasToken returns false when no token in sessionStorage', ...)

// add:
test('init returns onboarding sentinel for participant mode when not authenticated', async () => {
  Object.defineProperty(global, 'location', {
    configurable: true,
    get: () => ({ search: '' }),
    set: () => {},
  })
  const result = await GitHubStore.init({
    clientId: 'id', clientSecret: 'secret', mode: 'participant'
  })
  expect(result).not.toBeNull()
  expect(result.status).toBe('onboarding')
  expect(typeof result.url).toBe('string')
  expect(typeof result.hint).toBe('string')
  expect(typeof result.signIn).toBe('function')
})
```

**g) Lines 516–518 — `onboardingUrl` → `getOnboardingUrl`:**
```js
test('getOnboardingUrl returns the GitHub signup URL', () => {
  expect(GitHubStore.getOnboardingUrl()).toBe('https://github.com/signup')
})
```

**h) Lines 520–524 — `onboardingHint` → `getOnboardingHint`, fix incorrect assertion (existing test wrongly checks for 'google'):**
```js
test('getOnboardingHint returns a non-empty string mentioning GitHub', () => {
  const hint = GitHubStore.getOnboardingHint()
  expect(hint && hint.length > 0).toBe(true)
  expect(hint.toLowerCase().includes('github')).toBe(true)
})
```

**i) Lines 538–552 — `capabilities()` → `getCapabilities()`:**
```js
test('getCapabilities() returns all expected flags', () => {
  const store = new GitHubStore({ token: 'tok' })
  const caps = store.getCapabilities()
  // ... rest unchanged
```

**j) Add extends test:**
```js
test('GitHubStore extends BaseStore', () => {
  expect(new GitHubStore({}) instanceof BaseStore).toBe(true)
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test tests/github-store.test.mjs
```

Expected: multiple failures

- [ ] **Step 3: Update `lib/github-store.js`**

**a) Add import and extend:**
```js
import { BaseStore } from './base-store.js'

export class GitHubStore extends BaseStore {
  static _storageKey = 'gh'
```

**b) Constructor — call `super()`, rename `_repoFullName` → `_spaceId`:**
```js
constructor({ clientId, clientSecret, token = null, repoFullName = null, _username = null, corsProxy = 'https://cors-anywhere.herokuapp.com' } = {}) {
  super()
  this._clientId     = clientId
  this._clientSecret = clientSecret
  this._token        = token
  this._spaceId      = repoFullName   // internal field renamed; constructor param unchanged
  this._username     = _username
  this._corsProxy    = corsProxy
  this._readOnly     = false
}
```

**c) Replace `get username()` with `get userId()`:**
```js
get userId() { return this._username }
```

**d) Replace `onboardingUrl`/`onboardingHint` with renamed versions:**
```js
static getOnboardingUrl()  { return 'https://github.com/signup' }
static getOnboardingHint() { return 'You need a GitHub account' }
```

**e) Remove `hasToken()`. Update `init()` — add `mode` and `signIn`:**
```js
static async init({ clientId, clientSecret, corsProxy, repoFullName = null, inviteToken = null, mode = null } = {}) {
  const params        = new URLSearchParams(location.search)
  const code          = params.get('code')
  const existingToken = sessionStorage.getItem('gh:token')

  if (code) {
    await GitHubStore.completeAuth()
    const returnUrl = sessionStorage.getItem('gh:returnUrl')
    sessionStorage.removeItem('gh:returnUrl')
    location.href = returnUrl ?? location.href.split('?')[0]
    return null
  }

  if (existingToken) {
    const username = sessionStorage.getItem('gh:username')
    return new GitHubStore({ clientId, clientSecret, corsProxy, token: existingToken, repoFullName, _username: username })
  }

  if (mode === 'participant') {
    return {
      status: 'onboarding',
      url:    GitHubStore.getOnboardingUrl(),
      hint:   GitHubStore.getOnboardingHint(),
      signIn: () => GitHubStore.beginAuth({ clientId, clientSecret, corsProxy }),
    }
  }

  GitHubStore.beginAuth({ clientId, clientSecret, corsProxy })
  return null
}
```

**f) Remove `saveRecentSpace` and `getRecentSpaces` static methods** — inherited from BaseStore.

**g) Rename `capabilities()` → `getCapabilities()`.**

**h) Replace ALL occurrences of `this._repoFullName` with `this._spaceId`** throughout the file. Use search-and-replace. Check every method: `write`, `read`, `list`, `readAll`, `append`, `createSpace`, `join`, `closeSubmissions`, `archiveSpace`, `deleteSpace`, `addCollaborator`, `_apiCall`, etc.

**i) Fix `saveRecentSpace` calls in `join()` — there are two callsites:**
```js
// Line ~131 (already correct form, verify it reads):
this.constructor.saveRecentSpace(repoFullName)

// Line ~137 (hardcoded class name — must change):
// before: GitHubStore.saveRecentSpace(repoFullName)
// after:
this.constructor.saveRecentSpace(repoFullName)
```

**j) Fix `saveRecentSpace` call in `createSpace()` similarly:**
```js
// before: GitHubStore.saveRecentSpace(repoFullName)
// after:
this.constructor.saveRecentSpace(repoFullName)
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test tests/github-store.test.mjs
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: GitHubStore extends BaseStore, userId, getCapabilities, init onboarding"
```

---

## Task 3: Update `lib/github-store-worker.js`

**Files:**
- Modify: `lib/github-store-worker.js`

- [ ] **Step 1: Delete own `saveRecentSpace` and `getRecentSpaces` methods**

`WorkerGitHubStore` currently defines its own static `saveRecentSpace` and `getRecentSpaces`. These shadow `BaseStore`'s implementations and must be removed — `WorkerGitHubStore` inherits the correct implementations from `GitHubStore` → `BaseStore`.

Delete both methods entirely from `github-store-worker.js`.

- [ ] **Step 2: Make all remaining changes**

**a) Remove `hasToken()` if present.**

**b) Rename `capabilities()` → `getCapabilities()`.**

**c) Rename `this._repoFullName` → `this._spaceId` in `register()` and `join()`.**

In `register()`:
```js
// before
body: JSON.stringify({ repo: this._repoFullName, token: this._token }),
// after
body: JSON.stringify({ repo: this._spaceId, token: this._token }),
```

In `join()`:
```js
// before
this._repoFullName = repoFullName
// after
this._spaceId = repoFullName
```

**d) Fix `saveRecentSpace` call in `join()` to use `this.constructor` form:**
```js
// before: WorkerGitHubStore.saveRecentSpace(repoFullName)
// after:
this.constructor.saveRecentSpace(repoFullName)
```

**e) Update `init()` — add `mode` param and `signIn` in the onboarding sentinel:**
```js
static async init({ clientId, workerUrl, repoFullName = null, mode = null } = {}) {
  const params           = new URLSearchParams(location.search)
  const code             = params.get('code')
  const existingToken    = sessionStorage.getItem('gh:token')
  const existingUsername = sessionStorage.getItem('gh:username')

  if (code) {
    await WorkerGitHubStore.completeAuth()
    const returnUrl = sessionStorage.getItem('gh:returnUrl')
    sessionStorage.removeItem('gh:returnUrl')
    location.href = returnUrl ?? location.href.split('?')[0]
    return null
  }

  if (existingToken) {
    const storedWorkerUrl = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}').workerUrl ?? workerUrl
    return new WorkerGitHubStore({
      clientId, workerUrl: storedWorkerUrl,
      token: existingToken, repoFullName,
      _username: existingUsername,
    })
  }

  if (mode === 'participant') {
    return {
      status: 'onboarding',
      url:    WorkerGitHubStore.getOnboardingUrl(),
      hint:   WorkerGitHubStore.getOnboardingHint(),
      signIn: () => WorkerGitHubStore.beginAuth(clientId, workerUrl),
    }
  }

  WorkerGitHubStore.beginAuth(clientId, workerUrl)
  return null
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add lib/github-store-worker.js
git commit -m "feat: WorkerGitHubStore getCapabilities, init onboarding, _spaceId, remove shadow methods"
```

---

## Task 4: Update `lib/google-drive-store.js` + tests

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

- [ ] **Step 1: Update tests first**

In `tests/google-drive-store.test.mjs`:

**a) Add import for BaseStore:**
```js
import { BaseStore } from '../lib/base-store.js'
```

**b) Replace `hasToken` tests with onboarding sentinel test:**
```js
// remove:
// test('hasToken returns false when no token in sessionStorage', ...)
// test('hasToken returns true when gd:token present', ...)

// add:
test('init returns onboarding sentinel for participant mode when not authenticated', async () => {
  const result = await GoogleDriveStore.init({ clientId: 'id', mode: 'participant' })
  expect(result).not.toBeNull()
  expect(result.status).toBe('onboarding')
  expect(typeof result.url).toBe('string')
  expect(typeof result.hint).toBe('string')
  expect(typeof result.signIn).toBe('function')
})
```

**c) `onboardingUrl` → `getOnboardingUrl`:**
```js
test('getOnboardingUrl returns Google signup URL', () => {
  expect(GoogleDriveStore.getOnboardingUrl()).toBe('https://accounts.google.com/signup')
})
```

**d) `onboardingHint` → `getOnboardingHint`:**
```js
test('getOnboardingHint returns non-empty string', () => {
  expect(typeof GoogleDriveStore.getOnboardingHint()).toBe('string')
  expect(GoogleDriveStore.getOnboardingHint().length).toBeGreaterThan(0)
})
```

**e) `getRecentSpaces` is now an instance method:**
```js
test('saveRecentSpace persists to gd:recentSpaces', () => {
  GoogleDriveStore.saveRecentSpace('folder-123')
  const stored = new GoogleDriveStore({}).getRecentSpaces()
  expect(stored).toEqual(['folder-123'])
})

test('getRecentSpaces deduplicates and caps at 5', () => {
  for (let i = 0; i < 7; i++) GoogleDriveStore.saveRecentSpace(`folder-${i}`)
  expect(new GoogleDriveStore({}).getRecentSpaces()).toHaveLength(5)
})
```

**f) Add `userId` test:**
```js
test('userId returns userEmail', () => {
  const store = new GoogleDriveStore({ clientId: 'id', token: 'tok', userEmail: 'bob@example.com' })
  expect(store.userId).toBe('bob@example.com')
})
```

**g) Add `setSpace` override tests:**
```js
test('setSpace persists folderId to sessionStorage', () => {
  const store = new GoogleDriveStore({ clientId: 'id', token: 'tok' })
  store.setSpace('folder-xyz')
  expect(store._spaceId).toBe('folder-xyz')
  expect(sessionStorage.getItem('gd:folderId')).toBe('folder-xyz')
})

test('setSpace(null) removes folderId from sessionStorage', () => {
  sessionStorage.setItem('gd:folderId', 'old-folder')
  const store = new GoogleDriveStore({ clientId: 'id', token: 'tok' })
  store.setSpace(null)
  expect(store._spaceId).toBeNull()
  expect(sessionStorage.getItem('gd:folderId')).toBeNull()
})
```

**h) Add extends test:**
```js
test('GoogleDriveStore extends BaseStore', () => {
  expect(new GoogleDriveStore({}) instanceof BaseStore).toBe(true)
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test tests/google-drive-store.test.mjs
```

Expected: multiple failures

- [ ] **Step 3: Update `lib/google-drive-store.js`**

**a) Add import and extend:**
```js
import { BaseStore } from './base-store.js'

export class GoogleDriveStore extends BaseStore {
  static _storageKey = 'gd'
```

**b) Constructor — call `super()`, rename `_folderId` → `_spaceId`:**
```js
constructor({ clientId, token, userEmail = null, _folderId = null } = {}) {
  super()
  this._clientId           = clientId
  this._token              = token
  this._userEmail          = userEmail
  this._spaceId            = _folderId   // constructor param name retained; internal field renamed
  this._subfolderIdCache   = {}
}
```

**c) Add `get userId()`:**
```js
get userId() { return this._userEmail }
```

**d) Override `setSpace()` to persist to sessionStorage:**
```js
setSpace(id) {
  super.setSpace(id)
  if (id) sessionStorage.setItem('gd:folderId', id)
  else    sessionStorage.removeItem('gd:folderId')
}
```

**e) Remove `hasToken()`. Add renamed statics:**
```js
static getOnboardingUrl()  { return 'https://accounts.google.com/signup' }
static getOnboardingHint() { return 'You need a Google account' }
```

**f) Remove `saveRecentSpace` and `getRecentSpaces`** — inherited from BaseStore.

**g) Update `init()` — add `mode` and `signIn`:**
```js
static async init({ clientId, clientSecret, mode = null } = {}) {
  const params = new URLSearchParams(location.search)
  const code   = params.get('code')

  if (code) {
    await GoogleDriveStore.completeAuth()
    const returnUrl = sessionStorage.getItem('gd:returnUrl')
    sessionStorage.removeItem('gd:returnUrl')
    location.href = returnUrl ?? location.href.split('?')[0]
    return null
  }

  const existingToken = sessionStorage.getItem('gd:token')
  if (existingToken) {
    const { email } = JSON.parse(sessionStorage.getItem('gd:user') ?? '{}')
    const folderId  = sessionStorage.getItem('gd:folderId') ?? null
    return new GoogleDriveStore({ clientId, token: existingToken, userEmail: email, _folderId: folderId })
  }

  if (mode === 'participant') {
    return {
      status: 'onboarding',
      url:    GoogleDriveStore.getOnboardingUrl(),
      hint:   GoogleDriveStore.getOnboardingHint(),
      signIn: () => GoogleDriveStore.beginAuth({ clientId, clientSecret }),
    }
  }

  await GoogleDriveStore.beginAuth({ clientId, clientSecret })
  return null
}
```

**h) Replace ALL `this._folderId` with `this._spaceId`** throughout the file. The `sessionStorage` key `'gd:folderId'` is **kept as-is** — only the instance field name changes.

**i) In `createSpace()` and `join()`, replace the direct `this._folderId = folderId` / `this._spaceId = folderId` assignment AND the `sessionStorage.setItem('gd:folderId', ...)` call with a single `this.setSpace(folderId)` call.** The `setSpace()` override handles both the field and sessionStorage atomically.

In `deleteSpace()`, replace:
```js
this._folderId = null
this._subfolderIdCache = {}
sessionStorage.removeItem('gd:folderId')
```
with:
```js
this.setSpace(null)   // handles both _spaceId and sessionStorage
this._subfolderIdCache = {}
```

**j) Update `saveRecentSpace` calls in `createSpace()` and `join()`:**
```js
// before: GoogleDriveStore.saveRecentSpace(folderId)
// after:
this.constructor.saveRecentSpace(folderId)
```

**k) Rename `capabilities()` → `getCapabilities()`.**

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test tests/google-drive-store.test.mjs
```

Expected: all pass

- [ ] **Step 5: Run full suite to check for regressions**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: GoogleDriveStore extends BaseStore, _spaceId, userId, getCapabilities, init onboarding"
```

---

## Task 5: Update `lib/capabilities.js` + delete `lib/anytrunk.js`

**Files:**
- Modify: `lib/capabilities.js`
- Delete: `lib/anytrunk.js`

- [ ] **Step 1: Update `lib/capabilities.js`**

Find `store.capabilities()` inside `assertCapabilities` and change to `store.getCapabilities()`.

- [ ] **Step 2: Delete `lib/anytrunk.js` and run tests**

```bash
git rm lib/anytrunk.js
npm test
```

Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add lib/capabilities.js
git commit -m "feat: getCapabilities rename in capabilities.js, delete anytrunk.js"
```

Note: `git rm` already staged the deletion, so only `lib/capabilities.js` needs an explicit `git add`.

---

## Task 6: Update potluck app

**Files:**
- Modify: `apps/potluck/main.js`
- Modify: `apps/potluck/participant.js`
- Modify: `apps/potluck/organizer.js`

- [ ] **Step 1: Update `apps/potluck/main.js`**

```js
// before
if (mode === 'participant') {
  const hasCode = new URLSearchParams(location.search).has('code')
  if (!GitHubStore.hasToken() && !hasCode) {
    renderOnboardingGate(repoParam, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, corsProxy: CORS_PROXY })
    return
  }
}

const store = await GitHubStore.init({
  clientId:     CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  corsProxy:    CORS_PROXY,
  repoFullName: repoParam,
})
if (!store) return

// after
const result = await GitHubStore.init({
  clientId:     CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  corsProxy:    CORS_PROXY,
  repoFullName: repoParam,
  mode,
})
if (!result) return
if (result.status === 'onboarding') {
  renderOnboardingGate(repoParam, result)
  return
}
const store = result
```

- [ ] **Step 2: Update `apps/potluck/participant.js`**

**a) Remove the `GitHubStore` import at line 1** — the module no longer needs it.

**b) Update `renderOnboardingGate` signature and body:**

```js
// before
export function renderOnboardingGate(repoParam, { clientId, clientSecret, corsProxy } = {}) {
  // ...
  document.getElementById('yes-btn').onclick = () => {
    GitHubStore.init({ clientId, clientSecret, corsProxy, repoFullName: repoParam })
  }
  document.getElementById('no-btn').onclick = () => {
    // ...
    hint.innerHTML = `
      <p>${esc(GitHubStore.onboardingHint())}</p>
      <a href="${esc(GitHubStore.onboardingUrl())}" ...>
    `
  }
}

// after
export function renderOnboardingGate(repoParam, { url, hint: hintText, signIn }) {
  // ...
  document.getElementById('yes-btn').onclick = () => signIn()
  document.getElementById('no-btn').onclick = () => {
    // ...
    hint.innerHTML = `
      <p>${esc(hintText)}</p>
      <a href="${esc(url)}" ...>
    `
  }
}
```

**c) In `renderParticipant` — `store.username` → `store.userId` (line 16):**
```js
// before
Signed in as <strong>${esc(store.username)}</strong>
// after
Signed in as <strong>${esc(store.userId)}</strong>
```

**d) In `renderParticipant` — `store._repoFullName = repoParam` → `store.setSpace(repoParam)` (line 26):**
```js
// before
store._repoFullName = repoParam
// after
store.setSpace(repoParam)
```

- [ ] **Step 3: Update `apps/potluck/organizer.js`**

Read the full file first, then make these changes:

**a) `store.username` → `store.userId`** (lines 15 and 54).

**b) All reads of `store._repoFullName` → `store._spaceId`** (lines 7, 55, 123, 125, 134, 148, 231, 286).

**c) All writes to `store._repoFullName` → `store.setSpace(value)`** — check if there are any direct assignments; if so replace with `store.setSpace(value)`.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add apps/potluck/main.js apps/potluck/participant.js apps/potluck/organizer.js
git commit -m "feat: potluck uses init() onboarding sentinel, userId, _spaceId, no hasToken pre-check"
```

---

## Task 7: Update gifts app (GitHub backend)

**Files:**
- Modify: `apps/gifts/main.js`
- Modify: `apps/gifts/participant.js`
- Modify: `apps/gifts/organizer.js`

- [ ] **Step 1: Update `apps/gifts/main.js`**

```js
// before
if (mode === 'participant') {
  const hasCode = new URLSearchParams(location.search).has('code')
  if (!WorkerGitHubStore.hasToken() && !hasCode) {
    renderOnboardingGate(repoParam, { clientId: CLIENT_ID, workerUrl: WORKER_URL })
    return
  }
}

const store = await WorkerGitHubStore.init({
  clientId:     CLIENT_ID,
  workerUrl:    WORKER_URL,
  repoFullName: repoParam,
})
if (!store) return

// after
const result = await WorkerGitHubStore.init({
  clientId:     CLIENT_ID,
  workerUrl:    WORKER_URL,
  repoFullName: repoParam,
  mode,
})
if (!result) return
if (result.status === 'onboarding') {
  renderOnboardingGate(repoParam, result)
  return
}
const store = result
```

- [ ] **Step 2: Update `apps/gifts/participant.js`**

Read the full file first. The current `renderOnboardingGate` (line 12) takes `{ clientId, workerUrl }` and the yes-button calls `WorkerGitHubStore.beginAuth(clientId, workerUrl)`. Lines 19–20 call `WorkerGitHubStore.onboardingHint()` and `WorkerGitHubStore.onboardingUrl()` in a template.

**a) Remove the `WorkerGitHubStore` import at line 1.**

**b) Update `renderOnboardingGate` signature:**
```js
// before
export function renderOnboardingGate(repoParam, { clientId, workerUrl }) {
  // ...
  ${WorkerGitHubStore.onboardingHint()}
  <a href="${WorkerGitHubStore.onboardingUrl()}" ...>
  // ...
  document.getElementById('hasAccount').addEventListener('click', () => {
    WorkerGitHubStore.beginAuth(clientId, workerUrl)
  })
}

// after
export function renderOnboardingGate(repoParam, { url, hint, signIn }) {
  // ...
  ${hint}
  <a href="${url}" ...>
  // ...
  document.getElementById('hasAccount').addEventListener('click', () => signIn())
}
```

**c) In `renderParticipant` (and any other function) — `store.username` → `store.userId`** (lines 63, 70, 78, 103).

- [ ] **Step 3: Update `apps/gifts/organizer.js`**

Read the full file first. Key patterns to fix:

**a) `store.username` → `store.userId`** (line 45).

**b) All reads of `store._repoFullName` → `store._spaceId`** (lines 21, 99, 132 and any others).

**c) All writes to `store._repoFullName` → `store.setSpace(value)`:**
```js
// before
store._repoFullName = activeRepo
// after
store.setSpace(activeRepo)

// before
store._repoFullName = repo   // after createSpace
// after
store.setSpace(repo)
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add apps/gifts/main.js apps/gifts/participant.js apps/gifts/organizer.js
git commit -m "feat: gifts (GitHub) uses init() onboarding sentinel, userId, _spaceId"
```

---

## Task 8: Update gifts Drive app

**Files:**
- Modify: `apps/gifts/main-drive.js`

- [ ] **Step 1: Update `apps/gifts/main-drive.js`**

Read the full file first. Make these changes:

**a) Add `mode` to the `init()` call and handle the result:**
```js
// before
const store = await GoogleDriveStore.init({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
if (!store) return

// after
const result = await GoogleDriveStore.init({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, mode })
if (!result) return
if (result.status === 'onboarding') {
  // main-drive.js has a local renderOnboardingGate — update it to accept { url, hint, signIn }
  renderOnboardingGate(null, result)
  return
}
const store = result
```

**b) Update the local `renderOnboardingGate` function** (if it exists in this file) to accept `{ url, hint, signIn }` and use `signIn()` on the yes-button, replacing any `GoogleDriveStore` calls.

**c) In `renderOrganizer` — `getRecentSpaces` becomes instance:**
```js
// before
const recentSpaces = GoogleDriveStore.getRecentSpaces()
// after
const recentSpaces = store.getRecentSpaces()
```

**d) In `renderOrganizer` — replace `store._folderId` mutation with `store.setSpace`:**
```js
// before
if (activeSpace) store._folderId = activeSpace
// after
if (activeSpace) store.setSpace(activeSpace)
```

**e) `store.userEmail` → `store.userId`** — replace all occurrences in both `renderOrganizer` and `renderParticipant`.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add apps/gifts/main-drive.js
git commit -m "feat: main-drive uses instance getRecentSpaces, setSpace, userId, init onboarding"
```

---

## Task 9: Update `README.md` and `docs/tutorial-gifts.md`

**Files:**
- Modify: `README.md`
- Modify: `docs/tutorial-gifts.md`

- [ ] **Step 1: Update `README.md`**

**a) `store.username` → `store.userId`** — three occurrences (quick start block ~line 36, API section ~line 72, data operations example ~line 109).

**b) Local persistence section (~lines 127–132):**
```js
// before
// Save a repo to localStorage for one-click resume.
GitHubStore.saveRecentRepo(repoFullName)

// Returns up to 5 most-recently-used repos.
GitHubStore.getRecentRepos()
// → ['{owner}/{repo}', ...]

// after
// Save a space to localStorage for one-click resume.
GitHubStore.saveRecentSpace(spaceId)

// Returns up to 5 most-recently-used spaces (call on a store instance).
store.getRecentSpaces()
// → ['{owner}/{repo}', ...]
```

**c) Roadmap section (~lines 209–212):**
```markdown
// before
- [ ] GitLab backend
- [ ] Google Drive backend
- [ ] Provider interface (extract after second backend is proven)
- [ ] Cloudflare Worker for token exchange (fixes D1–D3)

// after
- [ ] GitLab backend
- [x] Google Drive backend
- [x] Provider interface (`BaseStore` abstract class)
- [ ] Cloudflare Worker for token exchange (fixes D1–D3)
```

- [ ] **Step 2: Update `docs/tutorial-gifts.md`**

**a) Drive section — `store.userEmail` → `store.userId` (~line 320):**
```js
// before
store.append({ item }, { prefix: store.userEmail })
// after
store.append({ item }, { prefix: store.userId })
```

**b) Drive section — update prose mentioning internal field `_folderId` (~line 311):**
```
// before
`store.join(folderId)` sets `_folderId` on the store and reads `_event.json`
// after
`store.join(folderId)` sets the active space on the store and reads `_event.json`
```

- [ ] **Step 3: Run full test suite one final time**

```bash
npm test
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add README.md docs/tutorial-gifts.md
git commit -m "docs: userId rename, getRecentSpaces instance, roadmap updates"
```

---

## Done

All tasks complete. Final check — verify the store class is mentioned exactly twice in each main entry point:

```bash
grep -c "GitHubStore\|WorkerGitHubStore\|GoogleDriveStore" \
  apps/potluck/main.js \
  apps/gifts/main.js \
  apps/gifts/main-drive.js
```

Expected: `2` for each file (import line + `init()` call).
