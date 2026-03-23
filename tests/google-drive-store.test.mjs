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
