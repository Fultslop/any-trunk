// tests/github-store.test.mjs
import { reset } from './helpers/mock-browser.mjs'
import { clearFetch, mockFetch } from './helpers/mock-fetch.mjs'
import { GitHubStore } from '../lib/github-store.js'

let passed = 0, failed = 0
const _queue = []

function test(name, fn) { _queue.push({ name, fn }) }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function assertEqual(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

async function runAll() {
  for (const { name, fn } of _queue) {
    reset()
    clearFetch()
    try {
      await fn()
      console.log('✓', name); passed++
    } catch(e) {
      console.error('✗', name, '\n ', e.message); failed++
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
}

// ── Tests follow below each Task ──

// Placeholder to verify the harness works
test('GitHubStore can be instantiated', () => {
  const s = new GitHubStore({ clientId: 'id', clientSecret: 'secret' })
  assert(!s.isAuthenticated, 'should not be authenticated with no token')
  assert(s.username === null, 'username should be null')
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
  assert(store.isAuthenticated, 'should be authenticated')
  assertEqual(store.username, 'johndoe')
  assertEqual(sessionStorage.getItem('gh:token'), 'gho_testtoken')
  assertEqual(sessionStorage.getItem('gh:username'), 'johndoe')
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
  let threw = false
  try { await GitHubStore.completeAuth() } catch { threw = true }
  assert(threw, 'should throw on state mismatch')
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
  assert(store.isAuthenticated)
  assertEqual(store.username, 'existinguser')
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

  assertEqual(repoFullName, 'johndoe/potluck-test')
  const repoCall = calls.find(c => c.url.includes('/user/repos'))
  assert(repoCall?.body?.private === true, 'repo should be private')
  const eventCall = calls.find(c => c.url.includes('_event.json'))
  assert(eventCall, 'should write _event.json')
  const content = JSON.parse(decodeURIComponent(escape(atob(eventCall.body.content))))
  assertEqual(content.name, 'potluck-test')
  assertEqual(content.owner, 'johndoe')
  assert(content.created, '_event.json should have a created timestamp')
})

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
  assert(addCall, 'should call PUT /collaborators/bob')
  assert(addCall.headers.Authorization === 'Bearer invite-pat',
    'should use inviteToken for collaborator add, not participant token')

  const acceptCall = calls.find(c => c.url.includes('invitations/99') && c.method === 'PATCH')
  assert(acceptCall, 'should call PATCH /invitations/99')
  assert(acceptCall.headers.Authorization === 'Bearer participant-token',
    'should use participant own token to accept')
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
  assert(inviteCalls.length === 0, 'should not touch invitations when already a collaborator')
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
    if ((opts.method ?? 'GET') === 'GET') {
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

  const store = new GitHubStore({ token: 'tok', repoFullName: 'johndoe/potluck' })
  await store.append({ dish: 'tiramisu' }, { prefix: 'bob' })

  const putCall = calls.find(c => c.method === 'PUT')
  assert(putCall, 'should PUT a file')
  assert(putCall.url.includes('/bob/'), 'path should include prefix')
  assert(putCall.url.endsWith('.json'), 'path should end in .json')
  // Extract timestamp from URL path: .../contents/bob/2026-03-21T...Z.json
  const match = putCall.url.match(/\/bob\/(.+\.json)/)
  assert(match, 'should have timestamp filename')
  const rawName = decodeURIComponent(match[1].replace('.json', ''))
  assert(rawName.match(/^\d{4}-/), 'filename should start with year')
})

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
  assertEqual(result.length, 2)
  assertEqual(result[0].path, 'bob/2026-03-21T14:00:00.000Z.json')
  assertEqual(result[1].sha, 'sha2')
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

  assertEqual(result.length, 2)

  const bob = result.find(r => r.username === 'bob')
  assert(bob, 'bob should be in results')
  assertEqual(bob.entries.length, 2)
  assertEqual(bob.latest.dish, 'tiramisu')

  const tom = result.find(r => r.username === 'tom')
  assert(tom, 'tom should be in results')
  assertEqual(tom.entries.length, 0)
  assert(tom.latest === null, 'latest should be null when no entries')

  // _event.json must be excluded
  assert(!result.find(r => r.username === '_event.json'), '_event.json should be excluded')
  assert(!result.find(r => r.username === '_archive'), '_archive dir should be excluded')
})

test('saveRecentRepo stores repoFullName in localStorage', () => {
  GitHubStore.saveRecentRepo('johndoe/potluck-test')
  const stored = GitHubStore.getRecentRepos()
  assert(stored.includes('johndoe/potluck-test'), 'should be in recent repos')
})

test('getRecentRepos deduplicates and caps at 5', () => {
  for (let i = 0; i < 7; i++) GitHubStore.saveRecentRepo(`owner/repo-${i}`)
  const stored = GitHubStore.getRecentRepos()
  assert(stored.length <= 5, 'should cap at 5 recent repos')
})

test('saveRecentRepo moves existing entry to front on re-save', () => {
  GitHubStore.saveRecentRepo('owner/repo-a')
  GitHubStore.saveRecentRepo('owner/repo-b')
  GitHubStore.saveRecentRepo('owner/repo-a')  // re-save moves to front
  const stored = GitHubStore.getRecentRepos()
  assertEqual(stored[0], 'owner/repo-a')
  assertEqual(stored[1], 'owner/repo-b')
  assertEqual(stored.length, 2)
})

runAll()
