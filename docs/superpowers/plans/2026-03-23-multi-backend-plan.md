# Multi-Backend Abstraction + Google Drive Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a capability contract, `GoogleDriveStore`, and `AnyTrunk.init()` entry point — then validate with a Drive-backed gifts demo.

**Architecture:** Parallel store classes (`GitHubStore`, `GoogleDriveStore`) share no base class; duck typing + `capabilities()` is the contract. A thin `lib/anytrunk.js` routes `AnyTrunk.init({ provider })` to the right store. Tests use vitest + mock-fetch, same pattern as existing GitHub tests.

**Tech Stack:** Vanilla ES modules (no bundler), vitest for tests, Google Drive REST API v3, Google OAuth 2.0 PKCE

**Spec:** `docs/superpowers/specs/2026-03-23-multi-backend-design.md`

---

## File Map

| Action | File | What it does |
|---|---|---|
| Create | `lib/capabilities.js` | CAPS dictionary + `assertCapabilities(store, required[])` |
| Create | `lib/anytrunk.js` | `AnyTrunk.init(config)` routing switch + re-exports |
| Create | `lib/google-drive-store.js` | Full `GoogleDriveStore` class |
| Create | `tests/capabilities.test.mjs` | Tests for `assertCapabilities` |
| Create | `tests/google-drive-store.test.mjs` | Tests for `GoogleDriveStore` |
| Create | `apps/gifts/main-drive.js` | Drive-backed gifts entry point |
| Create | `apps/gifts/gifts-drive.html` | HTML shell for Drive gifts demo |
| Modify | `lib/github-store.js` | Config-obj `beginAuth`, rename utilities, add `capabilities()` |
| Modify | `lib/github-store-worker.js` | Rename utilities, add `capabilities()` |
| Modify | `tests/github-store.test.mjs` | Update call sites, add `capabilities()` tests |
| Modify | `tests/github-store-worker.test.mjs` | Update call sites |
| Modify | `apps/potluck/organizer.js` | `getRecentRepos()` → `getRecentSpaces()` |
| Modify | `apps/gifts/organizer.js` | `getRecentRepos()` → `getRecentSpaces()` |
| Modify | `apps/gifts/participant.js` | No functional change needed (uses `WorkerGitHubStore` directly) |

---

## Task 1: lib/capabilities.js

**Files:**
- Create: `lib/capabilities.js`
- Create: `tests/capabilities.test.mjs`

- [ ] **Step 1: Write failing test**

Create `tests/capabilities.test.mjs`:

```js
import { test, expect } from 'vitest'
import { assertCapabilities } from '../lib/capabilities.js'

test('assertCapabilities passes when all required caps present', () => {
  const store = {
    capabilities: () => ({ append: true, read: true }),
    constructor: { name: 'TestStore' },
  }
  expect(() => assertCapabilities(store, ['append', 'read'])).not.toThrow()
})

test('assertCapabilities throws listing all missing caps', () => {
  const store = {
    capabilities: () => ({ append: true }),
    constructor: { name: 'TestStore' },
  }
  expect(() => assertCapabilities(store, ['append', 'read', 'write']))
    .toThrow('TestStore is missing required capabilities: read, write')
})

test('assertCapabilities passes with empty required list', () => {
  const store = {
    capabilities: () => ({}),
    constructor: { name: 'TestStore' },
  }
  expect(() => assertCapabilities(store, [])).not.toThrow()
})
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
npm test -- --reporter=verbose tests/capabilities.test.mjs
```

- [ ] **Step 3: Implement `lib/capabilities.js`**

```js
// lib/capabilities.js

export const CAPS = {
  createSpace:      'Create a new shared space',
  join:             'Participant joins a space',
  append:           'Write a new timestamped entry',
  read:             'Read a single file',
  readAll:          'Read all participant submissions',
  write:            'Overwrite a specific file',
  addCollaborator:  'Add a participant by identity',
  closeSubmissions: 'Mark event as closed',
  archiveSpace:     'Make space read-only',
  deleteSpace:      'Permanently remove the space',
  binaryData:       'Backend can store binary data in entries (method surface defined in Spec 2)',
}

export function assertCapabilities(store, required) {
  const caps = store.capabilities()
  const missing = required.filter(cap => !caps[cap])
  if (missing.length > 0) {
    throw new Error(
      `${store.constructor.name} is missing required capabilities: ${missing.join(', ')}`
    )
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --reporter=verbose tests/capabilities.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/capabilities.js tests/capabilities.test.mjs
git commit -m "feat: add capabilities contract (CAPS + assertCapabilities)"
```

---

## Task 2: Update GitHubStore — breaking changes

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

Changes: `beginAuth` positional → config obj, `saveRecentRepo` → `saveRecentSpace` (key `gh:recentSpaces`), `getRecentRepos` → `getRecentSpaces`, add `capabilities()`.

- [ ] **Step 1: Update test call sites and add new tests**

In `tests/github-store.test.mjs`, update:

```js
// Line 32 — was: GitHubStore.beginAuth('my-client-id', 'my-secret')
GitHubStore.beginAuth({ clientId: 'my-client-id', clientSecret: 'my-secret' })

// Line 40 — was: GitHubStore.beginAuth('my-client-id', 'my-secret')
GitHubStore.beginAuth({ clientId: 'my-client-id', clientSecret: 'my-secret' })

// Line 445 — was: GitHubStore.beginAuth('my-client-id', 'my-secret')
GitHubStore.beginAuth({ clientId: 'my-client-id', clientSecret: 'my-secret' })
```

Rename all `saveRecentRepo` / `getRecentRepos` call sites in the test file:
```js
// was: GitHubStore.saveRecentRepo(...)
GitHubStore.saveRecentSpace(...)

// was: GitHubStore.getRecentRepos()
GitHubStore.getRecentSpaces()
```

Update the localStorage key assertion in the `saveRecentRepo` test:
```js
// was: test('saveRecentRepo stores repoFullName in localStorage', ...
test('saveRecentSpace stores spaceId in localStorage', () => {
  GitHubStore.saveRecentSpace('johndoe/potluck-test')
  const stored = GitHubStore.getRecentSpaces()
  expect(stored).toEqual(['johndoe/potluck-test'])
})
```

Add `capabilities()` tests at the bottom of the file:
```js
test('capabilities() returns all expected flags', () => {
  const store = new GitHubStore({ token: 'tok' })
  const caps = store.capabilities()
  expect(caps.createSpace).toBe(true)
  expect(caps.join).toBe(true)
  expect(caps.append).toBe(true)
  expect(caps.read).toBe(true)
  expect(caps.readAll).toBe(true)
  expect(caps.write).toBe(true)
  expect(caps.addCollaborator).toBe(true)
  expect(caps.closeSubmissions).toBe(true)
  expect(caps.archiveSpace).toBe(true)
  expect(caps.deleteSpace).toBe(true)
  expect(caps.binaryData).toBe(true)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --reporter=verbose tests/github-store.test.mjs
```

Expected failures: `beginAuth` positional args, renamed methods, missing `capabilities()`.

- [ ] **Step 3: Update `lib/github-store.js`**

**3a. `beginAuth` — change from positional to config object:**

```js
// Before:
static beginAuth(clientId, clientSecret, corsProxy = 'https://cors-anywhere.herokuapp.com') {
  const state = crypto.randomUUID()
  sessionStorage.setItem('gh:auth', JSON.stringify({ clientId, clientSecret, state, corsProxy }))

// After:
static beginAuth({ clientId, clientSecret, corsProxy = 'https://cors-anywhere.herokuapp.com' } = {}) {
  const state = crypto.randomUUID()
  sessionStorage.setItem('gh:auth', JSON.stringify({ clientId, clientSecret, state, corsProxy }))
```

**3b. Fix internal `init()` call to `beginAuth` (near the end of `init()`):**

```js
// Before:
GitHubStore.beginAuth(clientId, clientSecret, corsProxy)

// After:
GitHubStore.beginAuth({ clientId, clientSecret, corsProxy })
```

**3c. Rename `saveRecentRepo` → `saveRecentSpace`, update localStorage key:**

```js
// Before:
static saveRecentRepo(repoFullName) {
  const key = 'potluck:recentRepos'
  const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
  const updated = [repoFullName, ...existing.filter(r => r !== repoFullName)].slice(0, 5)
  localStorage.setItem(key, JSON.stringify(updated))
}

static getRecentRepos() {
  return JSON.parse(localStorage.getItem('potluck:recentRepos') ?? '[]')
}

// After:
static saveRecentSpace(spaceId) {
  const key = 'gh:recentSpaces'
  const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
  const updated = [spaceId, ...existing.filter(r => r !== spaceId)].slice(0, 5)
  localStorage.setItem(key, JSON.stringify(updated))
}

static getRecentSpaces() {
  return JSON.parse(localStorage.getItem('gh:recentSpaces') ?? '[]')
}
```

**3d. Update internal call sites in `lib/github-store.js` (lines ~131, ~137, ~263):**

```js
// All three occurrences:
// Before: this.constructor.saveRecentRepo(repoFullName) / GitHubStore.saveRecentRepo(...)
// After:  this.constructor.saveRecentSpace(repoFullName) / GitHubStore.saveRecentSpace(...)
```

**3e. Add `capabilities()` method (before the closing `}` of the class):**

```js
capabilities() {
  return {
    createSpace: true, join: true, append: true,
    read: true, readAll: true, write: true,
    addCollaborator: true, closeSubmissions: true,
    archiveSpace: true, deleteSpace: true,
    binaryData: true,
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --reporter=verbose tests/github-store.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: update GitHubStore — config-obj beginAuth, rename utilities, add capabilities()"
```

---

## Task 3: Update WorkerGitHubStore

**Files:**
- Modify: `lib/github-store-worker.js`
- Modify: `tests/github-store-worker.test.mjs`

- [ ] **Step 1: Update test call sites**

In `tests/github-store-worker.test.mjs`, rename:
```js
// All occurrences:
WorkerGitHubStore.saveRecentRepo(...)  →  WorkerGitHubStore.saveRecentSpace(...)
WorkerGitHubStore.getRecentRepos()    →  WorkerGitHubStore.getRecentSpaces()

// Update localStorage key assertion:
// was: 'gifts:recentRepos'  →  'gh:recentSpaces'
```

Add `capabilities()` test:
```js
test('capabilities() returns all expected flags', () => {
  const store = new WorkerGitHubStore({ token: 'tok' })
  const caps = store.capabilities()
  expect(caps.createSpace).toBe(true)
  expect(caps.join).toBe(true)
  expect(caps.binaryData).toBe(true)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --reporter=verbose tests/github-store-worker.test.mjs
```

- [ ] **Step 3: Update `lib/github-store-worker.js`**

Rename `saveRecentRepo` → `saveRecentSpace` (key: `'gh:recentSpaces'`) and `getRecentRepos` → `getRecentSpaces`. Update all internal call sites within the file.

Add `capabilities()` method (identical return shape to `GitHubStore.capabilities()`):
```js
capabilities() {
  return {
    createSpace: true, join: true, append: true,
    read: true, readAll: true, write: true,
    addCollaborator: true, closeSubmissions: true,
    archiveSpace: true, deleteSpace: true,
    binaryData: true,
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --reporter=verbose tests/github-store-worker.test.mjs
```

- [ ] **Step 5: Full test suite — expect no regressions**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add lib/github-store-worker.js tests/github-store-worker.test.mjs
git commit -m "feat: update WorkerGitHubStore — rename utilities, add capabilities()"
```

---

## Task 4: lib/anytrunk.js

**Files:**
- Create: `lib/anytrunk.js`

No dedicated test — covered by integration in later tasks.

- [ ] **Step 1: Create `lib/anytrunk.js`**

```js
// lib/anytrunk.js
import { GitHubStore }      from './github-store.js'
import { GoogleDriveStore } from './google-drive-store.js'
import { assertCapabilities } from './capabilities.js'

export { assertCapabilities }

export const AnyTrunk = {
  async init(config) {
    switch (config.provider) {
      case 'github':       return GitHubStore.init(config)
      case 'google-drive': return GoogleDriveStore.init(config)
      default: throw new Error(`Unknown provider: "${config.provider}"`)
    }
  }
}
```

This will fail to import until `google-drive-store.js` exists. Create a stub immediately:

```js
// lib/google-drive-store.js  (stub — filled out in Tasks 5-9)
export class GoogleDriveStore {
  static async init() { throw new Error('Not implemented') }
}
```

- [ ] **Step 2: Verify import resolves**

```bash
node --input-type=module <<'EOF'
import { AnyTrunk } from './lib/anytrunk.js'
console.log('ok', typeof AnyTrunk.init)
EOF
```

Expected: `ok function`

- [ ] **Step 3: Commit**

```bash
git add lib/anytrunk.js lib/google-drive-store.js
git commit -m "feat: add AnyTrunk entry point + GoogleDriveStore stub"
```

---

## Task 5: GoogleDriveStore — constructor, auth, static utilities

**Files:**
- Modify: `lib/google-drive-store.js` (replace stub)
- Create: `tests/google-drive-store.test.mjs`

**Background:** Drive uses PKCE — no client secret, no CORS proxy. `crypto.subtle.digest` and `TextEncoder` are available natively in Node 18+.

- [ ] **Step 1: Write failing auth tests**

Create `tests/google-drive-store.test.mjs`:

```js
import { test, expect, beforeEach } from 'vitest'
import { reset, setLocation } from './helpers/mock-browser.mjs'
import { clearFetch, mockFetch } from './helpers/mock-fetch.mjs'
import { GoogleDriveStore } from '../lib/google-drive-store.js'

let lastRedirect = null
Object.defineProperty(global, 'location', {
  configurable: true,
  get: () => ({
    href:     lastRedirect ?? 'http://localhost/',
    search:   lastRedirect?.includes('?') ? '?' + lastRedirect.split('?')[1] : '',
    origin:   'http://localhost',
    pathname: '/',
  }),
  set: (v) => { lastRedirect = typeof v === 'string' ? v : v.href },
})

beforeEach(() => {
  reset()
  clearFetch()
  lastRedirect = null
})

// ── static utilities ────────────────────────────────────────────────────────

test('hasToken returns false when no token in sessionStorage', () => {
  expect(GoogleDriveStore.hasToken()).toBe(false)
})

test('hasToken returns true when gd:token present', () => {
  sessionStorage.setItem('gd:token', 'some-token')
  expect(GoogleDriveStore.hasToken()).toBe(true)
})

test('onboardingUrl returns Google signup URL', () => {
  expect(GoogleDriveStore.onboardingUrl()).toBe('https://accounts.google.com/signup')
})

test('onboardingHint returns non-empty string', () => {
  expect(typeof GoogleDriveStore.onboardingHint()).toBe('string')
  expect(GoogleDriveStore.onboardingHint().length).toBeGreaterThan(0)
})

test('saveRecentSpace persists to gd:recentSpaces', () => {
  GoogleDriveStore.saveRecentSpace('folder-123')
  const stored = GoogleDriveStore.getRecentSpaces()
  expect(stored).toEqual(['folder-123'])
})

test('getRecentSpaces deduplicates and caps at 5', () => {
  for (let i = 0; i < 7; i++) GoogleDriveStore.saveRecentSpace(`folder-${i}`)
  expect(GoogleDriveStore.getRecentSpaces()).toHaveLength(5)
})

// ── beginAuth ───────────────────────────────────────────────────────────────

test('beginAuth stores auth session in sessionStorage and redirects', async () => {
  await GoogleDriveStore.beginAuth({ clientId: 'goog-client-id' })

  const stored = JSON.parse(sessionStorage.getItem('gd:auth'))
  expect(stored.clientId).toBe('goog-client-id')
  expect(stored.codeVerifier).toBeTruthy()
  expect(stored.state).toBeTruthy()
  expect(stored.redirectUri).toBe('http://localhost/')

  expect(lastRedirect).toContain('accounts.google.com')
  expect(lastRedirect).toContain('client_id=goog-client-id')
  expect(lastRedirect).toContain('code_challenge_method=S256')
  expect(lastRedirect).toContain('access_type=offline')
})

// ── completeAuth ────────────────────────────────────────────────────────────

test('completeAuth throws if gd:auth missing', async () => {
  setLocation('http://localhost/?code=abc&state=xyz')
  await expect(GoogleDriveStore.completeAuth())
    .rejects.toThrow('Auth session not found')
})

test('completeAuth exchanges code and stores token', async () => {
  sessionStorage.setItem('gd:auth', JSON.stringify({
    clientId: 'goog-client-id', state: 'st123',
    codeVerifier: 'verifier', redirectUri: 'http://localhost/',
  }))
  setLocation('http://localhost/?code=mycode&state=st123')

  mockFetch((url) => {
    if (url.includes('oauth2.googleapis.com/token'))
      return { status: 200, body: { access_token: 'gd_token', refresh_token: 'ref_tok' } }
    if (url.includes('v2/userinfo'))
      return { status: 200, body: { email: 'alice@gmail.com', name: 'Alice' } }
  })

  const store = await GoogleDriveStore.completeAuth()
  expect(sessionStorage.getItem('gd:token')).toBe('gd_token')
  expect(sessionStorage.getItem('gd:refreshToken')).toBe('ref_tok')
  expect(JSON.parse(sessionStorage.getItem('gd:user')).email).toBe('alice@gmail.com')
  expect(sessionStorage.getItem('gd:auth')).toBeNull()
  expect(store).toBeInstanceOf(GoogleDriveStore)
})

test('completeAuth throws on state mismatch', async () => {
  sessionStorage.setItem('gd:auth', JSON.stringify({ state: 'correct', codeVerifier: 'v', redirectUri: '/' }))
  setLocation('http://localhost/?code=x&state=wrong')
  await expect(GoogleDriveStore.completeAuth()).rejects.toThrow('State mismatch')
})

// ── init() ──────────────────────────────────────────────────────────────────

test('init() Branch 2: rehydrates from sessionStorage when token exists', async () => {
  sessionStorage.setItem('gd:token', 'tok')
  sessionStorage.setItem('gd:user', JSON.stringify({ email: 'bob@gmail.com', name: 'Bob' }))
  sessionStorage.setItem('gd:folderId', 'folder-abc')

  const store = await GoogleDriveStore.init({ clientId: 'cid' })
  expect(store).toBeInstanceOf(GoogleDriveStore)
  expect(store.userEmail).toBe('bob@gmail.com')
  expect(store.isAuthenticated).toBe(true)
})

test('init() Branch 3: redirects to Google when no token', async () => {
  await GoogleDriveStore.init({ clientId: 'cid' })
  expect(lastRedirect).toContain('accounts.google.com')
})
```

- [ ] **Step 2: Run — expect FAIL (stub has no implementation)**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 3: Implement auth in `lib/google-drive-store.js`**

Replace the stub with the full class skeleton + auth:

```js
// lib/google-drive-store.js
export class GoogleDriveStore {
  constructor({ clientId, token, userEmail = null, _folderId = null } = {}) {
    this._clientId      = clientId
    this._token         = token
    this._userEmail     = userEmail
    this._folderId      = _folderId
    this._subfolderIdCache = {}
  }

  get isAuthenticated() { return !!this._token }
  get userEmail()       { return this._userEmail }

  // ── PKCE helper ────────────────────────────────────────────────────────────
  static async _pkce() {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const verifier = btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const data      = new TextEncoder().encode(verifier)
    const digest    = await crypto.subtle.digest('SHA-256', data)
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    return { verifier, challenge }
  }

  // ── beginAuth ──────────────────────────────────────────────────────────────
  static async beginAuth({ clientId }) {
    const { verifier, challenge } = await GoogleDriveStore._pkce()
    const state       = crypto.randomUUID()
    const redirectUri = location.origin + location.pathname
    sessionStorage.setItem('gd:auth', JSON.stringify({ clientId, state, codeVerifier: verifier, redirectUri }))
    sessionStorage.setItem('gd:returnUrl', location.href)

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('access_type', 'offline')
    location.href = url.toString()
  }

  // ── completeAuth ───────────────────────────────────────────────────────────
  static async completeAuth() {
    const raw = sessionStorage.getItem('gd:auth')
    if (!raw) throw new Error('Auth session not found — beginAuth was not called or sessionStorage was cleared')
    const stored = JSON.parse(raw)

    const params = new URLSearchParams(location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    if (state !== stored.state) throw new Error('State mismatch — possible CSRF')

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     stored.clientId,
        code,
        redirect_uri:  stored.redirectUri,
        grant_type:    'authorization_code',
        code_verifier: stored.codeVerifier,
      }),
    })
    if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status}`)
    const { access_token, refresh_token } = await resp.json()
    if (!access_token) throw new Error('Token exchange failed: no access_token in response')

    sessionStorage.setItem('gd:token', access_token)
    if (refresh_token) sessionStorage.setItem('gd:refreshToken', refresh_token)

    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!userResp.ok) throw new Error(`Failed to fetch user: HTTP ${userResp.status}`)
    const { email, name } = await userResp.json()
    sessionStorage.setItem('gd:user', JSON.stringify({ email, name }))

    sessionStorage.removeItem('gd:auth')
    // Note: gd:returnUrl is left for init() to consume
    return new GoogleDriveStore({ clientId: stored.clientId, token: access_token, userEmail: email })
  }

  // ── init() ─────────────────────────────────────────────────────────────────
  static async init({ clientId }) {
    const params = new URLSearchParams(location.search)
    const code   = params.get('code')

    if (code) {
      // Branch 1: returning from Google OAuth
      await GoogleDriveStore.completeAuth()
      const returnUrl = sessionStorage.getItem('gd:returnUrl')
      sessionStorage.removeItem('gd:returnUrl')
      // returnUrl null = direct callback navigation; strip ?code= as fallback
      location.href = returnUrl ?? location.href.split('?')[0]
      return null
    }

    const existingToken = sessionStorage.getItem('gd:token')
    if (existingToken) {
      // Branch 2: rehydrate
      const { email } = JSON.parse(sessionStorage.getItem('gd:user') ?? '{}')
      const folderId  = sessionStorage.getItem('gd:folderId') ?? null
      return new GoogleDriveStore({ clientId, token: existingToken, userEmail: email, _folderId: folderId })
    }

    // Branch 3: unauthenticated
    await GoogleDriveStore.beginAuth({ clientId })
    return null
  }

  // ── static UI utilities ────────────────────────────────────────────────────
  static hasToken()        { return !!sessionStorage.getItem('gd:token') }
  static onboardingUrl()   { return 'https://accounts.google.com/signup' }
  static onboardingHint()  { return 'You need a Google account' }

  static saveRecentSpace(spaceId) {
    const key      = 'gd:recentSpaces'
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
    const updated  = [spaceId, ...existing.filter(s => s !== spaceId)].slice(0, 5)
    localStorage.setItem(key, JSON.stringify(updated))
  }

  static getRecentSpaces() {
    return JSON.parse(localStorage.getItem('gd:recentSpaces') ?? '[]')
  }

  // ── data ops (stubs — implemented in Tasks 6-9) ────────────────────────────
  async createSpace()       { throw new Error('Not implemented') }
  async join()              { throw new Error('Not implemented') }
  async append()            { throw new Error('Not implemented') }
  async read()              { throw new Error('Not implemented') }
  async write()             { throw new Error('Not implemented') }
  async readAll()           { throw new Error('Not implemented') }
  async addCollaborator()   { throw new Error('Not implemented') }
  async closeSubmissions()  { throw new Error('Not implemented') }
  async archiveSpace()      { throw new Error('Not implemented') }
  async deleteSpace()       { throw new Error('Not implemented') }
  capabilities()            { throw new Error('Not implemented') }
}
```

- [ ] **Step 4: Run auth tests — expect PASS**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: GoogleDriveStore auth — PKCE beginAuth, completeAuth, init(), static utils"
```

---

## Task 6: GoogleDriveStore — createSpace, join

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

- [ ] **Step 1: Add createSpace + join tests**

Append to `tests/google-drive-store.test.mjs`:

```js
// ── helpers ──────────────────────────────────────────────────────────────────

function makeStore() {
  return new GoogleDriveStore({ clientId: 'cid', token: 'tok', userEmail: 'alice@gmail.com' })
}

// ── createSpace ──────────────────────────────────────────────────────────────

test('createSpace creates folder, writes _event.json, returns folderId', async () => {
  const store = makeStore()
  mockFetch((url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null
    // POST to create folder
    if (url.includes('drive/v3/files') && opts?.method === 'POST' && body?.mimeType?.includes('folder'))
      return { status: 200, body: { id: 'folder-abc' } }
    // POST to create _event.json (multipart upload)
    if (url.includes('drive/v3/files') && opts?.method === 'POST')
      return { status: 200, body: { id: 'file-evt' } }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })

  const spaceId = await store.createSpace('my-event', { accessMode: 'email' })
  expect(spaceId).toBe('folder-abc')
  expect(store._folderId).toBe('folder-abc')
  expect(sessionStorage.getItem('gd:folderId')).toBe('folder-abc')
  expect(GoogleDriveStore.getRecentSpaces()).toContain('folder-abc')
})

test('createSpace link mode sets folder link-sharing', async () => {
  const store = makeStore()
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, method: opts?.method })
    if (url.includes('drive/v3/files') && opts?.method === 'POST' && JSON.parse(opts.body ?? '{}').mimeType?.includes('folder'))
      return { status: 200, body: { id: 'folder-xyz' } }
    if (url.includes('permissions'))
      return { status: 200, body: {} }
    if (url.includes('drive/v3/files') && opts?.method === 'POST')
      return { status: 200, body: { id: 'f' } }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.createSpace('open-event', { accessMode: 'link' })
  expect(calls.some(c => c.url.includes('permissions'))).toBe(true)
})

// ── join ─────────────────────────────────────────────────────────────────────

test('join sets folderId, fetches _event.json, saves to sessionStorage', async () => {
  const store = makeStore()
  mockFetch((url) => {
    // list files query for _event.json
    if (url.includes('drive/v3/files') && url.includes('_event.json'))
      return { status: 200, body: { files: [{ id: 'evt-id', name: '_event.json' }] } }
    // get file content
    if (url.includes('evt-id') && url.includes('alt=media'))
      return { status: 200, body: { name: 'my-event', accessMode: 'email' } }
    throw new Error(`Unexpected: ${url}`)
  })

  await store.join('folder-abc')
  expect(store._folderId).toBe('folder-abc')
  expect(sessionStorage.getItem('gd:folderId')).toBe('folder-abc')
  expect(GoogleDriveStore.getRecentSpaces()).toContain('folder-abc')
})

test('join throws when folder is inaccessible', async () => {
  const store = makeStore()
  mockFetch(() => ({ status: 403, body: 'Forbidden' }))
  await expect(store.join('folder-bad')).rejects.toThrow()
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 3: Implement createSpace and join in `lib/google-drive-store.js`**

Add internal helpers and implement both methods. Replace the stubs:

```js
// ── internal API helper ─────────────────────────────────────────────────────
async _api(method, path, body = undefined, { rawBody = false, query = {} } = {}) {
  const base = 'https://www.googleapis.com'
  const url  = new URL(path.startsWith('http') ? path : `${base}${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)

  const opts = {
    method,
    headers: { Authorization: `Bearer ${this._token}` },
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const resp = await fetch(url.toString(), opts)
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Drive API ${method} ${path} → ${resp.status}: ${err}`)
  }
  return resp
}

// ── internal: write JSON file (create or update) ────────────────────────────
async _writeFile(name, parentId, data, existingFileId = null) {
  const content = JSON.stringify(data)
  if (existingFileId) {
    // Update existing file
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json' }, body: content }
    )
    return existingFileId
  }
  // Create new file (multipart)
  const boundary = '-------314159265358979323846'
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' }),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n')
  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` }, body: multipart }
  )
  if (!resp.ok) throw new Error(`Drive create file failed: ${resp.status}`)
  const { id } = await resp.json()
  return id
}

// ── internal: resolve file ID by name in a parent folder ───────────────────
async _findFile(name, parentId) {
  const q   = `name='${name}' and '${parentId}' in parents and trashed=false`
  const resp = await this._api('GET', '/drive/v3/files', undefined, { query: { q, fields: 'files(id,name)' } })
  const { files } = await resp.json()
  return files?.[0] ?? null
}

// ── internal: resolve subfolder ID (with cache) ─────────────────────────────
async _subfolderFor(name) {
  if (this._subfolderIdCache[name]) return this._subfolderIdCache[name]
  const f = await this._findFile(name, this._folderId)
  if (f) { this._subfolderIdCache[name] = f.id; return f.id }
  // Create subfolder
  const resp = await this._api('POST', '/drive/v3/files', {
    name, mimeType: 'application/vnd.google-apps.folder', parents: [this._folderId],
  })
  const { id } = await resp.json()
  this._subfolderIdCache[name] = id
  return id
}

// ── createSpace ──────────────────────────────────────────────────────────────
async createSpace(name, { accessMode = 'email' } = {}) {
  // Create root folder
  const folderResp = await this._api('POST', '/drive/v3/files', {
    name, mimeType: 'application/vnd.google-apps.folder',
  })
  const { id: folderId } = await folderResp.json()
  this._folderId = folderId
  sessionStorage.setItem('gd:folderId', folderId)

  // Set link-sharing if requested
  if (accessMode === 'link') {
    await this._api('POST', `/drive/v3/files/${folderId}/permissions`, {
      role: 'writer', type: 'anyone',
    })
  }

  // Write _event.json
  await this._writeFile('_event.json', folderId, {
    name, created: new Date().toISOString(), owner: this._userEmail, accessMode,
  })

  GoogleDriveStore.saveRecentSpace(folderId)
  return folderId
}

// ── join ─────────────────────────────────────────────────────────────────────
async join(folderId) {
  this._folderId = folderId
  sessionStorage.setItem('gd:folderId', folderId)
  // Verify access by reading _event.json
  const eventData = await this.read('_event.json')
  if (!eventData) throw new Error(`Cannot access space: folder ${folderId} not found or inaccessible`)
  GoogleDriveStore.saveRecentSpace(folderId)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: GoogleDriveStore createSpace + join"
```

---

## Task 7: GoogleDriveStore — read, write, append

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

- [ ] **Step 1: Add tests**

Append to `tests/google-drive-store.test.mjs`:

```js
// ── read ─────────────────────────────────────────────────────────────────────

test('read returns null for missing file', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  mockFetch(() => ({ status: 200, body: { files: [] } }))
  const result = await store.read('_event.json')
  expect(result).toBeNull()
})

test('read resolves root file and returns parsed JSON', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  mockFetch((url) => {
    if (url.includes('drive/v3/files') && !url.includes('alt=media'))
      return { status: 200, body: { files: [{ id: 'file-123', name: '_event.json' }] } }
    if (url.includes('alt=media'))
      return { status: 200, body: { name: 'my-event', accessMode: 'email' } }
    throw new Error(`Unexpected: ${url}`)
  })
  const result = await store.read('_event.json')
  expect(result).toEqual({ name: 'my-event', accessMode: 'email' })
})

// ── append ───────────────────────────────────────────────────────────────────

test('append creates timestamped file in participant subfolder', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  const createdFiles = []
  mockFetch((url, opts) => {
    const body = opts?.body
    if (url.includes('drive/v3/files') && opts?.method === 'POST' && JSON.parse(body ?? '{}').mimeType?.includes('folder'))
      return { status: 200, body: { id: 'subfolder-id' } }
    if (url.includes('upload/drive') && opts?.method === 'POST') {
      // Parse the multipart body to find the filename
      const nameMatch = body?.match(/"name":"([^"]+)"/)
      if (nameMatch) createdFiles.push(nameMatch[1])
      return { status: 200, body: { id: 'file-new' } }
    }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.append({ gift: 'book' }, { prefix: 'alice@gmail.com' })
  expect(createdFiles.some(f => f.match(/^\d{4}-\d{2}-\d{2}T.*\.json$/))).toBe(true)
})

// ── write ────────────────────────────────────────────────────────────────────

test('write updates existing file', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  let patchedId = null
  mockFetch((url, opts) => {
    if (url.includes('drive/v3/files') && !url.includes('upload'))
      return { status: 200, body: { files: [{ id: 'existing-id', name: '_event.json' }] } }
    if (url.includes('upload') && opts?.method === 'PATCH') {
      patchedId = url.match(/files\/([^?]+)/)?.[1]
      return { status: 200, body: {} }
    }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.write('_event.json', { closed: true })
  expect(patchedId).toBe('existing-id')
})

test('write creates file if not found', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  let created = false
  mockFetch((url, opts) => {
    if (!url.includes('upload')) return { status: 200, body: { files: [] } }
    if (opts?.method === 'POST') { created = true; return { status: 200, body: { id: 'new-id' } } }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.write('_event.json', { closed: true })
  expect(created).toBe(true)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 3: Implement read, write, append**

Replace stubs in `lib/google-drive-store.js`:

```js
async read(path) {
  const parts    = path.split('/')
  let parentId   = this._folderId
  const filename = parts[parts.length - 1]

  if (parts.length > 1) {
    // resolve subfolder
    const subName = parts.slice(0, -1).join('/')
    const sf      = await this._findFile(subName, this._folderId)
    if (!sf) return null
    parentId = sf.id
  }

  const file = await this._findFile(filename, parentId)
  if (!file) return null

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${this._token}` } }
  )
  if (!resp.ok) return null
  return resp.json()
}

async write(path, data) {
  const parts    = path.split('/')
  let parentId   = this._folderId
  const filename = parts[parts.length - 1]

  if (parts.length > 1) {
    parentId = await this._subfolderFor(parts.slice(0, -1).join('/'))
  }

  const existing = await this._findFile(filename, parentId)
  await this._writeFile(filename, parentId, data, existing?.id ?? null)
}

async append(data, { prefix }) {
  const subfolderId = await this._subfolderFor(prefix)
  const timestamp   = new Date().toISOString().replace(/:/g, '-')
  const filename    = `${timestamp}.json`
  await this._writeFile(filename, subfolderId, data)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: GoogleDriveStore read, write, append"
```

---

## Task 8: GoogleDriveStore — readAll

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

- [ ] **Step 1: Add readAll tests**

Append to `tests/google-drive-store.test.mjs`:

```js
// ── readAll ──────────────────────────────────────────────────────────────────

test('readAll returns participant entries sorted by username', async () => {
  const store = makeStore()
  store._folderId = 'folder-root'

  mockFetch((url) => {
    // List subfolders of root
    if (url.includes("in parents") && url.includes('application/vnd.google-apps.folder') && url.includes('folder-root'))
      return { status: 200, body: { files: [
        { id: 'sf-bob',   name: 'bob@gmail.com' },
        { id: 'sf-alice', name: 'alice@gmail.com' },
      ]}}
    // List files in alice's subfolder
    if (url.includes('sf-alice'))
      return { status: 200, body: { files: [{ id: 'f1', name: '2026-03-23T10-00-00.000Z.json' }] } }
    // List files in bob's subfolder
    if (url.includes('sf-bob'))
      return { status: 200, body: { files: [{ id: 'f2', name: '2026-03-23T11-00-00.000Z.json' }] } }
    // Get file content
    if (url.includes('f1') && url.includes('alt=media'))
      return { status: 200, body: { gift: 'book' } }
    if (url.includes('f2') && url.includes('alt=media'))
      return { status: 200, body: { gift: 'mug' } }
    throw new Error(`Unexpected readAll fetch: ${url}`)
  })

  const result = await store.readAll()
  expect(result).toHaveLength(2)
  expect(result[0].username).toBe('alice@gmail.com')   // sorted
  expect(result[0].latest).toEqual({ gift: 'book' })
  expect(result[1].username).toBe('bob@gmail.com')
})

test('readAll skips _ prefixed folders', async () => {
  const store = makeStore()
  store._folderId = 'folder-root'
  mockFetch((url) => {
    if (url.includes('application/vnd.google-apps.folder'))
      return { status: 200, body: { files: [
        { id: 'sf-meta', name: '_meta' },
        { id: 'sf-alice', name: 'alice@gmail.com' },
      ]}}
    if (url.includes('sf-alice'))
      return { status: 200, body: { files: [] } }
    throw new Error(`Unexpected: ${url}`)
  })
  const result = await store.readAll()
  expect(result).toHaveLength(1)
  expect(result[0].username).toBe('alice@gmail.com')
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 3: Implement readAll**

Replace the stub:

```js
async readAll() {
  // 1. List participant subfolders
  const q        = `'${this._folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const listResp = await this._api('GET', '/drive/v3/files', undefined, { query: { q, fields: 'files(id,name)' } })
  const { files: folders } = await listResp.json()

  // 2. Skip _ prefixed folders
  const participants = folders.filter(f => !f.name.startsWith('_'))

  // 3. For each subfolder, list files and read each
  const results = await Promise.all(participants.map(async folder => {
    const fq       = `'${folder.id}' in parents and mimeType='application/json' and trashed=false`
    const fResp    = await this._api('GET', '/drive/v3/files', undefined, {
      query: { q: fq, fields: 'files(id,name)', orderBy: 'name' }
    })
    const { files } = await fResp.json()

    const entries = await Promise.all(files.map(async file => {
      const contentResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${this._token}` } }
      )
      const data = await contentResp.json()
      return { path: `${folder.name}/${file.name}`, data }
    }))

    return {
      username: folder.name,
      entries,
      latest: entries.length > 0 ? entries[entries.length - 1].data : null,
    }
  }))

  return results.sort((a, b) => a.username.localeCompare(b.username))
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: GoogleDriveStore readAll"
```

---

## Task 9: GoogleDriveStore — management ops + capabilities()

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

- [ ] **Step 1: Add tests**

Append to `tests/google-drive-store.test.mjs`:

```js
// ── addCollaborator ───────────────────────────────────────────────────────────

test('addCollaborator adds email as editor in email mode', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  let permBody = null
  mockFetch((url, opts) => {
    // read _event.json to determine accessMode
    if (url.includes('drive/v3/files') && !url.includes('upload') && !url.includes('permissions') && !url.includes('alt=media'))
      return { status: 200, body: { files: [{ id: 'evt', name: '_event.json' }] } }
    if (url.includes('alt=media'))
      return { status: 200, body: { accessMode: 'email' } }
    if (url.includes('permissions') && opts?.method === 'POST') {
      permBody = JSON.parse(opts.body)
      return { status: 200, body: {} }
    }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.addCollaborator('bob@gmail.com')
  expect(permBody).toMatchObject({ role: 'writer', emailAddress: 'bob@gmail.com' })
})

test('addCollaborator throws in link mode', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  mockFetch((url) => {
    if (url.includes('drive/v3/files') && !url.includes('alt=media'))
      return { status: 200, body: { files: [{ id: 'evt', name: '_event.json' }] } }
    if (url.includes('alt=media'))
      return { status: 200, body: { accessMode: 'link' } }
  })
  await expect(store.addCollaborator('bob@gmail.com'))
    .rejects.toThrow('not supported in link-access spaces')
})

// ── closeSubmissions ──────────────────────────────────────────────────────────

test('closeSubmissions writes closed:true to _event.json', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  let writtenData = null
  mockFetch((url, opts) => {
    if (url.includes('drive/v3/files') && !url.includes('upload') && !url.includes('alt=media'))
      return { status: 200, body: { files: [{ id: 'evt', name: '_event.json' }] } }
    if (url.includes('alt=media'))
      return { status: 200, body: { name: 'my-event', accessMode: 'email' } }
    if (url.includes('upload') && opts?.method === 'PATCH') {
      writtenData = JSON.parse(opts.body)
      return { status: 200, body: {} }
    }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.closeSubmissions()
  expect(writtenData.closed).toBe(true)
  expect(writtenData.name).toBe('my-event')
})

// ── archiveSpace ──────────────────────────────────────────────────────────────

test('archiveSpace downgrades all non-owner permissions to reader', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  const patched = []
  mockFetch((url, opts) => {
    if (opts?.method === 'GET' && url.includes('permissions'))
      return { status: 200, body: { permissions: [
        { id: 'p1', role: 'writer' },
        { id: 'p2', role: 'owner' },
        { id: 'p3', role: 'writer' },
      ]}}
    if (opts?.method === 'PATCH' && url.includes('permissions')) {
      patched.push(url.split('/').at(-1))
      return { status: 200, body: {} }
    }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.archiveSpace()
  expect(patched).toEqual(expect.arrayContaining(['p1', 'p3']))
  expect(patched).not.toContain('p2')
})

// ── deleteSpace ───────────────────────────────────────────────────────────────

test('deleteSpace deletes folder and clears state', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  sessionStorage.setItem('gd:folderId', 'folder-abc')
  let deleted = false
  mockFetch((url, opts) => {
    if (opts?.method === 'DELETE') { deleted = true; return { status: 204, body: '' } }
    throw new Error(`Unexpected: ${opts?.method}`)
  })
  await store.deleteSpace()
  expect(deleted).toBe(true)
  expect(store._folderId).toBeNull()
  expect(sessionStorage.getItem('gd:folderId')).toBeNull()
})

// ── capabilities ──────────────────────────────────────────────────────────────

test('capabilities() returns all expected flags', () => {
  const store = makeStore()
  const caps = store.capabilities()
  expect(caps.createSpace).toBe(true)
  expect(caps.join).toBe(true)
  expect(caps.append).toBe(true)
  expect(caps.read).toBe(true)
  expect(caps.readAll).toBe(true)
  expect(caps.write).toBe(true)
  expect(caps.addCollaborator).toBe(true)
  expect(caps.closeSubmissions).toBe(true)
  expect(caps.archiveSpace).toBe(true)
  expect(caps.deleteSpace).toBe(true)
  expect(caps.binaryData).toBe(true)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --reporter=verbose tests/google-drive-store.test.mjs
```

- [ ] **Step 3: Implement management ops + capabilities()**

Replace stubs in `lib/google-drive-store.js`:

```js
async addCollaborator(email) {
  // Read accessMode from _event.json
  const event = await this.read('_event.json')
  if (event?.accessMode === 'link') {
    throw new Error('addCollaborator() is not supported in link-access spaces. Share the space URL directly with participants.')
  }
  await this._api('POST', `/drive/v3/files/${this._folderId}/permissions`, {
    role: 'writer', type: 'user', emailAddress: email,
  })
}

async closeSubmissions() {
  const current = await this.read('_event.json')
  await this.write('_event.json', { ...(current ?? {}), closed: true })
}

async archiveSpace() {
  const permResp = await this._api('GET', `/drive/v3/files/${this._folderId}/permissions`, undefined, {
    query: { fields: 'permissions(id,role)' }
  })
  const { permissions } = await permResp.json()
  await Promise.all(
    permissions
      .filter(p => p.role !== 'owner')
      .map(p => this._api('PATCH', `/drive/v3/files/${this._folderId}/permissions/${p.id}`, { role: 'reader' }))
  )
}

async deleteSpace() {
  await this._api('DELETE', `/drive/v3/files/${this._folderId}`)
  this._folderId = null
  this._subfolderIdCache = {}
  sessionStorage.removeItem('gd:folderId')
}

capabilities() {
  return {
    createSpace: true, join: true, append: true,
    read: true, readAll: true, write: true,
    addCollaborator: true, closeSubmissions: true,
    archiveSpace: true, deleteSpace: true,
    binaryData: true,
  }
}
```

- [ ] **Step 4: Run all tests — expect full PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: GoogleDriveStore management ops + capabilities()"
```

---

## Task 10: Update existing apps

**Files:**
- Modify: `apps/potluck/organizer.js`
- Modify: `apps/gifts/organizer.js`
- Modify: `apps/gifts/participant.js` (no-op — `WorkerGitHubStore.beginAuth` signature is unchanged; no call-site update needed)

- [ ] **Step 1: Update `apps/potluck/organizer.js`**

Find and replace:
```js
// Before:
const recent = GitHubStore.getRecentRepos()

// After:
const recent = GitHubStore.getRecentSpaces()
```

- [ ] **Step 2: Update `apps/gifts/organizer.js`**

Find and replace:
```js
// Before:
const recentRepos = WorkerGitHubStore.getRecentRepos()
let activeRepo = repoParam ?? null
if (!activeRepo && recentRepos.length > 0) {
  activeRepo = recentRepos[0]

// After:
const recentRepos = WorkerGitHubStore.getRecentSpaces()
let activeRepo = repoParam ?? null
if (!activeRepo && recentRepos.length > 0) {
  activeRepo = recentRepos[0]
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Smoke-test potluck app in browser**

Open `apps/potluck/index.html` directly in the browser (or via a local server). Verify the organizer view loads without JS errors in the console.

- [ ] **Step 5: Commit**

```bash
git add apps/potluck/organizer.js apps/gifts/organizer.js
git commit -m "fix: update apps to use renamed saveRecentSpace/getRecentSpaces"
```

---

## Task 11: gifts-drive.html — Google Drive demo

**Files:**
- Create: `apps/gifts/gifts-drive.html`
- Create: `apps/gifts/main-drive.js`

This is a side-by-side port of the GitHub gifts app using `GoogleDriveStore`. It diverges where the backends differ: no invite token, `space` URL param instead of `repo`, email display in participant list.

- [ ] **Step 1: Create `apps/gifts/gifts-drive.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gift Registry (Google Drive)</title>
  <link rel="stylesheet" href="gifts.css">
</head>
<body>
  <div id="app">Authenticating...</div>
  <script type="module" src="main-drive.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `apps/gifts/main-drive.js`**

```js
// apps/gifts/main-drive.js
// Gift Registry backed by Google Drive.
// URL params:
//   ?mode=organizer            → organizer view (create/manage event)
//   ?mode=participant&space=X  → participant view (join + claim)

import { GoogleDriveStore } from '../../lib/google-drive-store.js'

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Register a Google OAuth app at console.cloud.google.com.
// Authorised redirect URI: this page's URL (e.g. http://localhost:5500/apps/gifts/gifts-drive.html)
// Enable the Google Drive API in the Cloud Console.
const CLIENT_ID = '<GOOGLE_CLIENT_ID>'
// ─────────────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const params     = new URLSearchParams(location.search)
const mode       = params.get('mode')
const spaceParam = params.get('space')

async function main() {
  const store = await GoogleDriveStore.init({ clientId: CLIENT_ID })
  if (!store) return  // redirecting to Google

  if (mode === 'participant') {
    await renderParticipant(store)
  } else {
    await renderOrganizer(store)
  }
}

// ── ORGANIZER ─────────────────────────────────────────────────────────────────

async function renderOrganizer(store) {
  const app     = document.getElementById('app')
  const recentSpaces = GoogleDriveStore.getRecentSpaces()
  let activeSpace    = spaceParam ?? recentSpaces[0] ?? null

  if (activeSpace) store._folderId = activeSpace

  async function renderDashboard() {
    const wishlist    = activeSpace ? await store.read('_wishlist.json') : null
    const participants = activeSpace ? await store.readAll() : []

    const claims = {}
    for (const { username, latest } of participants) {
      if (latest?.item) {
        if (!claims[latest.item]) claims[latest.item] = []
        claims[latest.item].push(username)
      }
    }

    const items     = wishlist?.items ?? []
    const joinUrl   = activeSpace
      ? `${location.origin}${location.pathname}?mode=participant&space=${activeSpace}`
      : null

    app.innerHTML = `
      <h1>🎁 Gift Registry (Google Drive)</h1>
      ${activeSpace ? `<p style="font-size:0.85em;opacity:0.6">Space: ${esc(activeSpace)}</p>` : ''}
      <section id="create">
        <h2>Create event</h2>
        <input id="evtName" placeholder="Event name">
        <label>
          <input type="radio" name="mode" value="email" checked> Email invite (private)
        </label>
        <label>
          <input type="radio" name="mode" value="link"> Link sharing (anyone)
        </label>
        <button id="btnCreate">Create</button>
      </section>
      ${activeSpace ? `
        <section id="wishlist">
          <h2>Wish list</h2>
          <textarea id="itemsInput" placeholder="One item per line">${(items).join('\n')}</textarea>
          <button id="btnSaveWishlist">Save wish list</button>
        </section>
        <section id="participants">
          <h2>Participants</h2>
          ${participants.length === 0
            ? '<p>No submissions yet.</p>'
            : participants.map(p =>
                `<p>${esc(p.username)}: ${esc(p.latest?.item ?? '—')}</p>`
              ).join('')}
        </section>
        <section id="invite">
          <h2>Invite link</h2>
          <input value="${esc(joinUrl)}" readonly style="width:100%">
        </section>
        <section>
          <button id="btnClose">Close submissions</button>
          <button id="btnDelete">Delete event</button>
        </section>
      ` : ''}
    `

    document.getElementById('btnCreate')?.addEventListener('click', async () => {
      const name = document.getElementById('evtName').value.trim()
      const accessMode = document.querySelector('input[name="mode"]:checked').value
      if (!name) return
      activeSpace = await store.createSpace(name, { accessMode })
      await renderDashboard()
    })

    document.getElementById('btnSaveWishlist')?.addEventListener('click', async () => {
      const lines = document.getElementById('itemsInput').value.split('\n').map(s => s.trim()).filter(Boolean)
      await store.write('_wishlist.json', { items: lines })
      await renderDashboard()
    })

    document.getElementById('btnClose')?.addEventListener('click', async () => {
      await store.closeSubmissions()
      alert('Submissions closed.')
    })

    document.getElementById('btnDelete')?.addEventListener('click', async () => {
      if (!confirm('Delete this event permanently?')) return
      await store.deleteSpace()
      activeSpace = null
      await renderDashboard()
    })
  }

  await renderDashboard()
}

// ── PARTICIPANT ───────────────────────────────────────────────────────────────

async function renderParticipant(store) {
  const app = document.getElementById('app')
  if (!spaceParam) {
    app.innerHTML = `<p>No space ID in URL. Ask the organizer for the participant link.</p>`
    return
  }

  app.innerHTML = `<p>Joining registry…</p>`
  try {
    await store.join(spaceParam)
  } catch (e) {
    app.innerHTML = `<p style="color:red">Failed to join: ${esc(e.message)}</p>`
    return
  }

  const wishlist = await store.read('_wishlist.json')
  const items    = wishlist?.items ?? []

  app.innerHTML = `
    <h1>🎁 Gift Registry (Google Drive)</h1>
    <p>Signed in as: ${esc(store.userEmail)}</p>
    <h2>Pick a gift</h2>
    ${items.length === 0
      ? '<p>No items on the wish list yet. Check back later.</p>'
      : items.map((item, i) => `
          <label>
            <input type="radio" name="item" value="${esc(item)}"> ${esc(item)}
          </label><br>
        `).join('')}
    <button id="btnClaim">Claim item</button>
    <p id="status"></p>
  `

  document.getElementById('btnClaim')?.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="item"]:checked')?.value
    if (!selected) return
    await store.append({ item: selected }, { prefix: store.userEmail })
    document.getElementById('status').textContent = `You claimed: ${selected}`
  })
}

main().catch(e => {
  document.getElementById('app').innerHTML = `<p style="color:red">Error: ${esc(e.message)}</p>`
  console.error(e)
})
```

- [ ] **Step 3: Run full test suite — verify no regressions**

```bash
npm test
```

- [ ] **Step 4: Manual browser smoke test**

1. Open `apps/gifts/gifts-drive.html` in a browser via a local static server (e.g. `npx serve .` or VS Code Live Server).
2. Replace `<GOOGLE_CLIENT_ID>` in `main-drive.js` with a real Google OAuth app client ID (register at console.cloud.google.com, enable Drive API, add redirect URI for your local server URL).
3. Walk through organizer flow: sign in → create event → add wish list → copy join URL.
4. Open join URL in another tab (or incognito) → sign in → pick a gift.
5. Return to organizer tab → refresh → verify participant appears.

- [ ] **Step 5: Commit**

```bash
git add apps/gifts/gifts-drive.html apps/gifts/main-drive.js
git commit -m "feat: add gifts-drive.html — Google Drive backed gifts demo"
```

---

## Final check

- [ ] **Run full test suite one last time**

```bash
npm test
```

Expected: all tests pass, no unexpected skips.

- [ ] **Verify file map is complete**

```bash
ls lib/capabilities.js lib/anytrunk.js lib/google-drive-store.js
ls tests/capabilities.test.mjs tests/google-drive-store.test.mjs
ls apps/gifts/gifts-drive.html apps/gifts/main-drive.js
```

- [ ] **Final commit**

```bash
git add -A
git status  # verify nothing unexpected
git commit -m "feat: multi-backend abstraction complete (capabilities, GoogleDriveStore, AnyTrunk)"
```
