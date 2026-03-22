# PotluckApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `lib/github-store.js` — a vanilla ES module library that uses GitHub as a zero-backend shared datastore — plus `apps/potluck/index.html`, a demo app showing organizer and participant flows.

**Architecture:** `GitHubStore` is a class-based ES module with no dependencies. It uses the GitHub Contents API for data operations and the GitHub OAuth flow (via a public CORS proxy) for auth. The potluck app imports the library via a relative path and runs two modes (`?mode=organizer` / `?mode=participant`) from a single HTML file.

**Tech Stack:** Vanilla JS (ES modules), GitHub REST API v3, `cors-anywhere` CORS proxy (MVP), Node.js 18+ for tests (native fetch, no test framework)

---

## File Map

| File | Responsibility |
|---|---|
| `lib/github-store.js` | `GitHubStore` class — all GitHub API interaction, auth, data ops |
| `apps/potluck/index.html` | Potluck demo app — organizer + participant UI |
| `tests/github-store.test.mjs` | Unit tests for library (Node.js, no framework) |
| `tests/helpers/mock-browser.mjs` | Minimal browser API mocks (sessionStorage, localStorage, location) |
| `tests/helpers/mock-fetch.mjs` | Configurable fetch mock for GitHub API responses |

---

## Task 1: Project Scaffold

**Files:**
- Create: `lib/github-store.js`
- Create: `apps/potluck/index.html`
- Create: `tests/github-store.test.mjs`
- Create: `tests/helpers/mock-browser.mjs`
- Create: `tests/helpers/mock-fetch.mjs`

- [ ] **Step 1: Create the library stub**

```js
// lib/github-store.js
export class GitHubStore {
  constructor({ clientId, clientSecret, token = null, repoFullName = null } = {}) {
    this._clientId = clientId
    this._clientSecret = clientSecret
    this._token = token
    this._repoFullName = repoFullName
    this._username = null
  }

  get isAuthenticated() { return !!this._token }
  get username() { return this._username }
}
```

- [ ] **Step 2: Create the potluck app stub**

```html
<!-- apps/potluck/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potluck</title>
</head>
<body>
  <p>Loading...</p>
  <script type="module">
    import { GitHubStore } from '../../lib/github-store.js'
    console.log('GitHubStore loaded', GitHubStore)
  </script>
</body>
</html>
```

- [ ] **Step 3: Create the browser API mocks**

```js
// tests/helpers/mock-browser.mjs
// Call reset() between tests to clear storage state.

function makeStorage() {
  let store = {}
  return {
    getItem:    k     => store[k] ?? null,
    setItem:    (k,v) => { store[k] = String(v) },
    removeItem: k     => { delete store[k] },
    clear:      ()    => { store = {} },
    _store:     () => store,
  }
}

export const sessionStorage = makeStorage()
export const localStorage   = makeStorage()

export let location = { href: 'http://localhost/', search: '' }
export function setLocation(href) {
  location = { href, search: href.includes('?') ? '?' + href.split('?')[1] : '' }
}

export function reset() {
  sessionStorage.clear()
  localStorage.clear()
  setLocation('http://localhost/')
}

// Patch globals so the library picks them up
global.sessionStorage = sessionStorage
global.localStorage   = localStorage
global.location       = location
```

- [ ] **Step 4: Create the fetch mock**

```js
// tests/helpers/mock-fetch.mjs
let _handler = null

export function mockFetch(handler) { _handler = handler }
export function clearFetch()       { _handler = null }

global.fetch = async (url, opts = {}) => {
  if (!_handler) throw new Error(`Unexpected fetch: ${url}`)
  const result = await _handler(url, opts)
  // handler returns { status, body } — we wrap it
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    json: async () => JSON.parse(body),
    text: async () => body,
  }
}
```

- [ ] **Step 5: Create the test runner**

```js
// tests/github-store.test.mjs
import { reset } from './helpers/mock-browser.mjs'
import { clearFetch } from './helpers/mock-fetch.mjs'
import { GitHubStore } from '../lib/github-store.js'

let passed = 0, failed = 0

function test(name, fn) {
  reset()
  clearFetch()
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      result
        .then(() => { console.log('✓', name); passed++ })
        .catch(e  => { console.error('✗', name, '\n ', e.message); failed++ })
    } else {
      console.log('✓', name); passed++
    }
  } catch(e) {
    console.error('✗', name, '\n ', e.message); failed++
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function assertEqual(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

// ── Tests follow below each Task ──

// Placeholder to verify the harness works
test('GitHubStore can be instantiated', () => {
  const s = new GitHubStore({ clientId: 'id', clientSecret: 'secret' })
  assert(!s.isAuthenticated, 'should not be authenticated with no token')
  assert(s.username === null, 'username should be null')
})

// Summary (runs after all sync tests; async results trickle in above)
setTimeout(() => console.log(`\n${passed} passed, ${failed} failed`), 100)
```

- [ ] **Step 6: Run tests to confirm harness works**

```bash
node tests/github-store.test.mjs
```
Expected output:
```
✓ GitHubStore can be instantiated
1 passed, 0 failed
```

- [ ] **Step 7: Commit**

```bash
git add lib/github-store.js apps/potluck/index.html tests/
git commit -m "feat: project scaffold, test harness, library stub"
```

---

## Task 2: Auth — `beginAuth` + `completeAuth` + `init`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

The auth flow:
1. `beginAuth(clientId, clientSecret)` — stores credentials + random CSRF state in `sessionStorage`, then redirects to GitHub's OAuth URL
2. `completeAuth()` — reads credentials from `sessionStorage`, exchanges `?code=` for a token via the CORS proxy, stores token in `sessionStorage`
3. `init(config)` — orchestrates: complete if `?code=` present, rehydrate if token in storage, else begin

CORS proxy endpoint: `https://cors-anywhere.herokuapp.com/https://github.com/login/oauth/access_token`

- [ ] **Step 1: Write failing tests for `beginAuth`**

Add to `tests/github-store.test.mjs`:

```js
import { sessionStorage, setLocation } from './helpers/mock-browser.mjs'

// Track redirects: override the global.location set by mock-browser.mjs
// with a settable property descriptor so we can capture beginAuth's redirect.
let lastRedirect = null
Object.defineProperty(global, 'location', {
  configurable: true,
  get: () => ({ href: lastRedirect ?? 'http://localhost/', search: '' }),
  set: (v) => { lastRedirect = typeof v === 'string' ? v : v.href },
})

test('beginAuth stores credentials and state in sessionStorage', () => {
  GitHubStore.beginAuth('my-client-id', 'my-secret')
  const stored = JSON.parse(sessionStorage.getItem('gh:auth'))
  assertEqual(stored.clientId, 'my-client-id')
  assertEqual(stored.clientSecret, 'my-secret')
  assert(stored.state && stored.state.length > 8, 'state should be a random string')
})

test('beginAuth redirects to GitHub OAuth URL', () => {
  lastRedirect = null
  GitHubStore.beginAuth('my-client-id', 'my-secret')
  assert(lastRedirect?.includes('github.com/login/oauth/authorize'), 'should redirect to GitHub')
  assert(lastRedirect?.includes('client_id=my-client-id'), 'should include client_id')
  assert(lastRedirect?.includes('scope=repo'), 'should request repo scope')
})
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
node tests/github-store.test.mjs
```
Expected: `✗ beginAuth stores credentials...` and `✗ beginAuth redirects...`

- [ ] **Step 3: Implement `beginAuth`**

Add to `lib/github-store.js` (inside the class):

```js
static beginAuth(clientId, clientSecret) {
  const state = crypto.randomUUID()
  sessionStorage.setItem('gh:auth', JSON.stringify({ clientId, clientSecret, state }))
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'repo')
  url.searchParams.set('state', state)
  location.href = url.toString()
}
```

- [ ] **Step 4: Run — confirm `beginAuth` tests pass**

```bash
node tests/github-store.test.mjs
```
Expected: `✓ beginAuth stores credentials...`, `✓ beginAuth redirects...`

- [ ] **Step 5: Write failing tests for `completeAuth`**

```js
import { mockFetch } from './helpers/mock-fetch.mjs'

test('completeAuth exchanges code for token and stores it', async () => {
  // Simulate: beginAuth was called, page redirected back with ?code=
  sessionStorage.setItem('gh:auth', JSON.stringify({
    clientId: 'id', clientSecret: 'secret', state: 'abc123'
  }))
  setLocation('http://localhost/?code=mycode&state=abc123')
  global.location = { href: 'http://localhost/?code=mycode&state=abc123',
                       search: '?code=mycode&state=abc123' }

  mockFetch((url) => {
    if (url.includes('access_token')) {
      return { status: 200, body: { access_token: 'gho_testtoken' } }
    }
    if (url.includes('api.github.com/user')) {
      return { status: 200, body: { login: 'johndoe' } }
    }
  })

  const store = await GitHubStore.completeAuth()
  assert(store.isAuthenticated, 'should be authenticated')
  assertEqual(store.username, 'johndoe')
  assertEqual(sessionStorage.getItem('gh:token'), 'gho_testtoken')
})

test('completeAuth throws if state does not match', async () => {
  sessionStorage.setItem('gh:auth', JSON.stringify({
    clientId: 'id', clientSecret: 'secret', state: 'expected-state'
  }))
  global.location = { search: '?code=x&state=wrong-state' }
  let threw = false
  try { await GitHubStore.completeAuth() } catch { threw = true }
  assert(threw, 'should throw on state mismatch')
})
```

- [ ] **Step 6: Run — confirm `completeAuth` tests fail**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 7: Implement `completeAuth`**

```js
static async completeAuth() {
  const stored = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}')
  const params = new URLSearchParams(location.search)
  const code  = params.get('code')
  const state = params.get('state')
  if (!code) throw new Error('No code in URL')
  if (state !== stored.state) throw new Error('State mismatch — possible CSRF')

  const resp = await fetch(
    'https://cors-anywhere.herokuapp.com/https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: stored.clientId,
        client_secret: stored.clientSecret,
        code,
      }),
    }
  )
  const { access_token } = await resp.json()
  if (!access_token) throw new Error('Token exchange failed')
  sessionStorage.setItem('gh:token', access_token)

  // Fetch and cache current username
  const userResp = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${access_token}` }
  })
  const { login } = await userResp.json()
  sessionStorage.setItem('gh:username', login)

  return new GitHubStore({ clientId: stored.clientId, clientSecret: stored.clientSecret,
                           token: access_token, _username: login })
}
```

Also update the constructor to accept `_username`:
```js
constructor({ clientId, clientSecret, token = null, repoFullName = null, _username = null } = {}) {
  this._clientId     = clientId
  this._clientSecret = clientSecret
  this._token        = token
  this._repoFullName = repoFullName
  this._username     = _username
}
```

- [ ] **Step 8: Write and implement `init`**

Write the test first:
```js
test('init rehydrates from sessionStorage when token exists', async () => {
  sessionStorage.setItem('gh:token',    'gho_existing')
  sessionStorage.setItem('gh:username', 'existinguser')

  const store = await GitHubStore.init({ clientId: 'id', clientSecret: 'secret' })
  assert(store.isAuthenticated)
  assertEqual(store.username, 'existinguser')
})
```

Run to confirm it fails, then implement:
```js
static async init({ clientId, clientSecret, repoFullName = null, inviteToken = null } = {}) {
  const params    = new URLSearchParams(location.search)
  const code      = params.get('code')
  const existingToken    = sessionStorage.getItem('gh:token')
  const existingUsername = sessionStorage.getItem('gh:username')

  if (code) {
    // Returning from GitHub OAuth redirect
    const store = await GitHubStore.completeAuth()
    store._repoFullName = repoFullName
    // Clean ?code= and ?state= from URL without reload
    const clean = location.href.split('?')[0]
    history.replaceState(null, '', clean)
    return store
  }

  if (existingToken) {
    // Rehydrate from sessionStorage
    return new GitHubStore({
      clientId, clientSecret,
      token: existingToken, repoFullName,
      _username: existingUsername,
    })
  }

  // Not authenticated — redirect to GitHub
  GitHubStore.beginAuth(clientId, clientSecret)
  return null  // unreachable; browser redirects
}
```

- [ ] **Step 9: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: GitHubStore auth — beginAuth, completeAuth, init"
```

---

## Task 3: `createSpace` + `_event.json`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

`createSpace(name, { private: true })` must:
1. `POST /user/repos` to create the repo
2. `PUT /repos/{owner}/{repo}/contents/_event.json` to write event metadata
3. Return `repoFullName` as `"{owner}/{name}"`

Helper needed: `_apiCall(method, path, body)` — a private method that wraps fetch with the auth token and base URL. Add this first; it will be reused by all subsequent data ops.

- [ ] **Step 1: Write failing test for `_apiCall` helper**

```js
test('_apiCall sends Authorization header with token', async () => {
  let capturedHeaders = null
  mockFetch((url, opts) => {
    capturedHeaders = opts.headers
    return { status: 200, body: { ok: true } }
  })
  const store = new GitHubStore({ token: 'gho_mytoken' })
  await store._apiCall('GET', '/user')
  assert(capturedHeaders?.Authorization === 'Bearer gho_mytoken',
    'should send bearer token')
})
```

- [ ] **Step 2: Run — confirm it fails, then implement `_apiCall`**

```js
async _apiCall(method, path, body = undefined) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const resp = await fetch(url, opts)
  if (!resp.ok && resp.status !== 404) {
    const err = await resp.text()
    throw new Error(`GitHub API ${method} ${path} → ${resp.status}: ${err}`)
  }
  return resp
}
```

- [ ] **Step 3: Write failing test for `createSpace`**

```js
test('createSpace creates a private repo and writes _event.json', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body ?? '{}') })
    if (url.includes('/user/repos')) {
      return { status: 201, body: { full_name: 'johndoe/potluck-test', owner: { login: 'johndoe' } } }
    }
    if (url.includes('_event.json')) {
      return { status: 201, body: { content: { path: '_event.json' } } }
    }
  })

  const store = new GitHubStore({ token: 'tok', _username: 'johndoe' })
  const repoFullName = await store.createSpace('potluck-test')

  assertEqual(repoFullName, 'johndoe/potluck-test')
  const repoCall = calls.find(c => c.url.includes('/user/repos'))
  assert(repoCall.body.private === true, 'repo should be private')
  const eventCall = calls.find(c => c.url.includes('_event.json'))
  assert(eventCall, 'should write _event.json')
  const content = JSON.parse(atob(eventCall.body.content))
  assertEqual(content.name, 'potluck-test')
  assertEqual(content.owner, 'johndoe')
})
```

Note: `atob` is globally available in Node 18+.

- [ ] **Step 4: Run — confirm test fails**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 5: Implement `createSpace`**

```js
async createSpace(name, { private: isPrivate = true } = {}) {
  const repoResp = await this._apiCall('POST', '/user/repos', {
    name, private: isPrivate, auto_init: false,
  })
  const { full_name, owner } = await repoResp.json()
  this._repoFullName = full_name

  const event = { name, created: new Date().toISOString(), owner: owner.login }
  await this._writeFile('_event.json', event, null)  // null SHA = new file

  return full_name
}
```

- [ ] **Step 6: Write `_writeFile` private helper** (used by `createSpace`, `write`, `append`)

```js
async _writeFile(path, data, sha) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
  const body = { message: `update ${path}`, content }
  if (sha) body.sha = sha
  return this._apiCall('PUT', `/repos/${this._repoFullName}/contents/${path}`, body)
}
```

- [ ] **Step 7: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: createSpace — creates GitHub repo and writes _event.json"
```

---

## Task 4: `join()` — Participant Self-Registration

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

`join(repoFullName, inviteToken)` uses TWO tokens:
1. `inviteToken` (organizer's PAT) → `PUT /repos/{owner}/{repo}/collaborators/{username}`
2. `this._token` (participant's own OAuth token) → `GET /user/repository_invitations` → `PATCH .../invitations/{id}`

Step 2 is skipped when the PUT response body is empty (already a collaborator). Do NOT rely on HTTP status code — GitHub returns a non-empty body when an invitation is created.

- [ ] **Step 1: Write failing tests for `join`**

```js
test('join adds collaborator using inviteToken and auto-accepts invitation', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, headers: opts.headers })
    if (url.includes('/collaborators/')) {
      // Invitation created — non-empty body
      return { status: 201, body: { id: 99, invitee: { login: 'bob' } } }
    }
    if (url.includes('repository_invitations') && opts.method !== 'PATCH') {
      return { status: 200, body: [{ id: 99, repository: { full_name: 'johndoe/potluck' } }] }
    }
    if (url.includes('repository_invitations/99')) {
      return { status: 204, body: '' }
    }
  })

  const store = new GitHubStore({ token: 'participant-token', _username: 'bob' })
  await store.join('johndoe/potluck', 'invite-pat')

  const addCall = calls.find(c => c.url.includes('/collaborators/bob'))
  assert(addCall, 'should call PUT /collaborators/bob')
  assert(addCall.headers.Authorization === 'Bearer invite-pat', 'should use inviteToken')

  const acceptCall = calls.find(c => c.url.includes('invitations/99'))
  assert(acceptCall, 'should call PATCH /invitations/99')
  assert(acceptCall.headers.Authorization === 'Bearer participant-token',
    'should use participant own token')
})

test('join is idempotent — skips accept step when already a collaborator', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url })
    if (url.includes('/collaborators/')) {
      return { status: 204, body: '' }  // empty body = already a collaborator
    }
  })

  const store = new GitHubStore({ token: 'tok', _username: 'bob' })
  await store.join('johndoe/potluck', 'invite-pat')

  const acceptCalls = calls.filter(c => c.url.includes('repository_invitations'))
  assert(acceptCalls.length === 0, 'should not touch invitations when already a collaborator')
})
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 3: Implement `join`**

```js
async join(repoFullName, inviteToken) {
  this._repoFullName = repoFullName
  const [owner, repo] = repoFullName.split('/')

  // Step 1: Add collaborator using organizer's invite token
  const addResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${this._username}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${inviteToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'push' }),
    }
  )

  // If body is empty, user is already a collaborator — nothing more to do
  const text = await addResp.text()
  if (!text || !text.trim()) return

  // Step 2: Auto-accept the invitation using participant's own token
  const invitations = await fetch('https://api.github.com/user/repository_invitations', {
    headers: {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  })
  const list = await invitations.json()
  const invite = list.find(i => i.repository.full_name === repoFullName)
  if (!invite) throw new Error('Invitation not found after collaborator add')

  await fetch(`https://api.github.com/user/repository_invitations/${invite.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  })
}
```

- [ ] **Step 4: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: join() — dual-token collaborator self-registration with idempotency"
```

---

## Task 5: `write` + `append`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

`write(path, data)` — create or overwrite a file. Must GET the file first to retrieve SHA if it exists, then PUT.

`append(data, { prefix })` — write to `{prefix}/{iso-timestamp}.json`. Timestamp path is always new, so no SHA needed.

- [ ] **Step 1: Write failing tests**

```js
test('write creates a new file when it does not exist', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, body: opts.body })
    if (opts.method === 'GET' || !opts.method) return { status: 404, body: { message: 'Not Found' } }
    return { status: 201, body: { content: { path: 'bob/dish.json' } } }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.write('bob/dish.json', { dish: 'lasagna' })

  const putCall = calls.find(c => c.method === 'PUT')
  assert(putCall, 'should PUT the file')
  const body = JSON.parse(putCall.body)
  assert(!body.sha, 'should not include sha for new file')
  const decoded = JSON.parse(decodeURIComponent(escape(atob(body.content))))
  assertEqual(decoded.dish, 'lasagna')
})

test('write includes SHA when file already exists', async () => {
  const existingContent = btoa(unescape(encodeURIComponent(JSON.stringify({ dish: 'old' }))))
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, body: opts.body })
    if (!opts.method || opts.method === 'GET') {
      return { status: 200, body: { sha: 'abc123', content: existingContent } }
    }
    return { status: 200, body: {} }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.write('bob/dish.json', { dish: 'updated' })

  const putCall = calls.find(c => c.method === 'PUT')
  const body = JSON.parse(putCall.body)
  assertEqual(body.sha, 'abc123')
})

test('append writes to a timestamped path under prefix', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url })
    return { status: 201, body: {} }
  })

  const before = Date.now()
  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.append({ dish: 'tiramisu' }, { prefix: 'bob' })
  const after = Date.now()

  const putCall = calls.find(c => c.method === 'PUT')
  assert(putCall.url.includes('/bob/'), 'path should include prefix')
  assert(putCall.url.endsWith('.json'), 'path should end in .json')
  const timestamp = putCall.url.match(/\/bob\/(.+)\.json/)[1]
  const ts = new Date(decodeURIComponent(timestamp)).getTime()
  assert(ts >= before && ts <= after, 'timestamp should be current time')
})
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 3: Implement `write` and `append`**

```js
async write(path, data) {
  // GET existing file to obtain SHA (needed for updates)
  const getResp = await this._apiCall('GET', `/repos/${this._repoFullName}/contents/${path}`)
  const sha = getResp.ok ? (await getResp.json()).sha : null
  await this._writeFile(path, data, sha)
}

async append(data, { prefix }) {
  const timestamp = new Date().toISOString()
  const path = `${prefix}/${timestamp}.json`
  await this._writeFile(path, data, null)  // new file, no SHA
}
```

- [ ] **Step 4: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: write() and append() data operations"
```

---

## Task 6: `read` + `list`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

`read(path)` — GET file, decode base64 content, return parsed JSON. Return `null` on 404.

`list(prefix)` — GET directory listing, return sorted `[{ path, sha }]` for files only.

- [ ] **Step 1: Write failing tests**

```js
test('read returns parsed JSON for an existing file', async () => {
  const data = { dish: 'lasagna' }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
  mockFetch(() => ({ status: 200, body: { content: encoded, sha: 'abc' } }))

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.read('bob/dish.json')
  assertEqual(result.dish, 'lasagna')
})

test('read returns null for a missing file', async () => {
  mockFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.read('bob/dish.json')
  assert(result === null)
})

test('list returns sorted array of { path, sha } for files in a directory', async () => {
  mockFetch(() => ({
    status: 200,
    body: [
      { type: 'file', path: 'bob/2026-03-21T15:00:00.000Z.json', sha: 'sha2' },
      { type: 'file', path: 'bob/2026-03-21T14:00:00.000Z.json', sha: 'sha1' },
      { type: 'dir',  path: 'bob/subdir', sha: 'sha3' },  // dirs excluded
    ]
  }))
  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.list('bob')
  assertEqual(result.length, 2)
  assertEqual(result[0].path, 'bob/2026-03-21T14:00:00.000Z.json')  // sorted ascending
  assertEqual(result[1].sha, 'sha2')
})
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 3: Implement `read` and `list`**

```js
async read(path) {
  const resp = await this._apiCall('GET', `/repos/${this._repoFullName}/contents/${path}`)
  if (!resp.ok) return null
  const { content } = await resp.json()
  return JSON.parse(decodeURIComponent(escape(atob(content.replace(/\n/g, '')))))
}

async list(prefix) {
  const resp = await this._apiCall('GET', `/repos/${this._repoFullName}/contents/${prefix}`)
  if (!resp.ok) return []
  const items = await resp.json()
  return items
    .filter(i => i.type === 'file')
    .map(i => ({ path: i.path, sha: i.sha }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
```

- [ ] **Step 4: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: read() and list() data operations"
```

---

## Task 7: `readAll`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

`readAll()` enumerates the repo root, skips entries starting with `_`, reads each participant directory, and returns the participant array.

- [ ] **Step 1: Write failing test**

```js
test('readAll returns participants with entries and latest, skipping _ entries', async () => {
  const encode = d => btoa(unescape(encodeURIComponent(JSON.stringify(d))))

  mockFetch((url) => {
    // Root listing
    if (url.endsWith('/contents/') || url.endsWith('/contents')) {
      return { status: 200, body: [
        { type: 'file', name: '_event.json', path: '_event.json', sha: 'e1' },
        { type: 'dir',  name: 'bob',         path: 'bob',         sha: 'd1' },
        { type: 'dir',  name: 'tom',         path: 'tom',         sha: 'd2' },
      ]}
    }
    // bob's directory
    if (url.includes('/contents/bob') && !url.includes('.json')) {
      return { status: 200, body: [
        { type: 'file', path: 'bob/2026-03-21T14:00:00.000Z.json', sha: 's1' },
        { type: 'file', path: 'bob/2026-03-21T15:00:00.000Z.json', sha: 's2' },
      ]}
    }
    // tom's directory — empty
    if (url.includes('/contents/tom') && !url.includes('.json')) {
      return { status: 200, body: [] }
    }
    // bob's files
    if (url.includes('bob/2026-03-21T14')) return { status: 200, body: { content: encode({ dish: 'lasagna' }), sha: 's1' } }
    if (url.includes('bob/2026-03-21T15')) return { status: 200, body: { content: encode({ dish: 'tiramisu' }), sha: 's2' } }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.readAll()

  assertEqual(result.length, 2)
  const bob = result.find(r => r.username === 'bob')
  assert(bob, 'bob should be in results')
  assertEqual(bob.entries.length, 2)
  assertEqual(bob.latest.dish, 'tiramisu')

  const tom = result.find(r => r.username === 'tom')
  assert(tom, 'tom should be in results')
  assertEqual(tom.entries.length, 0)
  assert(tom.latest === null)
})
```

- [ ] **Step 2: Run — confirm test fails**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 3: Implement `readAll`**

```js
async readAll() {
  const rootResp = await this._apiCall('GET', `/repos/${this._repoFullName}/contents/`)
  const root = await rootResp.json()

  const participantDirs = root.filter(
    i => i.type === 'dir' && !i.name.startsWith('_')
  )

  return Promise.all(participantDirs.map(async dir => {
    const files = await this.list(dir.name)
    const entries = await Promise.all(
      files.map(async f => ({ path: f.path, data: await this.read(f.path) }))
    )
    return {
      username: dir.name,
      entries,
      latest: entries.length > 0 ? entries[entries.length - 1].data : null,
    }
  }))
}
```

- [ ] **Step 4: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: readAll() — aggregate all participant entries"
```

---

## Task 8: State Persistence (`localStorage`)

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

After `createSpace()` and `join()` succeed, save `repoFullName` to `localStorage` under `potluck:recentRepos`. The potluck app will read this on load to offer "Continue" links.

This is app-convenience state. The library exposes two small helpers:
- `GitHubStore.saveRecentRepo(repoFullName)` — static, called internally by `createSpace` and `join`
- `GitHubStore.getRecentRepos()` — static, returns `[repoFullName, ...]`

- [ ] **Step 1: Write failing tests**

```js
test('saveRecentRepo stores repoFullName in localStorage', () => {
  GitHubStore.saveRecentRepo('johndoe/potluck-test')
  const stored = GitHubStore.getRecentRepos()
  assert(stored.includes('johndoe/potluck-test'))
})

test('getRecentRepos deduplicates and limits to 5', () => {
  for (let i = 0; i < 7; i++) GitHubStore.saveRecentRepo(`owner/repo-${i}`)
  const stored = GitHubStore.getRecentRepos()
  assert(stored.length <= 5, 'should cap at 5 recent repos')
})
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
node tests/github-store.test.mjs
```

- [ ] **Step 3: Implement**

```js
static saveRecentRepo(repoFullName) {
  const key = 'potluck:recentRepos'
  const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
  const updated = [repoFullName, ...existing.filter(r => r !== repoFullName)].slice(0, 5)
  localStorage.setItem(key, JSON.stringify(updated))
}

static getRecentRepos() {
  return JSON.parse(localStorage.getItem('potluck:recentRepos') ?? '[]')
}
```

Also add `GitHubStore.saveRecentRepo(full_name)` at the end of `createSpace()`, and `GitHubStore.saveRecentRepo(repoFullName)` at the end of `join()`.

Also add `addCollaborator` as a thin wrapper (spec requires it on the API surface; the potluck flow uses `join()` + PAT instead, but the method should exist for apps that manage collaborators directly):

```js
async addCollaborator(username) {
  await this._apiCall('PUT',
    `/repos/${this._repoFullName}/collaborators/${username}`,
    { permission: 'push' }
  )
}
```

- [ ] **Step 4: Run all tests**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: localStorage state persistence for recent repos"
```

---

## Task 9: Potluck App — HTML Shell + Routing

**Files:**
- Modify: `apps/potluck/index.html`

The single HTML file:
- Reads `?mode=` from the URL (`organizer` or `participant`)
- Reads `?repo=` and `?invite=` params
- Initialises `GitHubStore.init()`
- Renders the correct UI section

Config constants live at the top of the `<script>` block.

- [ ] **Step 1: Replace stub with full shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potluck</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 2rem auto; padding: 0 1rem; }
    h1   { font-size: 1.2rem; margin-bottom: 0.25rem; }
    .sub { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 0.4rem; margin-top: 0.25rem; border: 1px solid #ccc; border-radius: 4px; }
    button { margin-top: 1rem; padding: 0.5rem 1.2rem; cursor: pointer; }
    table  { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
    td, th { padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; text-align: left; }
    .section { margin-top: 2rem; }
    .divider { border: none; border-top: 1px solid #eee; margin: 1.5rem 0; }
    .badge { background: #e6ffe6; color: #2a7a2a; padding: 0.1rem 0.5rem; border-radius: 3px; font-size: 0.8rem; }
    #status { margin-top: 1rem; color: #c00; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div id="app">Loading...</div>

  <script type="module">
    // ── CONFIG — replace with your GitHub OAuth app credentials ──────────────
    const CLIENT_ID     = 'YOUR_CLIENT_ID_HERE'
    const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE'  // ⚠ see D1 in design spec
    // ─────────────────────────────────────────────────────────────────────────

    import { GitHubStore } from '../../lib/github-store.js'

    const params     = new URLSearchParams(location.search)
    const mode       = params.get('mode')       // 'organizer' | 'participant'
    const repoParam  = params.get('repo')        // e.g. 'johndoe/potluck-2026-03-21'
    const inviteParam = params.get('invite')     // organizer's Fine-Grained PAT

    async function main() {
      const store = await GitHubStore.init({
        clientId:     CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        repoFullName: repoParam,
        inviteToken:  inviteParam,
      })
      if (!store) return  // redirecting to GitHub

      if (mode === 'participant') {
        await renderParticipant(store)
      } else {
        await renderOrganizer(store)
      }
    }

    function setStatus(msg, isError = true) {
      let el = document.getElementById('status')
      if (!el) { el = document.createElement('div'); el.id = 'status'; document.getElementById('app').appendChild(el) }
      el.style.color = isError ? '#c00' : '#2a7a2a'
      el.textContent = msg
    }

    // ── Organizer and Participant renderers follow in Tasks 10 and 11 ──

    main().catch(e => {
      document.getElementById('app').innerHTML = `<p style="color:red">Error: ${e.message}</p>`
      console.error(e)
    })
  </script>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify it redirects to GitHub OAuth**

Serve the directory with any static server (pin port to 3000 — this must match the OAuth callback URL registered in Task 12):
```bash
npx serve . -l 3000
```
Open `http://localhost:3000/apps/potluck/index.html?mode=organizer`

Expected: browser redirects to `github.com/login/oauth/authorize`

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: potluck app shell with routing and auth init"
```

---

## Task 10: Potluck App — Organizer Mode

**Files:**
- Modify: `apps/potluck/index.html`

The `renderOrganizer(store)` function renders in the `#app` div and handles:
1. Create event form
2. "Continue" list from `localStorage`
3. After event creation: PAT instructions + join link generation + live submissions table

- [ ] **Step 1: Implement `renderOrganizer`**

Add inside the `<script type="module">` block, before `main()`:

```js
async function renderOrganizer(store) {
  const app = document.getElementById('app')
  const recentRepos = GitHubStore.getRecentRepos()

  // If we have an active repo (from URL param or will be set after create), go straight to dashboard
  if (store._repoFullName) {
    await renderOrganizerDashboard(store, app)
    return
  }

  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">Signed in as <strong>${store.username}</strong></p>

    <div class="section">
      <strong>Create new event</strong>
      <label>Event name
        <input id="event-name" type="text" value="potluck-${new Date().toISOString().slice(0,10)}" />
      </label>
      <button id="create-btn">Create</button>
    </div>

    ${recentRepos.length ? `
    <hr class="divider">
    <div class="section">
      <strong>Resume a recent event</strong>
      <ul>
        ${recentRepos.map(r => `<li><a href="?mode=organizer&repo=${r}">${r}</a></li>`).join('')}
      </ul>
    </div>` : ''}
    <div id="status"></div>
  `

  document.getElementById('create-btn').onclick = async () => {
    const name = document.getElementById('event-name').value.trim()
    if (!name) return setStatus('Event name required')
    setStatus('Creating repo...', false)
    try {
      const repoFullName = await store.createSpace(name)
      store._repoFullName = repoFullName
      await renderOrganizerDashboard(store, app)
    } catch(e) {
      setStatus(`Error: ${e.message}`)
    }
  }
}

async function renderOrganizerDashboard(store, app) {
  const [owner, repo] = store._repoFullName.split('/')
  const patUrl = `https://github.com/settings/personal-access-tokens/new`
    + `?description=potluck-invite-${repo}`

  const joinBase = `${location.origin}${location.pathname}?mode=participant&repo=${store._repoFullName}`

  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">Signed in as <strong>${store.username}</strong> &nbsp;·&nbsp; <strong>${store._repoFullName}</strong></p>

    <div class="section">
      <strong>Share join link</strong>
      <ol style="font-size:0.9rem;line-height:1.8">
        <li>Create an invite token: <a href="${patUrl}" target="_blank">→ GitHub PAT (administration:write, this repo only)</a></li>
        <li>Paste it here: <input id="pat-input" type="text" placeholder="ghp_..." style="width:260px" /></li>
        <li><button id="copy-btn" disabled>Copy join link</button> <span id="link-preview" style="font-size:0.8rem;color:#666"></span></li>
      </ol>
    </div>

    <hr class="divider">

    <div class="section">
      <strong>Responses</strong> <span style="font-size:0.8rem;color:#888">(refreshes every 30s)</span>
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
    preview.textContent = val ? `${joinBase}&invite=${val}`.slice(0, 60) + '…' : ''
  })

  copyBtn.onclick = () => {
    const link = `${joinBase}&invite=${patInput.value.trim()}`
    navigator.clipboard.writeText(link)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => copyBtn.textContent = 'Copy join link', 2000)
  }

  async function refreshTable() {
    const tbody = document.getElementById('responses-table')
    if (!tbody) return
    try {
      const participants = await store.readAll()
      if (!participants.length) { tbody.innerHTML = '<p style="color:#888">No responses yet.</p>'; return }
      tbody.innerHTML = `<table>
        <thead><tr><th>Participant</th><th>Dish</th><th>Note</th><th>Time</th></tr></thead>
        <tbody>
          ${participants.map(p => {
            const time = p.entries.length
              ? new Date(p.entries[p.entries.length-1].path.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1]).toLocaleTimeString()
              : '—'
            return `<tr>
              <td>${p.username}</td>
              <td>${p.latest?.dish ?? '—'}</td>
              <td>${p.latest?.note ?? ''}</td>
              <td>${time}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>`
    } catch(e) {
      tbody.innerHTML = `<p style="color:#c00">Error loading responses: ${e.message}</p>`
    }
  }

  await refreshTable()
  setInterval(refreshTable, 30_000)
}
```

- [ ] **Step 2: Open in browser — organizer mode**

```bash
npx serve .
```
Open `http://localhost:3000/apps/potluck/index.html?mode=organizer`

Verify:
- Auth flow completes (after GitHub redirects back)
- Create event form appears
- After creating event, dashboard renders with PAT instructions
- "Copy join link" button becomes active after pasting PAT
- Responses table shows "No responses yet"

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: potluck organizer mode — create event, join link, live responses"
```

---

## Task 11: Potluck App — Participant Mode

**Files:**
- Modify: `apps/potluck/index.html`

The `renderParticipant(store)` function handles:
1. Call `store.join(repoFullName, inviteToken)` automatically on load
2. Render submission form (dish + optional note)
3. On submit, call `store.append({ dish, note }, { prefix: store.username })`
4. Show the participant's submission history

- [ ] **Step 1: Implement `renderParticipant`**

Add inside the `<script type="module">` block:

```js
async function renderParticipant(store) {
  const app = document.getElementById('app')

  if (!repoParam) {
    app.innerHTML = `<p>Invalid join link — missing <code>repo</code> parameter.</p>`
    return
  }

  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub"><strong>${repoParam}</strong></p>
    <p>Signed in as <strong>${store.username}</strong> &nbsp;·&nbsp; <span id="join-status">Joining...</span></p>
    <div id="status"></div>
  `

  // Auto-join
  try {
    if (inviteParam) {
      await store.join(repoParam, inviteParam)
    } else {
      store._repoFullName = repoParam  // already a collaborator — just set context
    }
    document.getElementById('join-status').innerHTML = `<span class="badge">joined ✓</span>`
  } catch(e) {
    setStatus(`Join failed: ${e.message}`)
    return
  }

  app.innerHTML += `
    <hr class="divider">
    <div class="section">
      <strong>What are you bringing?</strong>
      <label>Dish
        <input id="dish-input" type="text" placeholder="e.g. tiramisu" />
      </label>
      <label>Note (optional)
        <input id="note-input" type="text" placeholder="e.g. contains nuts" />
      </label>
      <button id="submit-btn">Submit</button>
    </div>
    <hr class="divider">
    <div class="section">
      <strong>Your submissions</strong>
      <div id="history">Loading...</div>
    </div>
  `

  document.getElementById('submit-btn').onclick = async () => {
    const dish = document.getElementById('dish-input').value.trim()
    if (!dish) return setStatus('Dish name required')
    const note = document.getElementById('note-input').value.trim()
    setStatus('Submitting...', false)
    try {
      await store.append({ dish, note }, { prefix: store.username })
      document.getElementById('dish-input').value = ''
      document.getElementById('note-input').value = ''
      setStatus('Submitted!', false)
      await renderHistory(store)
    } catch(e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  await renderHistory(store)
}

async function renderHistory(store) {
  const el = document.getElementById('history')
  if (!el) return
  try {
    const files = await store.list(store.username)
    if (!files.length) { el.innerHTML = '<p style="color:#888">No submissions yet.</p>'; return }

    const entries = await Promise.all(files.map(async f => ({ path: f.path, data: await store.read(f.path) })))
    const latest  = entries[entries.length - 1]

    el.innerHTML = `<table>
      <thead><tr><th>Time</th><th>Dish</th><th>Note</th><th></th></tr></thead>
      <tbody>
        ${entries.map(e => {
          const time = new Date(e.path.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1]).toLocaleTimeString()
          const isCurrent = e.path === latest.path
          return `<tr${isCurrent ? ' style="font-weight:bold"' : ''}>
            <td>${time}</td>
            <td>${e.data.dish}</td>
            <td>${e.data.note ?? ''}</td>
            <td>${isCurrent ? '← current' : ''}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
  } catch(e) {
    el.innerHTML = `<p style="color:#c00">Could not load history: ${e.message}</p>`
  }
}
```

- [ ] **Step 2: Open in browser — participant mode**

With a real join URL (generated by the organizer dashboard):
```
http://localhost:3000/apps/potluck/index.html?mode=participant&repo={owner}/{repo}&invite={PAT}
```

Verify:
- Auth flow completes
- "Joining..." becomes "joined ✓"
- Submission form renders
- Submitting a dish writes to the repo and appears in history
- Re-submitting adds a new entry; latest is bolded

- [ ] **Step 3: Run all unit tests to confirm nothing broken**

```bash
node tests/github-store.test.mjs
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: potluck participant mode — join, submit dish, view history"
```

---

## Task 12: End-to-End Manual Test

No automated test can substitute for the real OAuth + GitHub API flow. Follow these steps with two browser sessions (or two GitHub accounts).

- [ ] **Step 1: Register a GitHub OAuth App**

1. Go to `github.com/settings/developers` → "OAuth Apps" → "New OAuth App"
2. Application name: `PotluckPOC`
3. Homepage URL: `http://localhost:3000`
4. Authorization callback URL: `http://localhost:3000/apps/potluck/index.html`
5. Copy `Client ID` and `Client Secret` into the `CLIENT_ID` / `CLIENT_SECRET` constants in `apps/potluck/index.html`

- [ ] **Step 2: Organizer creates event**

Open `http://localhost:3000/apps/potluck/index.html?mode=organizer`
1. Authenticate with GitHub (Account A)
2. Enter event name, click Create
3. Follow PAT instructions, paste PAT
4. Copy join link

- [ ] **Step 3: Participant joins and submits**

Open the join link in a private browser window (Account B)
1. Authenticate with GitHub
2. Verify "joined ✓" status
3. Submit a dish
4. Verify it appears in history

- [ ] **Step 4: Organizer sees the submission**

Back in organizer window — wait for 30s poll (or reload)
Verify participant's dish appears in the responses table.

- [ ] **Step 5: Participant re-submits**

Submit again from participant window. Verify history shows both entries, latest is current.

- [ ] **Step 6: Participant revisits without join link**

Close participant window. Open `http://localhost:3000/apps/potluck/index.html?mode=participant&repo={owner}/{repo}` (no `invite=` param).
Verify it still works (already a collaborator, join is skipped).

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: complete potluck POC — library + demo app"
```

---

## Summary of Files Produced

| File | Lines (approx) | Purpose |
|---|---|---|
| `lib/github-store.js` | ~200 | The library |
| `apps/potluck/index.html` | ~200 | Demo app |
| `tests/github-store.test.mjs` | ~150 | Unit tests |
| `tests/helpers/mock-browser.mjs` | ~30 | Browser mock |
| `tests/helpers/mock-fetch.mjs` | ~20 | Fetch mock |
