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

// ── helpers ──────────────────────────────────────────────────────────────────

function makeStore() {
  return new GoogleDriveStore({ clientId: 'cid', token: 'tok', userEmail: 'alice@gmail.com' })
}

// ── createSpace ──────────────────────────────────────────────────────────────

test('createSpace creates folder, writes _event.json, returns folderId', async () => {
  const store = makeStore()
  mockFetch((url, opts) => {
    let parsedBody = null
    try { parsedBody = opts?.body ? JSON.parse(opts.body) : null } catch {}
    // POST to create folder (plain JSON, not upload)
    if (!url.includes('upload') && url.includes('drive/v3/files') && opts?.method === 'POST' && parsedBody?.mimeType?.includes('folder'))
      return { status: 200, body: { id: 'folder-abc' } }
    // Multipart upload to create _event.json
    if (url.includes('upload/drive') && opts?.method === 'POST')
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
    let parsedBody = null
    try { parsedBody = opts?.body ? JSON.parse(opts.body) : null } catch {}
    if (!url.includes('upload') && url.includes('drive/v3/files') && opts?.method === 'POST' && parsedBody?.mimeType?.includes('folder'))
      return { status: 200, body: { id: 'folder-xyz' } }
    if (url.includes('permissions'))
      return { status: 200, body: {} }
    if (url.includes('upload/drive') && opts?.method === 'POST')
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

test('read resolves subfolder file', async () => {
  const store = makeStore()
  store._folderId = 'folder-root'
  mockFetch((url) => {
    // Find the subfolder
    if (url.includes('alice%40gmail.com') || url.includes("name='alice@gmail.com'"))
      return { status: 200, body: { files: [{ id: 'sf-id', name: 'alice@gmail.com' }] } }
    // Find the file inside the subfolder
    if (url.includes('sf-id') && !url.includes('alt=media'))
      return { status: 200, body: { files: [{ id: 'file-id', name: 'entry.json' }] } }
    // Fetch file content
    if (url.includes('file-id') && url.includes('alt=media'))
      return { status: 200, body: { gift: 'book' } }
    throw new Error(`Unexpected: ${url}`)
  })
  const result = await store.read('alice@gmail.com/entry.json')
  expect(result).toEqual({ gift: 'book' })
})

// ── append ───────────────────────────────────────────────────────────────────

test('append creates timestamped file in participant subfolder', async () => {
  const store = makeStore()
  store._folderId = 'folder-abc'
  const createdFiles = []
  mockFetch((url, opts) => {
    const body = opts?.body
    // GET requests — subfolder lookup returns empty (not found)
    if (opts?.method === 'GET')
      return { status: 200, body: { files: [] } }
    // POST to create subfolder (plain JSON body)
    if (!url.includes('upload') && opts?.method === 'POST') {
      let parsedBody = null
      try { parsedBody = body ? JSON.parse(body) : null } catch {}
      if (parsedBody?.mimeType?.includes('folder'))
        return { status: 200, body: { id: 'subfolder-id' } }
    }
    // Multipart upload for file content
    if (url.includes('upload/drive') && opts?.method === 'POST') {
      const nameMatch = body?.match(/"name":"([^"]+)"/)
      if (nameMatch) createdFiles.push(nameMatch[1])
      return { status: 200, body: { id: 'file-new' } }
    }
    throw new Error(`Unexpected: ${opts?.method} ${url}`)
  })
  await store.append({ gift: 'book' }, { prefix: 'alice@gmail.com' })
  expect(createdFiles.some(f => f.match(/^\d{4}-\d{2}-\d{2}T.*\.json$/))).toBe(true)
})

// ── readAll ──────────────────────────────────────────────────────────────────

test('readAll returns participant entries sorted by username', async () => {
  const store = makeStore()
  store._folderId = 'folder-root'

  mockFetch((url) => {
    // List subfolders of root — match by folderId in the query string
    if (url.includes('folder-root') && url.includes('google-apps.folder'))
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
    if (url.includes('folder-root') && url.includes('google-apps.folder'))
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
