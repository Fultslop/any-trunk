# Gifts App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gifts demo app — a hardened AnyTrunk pattern that fixes potluck's D1–D3 security deferred items via a Cloudflare Worker, while keeping the library's data API identical.

**Architecture:** Refactor the base class to extract `_autoAcceptInvitation()`, then build `WorkerGitHubStore extends GitHubStore` that routes auth through a Worker URL instead of a CORS proxy + client secret. A Cloudflare Worker handles token exchange and collaborator invites. The gifts app (organizer + participant) mirrors the potluck app structure.

**Tech Stack:** Vanilla ES modules, Vitest (tests), Cloudflare Workers (backend), Workers KV (state), GitHub OAuth + REST API.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/github-store.js` | Modify | Extract `_autoAcceptInvitation()`, make fault-tolerant |
| `lib/github-store-worker.js` | Create | `WorkerGitHubStore extends GitHubStore` |
| `tests/github-store.test.mjs` | Modify | Add test for fault-tolerant `_autoAcceptInvitation()` |
| `tests/github-store-worker.test.mjs` | Create | Full test suite for `WorkerGitHubStore` |
| `workers/anytrunk-worker/index.js` | Create | Cloudflare Worker — 3 HTTP endpoints |
| `workers/anytrunk-worker/wrangler.toml` | Create | CF config with KV binding |
| `apps/gifts/index.html` | Create | App entry point |
| `apps/gifts/main.js` | Create | Mode routing + config |
| `apps/gifts/organizer.js` | Create | Organizer UI and logic |
| `apps/gifts/participant.js` | Create | Participant UI and logic |
| `apps/gifts/gifts.css` | Create | Styles (same visual language as potluck) |
| `docs/tutorial.md` | Create | Shared prerequisites and server setup |
| `docs/tutorial-potluck.md` | Create | Potluck walkthrough (replaces e2e-test.md) |
| `docs/tutorial-gifts.md` | Create | Gifts walkthrough (Worker deploy + app differences) |
| `docs/e2e-test.md` | Delete | Retired — content subsumed by tutorial files |

---

## Task 1: Refactor `join()` — extract `_autoAcceptInvitation()`

The base class `join()` currently has the auto-accept logic inlined. `WorkerGitHubStore` needs to call just that part, so it must be extracted into `_autoAcceptInvitation(repoFullName)`. It must also be made fault-tolerant: currently it throws if no pending invitation is found; it must instead return silently, because the Worker-backed flow calls it unconditionally.

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1.1: Write a failing test for fault-tolerant `_autoAcceptInvitation()`**

Add to `tests/github-store.test.mjs`:

```js
test('_autoAcceptInvitation returns silently when no pending invitation exists', async () => {
  mockFetch((url, opts) => {
    if (url.includes('repository_invitations') && (opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: [] }  // no pending invitations
    }
  })

  const store = new GitHubStore({ token: 'tok', _username: 'bob' })
  // Must not throw even though no invitation is found
  await expect(store._autoAcceptInvitation('johndoe/potluck')).resolves.toBeUndefined()
})
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
npm test
```

Expected: one test FAILs — `_autoAcceptInvitation returns silently when no pending invitation exists` — with `TypeError: store._autoAcceptInvitation is not a function`.

- [ ] **Step 1.3: Extract `_autoAcceptInvitation()` and make it fault-tolerant**

In `lib/github-store.js`, replace the auto-accept block inside `join()` and add the new method.

Replace the current `join()` method (lines 103–161) with:

```js
async join(repoFullName, inviteToken) {
  if (this._readOnly) throw new Error('This store is read-only. initReadOnly() does not support write operations.')
  this._repoFullName = repoFullName
  const [owner, repo] = repoFullName.split('/')

  // Step 1: Add collaborator using organizer's invite token (NOT this._token)
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

  // Empty body = user is already a collaborator — nothing more to do.
  // Non-empty body = invitation just created — must auto-accept.
  // Do NOT check status code alone: GitHub returns 204 in both cases.
  const text = await addResp.text()
  if (!addResp.ok) {
    throw new Error(`Failed to add collaborator: HTTP ${addResp.status}: ${text}`)
  }
  if (!text || !text.trim()) {
    GitHubStore.saveRecentRepo(repoFullName)
    return
  }

  // Step 2: Auto-accept using participant's own token
  await this._autoAcceptInvitation(repoFullName)
  GitHubStore.saveRecentRepo(repoFullName)
}

async _autoAcceptInvitation(repoFullName) {
  const invResp = await fetch('https://api.github.com/user/repository_invitations', {
    headers: {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!invResp.ok) throw new Error(`Failed to list invitations: HTTP ${invResp.status}`)
  const list = await invResp.json()
  const invite = list.find(i => i.repository.full_name === repoFullName)
  if (!invite) return  // already a collaborator or invitation already accepted — nothing to do

  const acceptResp = await fetch(
    `https://api.github.com/user/repository_invitations/${invite.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  )
  if (!acceptResp.ok) throw new Error(`Failed to accept invitation: HTTP ${acceptResp.status}`)
}
```

- [ ] **Step 1.4: Run all tests to confirm everything passes**

```bash
npm test
```

Expected: all tests pass. The two existing `join` tests still pass because `join()` calls `_autoAcceptInvitation()` internally and the external behaviour is unchanged.

- [ ] **Step 1.5: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "refactor: extract _autoAcceptInvitation() from join(), make fault-tolerant"
```

---

## Task 2: `WorkerGitHubStore` subclass

**Files:**
- Create: `lib/github-store-worker.js`
- Create: `tests/github-store-worker.test.mjs`

- [ ] **Step 2.1: Write failing tests**

Create `tests/github-store-worker.test.mjs`:

```js
// tests/github-store-worker.test.mjs
import { test, expect, beforeEach } from 'vitest'
import { reset } from './helpers/mock-browser.mjs'
import { clearFetch, mockFetch } from './helpers/mock-fetch.mjs'
import { WorkerGitHubStore } from '../lib/github-store-worker.js'

let lastRedirect = null
Object.defineProperty(global, 'location', {
  configurable: true,
  get: () => ({ href: lastRedirect ?? 'http://localhost/', search: '' }),
  set: (v) => { lastRedirect = typeof v === 'string' ? v : v.href },
})

beforeEach(() => {
  reset()
  clearFetch()
  lastRedirect = null
})

// ── beginAuth ──────────────────────────────────────────────────────────────

test('beginAuth stores workerUrl (not clientSecret) in sessionStorage', () => {
  WorkerGitHubStore.beginAuth('my-client-id', 'https://worker.example.com')
  const stored = JSON.parse(sessionStorage.getItem('gh:auth'))
  expect(stored.clientId).toBe('my-client-id')
  expect(stored.workerUrl).toBe('https://worker.example.com')
  expect(stored.clientSecret).toBeUndefined()
  expect(stored.state && stored.state.length > 8).toBe(true)
})

test('beginAuth redirects to GitHub OAuth URL', () => {
  WorkerGitHubStore.beginAuth('my-client-id', 'https://worker.example.com')
  expect(lastRedirect?.includes('github.com/login/oauth/authorize')).toBe(true)
  expect(lastRedirect?.includes('client_id=my-client-id')).toBe(true)
})

// ── completeAuth ───────────────────────────────────────────────────────────

test('completeAuth POSTs to workerUrl/oauth/token (not cors-anywhere)', async () => {
  sessionStorage.setItem('gh:auth', JSON.stringify({
    clientId: 'id', workerUrl: 'https://worker.example.com', state: 'abc123',
  }))
  Object.defineProperty(global, 'location', {
    configurable: true,
    get: () => ({ href: 'http://localhost/?code=mycode&state=abc123',
                  search: '?code=mycode&state=abc123' }),
    set: () => {},
  })

  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null })
    if (url === 'https://worker.example.com/oauth/token') {
      return { status: 200, body: { access_token: 'gho_testtoken' } }
    }
    if (url.includes('api.github.com/user')) {
      return { status: 200, body: { login: 'alice' } }
    }
  })

  const store = await WorkerGitHubStore.completeAuth()
  const tokenCall = calls.find(c => c.url === 'https://worker.example.com/oauth/token')
  expect(tokenCall).toBeTruthy()
  expect(tokenCall.body.code).toBe('mycode')
  expect(store).toBeInstanceOf(WorkerGitHubStore)  // not a plain GitHubStore
  expect(store.isAuthenticated).toBe(true)
  expect(store.username).toBe('alice')
  expect(store._workerUrl).toBe('https://worker.example.com')
  expect(sessionStorage.getItem('gh:token')).toBe('gho_testtoken')
})

// ── register ───────────────────────────────────────────────────────────────

test('register POSTs to workerUrl/spaces/register and stores inviteCode in localStorage', async () => {
  mockFetch((url) => {
    if (url === 'https://worker.example.com/spaces/register') {
      return { status: 200, body: { inviteCode: 'abc123xyz' } }
    }
  })

  const store = new WorkerGitHubStore({
    clientId: 'id', workerUrl: 'https://worker.example.com',
    token: 'gho_tok', repoFullName: 'alice/birthday-2026',
  })
  const code = await store.register()

  expect(code).toBe('abc123xyz')
  const stored = localStorage.getItem(`gifts:${encodeURIComponent('alice/birthday-2026')}:inviteCode`)
  expect(stored).toBe('abc123xyz')
})

test('register sends repo and token in request body', async () => {
  let captured = null
  mockFetch((url, opts) => {
    if (url.includes('/spaces/register')) {
      captured = JSON.parse(opts.body)
      return { status: 200, body: { inviteCode: 'code' } }
    }
  })

  const store = new WorkerGitHubStore({
    clientId: 'id', workerUrl: 'https://worker.example.com',
    token: 'gho_organizer_token', repoFullName: 'alice/birthday-2026',
  })
  await store.register()

  expect(captured.repo).toBe('alice/birthday-2026')
  expect(captured.token).toBe('gho_organizer_token')
})

// ── join ───────────────────────────────────────────────────────────────────

test('join POSTs to workerUrl/spaces/invite with repo, username, inviteCode', async () => {
  let inviteCall = null
  mockFetch((url, opts) => {
    if (url.includes('/spaces/invite')) {
      inviteCall = JSON.parse(opts.body)
      return { status: 200, body: { ok: true } }
    }
    if (url.includes('repository_invitations') && (opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: [] }  // no pending invitation — fault-tolerant path
    }
  })

  const store = new WorkerGitHubStore({
    clientId: 'id', workerUrl: 'https://worker.example.com',
    token: 'gho_participant_token', _username: 'bob',
  })
  await store.join('alice/birthday-2026', 'abc123xyz')

  expect(inviteCall.repo).toBe('alice/birthday-2026')
  expect(inviteCall.username).toBe('bob')
  expect(inviteCall.inviteCode).toBe('abc123xyz')
})

test('join calls _autoAcceptInvitation unconditionally and accepts if invitation exists', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, method: opts.method ?? 'GET', headers: opts.headers })
    if (url.includes('/spaces/invite')) return { status: 200, body: { ok: true } }
    if (url.includes('repository_invitations') && (opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: [{ id: 42, repository: { full_name: 'alice/birthday-2026' } }] }
    }
    if (url.includes('repository_invitations/42')) return { status: 204, body: '' }
  })

  const store = new WorkerGitHubStore({
    clientId: 'id', workerUrl: 'https://worker.example.com',
    token: 'gho_participant_token', _username: 'bob',
  })
  await store.join('alice/birthday-2026', 'abc123xyz')

  const acceptCall = calls.find(c => c.url.includes('invitations/42') && c.method === 'PATCH')
  expect(acceptCall).toBeTruthy()
  expect(acceptCall.headers.Authorization).toBe('Bearer gho_participant_token')
})

test('join saves to gifts:recentRepos (not potluck:recentRepos)', async () => {
  mockFetch((url, opts) => {
    if (url.includes('/spaces/invite')) return { status: 200, body: { ok: true } }
    if (url.includes('repository_invitations') && (opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: [] }
    }
  })

  const store = new WorkerGitHubStore({
    clientId: 'id', workerUrl: 'https://worker.example.com',
    token: 'tok', _username: 'bob',
  })
  await store.join('alice/birthday-2026', 'code')

  const gifts = JSON.parse(localStorage.getItem('gifts:recentRepos') ?? '[]')
  const potluck = JSON.parse(localStorage.getItem('potluck:recentRepos') ?? '[]')
  expect(gifts).toContain('alice/birthday-2026')
  expect(potluck).toHaveLength(0)
})

// ── saveRecentRepo / getRecentRepos ────────────────────────────────────────

test('saveRecentRepo uses gifts:recentRepos key', () => {
  WorkerGitHubStore.saveRecentRepo('alice/birthday-2026')
  expect(JSON.parse(localStorage.getItem('gifts:recentRepos'))).toContain('alice/birthday-2026')
  expect(localStorage.getItem('potluck:recentRepos')).toBeNull()
})

test('getRecentRepos reads from gifts:recentRepos', () => {
  localStorage.setItem('gifts:recentRepos', JSON.stringify(['alice/birthday-2026']))
  expect(WorkerGitHubStore.getRecentRepos()).toEqual(['alice/birthday-2026'])
})
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
npm test
```

Expected: all `github-store-worker` tests FAIL — `Cannot find module '../lib/github-store-worker.js'`. Existing `github-store` tests continue to pass.

- [ ] **Step 2.3: Implement `WorkerGitHubStore`**

Create `lib/github-store-worker.js`:

```js
// lib/github-store-worker.js
import { GitHubStore } from './github-store.js'

export class WorkerGitHubStore extends GitHubStore {
  constructor({ clientId, workerUrl, token = null, repoFullName = null, _username = null } = {}) {
    super({ clientId, token, repoFullName, _username })
    this._workerUrl = workerUrl
  }

  // Signature change: workerUrl replaces clientSecret
  // Note: requests 'repo' scope only (not 'delete_repo'). deleteSpace() is inherited
  // from the base class but is out of scope for the gifts app and would fail at runtime
  // with a 403 if called. This is intentional — see "Out of Scope" in the design spec.
  static beginAuth(clientId, workerUrl) {
    const state = crypto.randomUUID()
    sessionStorage.setItem('gh:auth', JSON.stringify({ clientId, workerUrl, state }))
    sessionStorage.setItem('gh:returnUrl', location.href)
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('scope', 'repo')
    url.searchParams.set('state', state)
    location.href = url.toString()
  }

  // Calls workerUrl/oauth/token instead of cors-anywhere
  static async completeAuth() {
    const stored = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}')
    const params = new URLSearchParams(location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    if (!code) throw new Error('No code in URL')
    if (state !== stored.state) throw new Error('State mismatch — possible CSRF')

    const resp = await fetch(`${stored.workerUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status}`)
    const { access_token } = await resp.json()
    if (!access_token) throw new Error('Token exchange failed: no access_token in response')
    sessionStorage.setItem('gh:token', access_token)

    const userResp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` }
    })
    if (!userResp.ok) throw new Error(`Failed to fetch user: HTTP ${userResp.status}`)
    const { login } = await userResp.json()
    if (!login) throw new Error('Failed to fetch user: no login in response')
    sessionStorage.setItem('gh:username', login)

    return new WorkerGitHubStore({
      clientId: stored.clientId, workerUrl: stored.workerUrl,
      token: access_token, _username: login,
    })
  }

  static async init({ clientId, workerUrl, repoFullName = null } = {}) {
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

    WorkerGitHubStore.beginAuth(clientId, workerUrl)
    return null
  }

  // Calls Worker /spaces/register; stores inviteCode in localStorage
  async register() {
    const resp = await fetch(`${this._workerUrl}/spaces/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: this._repoFullName, token: this._token }),
    })
    if (!resp.ok) throw new Error(`register failed: HTTP ${resp.status}`)
    const { inviteCode } = await resp.json()
    localStorage.setItem(`gifts:${encodeURIComponent(this._repoFullName)}:inviteCode`, inviteCode)
    return inviteCode
  }

  static getInviteCode(repoFullName) {
    return localStorage.getItem(`gifts:${encodeURIComponent(repoFullName)}:inviteCode`)
  }

  // Uses gifts:recentRepos to isolate from potluck app
  static saveRecentRepo(repoFullName) {
    const key = 'gifts:recentRepos'
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
    const updated = [repoFullName, ...existing.filter(r => r !== repoFullName)].slice(0, 5)
    localStorage.setItem(key, JSON.stringify(updated))
  }

  static getRecentRepos() {
    return JSON.parse(localStorage.getItem('gifts:recentRepos') ?? '[]')
  }

  // Calls Worker /spaces/invite; then unconditionally calls _autoAcceptInvitation
  async join(repoFullName, inviteCode) {
    this._repoFullName = repoFullName

    const resp = await fetch(`${this._workerUrl}/spaces/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoFullName, username: this._username, inviteCode }),
    })
    if (!resp.ok) throw new Error(`join failed: HTTP ${resp.status}`)

    // Always attempt auto-accept — _autoAcceptInvitation returns silently if
    // no pending invitation exists (already-a-collaborator case)
    await this._autoAcceptInvitation(repoFullName)
    WorkerGitHubStore.saveRecentRepo(repoFullName)
  }
}
```

- [ ] **Step 2.4: Run all tests**

```bash
npm test
```

Expected: all tests pass (both existing `github-store.test.mjs` and new `github-store-worker.test.mjs`)

- [ ] **Step 2.5: Commit**

```bash
git add lib/github-store-worker.js tests/github-store-worker.test.mjs
git commit -m "feat: add WorkerGitHubStore subclass"
```

---

## Task 3: Cloudflare Worker

No automated unit tests — the Worker runs in the Cloudflare runtime and is verified manually in the tutorial walkthrough. The wrangler.toml requires a KV namespace ID that only exists after deployment.

**Files:**
- Create: `workers/anytrunk-worker/index.js`
- Create: `workers/anytrunk-worker/wrangler.toml`

- [ ] **Step 3.1: Create Worker directory and wrangler config**

Create `workers/anytrunk-worker/wrangler.toml`:

```toml
name = "anytrunk-worker"
main = "index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "KV"
# Replace with your KV namespace ID after running:
# npx wrangler kv namespace create anytrunk
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"

[vars]
# GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set as secrets, not vars.
# Run: npx wrangler secret put GITHUB_CLIENT_ID
#      npx wrangler secret put GITHUB_CLIENT_SECRET
```

- [ ] **Step 3.2: Implement the Worker**

Create `workers/anytrunk-worker/index.js`:

```js
// workers/anytrunk-worker/index.js
// Cloudflare Worker — AnyTrunk auth backend
// Endpoints:
//   POST /oauth/token      — exchange GitHub OAuth code for access token
//   POST /spaces/register  — store organizer token, generate invite code (idempotent)
//   POST /spaces/invite    — validate invite code, add collaborator via stored organizer token

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: CORS })
    }

    const { pathname } = new URL(request.url)
    if (pathname === '/oauth/token')    return handleOAuthToken(body, env)
    if (pathname === '/spaces/register') return handleRegister(body, env)
    if (pathname === '/spaces/invite')   return handleInvite(body, env)
    return new Response('Not found', { status: 404, headers: CORS })
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function handleOAuthToken({ code }, env) {
  if (!code) return json({ error: 'missing_code' }, 400)

  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const data = await resp.json()
  if (!data.access_token) return json({ error: data.error ?? 'token_exchange_failed' }, 400)
  return json({ access_token: data.access_token })
}

async function handleRegister({ repo, token }, env) {
  if (!repo || !token) return json({ error: 'missing_fields' }, 400)

  // {repo} is URL-encoded to avoid key separator issues across KV implementations
  const key = encodeURIComponent(repo)
  const codeKey  = `repo:${key}:inviteCode`
  const tokenKey = `repo:${key}:token`

  // Idempotent: return existing code if already registered
  const existing = await env.KV.get(codeKey)
  if (existing) return json({ inviteCode: existing })

  const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  await env.KV.put(tokenKey, token)
  await env.KV.put(codeKey, inviteCode)
  return json({ inviteCode })
}

async function handleInvite({ repo, username, inviteCode }, env) {
  if (!repo || !username || !inviteCode) return json({ error: 'missing_fields' }, 400)

  const key = encodeURIComponent(repo)
  const storedCode = await env.KV.get(`repo:${key}:inviteCode`)
  if (storedCode !== inviteCode) return json({ error: 'invalid_invite_code' }, 403)

  const token = await env.KV.get(`repo:${key}:token`)
  if (!token) return json({ error: 'no_organizer_token' }, 403)

  const [owner, repoName] = repo.split('/')
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/collaborators/${username}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'push' }),
    }
  )
  // GitHub returns 204 for both new invite and already-a-collaborator — both are success
  if (!resp.ok) {
    const err = await resp.text()
    return json({ error: `github_api_error: ${err}` }, 502)
  }
  return json({ ok: true })
}
```

- [ ] **Step 3.3: Commit**

```bash
git add workers/
git commit -m "feat: add Cloudflare Worker (anytrunk-worker)"
```

---

## Task 4: Gifts app

The app follows the same structure as potluck: `index.html` + `main.js` + `organizer.js` + `participant.js` + `gifts.css`. No observer mode (all gift registries are private).

**Files:**
- Create: `apps/gifts/index.html`
- Create: `apps/gifts/main.js`
- Create: `apps/gifts/organizer.js`
- Create: `apps/gifts/participant.js`
- Create: `apps/gifts/gifts.css`

- [ ] **Step 4.1: Create `index.html`**

Create `apps/gifts/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gift Registry</title>
  <link rel="stylesheet" href="gifts.css">
</head>
<body>
  <div id="app">Authenticating...</div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 4.2: Create `main.js`**

Create `apps/gifts/main.js`:

```js
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'
import { renderOrganizer } from './organizer.js'
import { renderParticipant, renderOnboardingGate } from './participant.js'

// ── CONFIG ────────────────────────────────────────────────────────────────
// Deploy workers/anytrunk-worker/ to Cloudflare and paste the worker URL here.
// Register a GitHub OAuth App — put clientSecret in the Worker, not here.
const CLIENT_ID  = '<CLIENT_ID>'
const WORKER_URL = '<WORKER_URL>'
// ─────────────────────────────────────────────────────────────────────────

const params      = new URLSearchParams(location.search)
const mode        = params.get('mode')    // 'organizer' | 'participant'
const repoParam   = params.get('repo')
const inviteParam = params.get('invite')  // opaque invite code (not a PAT)

async function main() {
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

- [ ] **Step 4.3: Create `organizer.js`**

Create `apps/gifts/organizer.js`:

```js
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'

export async function renderOrganizer(store, repoParam) {
  const app = document.getElementById('app')

  // Resume from URL param or localStorage
  const recentRepos = WorkerGitHubStore.getRecentRepos()
  let activeRepo = repoParam ?? null

  if (!activeRepo && recentRepos.length > 0) {
    activeRepo = recentRepos[0]
    store._repoFullName = activeRepo
  }

  async function renderDashboard() {
    const wishlist = activeRepo ? await store.read('_wishlist.json') : null
    const participants = activeRepo ? await store.readAll() : []

    // Build claims map: item → [usernames]
    const claims = {}
    for (const { username, latest } of participants) {
      if (latest?.item) {
        if (!claims[latest.item]) claims[latest.item] = []
        claims[latest.item].push(username)
      }
    }

    const items = wishlist?.items ?? []
    const inviteCode = activeRepo ? WorkerGitHubStore.getInviteCode(activeRepo) : null
    const joinUrl = inviteCode
      ? `${location.origin}${location.pathname.replace('index.html', 'index.html')}?mode=participant&repo=${activeRepo}&invite=${inviteCode}`
      : null

    app.innerHTML = `
      <h1>Gift Registry — Organizer</h1>
      <p>Signed in as: <strong>${store.username}</strong></p>

      ${!activeRepo ? `
        <section>
          <h2>Create new registry</h2>
          <input id="eventName" placeholder="birthday-2026-04-01" />
          <button id="createBtn">Create</button>
        </section>
      ` : ''}

      ${recentRepos.length > 0 && !activeRepo ? `
        <section>
          <h2>Resume</h2>
          ${recentRepos.map(r => `<button class="resume-btn" data-repo="${r}">${r}</button>`).join('')}
        </section>
      ` : ''}

      ${activeRepo ? `
        <section>
          <h2>Active registry</h2>
          <p>Repo: <strong>${activeRepo}</strong></p>
          ${joinUrl
            ? `<button id="copyJoinLink">Copy join link</button>`
            : `<button id="registerBtn">Generate join link</button>`}
        </section>

        <section>
          <h2>Wishlist</h2>
          <div>
            <input id="newItem" placeholder="Add item..." />
            <button id="addItemBtn">Add</button>
          </div>
          <ul id="wishlistItems">
            ${items.map(item => {
              const claimants = claims[item] ?? []
              const display = claimants.length === 0
                ? '<span class="unclaimed">unclaimed</span>'
                : claimants.length > 1
                  ? `<span class="conflict">⚠ claimed by ${claimants.join(', ')}</span>`
                  : `<span class="claimed">→ claimed by ${claimants[0]}</span>`
              return `<li>${item} ${display}</li>`
            }).join('')}
          </ul>
        </section>
      ` : ''}
    `

    // Wire up buttons
    document.getElementById('createBtn')?.addEventListener('click', async () => {
      const name = document.getElementById('eventName').value.trim()
      if (!name) return
      try {
        const repo = await store.createSpace(name)
        activeRepo = repo
        store._repoFullName = repo
        await store.write('_wishlist.json', { items: [] })
        await store.register()
        await renderDashboard()
      } catch (e) {
        app.querySelector('.err')?.remove()
        app.insertAdjacentHTML('beforeend', `<p class="err">${e.message}</p>`)
      }
    })

    document.getElementById('registerBtn')?.addEventListener('click', async () => {
      await store.register()
      await renderDashboard()
    })

    document.getElementById('copyJoinLink')?.addEventListener('click', () => {
      navigator.clipboard.writeText(joinUrl)
        .then(() => alert('Join link copied!'))
        .catch(() => prompt('Copy this link:', joinUrl))
    })

    document.getElementById('addItemBtn')?.addEventListener('click', async () => {
      const item = document.getElementById('newItem').value.trim()
      if (!item) return
      const current = await store.read('_wishlist.json')
      const updated = { items: [...(current?.items ?? []), item] }
      await store.write('_wishlist.json', updated)
      await renderDashboard()
    })

    document.querySelectorAll('.resume-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        activeRepo = btn.dataset.repo
        store._repoFullName = activeRepo
        await renderDashboard()
      })
    })

    // Poll for claim updates every 30s
    if (activeRepo) {
      clearTimeout(renderDashboard._pollTimer)
      renderDashboard._pollTimer = setTimeout(renderDashboard, 30_000)
    }
  }

  await renderDashboard()
}
```

- [ ] **Step 4.4: Create `participant.js`**

Create `apps/gifts/participant.js`:

```js
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'

export function renderOnboardingGate(repoParam, { clientId, workerUrl }) {
  const app = document.getElementById('app')
  app.innerHTML = `
    <h1>Gift Registry</h1>
    <p>You've been invited to a gift registry. Do you have a GitHub account?</p>
    <button id="hasAccount">Yes, sign in with GitHub</button>
    <button id="noAccount">No, create a free account</button>
    <p id="hint" style="display:none">${WorkerGitHubStore.onboardingHint()}
      <a href="${WorkerGitHubStore.onboardingUrl()}" target="_blank">Create account →</a>
    </p>
  `
  document.getElementById('hasAccount').addEventListener('click', () => {
    WorkerGitHubStore.beginAuth(clientId, workerUrl)
  })
  document.getElementById('noAccount').addEventListener('click', () => {
    document.getElementById('hint').style.display = ''
  })
}

export async function renderParticipant(store, repoParam, inviteCode) {
  const app = document.getElementById('app')
  app.innerHTML = `<p>Joining registry...</p>`

  try {
    await store.join(repoParam, inviteCode)
  } catch (e) {
    app.innerHTML = `<p class="err">Failed to join: ${e.message}</p>`
    return
  }

  async function renderWishlist() {
    const wishlist = await store.read('_wishlist.json')
    const participants = await store.readAll()

    // Build claims map: item → first claimant (lexicographically earliest timestamp)
    // readAll returns entries sorted by path, so entries[0] is earliest
    const firstClaims = {}
    const allClaims = {}
    for (const { username, entries } of participants) {
      for (const { data } of entries) {
        if (data?.item) {
          if (!allClaims[data.item]) allClaims[data.item] = []
          allClaims[data.item].push(username)
          // Track first claim by insertion order (entries already sorted by timestamp)
          if (!firstClaims[data.item]) firstClaims[data.item] = username
        }
      }
    }

    const items = wishlist?.items ?? []

    app.innerHTML = `
      <h1>Gift Registry</h1>
      <p>Signed in as: <strong>${store.username}</strong></p>
      <p>Status: <strong class="badge">joined ✓</strong></p>

      <section>
        <h2>Wishlist</h2>
        <ul id="wishlistItems">
          ${items.map(item => {
            const claimants = allClaims[item] ?? []
            const myClaim = claimants.includes(store.username)

            let display
            if (claimants.length === 0) {
              display = `<button class="claim-btn" data-item="${item}">Claim</button>`
            } else if (claimants.length > 1) {
              display = `<span class="conflict">⚠ claimed by ${claimants.join(', ')}</span>`
            } else if (myClaim) {
              display = `<span class="yours">You ✓</span>`
            } else {
              display = `<span class="claimed">claimed by ${claimants[0]}</span>`
            }

            return `<li>${item} ${display}</li>`
          }).join('')}
        </ul>
      </section>
    `

    document.querySelectorAll('.claim-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true
        try {
          await store.append({ item: btn.dataset.item }, { prefix: store.username })
          await renderWishlist()
        } catch (e) {
          app.insertAdjacentHTML('beforeend', `<p class="err">${e.message}</p>`)
          btn.disabled = false
        }
      })
    })

    // Poll every 30s
    clearTimeout(renderWishlist._pollTimer)
    renderWishlist._pollTimer = setTimeout(renderWishlist, 30_000)
  }

  await renderWishlist()
}
```

- [ ] **Step 4.5: Create `gifts.css`**

Create `apps/gifts/gifts.css`:

```css
body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
h2 { font-size: 1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #eee; padding-bottom: 0.25rem; }
input { padding: 0.4rem 0.6rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.95rem; }
button { padding: 0.4rem 0.8rem; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: #f6f8fa; font-size: 0.9rem; margin-left: 0.5rem; }
button:hover { background: #e6e9ec; }
ul { list-style: none; padding: 0; }
li { padding: 0.4rem 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f0f0; }
.badge { background: #2ea44f; color: white; padding: 0.1rem 0.5rem; border-radius: 12px; font-size: 0.85rem; }
.claimed { color: #666; font-size: 0.9rem; }
.unclaimed { color: #999; font-size: 0.9rem; font-style: italic; }
.yours { color: #2ea44f; font-weight: bold; font-size: 0.9rem; }
.conflict { color: #d97706; font-size: 0.9rem; }
.err { color: #d73a49; background: #ffeef0; padding: 0.5rem; border-radius: 4px; }
.resume-btn { margin: 0.25rem 0.25rem 0 0; }
```

- [ ] **Step 4.6: Verify the app loads in browser**

Start the static server:

```bash
npx serve . -l 3000
```

Open `http://localhost:3000/apps/gifts/index.html?mode=organizer` — should see "Authenticating..." briefly then redirect to GitHub (since CLIENT_ID is still a placeholder). That redirect confirms the app is wired up correctly.

> To test the full flow you need a deployed Worker and real CLIENT_ID — see `docs/tutorial-gifts.md`.

- [ ] **Step 4.7: Commit**

```bash
git add apps/gifts/
git commit -m "feat: add gifts app (organizer + participant modes)"
```

---

## Task 5: Tutorial documentation

Replace `docs/e2e-test.md` with three focused files. The potluck tutorial inherits everything from the existing e2e-test.md; the gifts tutorial focuses on Worker deployment and the differences.

**Files:**
- Create: `docs/tutorial.md`
- Create: `docs/tutorial-potluck.md`
- Create: `docs/tutorial-gifts.md`
- Delete: `docs/e2e-test.md`

- [ ] **Step 5.1: Create `docs/tutorial.md`** (shared prerequisites)

Create `docs/tutorial.md`:

```markdown
# AnyTrunk Tutorial — Prerequisites & Setup

This guide covers the prerequisites shared by both the **Potluck** and **Gifts** walkthroughs.
Complete this section first, then follow the app-specific tutorial.

---

## Prerequisites

- Node.js 18 or later (`node --version`)
- Two GitHub accounts:
  - **Account A** — will act as the event organizer
  - **Account B** — will act as a participant
- The repository checked out and dependencies installed (`npm install`)

---

## Step 1: Register a GitHub OAuth App

All steps below are performed while signed in to **Account A**.

1. Go to `https://github.com/settings/developers`
2. Click **OAuth Apps** → **New OAuth App**
3. Fill in:
   - **Application name:** `AnyTrunkDemo`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** depends on which app you are testing:
     - Potluck: `http://localhost:3000/apps/potluck/index.html`
     - Gifts: `http://localhost:3000/apps/gifts/index.html`
4. Click **Register application**
5. Note the **Client ID** — you will paste it into the app's config
6. Click **Generate a new client secret** and note the **Client Secret**
   - Potluck: paste into `apps/potluck/main.js` as `CLIENT_SECRET`
   - Gifts: this goes into the Worker env, not client code — see `docs/tutorial-gifts.md`

---

## Step 2: Start the Static File Server

Open a terminal in the project root:

```bash
npx serve . -l 3000
```

Verify: open `http://localhost:3000` — you should see a directory listing.

> `serve.json` in the project root sets `"cleanUrls": false` to prevent 301 redirects
> from stripping the `?code=&state=` query string that GitHub appends to the callback URL.
> Without it, OAuth completes but the app never receives the code.

Now follow the app-specific tutorial:

- Potluck (zero-backend, CORS proxy): `docs/tutorial-potluck.md`
- Gifts (hardened, Cloudflare Worker): `docs/tutorial-gifts.md`
```

- [ ] **Step 5.2: Create `docs/tutorial-potluck.md`**

Create `docs/tutorial-potluck.md`:

```markdown
# AnyTrunk Tutorial — Potluck App

The potluck app demonstrates the **zero-backend pattern**: GitHub is the storage layer,
the browser is the runtime. A public CORS proxy handles the OAuth token exchange, and the
organizer creates a Fine-Grained PAT manually to invite participants.

**Complete `docs/tutorial.md` first.**

Estimated time: 30–45 minutes.

---

## Step 1: Configure the App

Open `apps/potluck/main.js` and fill in the config block near the top:

```js
const CLIENT_ID     = '<your Client ID>'
const CLIENT_SECRET = '<your Client Secret>'   // ⚠ visible in browser — POC only, see D1
const CORS_PROXY    = 'http://localhost:8080'
```

> The client secret is visible in the browser source. This is a known limitation of the
> potluck POC — see D1 in the design spec. Do not reuse this OAuth App for anything beyond
> local testing.

---

## Step 2: Start the CORS Proxy

Open a second terminal in the project root:

```bash
npm run proxy
```

This runs a local cors-anywhere server on port 8080.

> The library (`completeAuth()`) POSTs to GitHub's token endpoint via this proxy because
> browsers block direct cross-origin requests to `github.com/login/oauth/access_token`.
> In the gifts app, a Cloudflare Worker replaces this proxy — see D2 in the design spec.

Verify both servers are running:
- Proxy: `curl -s http://localhost:8080` — a response or "missing headers" is normal
- File server: `http://localhost:3000` shows a directory listing

---

## Step 3: Organizer Creates an Event (Account A)

Navigate to:
```
http://localhost:3000/apps/potluck/index.html?mode=organizer
```

1. GitHub OAuth screen appears. Sign in as **Account A** and click **Authorize**.
2. You are redirected back. You should see **Potluck Organizer** with your Account A username.

   > After OAuth, the library stores the token in `sessionStorage` and redirects to the
   > original URL. The app reloads with the token available — no second OAuth redirect.

3. Fill in an event name (e.g. `potluck-2026-03-21`) and click **Create**.
   The library calls `store.createSpace(name)` — this creates a private GitHub repo and
   writes `_event.json` to it.

4. Under **Share join link**, follow the 6-step PAT checklist:
   - Click **→ Open GitHub token page**
   - Token name: copy the suggested name
   - Expiration: **7 days**
   - Repository access: **Only select repositories** → select the new repo
   - Permissions → Repository permissions → Administration: **Read and write**
   - Click **Generate token**, copy it, paste into the app, click **Validate**

   > The PAT is embedded in the join URL. This is D3+D4 — see the design spec. The gifts
   > app eliminates this step entirely via the Worker.

5. Click **Copy join link** and save it. Keep this window open.

---

## Step 4: Participant Joins (Account B)

Open a **private/incognito window** and navigate to the join link.

1. The onboarding gate appears — click **Yes, sign in with GitHub**.
2. Sign in as **Account B** and authorize.
3. The **joined ✓** badge appears. The library called `store.join()` which:
   - Used the PAT in the URL to call `PUT /collaborators/{username}` (adding Account B)
   - Used Account B's own token to accept the invitation via `PATCH /repository_invitations/{id}`

4. Enter a dish name and click **Submit**.
   The library calls `store.append({ dish }, { prefix: username })` — writes
   `{username}/{timestamp}.json` to the repo.

---

## Step 5: Organizer Sees the Submission

Back in the organizer window, wait up to 30 seconds (the app polls `store.readAll()`
every 30s). Account B's dish should appear in the Responses table.

> `readAll()` enumerates top-level repo directories, skipping `_`-prefixed entries
> (like `_event.json`). Each participant directory is a GitHub username; files inside
> are submissions sorted lexicographically by timestamp.

---

## Step 6: Participant Re-submits

In the participant window, enter a different dish and click **Submit**. Two rows appear
in the history; the latest is marked `← current`.

Back in the organizer window, the table shows the latest dish after the next poll.

---

## Step 7: Cleanup

1. Revoke the PAT: `github.com/settings/tokens` → delete the `{repo}-invite` token
2. Delete the repo from the organizer dashboard (**Delete event**) or from GitHub directly
3. Optionally revoke the OAuth App under `github.com/settings/developers`

---

## Troubleshooting

**CORS error on token exchange** — Check that `npm run proxy` is running and that
`CORS_PROXY` in `main.js` is `http://localhost:8080`.

**401 Unauthorized** — Token has expired or session was lost. Close the tab, reopen the
URL, and re-authenticate. Tokens are stored in `sessionStorage` and cleared on tab close.

**PUT /collaborators fails with 404** — The PAT targets the wrong repo or has expired.
Re-generate a new PAT in the organizer dashboard.

**Already authenticated but shows the login page** — Expected on fresh incognito window.
`sessionStorage` is cleared when a tab closes. Click **Yes, sign in with GitHub**.
```

- [ ] **Step 5.3: Create `docs/tutorial-gifts.md`**

Create `docs/tutorial-gifts.md`:

```markdown
# AnyTrunk Tutorial — Gifts App

The gifts app demonstrates the **hardened pattern**: a Cloudflare Worker handles OAuth
token exchange and collaborator invites. No secrets in client code. No manual PAT creation.

**Complete `docs/tutorial.md` first.**

Compared to potluck, this tutorial has one extra section (deploying the Worker). After
that, the organizer and participant flows are noticeably simpler.

Estimated time: 45–60 minutes (including Worker deployment).

---

## Step 1: Deploy the Cloudflare Worker

You will need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

**Install wrangler:**
```bash
npm install -g wrangler
wrangler login
```

**Create a KV namespace:**
```bash
cd workers/anytrunk-worker
npx wrangler kv namespace create anytrunk
```

Copy the `id` from the output and paste it into `workers/anytrunk-worker/wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "KV"
id = "PASTE_YOUR_ID_HERE"
```

**Set secrets** (these replace `CLIENT_SECRET` and `CORS_PROXY` from potluck — they live
in the Worker, never in client code):
```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Enter the values from your OAuth App when prompted.

**Deploy:**
```bash
npx wrangler deploy
```

Note the Worker URL (e.g. `https://anytrunk-worker.your-subdomain.workers.dev`).

Return to the project root before continuing:
```bash
cd ../..
```

> The Worker handles three endpoints: `/oauth/token` (fixes D1+D2 — secret off client,
> own proxy), `/spaces/register` (generates invite codes), and `/spaces/invite` (fixes D3
> — adds collaborators using a stored organizer token without exposing it to the client).

---

## Step 2: Configure the App

Open `apps/gifts/main.js` and fill in:

```js
const CLIENT_ID  = '<your Client ID>'      // same OAuth App as registered in prerequisites
const WORKER_URL = '<your Worker URL>'     // e.g. https://anytrunk-worker.your-sub.workers.dev
```

No `CLIENT_SECRET` here — it lives in the Worker.

---

## Step 3: Organizer Creates a Registry (Account A)

Navigate to:
```
http://localhost:3000/apps/gifts/index.html?mode=organizer
```

1. GitHub OAuth screen appears. Sign in as **Account A** and authorize.

   > The library (`WorkerGitHubStore.completeAuth()`) POSTs the OAuth code to the Worker's
   > `/oauth/token` endpoint instead of cors-anywhere. The Worker exchanges it for a token
   > using the stored `GITHUB_CLIENT_SECRET` — the secret never touches the browser.

2. Fill in a registry name (e.g. `birthday-2026-04-01`) and click **Create**.
   Same as potluck: `store.createSpace(name)` creates a private GitHub repo.

3. The app immediately calls `store.register()` after creation.

   > `register()` POSTs `{ repo, token }` to the Worker's `/spaces/register` endpoint.
   > The Worker stores the organizer's token in KV and returns an opaque invite code.
   > The invite code is stored in `localStorage` — no PAT creation needed.

   Notice: no GitHub Settings detour. No PAT checklist. This is D3 resolved.

4. Add wishlist items using the **Add** button. Each item is written to `_wishlist.json`
   via `store.write('_wishlist.json', { items })`.

5. Click **Copy join link** and share it with participants.

   > The join URL contains an opaque code (e.g. `?invite=a3f8c1d2...`), not a raw PAT.
   > This is D4 partially mitigated — the code grants collaborator access but is not
   > directly usable as a GitHub credential.

---

## Step 4: Participant Joins (Account B)

Open a **private/incognito window** and navigate to the join link.

1. The onboarding gate appears — click **Yes, sign in with GitHub**.
2. Sign in as **Account B** and authorize.

   > Token exchange goes through the Worker — Account B's `client_secret` is never in
   > the browser.

3. The **joined ✓** badge appears. Behind the scenes:
   - `store.join()` POSTed `{ repo, username, inviteCode }` to the Worker's `/spaces/invite`
   - The Worker validated the invite code and called `PUT /collaborators/{username}`
     using the **stored organizer token** — Account B never saw the organizer's token
   - `_autoAcceptInvitation()` then accepted the invitation using Account B's own token

   Compare to potluck: the PAT that was embedded in the URL is now stored server-side.

4. The wishlist appears. Click **Claim** on an item.
   The library calls `store.append({ item }, { prefix: username })` — same API as potluck.

---

## Step 5: Organizer Sees Claims

Back in the organizer window, claimed items show the claimant's name. The app polls
`store.readAll()` every 30s — same mechanism as potluck.

> The data layer is identical between the two apps. Only the auth flow changed.

---

## Step 6: Cleanup

1. Delete the repo from the organizer dashboard or GitHub directly
2. Optionally delete the Worker: `npx wrangler delete anytrunk-worker`
3. Optionally revoke the OAuth App under `github.com/settings/developers`

---

## Troubleshooting

**Worker returns 400 on token exchange** — Check that `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` secrets are set correctly in the Worker (`npx wrangler secret list`).

**Worker returns 403 on invite** — The invite code in the URL may be stale. Open the
organizer dashboard, which will regenerate and display the current join link.

**401 Unauthorized on GitHub API calls** — Same as potluck: token expired or session lost.
Close the tab, reopen the URL, re-authenticate.

**`wrangler deploy` fails with KV namespace error** — Confirm the `id` in `wrangler.toml`
matches the output of `npx wrangler kv namespace list`.
```

- [ ] **Step 5.4: Delete `docs/e2e-test.md`**

```bash
git rm docs/e2e-test.md
```

- [ ] **Step 5.5: Commit**

```bash
git add docs/tutorial.md docs/tutorial-potluck.md docs/tutorial-gifts.md
git commit -m "docs: add tutorial set (tutorial.md, tutorial-potluck.md, tutorial-gifts.md), retire e2e-test.md"
```

---

## Final verification

```bash
npm test
```

Expected: all tests pass. Manual verification via `docs/tutorial-gifts.md`.
