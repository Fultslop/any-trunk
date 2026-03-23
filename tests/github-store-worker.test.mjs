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
