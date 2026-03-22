# GitHub Experience Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement session lifecycle management, participant onboarding, observer mode, and UX improvements to the GitHub backend without requiring a Cloudflare Worker.

**Architecture:** Library-first. `lib/github-store.js` gets all new API methods (TDD — tests first); `apps/potluck/index.html` adds UI on top. Layer 3 fixes are distributed between library and app. All library tasks follow strict TDD: write failing test → implement → confirm passing → commit.

**Tech Stack:** Vanilla JS (ES modules), GitHub REST API v3, Node.js 18+ for tests (native fetch, no framework)

---

## File Map

| File | Changes |
|---|---|
| `lib/github-store.js` | `_apiCall` null-token fix + read-only guard; `closeSubmissions()`, `archiveSpace()`, `deleteSpace()`; `initReadOnly()`, `hasToken()`, `onboardingUrl()`, `onboardingHint()`; 422 handling in `createSpace()`; `beginAuth()` scope update |
| `tests/github-store.test.mjs` | New tests for all library additions |
| `apps/potluck/index.html` | Observer mode; participant onboarding gate; organizer lifecycle controls; enhanced PAT guidance; rate limiting |

Run `npm test` after every commit to confirm no regressions.

---

## Task 1: `_apiCall` — null-token fix and read-only guard

Foundational changes required by all later tasks. The current `_apiCall` sends `Authorization: Bearer null` when the token is null (breaks unauthenticated reads). We also need a `_readOnly` flag to guard write operations on read-only store instances.

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add before `runAll()` in `tests/github-store.test.mjs`:

```js
test('_apiCall omits Authorization header when token is null', async () => {
  let capturedHeaders = null
  mockFetch((url, opts) => {
    capturedHeaders = opts.headers
    return { status: 200, body: {} }
  })
  const store = new GitHubStore({})
  await store._apiCall('GET', '/repos/test/test/contents/')
  assert(!capturedHeaders?.Authorization,
    'should not send Authorization header when token is null')
})

test('_apiCall throws immediately on write when store is read-only', async () => {
  const store = new GitHubStore({ token: 'tok' })
  store._readOnly = true
  let threw = false
  try { await store._apiCall('PUT', '/repos/x/y/contents/foo', { content: 'x' }) }
  catch { threw = true }
  assert(threw, 'should throw for PUT on read-only store')
})

test('join throws immediately when store is read-only', async () => {
  const store = new GitHubStore({ token: 'tok', _username: 'alice' })
  store._readOnly = true
  let threw = false
  try { await store.join('owner/repo', 'invite-pat') }
  catch { threw = true }
  assert(threw, 'should throw for join on read-only store')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: 3 new failures

- [ ] **Step 3: Update the constructor to initialise `_readOnly`**

In `lib/github-store.js`, add `this._readOnly = false` at the end of the constructor body:

```js
constructor({ clientId, clientSecret, token = null, repoFullName = null, _username = null, corsProxy = 'https://cors-anywhere.herokuapp.com' } = {}) {
  this._clientId     = clientId
  this._clientSecret = clientSecret
  this._token        = token
  this._repoFullName = repoFullName
  this._username     = _username
  this._corsProxy    = corsProxy
  this._readOnly     = false
}
```

- [ ] **Step 4: Update `_apiCall` with the null-token fix and read-only guard**

Replace the existing `_apiCall` method:

```js
async _apiCall(method, path, body = undefined) {
  if (this._readOnly && method !== 'GET') {
    throw new Error('This store is read-only. initReadOnly() does not support write operations.')
  }
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`
  const opts = {
    method,
    headers: {
      ...(this._token ? { Authorization: `Bearer ${this._token}` } : {}),
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

- [ ] **Step 5: Add the read-only guard at the top of `join()`**

Add one line as the very first statement of the existing `join()` body (before `this._repoFullName = repoFullName`):

```js
async join(repoFullName, inviteToken) {
  if (this._readOnly) throw new Error('This store is read-only. initReadOnly() does not support write operations.')
  this._repoFullName = repoFullName
  const [owner, repo] = repoFullName.split('/')
  // ... remainder of join() is unchanged ...
```

The full `join()` method body is unchanged beyond this one inserted line.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: fix _apiCall null-token header and add read-only guard"
```

---

## Task 2: `createSpace()` — public option test + 422 naming conflict

`private: false` already works in the code but has no test. The 422 conflict error is new.

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('createSpace passes private:false when requested', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null })
    if (url.includes('/user/repos')) {
      return { status: 201, body: { full_name: 'johndoe/public-event', owner: { login: 'johndoe' } } }
    }
    return { status: 201, body: {} }
  })
  const store = new GitHubStore({ token: 'tok', _username: 'johndoe' })
  await store.createSpace('public-event', { private: false })
  const repoCall = calls.find(c => c.url.includes('/user/repos'))
  assert(repoCall?.body?.private === false, 'repo should be public when private:false passed')
})

test('createSpace throws a friendly error when repo name is already taken', async () => {
  mockFetch(() => ({ status: 422, body: { message: 'Repository creation failed.' } }))
  const store = new GitHubStore({ token: 'tok', _username: 'johndoe' })
  let msg = ''
  try { await store.createSpace('existing-event') } catch(e) { msg = e.message }
  assert(msg.includes('existing-event'), 'error should name the conflicting event')
  assert(msg.includes('already exists'), 'error should say it already exists')
  assert(msg.includes('existing-event-2'), 'error should suggest an alternative')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: 2 new failures

- [ ] **Step 3: Wrap the `_apiCall` in `createSpace()` to catch 422**

Replace the opening of `createSpace()`:

```js
async createSpace(name, { private: isPrivate = true } = {}) {
  let repoResp
  try {
    repoResp = await this._apiCall('POST', '/user/repos', {
      name, private: isPrivate, auto_init: false,
    })
  } catch (e) {
    if (e.message.includes('→ 422:')) {
      throw new Error(`An event named '${name}' already exists in your account. Try '${name}-2' or choose a different name.`)
    }
    throw e
  }
  const { full_name, owner } = await repoResp.json()
  this._repoFullName = full_name
  const event = { name, created: new Date().toISOString(), owner: owner.login }
  await this._writeFile('_event.json', event, null)
  GitHubStore.saveRecentRepo(full_name)
  return full_name
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add createSpace public option test and 422 conflict handling"
```

---

## Task 3: `closeSubmissions()`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('closeSubmissions merges closed:true into _event.json', async () => {
  const existing = { name: 'my-event', created: '2026-03-22T00:00:00.000Z', owner: 'alice' }
  const existingEncoded = btoa(unescape(encodeURIComponent(JSON.stringify(existing))))
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, body: opts.body })
    if ((opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: { content: existingEncoded, sha: 'sha-event' } }
    }
    return { status: 200, body: {} }
  })
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/my-event' })
  await store.closeSubmissions()
  const putCall = calls.find(c => c.method === 'PUT' && c.url.includes('_event.json'))
  assert(putCall, 'should PUT to _event.json')
  const body = JSON.parse(putCall.body)
  const written = JSON.parse(decodeURIComponent(escape(atob(body.content))))
  assert(written.closed === true, '_event.json should have closed:true')
  assertEqual(written.name, 'my-event', 'should preserve existing fields')
})

test('closeSubmissions is idempotent — succeeds even if already closed', async () => {
  const existing = { name: 'e', created: '2026-03-22T00:00:00.000Z', owner: 'a', closed: true }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(existing))))
  mockFetch((url, opts) => {
    if ((opts.method ?? 'GET') === 'GET') return { status: 200, body: { content: encoded, sha: 'sha' } }
    return { status: 200, body: {} }
  })
  const store = new GitHubStore({ token: 'tok', repoFullName: 'a/e' })
  let threw = false
  try { await store.closeSubmissions() } catch { threw = true }
  assert(!threw, 'closeSubmissions should not throw when already closed')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: 2 new failures (`closeSubmissions is not a function`)

- [ ] **Step 3: Add `closeSubmissions()` to `lib/github-store.js`**

Add after the `write` method:

```js
async closeSubmissions() {
  const current = await this.read('_event.json')
  await this.write('_event.json', { ...(current ?? {}), closed: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add closeSubmissions() to GitHubStore"
```

---

## Task 4: `archiveSpace()`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('archiveSpace sends PATCH with archived:true', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, body: opts.body })
    return { status: 200, body: { archived: true, full_name: 'alice/my-event' } }
  })
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/my-event' })
  await store.archiveSpace()
  const patchCall = calls.find(c => c.method === 'PATCH')
  assert(patchCall, 'should make a PATCH request')
  assert(patchCall.url.includes('/repos/alice/my-event'), 'should target the correct repo')
  const body = JSON.parse(patchCall.body)
  assert(body.archived === true, 'should send archived:true')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

- [ ] **Step 3: Add `archiveSpace()` to `lib/github-store.js`**

Add after `closeSubmissions()`:

```js
async archiveSpace() {
  await this._apiCall('PATCH', `/repos/${this._repoFullName}`, { archived: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add archiveSpace() to GitHubStore"
```

---

## Task 5: `deleteSpace()` and OAuth scope update

`deleteSpace()` requires the `delete_repo` OAuth scope which must be added to `beginAuth()`. This is a **breaking change** for existing OAuth app registrations — app devs must re-register and existing users must re-authorise.

`deleteSpace()` uses raw `fetch` (not `_apiCall`) so it can intercept the 403 before `_apiCall`'s generic error handler obscures the cause.

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('beginAuth requests delete_repo scope', () => {
  lastRedirect = null
  GitHubStore.beginAuth('my-client-id', 'my-secret')
  assert(lastRedirect?.includes('delete_repo'), 'should request delete_repo scope')
})

test('deleteSpace sends DELETE to the correct repo URL', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url })
    return { status: 204, body: '' }
  })
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/my-event' })
  await store.deleteSpace()
  const deleteCall = calls.find(c => c.method === 'DELETE')
  assert(deleteCall, 'should make a DELETE request')
  assert(deleteCall.url.includes('/repos/alice/my-event'), 'should target the correct repo')
})

test('deleteSpace throws a friendly error when delete_repo scope is missing', async () => {
  mockFetch(() => ({ status: 403, body: { message: 'Must have admin rights.' } }))
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/my-event' })
  let msg = ''
  try { await store.deleteSpace() } catch(e) { msg = e.message }
  assert(msg.includes('delete_repo'), 'error should mention the missing scope')
  assert(msg.includes('Re-authorise'), 'error should tell user to re-authorise')
})

test('deleteSpace throws on read-only store without making a network call', async () => {
  // deleteSpace() uses raw fetch (not _apiCall), so the read-only guard must be explicit
  mockFetch(() => { throw new Error('should not make a network call') })
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/my-event' })
  store._readOnly = true
  let msg = ''
  try { await store.deleteSpace() } catch(e) { msg = e.message }
  assert(msg.includes('read-only'), 'should throw read-only error before any fetch')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: 3 new failures. Note: the existing `beginAuth redirects to GitHub OAuth URL` test checks `scope=repo` — that substring is still present in `scope=repo%2Cdelete_repo` so it continues to pass.

- [ ] **Step 3: Update `beginAuth()` scope**

Change the scope line in `beginAuth()`:

```js
url.searchParams.set('scope', 'repo,delete_repo')
```

- [ ] **Step 4: Add `deleteSpace()` to `lib/github-store.js`**

Add after `archiveSpace()`:

```js
async deleteSpace() {
  if (this._readOnly) throw new Error('This store is read-only. initReadOnly() does not support write operations.')
  const resp = await fetch(`https://api.github.com/repos/${this._repoFullName}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (resp.status === 403) {
    throw new Error("Cannot delete repo: your OAuth token is missing the 'delete_repo' scope. Re-authorise the app to grant this permission.")
  }
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`GitHub API DELETE /repos/${this._repoFullName} → ${resp.status}: ${err}`)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add deleteSpace() and update beginAuth scope to include delete_repo"
```

> **⚠ App dev action required:** Update your GitHub OAuth App at `github.com/settings/developers` to add `delete_repo` scope. Existing authorised users must re-authorise to get the new scope.

---

## Task 6: `initReadOnly()`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('initReadOnly returns a read-only store instance for a public repo', async () => {
  mockFetch(() => ({ status: 200, body: [] }))
  const store = await GitHubStore.initReadOnly({ repoFullName: 'owner/public-repo' })
  assert(store, 'should return a store instance')
  assert(!store._token, 'store should have no token')
  assert(store._readOnly === true, 'store should be marked read-only')
})

test('initReadOnly — write operations throw with read-only message', async () => {
  mockFetch(() => ({ status: 200, body: [] }))
  const store = await GitHubStore.initReadOnly({ repoFullName: 'owner/public-repo' })
  let msg = ''
  try { await store.write('x.json', {}) } catch(e) { msg = e.message }
  assert(msg.includes('read-only'), 'write should throw read-only message')
})

test('initReadOnly throws a friendly error for private or missing repos', async () => {
  mockFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
  let msg = ''
  try {
    await GitHubStore.initReadOnly({ repoFullName: 'owner/private-repo' })
  } catch(e) { msg = e.message }
  assert(msg.includes('Repo not found or is private'), 'should give friendly message')
  assert(msg.includes('GitHubStore.init()'), 'should direct user to init()')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

- [ ] **Step 3: Add `initReadOnly()` to `lib/github-store.js`**

Add after the `init` static method:

```js
static async initReadOnly({ repoFullName }) {
  const store = new GitHubStore({ repoFullName })
  store._readOnly = true
  const resp = await store._apiCall('GET', `/repos/${repoFullName}/contents/`)
  if (!resp.ok) {
    throw new Error('Repo not found or is private. Use GitHubStore.init() to access private repos.')
  }
  return store
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add initReadOnly() static factory to GitHubStore"
```

---

## Task 7: `hasToken()`, `onboardingUrl()`, `onboardingHint()`

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('hasToken returns true when token is in sessionStorage', () => {
  sessionStorage.setItem('gh:token', 'gho_sometoken')
  assert(GitHubStore.hasToken() === true, 'should return true when token exists')
})

test('hasToken returns false when no token in sessionStorage', () => {
  assert(GitHubStore.hasToken() === false, 'should return false when no token')
})

test('onboardingUrl returns the GitHub signup URL', () => {
  assertEqual(GitHubStore.onboardingUrl(), 'https://github.com/signup')
})

test('onboardingHint returns a non-empty string mentioning Google sign-in', () => {
  const hint = GitHubStore.onboardingHint()
  assert(hint && hint.length > 0, 'hint should be non-empty')
  assert(hint.toLowerCase().includes('google'), 'hint should mention Google sign-in')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

- [ ] **Step 3: Add the three static methods to `lib/github-store.js`**

Add after `getRecentRepos()`:

```js
static hasToken() {
  return !!sessionStorage.getItem('gh:token')
}

static onboardingUrl() {
  return 'https://github.com/signup'
}

static onboardingHint() {
  return "You'll need a free GitHub account. Google sign-in is supported on the signup page."
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add hasToken(), onboardingUrl(), onboardingHint() to GitHubStore"
```

---

## Task 8: App — Observer mode (`?mode=observer`)

Observer mode renders a read-only submissions table without authentication. It must be checked **before** `GitHubStore.init()` is called (which would redirect unauthenticated users).

**Files:**
- Modify: `apps/potluck/index.html`

No automated tests. Verify with spec smoke tests.

- [ ] **Step 1: Add observer mode branch to `main()` before the `init()` call**

Replace the existing `main()`:

```js
async function main() {
  // Observer mode: no auth required — must be checked before init()
  if (mode === 'observer') {
    await renderObserver()
    return
  }

  // Participant gate: check auth state before triggering OAuth redirect
  if (mode === 'participant') {
    const hasCode = new URLSearchParams(location.search).has('code')
    if (!GitHubStore.hasToken() && !hasCode) {
      renderOnboardingGate()
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

  if (mode === 'participant') {
    await renderParticipant(store)
  } else {
    await renderOrganizer(store)
  }
}
```

Note: `renderOnboardingGate` is added in Task 9 — add a stub for now: `function renderOnboardingGate() {}`.

- [ ] **Step 2: Add `renderObserver()` after `renderOrganizerDashboard()`**

```js
async function renderObserver() {
  const app = document.getElementById('app')
  if (!repoParam) {
    app.innerHTML = `<p>Invalid observer link — missing <code>repo</code> parameter.</p>`
    return
  }
  let store
  try {
    store = await GitHubStore.initReadOnly({ repoFullName: repoParam })
  } catch (e) {
    if (e.message.includes('not found or is private')) {
      app.innerHTML = `<p>This event is private. You need an invitation to participate.</p>`
    } else {
      app.innerHTML = `<p class="err">Could not load event: ${esc(e.message)}</p>`
    }
    return
  }

  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">
      <strong>${esc(repoParam)}</strong> &nbsp;·&nbsp;
      <span style="color:#888">Read-only view</span>
      <span style="font-size:0.8rem;color:#888"> (refreshes every 30s)</span>
    </p>
    <div id="closed-banner" style="display:none">
      <p style="background:#fff3cd;padding:0.6rem;border-radius:4px;margin-top:1rem">
        Submissions are closed. No new entries are being accepted.
      </p>
    </div>
    <div id="responses-table">Loading...</div>
  `

  async function refreshObserver() {
    const el = document.getElementById('responses-table')
    if (!el) return
    try {
      const eventMeta = await store.read('_event.json')
      const closedBanner = document.getElementById('closed-banner')
      if (closedBanner) closedBanner.style.display = eventMeta?.closed ? 'block' : 'none'
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
      if (el2) el2.innerHTML = `<p class="err">Error: ${esc(e.message)}</p>`
    }
  }

  await refreshObserver()
  setInterval(refreshObserver, 30_000)
}
```

- [ ] **Step 3: Smoke test observer mode**

With `npm run proxy` running and the app served (e.g. `npx serve .`):
1. Create a public space: open organizer mode, create an event with `{ private: false }`.
2. Open `?mode=observer&repo={owner}/{repo}` in a private/incognito window → submissions table renders, no login prompt.
3. Open `?mode=observer&repo={owner}/nonexistent` → "This event is private" message. (GitHub returns 404 for both private and non-existent repos when unauthenticated — the identical message is by design; see spec section 1.3.)
4. After organizer closes submissions → observer banner shows "Submissions are closed".

- [ ] **Step 4: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: add observer mode to potluck app"
```

---

## Task 9: App — Participant onboarding gate

**Files:**
- Modify: `apps/potluck/index.html`

- [ ] **Step 1: Replace the `renderOnboardingGate()` stub with the real implementation**

Replace the stub added in Task 8:

```js
function renderOnboardingGate() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">You've been invited to a Potluck event.</p>
    <div class="section">
      <strong>Do you have a GitHub account?</strong>
      <p style="font-size:0.9rem;color:#555;margin-top:0.5rem">
        This app uses GitHub to store event data. You'll need an account to participate.
      </p>
      <button id="yes-btn" style="margin-right:0.5rem">Yes, sign in with GitHub</button>
      <button id="no-btn">No, create a free account</button>
    </div>
    <div id="onboarding-hint" style="display:none;margin-top:1rem"></div>
  `

  document.getElementById('yes-btn').onclick = () => {
    GitHubStore.init({
      clientId:     CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      corsProxy:    CORS_PROXY,
      repoFullName: repoParam,
    })
  }

  document.getElementById('no-btn').onclick = () => {
    const hint = document.getElementById('onboarding-hint')
    hint.style.display = 'block'
    hint.innerHTML = `
      <p>${esc(GitHubStore.onboardingHint())}</p>
      <a href="${esc(GitHubStore.onboardingUrl())}" target="_blank">
        Create a free GitHub account →
      </a>
      <p style="font-size:0.85rem;color:#555;margin-top:0.75rem">
        Once you have an account, return to this page and click "Yes, sign in with GitHub".
      </p>
    `
  }
}
```

- [ ] **Step 2: Smoke test the onboarding gate**

1. Open the invite URL (`?mode=participant&repo=...&invite=...`) in a private/incognito window → onboarding gate appears; no OAuth redirect occurs.
2. Click "No" → hint text and GitHub signup link shown; user stays on page.
3. Click "Yes" → OAuth redirect fires.
4. Complete OAuth, return to invite URL with `?code=` → gate is skipped, join flow proceeds normally.

- [ ] **Step 3: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: add participant onboarding gate to potluck app"
```

---

## Task 10: App — Organizer lifecycle controls

Three sequentially-unlocking buttons: Close submissions → Lock event → Delete event.

**Files:**
- Modify: `apps/potluck/index.html`

- [ ] **Step 1: Add the lifecycle section to the organizer dashboard HTML**

In `renderOrganizerDashboard()`, add this section to the rendered HTML string after `<div id="status"></div>`:

```html
<hr>
<div class="section">
  <strong>Event lifecycle</strong>
  <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap">
    <button id="close-btn">Close submissions</button>
    <button id="lock-btn" style="display:none">Lock event</button>
    <button id="delete-btn" style="display:none">Delete event</button>
  </div>
  <div id="delete-confirm" style="display:none;margin-top:0.75rem">
    <label style="font-size:0.9rem">
      Type <strong id="delete-repo-hint"></strong> to confirm permanent deletion:
      <input id="delete-name-input" type="text" style="width:100%;margin-top:0.25rem" />
    </label>
    <button id="delete-confirm-btn" style="margin-top:0.5rem;background:#c00;color:#fff;border:none;padding:0.4rem 1rem;border-radius:4px;cursor:pointer" disabled>
      Permanently delete
    </button>
    <button id="delete-cancel-btn" style="margin-top:0.5rem;margin-left:0.5rem">Cancel</button>
  </div>
</div>
```

- [ ] **Step 2: Wire up the lifecycle buttons**

Add after `setInterval(refreshTable, 30_000)` in `renderOrganizerDashboard()`:

```js
const closeBtn         = document.getElementById('close-btn')
const lockBtn          = document.getElementById('lock-btn')
const deleteBtn        = document.getElementById('delete-btn')
const deleteConfirm    = document.getElementById('delete-confirm')
const deleteRepoHint   = document.getElementById('delete-repo-hint')
const deleteNameInput  = document.getElementById('delete-name-input')
const deleteConfirmBtn = document.getElementById('delete-confirm-btn')
const deleteCancelBtn  = document.getElementById('delete-cancel-btn')
const repoShortName    = store._repoFullName?.split('/')[1] ?? store._repoFullName

closeBtn.onclick = async () => {
  closeBtn.disabled = true
  setStatus('Closing submissions...', false)
  try {
    await store.closeSubmissions()
    closeBtn.textContent = 'Submissions closed ✓'
    setStatus('', false)
    lockBtn.style.display = 'inline'
  } catch(e) {
    setStatus(e.message)
    closeBtn.disabled = false
  }
}

lockBtn.onclick = async () => {
  if (!confirm('This will archive the event on GitHub, making it permanently read-only. You will not be able to reopen submissions. Continue?')) return
  lockBtn.disabled = true
  setStatus('Locking event...', false)
  try {
    await store.archiveSpace()
    lockBtn.textContent = 'Event locked ✓'
    setStatus('', false)
    deleteBtn.style.display = 'inline'
  } catch(e) {
    setStatus(e.message)
    lockBtn.disabled = false
  }
}

deleteBtn.onclick = () => {
  deleteRepoHint.textContent = repoShortName
  deleteConfirm.style.display = 'block'
  deleteBtn.style.display = 'none'
}

deleteCancelBtn.onclick = () => {
  deleteConfirm.style.display = 'none'
  deleteBtn.style.display = 'inline'
  deleteNameInput.value = ''
  deleteConfirmBtn.disabled = true
}

deleteNameInput.addEventListener('input', () => {
  deleteConfirmBtn.disabled = deleteNameInput.value.trim() !== repoShortName
})

deleteConfirmBtn.onclick = async () => {
  deleteConfirmBtn.disabled = true
  setStatus('Deleting event...', false)
  try {
    await store.deleteSpace()
    const key = 'potluck:recentRepos'
    const repos = JSON.parse(localStorage.getItem(key) ?? '[]')
    localStorage.setItem(key, JSON.stringify(repos.filter(r => r !== store._repoFullName)))
    location.href = `${location.pathname}?mode=organizer`
  } catch(e) {
    setStatus(e.message)
    deleteNameInput.value = ''
    deleteConfirmBtn.disabled = true
    deleteConfirm.style.display = 'none'
    deleteBtn.style.display = 'inline'
  }
}
```

- [ ] **Step 3: Smoke test lifecycle controls**

1. Open organizer dashboard → "Close submissions" button visible; Lock and Delete hidden.
2. Click "Close submissions" → button becomes "Submissions closed ✓"; "Lock event" appears.
3. Click "Lock event" → confirm dialog → confirm → "Event locked ✓"; "Delete event" appears.
4. Click "Delete event" → name input appears → type wrong name → confirm button stays disabled → type correct name → enables → click → repo deleted, redirected to `?mode=organizer`.
5. Repeat step 4 with a token missing `delete_repo` scope → error banner shown; name input cleared; Delete button resets.

- [ ] **Step 4: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: add organizer lifecycle controls to potluck app"
```

---

## Task 11: App — Enhanced PAT creation guidance

Replace the existing PAT link with the step-by-step checklist including a Validate button.

**Files:**
- Modify: `apps/potluck/index.html`

- [ ] **Step 1: Replace the PAT section HTML in `renderOrganizerDashboard()`**

Replace the `<div class="section">` containing `<strong>Share join link</strong>`:

```html
<div class="section">
  <strong>Share join link</strong>
  <p style="font-size:0.9rem;color:#555;margin-top:0.5rem">
    Create an invite token on GitHub so participants can join:
  </p>
  <ol style="font-size:0.9rem;line-height:2.4">
    <li>
      <a id="pat-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank">
        → Open GitHub token page
      </a>
    </li>
    <li>
      Token name: <code id="pat-name-hint"></code>
      <button id="copy-name-btn" style="font-size:0.8rem;padding:0.2rem 0.5rem;margin-left:0.4rem">Copy</button>
    </li>
    <li>Expiration: <strong>7 days</strong></li>
    <li>Repository access: <em>Only select repositories</em> → <code id="repo-name-hint"></code></li>
    <li>Permissions: <em>Repository permissions → Administration → Read and write</em></li>
    <li>
      Generate token, then paste here:
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem">
        <input id="pat-input" type="text" placeholder="github_pat_..." style="flex:1" />
        <button id="validate-btn">Validate</button>
      </div>
      <span id="validate-status" style="font-size:0.85rem;margin-top:0.25rem;display:block"></span>
    </li>
  </ol>
  <div id="invite-link-section" style="display:none;margin-top:1rem">
    <button id="copy-btn">Copy join link</button>
    <span id="link-preview" style="font-size:0.8rem;color:#666;margin-left:0.5rem"></span>
    <p style="font-size:0.8rem;color:#c00;margin-top:0.5rem">
      ⚠ Set this token to expire in 7 days — revoke it from GitHub Settings when the event is over.
    </p>
  </div>
</div>
```

- [ ] **Step 2: Replace the PAT wiring in `renderOrganizerDashboard()`**

Remove the existing `patInput`/`copyBtn`/`preview` block and replace with:

```js
const repoName         = store._repoFullName?.split('/')[1] ?? ''
const suggestedName    = `${repoName}-invite`
const joinBase         = `${location.origin}${location.pathname}?mode=participant&repo=${store._repoFullName}`
const patInput         = document.getElementById('pat-input')
const validateBtn      = document.getElementById('validate-btn')
const validateStatus   = document.getElementById('validate-status')
const inviteSection    = document.getElementById('invite-link-section')
const copyBtn          = document.getElementById('copy-btn')
const preview          = document.getElementById('link-preview')

document.getElementById('pat-name-hint').textContent = suggestedName
document.getElementById('repo-name-hint').textContent = store._repoFullName ?? ''
document.getElementById('copy-name-btn').onclick = () => {
  navigator.clipboard.writeText(suggestedName)
  document.getElementById('copy-name-btn').textContent = 'Copied!'
  setTimeout(() => { document.getElementById('copy-name-btn').textContent = 'Copy' }, 2000)
}

validateBtn.onclick = async () => {
  const token = patInput.value.trim()
  if (!token) { validateStatus.textContent = 'Paste a token first.'; return }
  validateBtn.disabled = true
  validateStatus.textContent = 'Validating...'
  validateStatus.className = ''
  try {
    const resp = await fetch(`https://api.github.com/repos/${store._repoFullName}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    })
    if (resp.status === 401) {
      validateStatus.textContent = 'Token is invalid or expired — re-generate it at step 1.'
      validateStatus.className = 'err'
      inviteSection.style.display = 'none'
    } else if (!resp.ok) {
      validateStatus.textContent = 'Token cannot access this repo — check steps 4 and 5.'
      validateStatus.className = 'err'
      inviteSection.style.display = 'none'
    } else {
      const data = await resp.json()
      if (!data.permissions?.admin) {
        validateStatus.textContent = 'Token cannot access this repo — check steps 4 and 5.'
        validateStatus.className = 'err'
        inviteSection.style.display = 'none'
      } else {
        validateStatus.textContent = 'Token valid ✓'
        validateStatus.className = 'ok'
        inviteSection.style.display = 'block'
        const full = `${joinBase}&invite=${token}`
        preview.textContent = full.length > 70 ? full.slice(0, 70) + '…' : full
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(full)
          copyBtn.textContent = 'Copied!'
          setTimeout(() => { copyBtn.textContent = 'Copy join link' }, 2000)
        }
      }
    }
  } catch(e) {
    validateStatus.textContent = `Validation error: ${esc(e.message)}`
    validateStatus.className = 'err'
  } finally {
    validateBtn.disabled = false
  }
}

- [ ] **Step 3: Smoke test PAT guidance**

1. Create an event → PAT checklist renders with `{repo}-invite` in step 2 and repo name in step 4.
2. Click "Copy" next to token name → clipboard receives `{repo}-invite`.
3. Paste a valid PAT with admin scope → "Token valid ✓" → invite section appears with join link.
4. Paste a PAT scoped to a different repo → "check steps 4 and 5".
5. Paste an invalid/expired token string → "invalid or expired — re-generate at step 1".

- [ ] **Step 4: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: replace PAT link with step-by-step checklist and validate button"
```

---

## Task 12: App — Rate limiting (visibility pause + 429 back-off)

**Files:**
- Modify: `apps/potluck/index.html`

- [ ] **Step 1: Add `startPolling()` above `main()`**

```js
function startPolling(fn, interval) {
  let timer = null
  let paused = false
  let rateLimited = false

  function showRateLimitStatus(show) {
    if (show === rateLimited) return
    rateLimited = show
    setStatus(show ? 'Refreshing paused briefly…' : '', !show)
  }

  async function tick() {
    try {
      await fn()
      showRateLimitStatus(false)
    } catch(e) {
      if (e.message?.includes('→ 429:')) {
        showRateLimitStatus(true)
        clearInterval(timer)
        timer = null
        setTimeout(() => {
          showRateLimitStatus(false)
          if (!paused) schedule()
        }, 60_000)
        return
      }
      // Non-429 errors: let fn's own error handler deal with them
    }
  }

  function schedule() {
    timer = setInterval(() => { if (!paused) tick() }, interval)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      paused = true
      clearInterval(timer)
      timer = null
    } else {
      paused = false
      schedule()
    }
  })

  schedule()
}
```

- [ ] **Step 2: Replace `setInterval` calls in both polling loops**

In `renderOrganizerDashboard()`, replace:
```js
setInterval(refreshTable, 30_000)
```
With:
```js
startPolling(refreshTable, 30_000)
```

In `renderObserver()`, replace:
```js
setInterval(refreshObserver, 30_000)
```
With:
```js
startPolling(refreshObserver, 30_000)
```

- [ ] **Step 3: Smoke test rate limiting**

1. Open organizer or observer mode → responses load normally.
2. Switch to another browser tab → open DevTools Network tab → confirm no `api.github.com` requests while the tab is hidden.
3. Switch back → polling resumes within one interval.
4. Optional: in DevTools → Network → add a custom response rule returning 429 for `api.github.com` calls → confirm "Refreshing paused briefly…" appears and auto-resumes after ~60s.

- [ ] **Step 4: Commit**

```bash
git add apps/potluck/index.html
git commit -m "feat: add visibility-aware polling and 429 rate limit back-off"
```

---

## Final verification

Run the full test suite:

```bash
npm test
```
Expected: all tests pass (existing + new).

Then do a full end-to-end walkthrough using [docs/e2e-test.md](docs/e2e-test.md) as a baseline, verifying each of the Layer 1, 2, and 3 smoke tests from the spec at:
`docs/superpowers/specs/2026-03-22-github-experience-improvements-design.md`
