// tests/github-store.test.mjs
import { test, expect, beforeEach } from 'vitest'
import { reset } from './helpers/mock-browser.mjs'
import { clearFetch, mockFetch } from './helpers/mock-fetch.mjs'
import { GitHubStore } from '../lib/github-store.js'

beforeEach(() => {
  reset()
  clearFetch()
  lastRedirect = null
})

// ── Tests follow below each Task ──

// Placeholder to verify the harness works
test('GitHubStore can be instantiated', () => {
  const s = new GitHubStore({ clientId: 'id', clientSecret: 'secret' })
  expect(s.isAuthenticated).toBeFalsy()
  expect(s.username).toBeNull()
})

// Track redirects: override global.location with a settable property descriptor
// so we can capture beginAuth's redirect. configurable:true allows later override.
let lastRedirect = null
Object.defineProperty(global, 'location', {
  configurable: true,
  get: () => ({ href: lastRedirect ?? 'http://localhost/', search: '' }),
  set: (v) => { lastRedirect = typeof v === 'string' ? v : v.href },
})

test('beginAuth stores credentials and state in sessionStorage', () => {
  GitHubStore.beginAuth('my-client-id', 'my-secret')
  const stored = JSON.parse(sessionStorage.getItem('gh:auth'))
  expect(stored.clientId).toBe('my-client-id')
  expect(stored.clientSecret).toBe('my-secret')
  expect(stored.state && stored.state.length > 8).toBe(true)
})

test('beginAuth redirects to GitHub OAuth URL', () => {
  GitHubStore.beginAuth('my-client-id', 'my-secret')
  expect(lastRedirect?.includes('github.com/login/oauth/authorize')).toBe(true)
  expect(lastRedirect?.includes('client_id=my-client-id')).toBe(true)
  expect(lastRedirect?.includes('scope=repo')).toBe(true)
})

test('completeAuth exchanges code for token and stores it', async () => {
  sessionStorage.setItem('gh:auth', JSON.stringify({
    clientId: 'id', clientSecret: 'secret', state: 'abc123',
    corsProxy: 'https://cors-anywhere.herokuapp.com'
  }))
  Object.defineProperty(global, 'location', {
    configurable: true,
    get: () => ({ href: 'http://localhost/?code=mycode&state=abc123',
                  search: '?code=mycode&state=abc123' }),
    set: () => {},
  })

  mockFetch((url) => {
    if (url.includes('access_token')) {
      return { status: 200, body: { access_token: 'gho_testtoken' } }
    }
    if (url.includes('api.github.com/user')) {
      return { status: 200, body: { login: 'johndoe' } }
    }
  })

  const store = await GitHubStore.completeAuth()
  expect(store.isAuthenticated).toBe(true)
  expect(store.username).toBe('johndoe')
  expect(sessionStorage.getItem('gh:token')).toBe('gho_testtoken')
  expect(sessionStorage.getItem('gh:username')).toBe('johndoe')
})

test('completeAuth throws if state does not match', async () => {
  sessionStorage.setItem('gh:auth', JSON.stringify({
    clientId: 'id', clientSecret: 'secret', state: 'expected-state'
  }))
  Object.defineProperty(global, 'location', {
    configurable: true,
    get: () => ({ search: '?code=x&state=wrong-state' }),
    set: () => {},
  })
  await expect(GitHubStore.completeAuth()).rejects.toThrow()
})

test('init rehydrates from sessionStorage when token exists', async () => {
  sessionStorage.setItem('gh:token',    'gho_existing')
  sessionStorage.setItem('gh:username', 'existinguser')
  Object.defineProperty(global, 'location', {
    configurable: true,
    get: () => ({ search: '' }),
    set: () => {},
  })

  const store = await GitHubStore.init({ clientId: 'id', clientSecret: 'secret' })
  expect(store.isAuthenticated).toBe(true)
  expect(store.username).toBe('existinguser')
})

test('createSpace creates a private repo and writes _event.json', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null })
    if (url.includes('/user/repos')) {
      return { status: 201, body: { full_name: 'johndoe/potluck-test', owner: { login: 'johndoe' } } }
    }
    if (url.includes('_event.json')) {
      return { status: 201, body: { content: { path: '_event.json' } } }
    }
  })

  const store = new GitHubStore({ token: 'tok', _username: 'johndoe' })
  const repoFullName = await store.createSpace('potluck-test')

  expect(repoFullName).toBe('johndoe/potluck-test')
  const repoCall = calls.find(c => c.url.includes('/user/repos'))
  expect(repoCall?.body?.private).toBe(true)
  const eventCall = calls.find(c => c.url.includes('_event.json'))
  expect(eventCall).toBeTruthy()
  const content = JSON.parse(decodeURIComponent(escape(atob(eventCall.body.content))))
  expect(content.name).toBe('potluck-test')
  expect(content.owner).toBe('johndoe')
  expect(content.created).toBeTruthy()
})

test('_apiCall sends Authorization header with token', async () => {
  let capturedHeaders = null
  mockFetch((url, opts) => {
    capturedHeaders = opts.headers
    return { status: 200, body: { ok: true } }
  })
  const store = new GitHubStore({ token: 'gho_mytoken' })
  await store._apiCall('GET', '/user')
  expect(capturedHeaders?.Authorization).toBe('Bearer gho_mytoken')
})

test('join adds collaborator using inviteToken and auto-accepts invitation', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, headers: opts.headers })
    if (url.includes('/collaborators/bob')) {
      // Non-empty body = invitation was created
      return { status: 201, body: { id: 99, invitee: { login: 'bob' } } }
    }
    if (url.includes('repository_invitations') && (opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: [{ id: 99, repository: { full_name: 'johndoe/potluck' } }] }
    }
    if (url.includes('repository_invitations/99')) {
      return { status: 204, body: '' }
    }
  })

  const store = new GitHubStore({ token: 'participant-token', _username: 'bob' })
  await store.join('johndoe/potluck', 'invite-pat')

  const addCall = calls.find(c => c.url.includes('/collaborators/bob'))
  expect(addCall).toBeTruthy()
  expect(addCall.headers.Authorization).toBe('Bearer invite-pat')

  const acceptCall = calls.find(c => c.url.includes('invitations/99') && c.method === 'PATCH')
  expect(acceptCall).toBeTruthy()
  expect(acceptCall.headers.Authorization).toBe('Bearer participant-token')
})

test('join is idempotent — skips accept step when already a collaborator', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url })
    if (url.includes('/collaborators/bob')) {
      return { status: 204, body: '' }  // empty body = already a collaborator
    }
  })

  const store = new GitHubStore({ token: 'tok', _username: 'bob' })
  await store.join('johndoe/potluck', 'invite-pat')

  const inviteCalls = calls.filter(c => c.url.includes('repository_invitations'))
  expect(inviteCalls.length).toBe(0)
})

test('write creates a new file when it does not exist', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, body: opts.body })
    if ((opts.method ?? 'GET') === 'GET') return { status: 404, body: { message: 'Not Found' } }
    return { status: 201, body: { content: { path: 'bob/dish.json' } } }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.write('bob/dish.json', { dish: 'lasagna' })

  const putCall = calls.find(c => c.method === 'PUT')
  expect(putCall).toBeTruthy()
  const body = JSON.parse(putCall.body)
  expect(body.sha).toBeFalsy()
  const decoded = JSON.parse(decodeURIComponent(escape(atob(body.content))))
  expect(decoded.dish).toBe('lasagna')
})

test('write includes SHA when file already exists', async () => {
  const existingContent = btoa(unescape(encodeURIComponent(JSON.stringify({ dish: 'old' }))))
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url, body: opts.body })
    if ((opts.method ?? 'GET') === 'GET') {
      return { status: 200, body: { sha: 'abc123', content: existingContent } }
    }
    return { status: 200, body: {} }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.write('bob/dish.json', { dish: 'updated' })

  const putCall = calls.find(c => c.method === 'PUT')
  const body = JSON.parse(putCall.body)
  expect(body.sha).toBe('abc123')
})

test('append writes to a timestamped path under prefix', async () => {
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ method: opts.method ?? 'GET', url })
    return { status: 201, body: {} }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.append({ dish: 'tiramisu' }, { prefix: 'bob' })

  const putCall = calls.find(c => c.method === 'PUT')
  expect(putCall).toBeTruthy()
  expect(putCall.url.includes('/bob/')).toBe(true)
  expect(putCall.url.endsWith('.json')).toBe(true)
  // Extract timestamp from URL path: .../contents/bob/2026-03-21T...Z.json
  const match = putCall.url.match(/\/bob\/(.+\.json)/)
  expect(match).toBeTruthy()
  const rawName = decodeURIComponent(match[1].replace('.json', ''))
  expect(rawName.match(/^\d{4}-/)).toBeTruthy()
})

test('read returns parsed JSON for an existing file', async () => {
  const data = { dish: 'lasagna' }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
  mockFetch(() => ({ status: 200, body: { content: encoded, sha: 'abc' } }))

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.read('bob/dish.json')
  expect(result.dish).toBe('lasagna')
})

test('read returns null for a missing file', async () => {
  mockFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.read('bob/dish.json')
  expect(result).toBeNull()
})

test('list returns sorted array of { path, sha } for files only', async () => {
  mockFetch(() => ({
    status: 200,
    body: [
      { type: 'file', path: 'bob/2026-03-21T15:00:00.000Z.json', sha: 'sha2' },
      { type: 'file', path: 'bob/2026-03-21T14:00:00.000Z.json', sha: 'sha1' },
      { type: 'dir',  path: 'bob/subdir', sha: 'sha3' },
    ]
  }))
  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.list('bob')
  expect(result.length).toBe(2)
  expect(result[0].path).toBe('bob/2026-03-21T14:00:00.000Z.json')
  expect(result[1].sha).toBe('sha2')
})

test('readAll returns participants with entries and latest, skipping _ entries', async () => {
  const encode = d => btoa(unescape(encodeURIComponent(JSON.stringify(d))))

  mockFetch((url) => {
    // Root directory listing
    if (url.match(/\/contents\/?$/)) {
      return { status: 200, body: [
        { type: 'file', name: '_event.json', path: '_event.json', sha: 'e1' },
        { type: 'dir',  name: '_archive',    path: '_archive',    sha: 'da' },
        { type: 'dir',  name: 'bob',         path: 'bob',         sha: 'd1' },
        { type: 'dir',  name: 'tom',         path: 'tom',         sha: 'd2' },
      ]}
    }
    // bob's directory
    if (url.includes('/contents/bob') && !url.includes('.json')) {
      return { status: 200, body: [
        { type: 'file', path: 'bob/2026-03-21T14-00-00.000Z.json', sha: 's1' },
        { type: 'file', path: 'bob/2026-03-21T15-00-00.000Z.json', sha: 's2' },
      ]}
    }
    // tom's directory — empty
    if (url.includes('/contents/tom') && !url.includes('.json')) {
      return { status: 200, body: [] }
    }
    // bob's files
    if (url.includes('bob/2026-03-21T14')) {
      return { status: 200, body: { content: encode({ dish: 'lasagna' }), sha: 's1' } }
    }
    if (url.includes('bob/2026-03-21T15')) {
      return { status: 200, body: { content: encode({ dish: 'tiramisu' }), sha: 's2' } }
    }
  })

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  const result = await store.readAll()

  expect(result.length).toBe(2)

  const bob = result.find(r => r.username === 'bob')
  expect(bob).toBeTruthy()
  expect(bob.entries.length).toBe(2)
  expect(bob.latest.dish).toBe('tiramisu')

  const tom = result.find(r => r.username === 'tom')
  expect(tom).toBeTruthy()
  expect(tom.entries.length).toBe(0)
  expect(tom.latest).toBeNull()

  // _event.json must be excluded
  expect(result.find(r => r.username === '_event.json')).toBeFalsy()
  expect(result.find(r => r.username === '_archive')).toBeFalsy()
})

test('saveRecentRepo stores repoFullName in localStorage', () => {
  GitHubStore.saveRecentRepo('johndoe/potluck-test')
  const stored = GitHubStore.getRecentRepos()
  expect(stored.includes('johndoe/potluck-test')).toBe(true)
})

test('getRecentRepos deduplicates and caps at 5', () => {
  for (let i = 0; i < 7; i++) GitHubStore.saveRecentRepo(`owner/repo-${i}`)
  const stored = GitHubStore.getRecentRepos()
  expect(stored.length <= 5).toBe(true)
})

test('saveRecentRepo moves existing entry to front on re-save', () => {
  GitHubStore.saveRecentRepo('owner/repo-a')
  GitHubStore.saveRecentRepo('owner/repo-b')
  GitHubStore.saveRecentRepo('owner/repo-a')  // re-save moves to front
  const stored = GitHubStore.getRecentRepos()
  expect(stored[0]).toBe('owner/repo-a')
  expect(stored[1]).toBe('owner/repo-b')
  expect(stored.length).toBe(2)
})

test('_apiCall omits Authorization header when token is null', async () => {
  let capturedHeaders = null
  mockFetch((url, opts) => {
    capturedHeaders = opts.headers
    return { status: 200, body: {} }
  })
  const store = new GitHubStore({})
  await store._apiCall('GET', '/repos/test/test/contents/')
  expect(capturedHeaders?.Authorization).toBeFalsy()
})

test('_apiCall throws immediately on write when store is read-only', async () => {
  const store = new GitHubStore({ token: 'tok' })
  store._readOnly = true
  await expect(store._apiCall('PUT', '/repos/x/y/contents/foo', { content: 'x' })).rejects.toThrow()
})

test('join throws immediately when store is read-only', async () => {
  const store = new GitHubStore({ token: 'tok', _username: 'alice' })
  store._readOnly = true
  await expect(store.join('owner/repo', 'invite-pat')).rejects.toThrow()
})

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
  expect(repoCall?.body?.private).toBe(false)
})

test('createSpace throws a friendly error when repo name is already taken', async () => {
  mockFetch(() => ({ status: 422, body: { message: 'Repository creation failed.' } }))
  const store = new GitHubStore({ token: 'tok', _username: 'johndoe' })
  let msg = ''
  try { await store.createSpace('existing-event') } catch(e) { msg = e.message }
  expect(msg.includes('existing-event')).toBe(true)
  expect(msg.includes('already exists')).toBe(true)
  expect(msg.includes('existing-event-2')).toBe(true)
})
