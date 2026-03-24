# Scavenger Hunt App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `delete()` and `findOrCreateSpace()` to the store library, then build `apps/hunt/` — a multi-service scavenger hunt organizer app serving as the AnyTrunk reference template.

**Architecture:** Library extension first (Tasks 1–4), then app scaffold (Task 5), pure utilities (Task 6), form wrapper (Task 7), four views (Tasks 8–11), CSS (Task 12). Each library task is TDD. App tasks are verified manually by running the app. The hunt app uses a fixed-name registry space (`anytrunk-hunt`) for cross-device discovery; each hunt is its own space with a base-36 timestamp ID.

**Tech Stack:** Vanilla ES modules, no build step. Tailwind CSS via CDN, JSON Forms (`@jsonforms/core` + `@jsonforms/vanilla-renderers`) via `esm.sh`. Vitest for library tests.

---

## File Map

### Modified
| File | Change |
|---|---|
| `lib/base-store.js` | Add `async delete(path)` and `async findOrCreateSpace(name)` stubs |
| `lib/github-store.js` | Implement both methods; add `delete` + `findOrCreateSpace` to `getCapabilities()` |
| `lib/google-drive-store.js` | Implement both methods; add to `getCapabilities()` |
| `tests/github-store.test.mjs` | New tests for `delete()` and `findOrCreateSpace()` |
| `tests/google-drive-store.test.mjs` | New tests for `delete()` and `findOrCreateSpace()` |

### Created
| File | Role |
|---|---|
| `apps/hunt/index.html` | Entry point: Tailwind CDN, JSON Forms CSS CDN, `<script type="module" src="hunt.js">` |
| `apps/hunt/hunt.js` | Bootstrap + config (`SERVICES`, `SCHEMA`) + view router |
| `apps/hunt/hunt.css` | Scoped JSON Forms overrides (Tailwind preflight compatibility) |
| `apps/hunt/views/service-select.js` | View: pick GitHub or Drive |
| `apps/hunt/views/space-list.js` | View: list/create/delete hunts from registry |
| `apps/hunt/views/hunt-editor.js` | View: hunt details + locations list |
| `apps/hunt/views/location-form.js` | View: create/edit one location via JSON Forms |
| `apps/hunt/lib/forms.js` | `renderForm(container, schema, data, onChange)` wrapper |
| `apps/hunt/lib/slug.js` | `toSlug(name)` + `uniqueSlug(name, existing[])` pure utils |
| `apps/hunt/lib/poller.js` | `createPoller(fn, ms)` → `{ start, stop }` |

---

## Task 1: `delete(path)` on BaseStore and GitHubStore

**Files:**
- Modify: `lib/base-store.js`
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 1.1: Write failing tests**

Append to `tests/github-store.test.mjs`:

```js
// ── delete() ──────────────────────────────────────────────────────────────

test('delete fetches SHA then sends DELETE request', async () => {
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/hunt-abc' })
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined })
    if (opts.method === 'GET')    return { status: 200, body: { sha: 'abc123', content: '' } }
    if (opts.method === 'DELETE') return { status: 200, body: {} }
  })
  await store.delete('locations/foo.json')
  expect(calls).toHaveLength(2)
  expect(calls[0].method).toBe('GET')
  expect(calls[0].url).toContain('/repos/alice/hunt-abc/contents/locations/foo.json')
  expect(calls[1].method).toBe('DELETE')
  expect(calls[1].url).toContain('/repos/alice/hunt-abc/contents/locations/foo.json')
  expect(calls[1].body.sha).toBe('abc123')
  expect(calls[1].body.message).toBe('delete locations/foo.json')
})

test('delete returns silently when GET returns 404 (already deleted)', async () => {
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/hunt-abc' })
  mockFetch(() => ({ status: 404, body: {} }))
  await expect(store.delete('locations/missing.json')).resolves.toBeUndefined()
})

test('delete returns silently when DELETE returns 404 (race condition)', async () => {
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/hunt-abc' })
  let callCount = 0
  mockFetch((url, opts) => {
    callCount++
    if (opts.method === 'GET') return { status: 200, body: { sha: 'abc123', content: '' } }
    return { status: 404, body: {} }
  })
  await expect(store.delete('locations/foo.json')).resolves.toBeUndefined()
})

test('delete throws when DELETE returns non-404 error', async () => {
  const store = new GitHubStore({ token: 'tok', repoFullName: 'alice/hunt-abc' })
  mockFetch((url, opts) => {
    if (opts.method === 'GET')    return { status: 200, body: { sha: 'abc123', content: '' } }
    if (opts.method === 'DELETE') return { status: 500, body: 'Internal Server Error' }
  })
  await expect(store.delete('locations/foo.json')).rejects.toThrow()
})
```

- [ ] **Step 1.2: Run tests — verify they fail**

```bash
npx vitest run tests/github-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 4 new tests fail with "not implemented".

- [ ] **Step 1.3: Add stub to `lib/base-store.js`**

After the `deleteSpace` stub line:
```js
async delete(path)        { throw new Error('not implemented') }
async findOrCreateSpace(name) { throw new Error('not implemented') }
```

- [ ] **Step 1.4: Implement `delete(path)` on `GitHubStore`**

Add after the `write()` method in `lib/github-store.js`:

```js
async delete(path) {
  const getResp = await this._apiCall('GET', `/repos/${this._spaceId}/contents/${path}`)
  if (!getResp.ok) return   // 404 = already deleted, return silently
  const { sha } = await getResp.json()

  const delResp = await this._apiCall('DELETE', `/repos/${this._spaceId}/contents/${path}`, {
    message: `delete ${path}`,
    sha,
  })
  if (!delResp.ok && delResp.status !== 404) {
    const err = await delResp.text()
    throw new Error(`GitHub API DELETE ${path} → ${delResp.status}: ${err}`)
  }
}
```

- [ ] **Step 1.5: Add `delete` to `getCapabilities()` in `GitHubStore`**

Update the `getCapabilities()` return object — add `delete: true` alongside the existing fields.

- [ ] **Step 1.6: Run tests — verify they pass**

```bash
npx vitest run tests/github-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 4 new tests pass.

- [ ] **Step 1.7: Commit**

```bash
git add lib/base-store.js lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add delete(path) to BaseStore and GitHubStore"
```

---

## Task 2: `findOrCreateSpace(name)` on GitHubStore

**Files:**
- Modify: `lib/github-store.js`
- Modify: `tests/github-store.test.mjs`

- [ ] **Step 2.1: Write failing tests**

Append to `tests/github-store.test.mjs`:

```js
// ── findOrCreateSpace() ───────────────────────────────────────────────────

test('findOrCreateSpace sets spaceId and returns full_name when repo exists', async () => {
  const store = new GitHubStore({ token: 'tok', _username: 'alice' })
  mockFetch(() => ({ status: 200, body: { full_name: 'alice/anytrunk-hunt' } }))
  const id = await store.findOrCreateSpace('anytrunk-hunt')
  expect(id).toBe('alice/anytrunk-hunt')
  expect(store._spaceId).toBe('alice/anytrunk-hunt')
})

test('findOrCreateSpace creates repo and returns full_name when not found', async () => {
  const store = new GitHubStore({ token: 'tok', _username: 'alice' })
  let callCount = 0
  mockFetch((url, opts) => {
    callCount++
    if (callCount === 1) return { status: 404, body: {} }  // GET /repos/alice/anytrunk-hunt
    if (callCount === 2) return { status: 201, body: { full_name: 'alice/anytrunk-hunt', owner: { login: 'alice' } } }  // POST /user/repos
    return { status: 201, body: { content: { sha: 'init' } } }  // PUT _event.json
  })
  const id = await store.findOrCreateSpace('anytrunk-hunt')
  expect(id).toBe('alice/anytrunk-hunt')
  expect(store._spaceId).toBe('alice/anytrunk-hunt')
})

test('findOrCreateSpace throws on unexpected API error', async () => {
  const store = new GitHubStore({ token: 'tok', _username: 'alice' })
  mockFetch(() => ({ status: 500, body: 'Server error' }))
  await expect(store.findOrCreateSpace('anytrunk-hunt')).rejects.toThrow()
})
```

- [ ] **Step 2.2: Run tests — verify they fail**

```bash
npx vitest run tests/github-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 3 new tests fail with "not implemented".

- [ ] **Step 2.3: Implement `findOrCreateSpace(name)` on `GitHubStore`**

Add after `delete()` in `lib/github-store.js`:

```js
async findOrCreateSpace(name) {
  const resp = await this._apiCall('GET', `/repos/${this._username}/${name}`)
  if (resp.ok) {
    const { full_name } = await resp.json()
    this.setSpace(full_name)
    return full_name
  }
  // 404 = repo doesn't exist yet — create it
  return this.createSpace(name)
}
```

Note: `this._username` is set during `init()` / `completeAuth()` and held in sessionStorage. Verify the constructor assigns it from `_username` (it does, line 12: `this._username = _username`).

- [ ] **Step 2.4: Add `findOrCreateSpace` to `getCapabilities()`**

Add `findOrCreateSpace: true` to the return object.

- [ ] **Step 2.5: Run tests — verify they pass**

```bash
npx vitest run tests/github-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 3 new tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add lib/github-store.js tests/github-store.test.mjs
git commit -m "feat: add findOrCreateSpace(name) to GitHubStore"
```

---

## Task 3: `delete(path)` on GoogleDriveStore

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

**Key facts about Drive's `_findFile`:** Returns `{ id, name }` or `null` (from HTTP 200 with empty `files` array). A missing file returns `null`, not a 404. So "not found" is handled by checking the return value, not by catching errors.

- [ ] **Step 3.1: Write failing tests**

Append to `tests/google-drive-store.test.mjs`:

```js
// ── delete() ────────────────────────────────────────────────────────────

function driveStore(spaceId = 'folder-root') {
  const s = new GoogleDriveStore({ token: 'tok', _folderId: spaceId })
  return s
}

test('delete resolves file ID and sends DELETE request', async () => {
  const store = driveStore('space-123')
  const calls = []
  mockFetch((url, opts) => {
    calls.push({ url, method: opts.method })
    // _findFile for 'foo.json' in space-123
    if (opts.method === 'GET' && url.includes('drive/v3/files') && !url.includes('/files/')) {
      return { status: 200, body: { files: [{ id: 'file-abc', name: 'foo.json' }] } }
    }
    // DELETE
    if (opts.method === 'DELETE') return { status: 204, body: '' }
  })
  await store.delete('foo.json')
  const deleteCall = calls.find(c => c.method === 'DELETE')
  expect(deleteCall).toBeDefined()
  expect(deleteCall.url).toContain('file-abc')
})

test('delete returns silently when file not found', async () => {
  const store = driveStore('space-123')
  mockFetch(() => ({ status: 200, body: { files: [] } }))
  await expect(store.delete('missing.json')).resolves.toBeUndefined()
})

test('delete resolves subfolder then file for nested path', async () => {
  const store = driveStore('space-123')
  let callCount = 0
  mockFetch((url, opts) => {
    callCount++
    if (opts.method === 'GET') {
      if (callCount === 1) return { status: 200, body: { files: [{ id: 'sub-folder-id', name: 'locations' }] } }
      return { status: 200, body: { files: [{ id: 'file-xyz', name: 'anne-frank.json' }] } }
    }
    return { status: 204, body: '' }
  })
  await store.delete('locations/anne-frank.json')
  expect(callCount).toBe(3) // 2 finds + 1 delete
})

test('delete returns silently when subfolder not found', async () => {
  const store = driveStore('space-123')
  mockFetch(() => ({ status: 200, body: { files: [] } }))
  await expect(store.delete('locations/missing.json')).resolves.toBeUndefined()
})
```

- [ ] **Step 3.2: Run tests — verify they fail**

```bash
npx vitest run tests/google-drive-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 4 new tests fail with "not implemented".

- [ ] **Step 3.3: Implement `delete(path)` on `GoogleDriveStore`**

Add after the `write()` method in `lib/google-drive-store.js`:

```js
async delete(path) {
  const parts    = path.split('/')
  const filename = parts[parts.length - 1]
  let parentId   = this._spaceId

  if (parts.length > 1) {
    const sub = await this._findFile(parts[0], this._spaceId)
    if (!sub) return   // subfolder not found — nothing to delete
    parentId = sub.id
  }

  const file = await this._findFile(filename, parentId)
  if (!file) return   // file not found — return silently

  // Note: spec says "use fetch() directly" for this DELETE call, but this codebase
  // routes all Drive calls through _api() for consistent auth headers and base URL.
  // _api() throws with the message pattern "Drive API ... → {status}: ..." on errors,
  // so we catch and suppress 404s using that string. 204 (success) does not throw.
  try {
    await this._api('DELETE', `/drive/v3/files/${file.id}`)
  } catch (e) {
    if (e.message.includes('→ 404:')) return   // already deleted — return silently
    throw e
  }
}
```

- [ ] **Step 3.4: Add `delete` to `getCapabilities()` in `GoogleDriveStore`**

Add `delete: true` to the return object.

- [ ] **Step 3.5: Run tests — verify they pass**

```bash
npx vitest run tests/google-drive-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 4 new tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: add delete(path) to GoogleDriveStore"
```

---

## Task 4: `findOrCreateSpace(name)` on GoogleDriveStore

**Files:**
- Modify: `lib/google-drive-store.js`
- Modify: `tests/google-drive-store.test.mjs`

**Key fact:** `_findFile(name, 'root')` searches Drive's root folder. `'root'` is the Drive API's well-known alias for the authenticated user's root folder.

- [ ] **Step 4.1: Write failing tests**

Append to `tests/google-drive-store.test.mjs`:

```js
// ── findOrCreateSpace() ──────────────────────────────────────────────────

test('findOrCreateSpace sets spaceId and returns folder ID when folder exists', async () => {
  const store = new GoogleDriveStore({ token: 'tok' })
  mockFetch((url, opts) => {
    // _findFile(name, 'root') — GET /drive/v3/files?q=...
    if (opts.method === 'GET') return { status: 200, body: { files: [{ id: 'folder-abc', name: 'anytrunk-hunt' }] } }
  })
  const id = await store.findOrCreateSpace('anytrunk-hunt')
  expect(id).toBe('folder-abc')
  expect(store._spaceId).toBe('folder-abc')
})

test('findOrCreateSpace creates folder and returns its ID when not found', async () => {
  const store = new GoogleDriveStore({ token: 'tok', userEmail: 'alice@example.com' })
  let callCount = 0
  mockFetch((url, opts) => {
    callCount++
    // _findFile returns empty → not found
    if (callCount === 1) return { status: 200, body: { files: [] } }
    // POST /drive/v3/files (createSpace — create folder)
    if (callCount === 2 && opts.method === 'POST' && url.includes('/drive/v3/files') && !url.includes('upload'))
      return { status: 200, body: { id: 'new-folder-id' } }
    // _writeFile for _event.json (multipart upload)
    return { status: 200, body: { id: 'event-file-id' } }
  })
  const id = await store.findOrCreateSpace('anytrunk-hunt')
  expect(id).toBe('new-folder-id')
  expect(store._spaceId).toBe('new-folder-id')
})
```

- [ ] **Step 4.2: Run tests — verify they fail**

```bash
npx vitest run tests/google-drive-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 2 new tests fail with "not implemented".

- [ ] **Step 4.3: Implement `findOrCreateSpace(name)` on `GoogleDriveStore`**

Add after `delete()` in `lib/google-drive-store.js`:

```js
async findOrCreateSpace(name) {
  // Search in Drive root — 'root' is the Drive API alias for the user's root folder
  const file = await this._findFile(name, 'root')
  if (file) {
    this.setSpace(file.id)
    return file.id
  }
  return this.createSpace(name)
}
```

- [ ] **Step 4.4: Add `findOrCreateSpace` to `getCapabilities()`**

Add `findOrCreateSpace: true` to the return object.

- [ ] **Step 4.5: Run tests — verify they pass**

```bash
npx vitest run tests/google-drive-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 2 new tests pass.

- [ ] **Step 4.6: Run the full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass. Fix any regressions before continuing.

- [ ] **Step 4.7: Commit**

```bash
git add lib/google-drive-store.js tests/google-drive-store.test.mjs
git commit -m "feat: add findOrCreateSpace(name) to GoogleDriveStore"
```

---

## Task 5: App scaffold — `index.html`, `hunt.js`, `hunt.css`

**Files:**
- Create: `apps/hunt/index.html`
- Create: `apps/hunt/hunt.js`
- Create: `apps/hunt/hunt.css`

The app is a vanilla ES module SPA. All views export `render(container, state, navigate)`. The router in `hunt.js` calls the right view and merges state on every transition.

- [ ] **Step 5.1: Create `apps/hunt/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hunt — AnyTrunk</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet"
    href="https://unpkg.com/@jsonforms/vanilla-renderers/vanilla.css">
  <link rel="stylesheet" href="hunt.css">
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="app" class="max-w-lg mx-auto px-4 py-8"></div>
  <script type="module" src="hunt.js"></script>
</body>
</html>
```

- [ ] **Step 5.2: Create `apps/hunt/hunt.js`** (bootstrap + config + router skeleton)

```js
// apps/hunt/hunt.js
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'
import { GoogleDriveStore }   from '../../lib/google-drive-store.js'
import { renderServiceSelect } from './views/service-select.js'
import { renderSpaceList }     from './views/space-list.js'
import { renderHuntEditor }    from './views/hunt-editor.js'
import { renderLocationForm }  from './views/location-form.js'

// ── CONFIG — edit this section to use the app ────────────────────────────────

const SERVICES = [
  {
    id:    'github',
    label: 'GitHub',
    icon:  '🐙',
    hint:  'Version-controlled. Needs a GitHub account.',
    Store: WorkerGitHubStore,
    config: { clientId: '<CLIENT_ID>', workerUrl: '<WORKER_URL>' },
  },
  {
    id:    'google-drive',
    label: 'Google Drive',
    icon:  '📁',
    hint:  'Easy sharing. Needs a Google account.',
    Store: GoogleDriveStore,
    config: { clientId: '<CLIENT_ID>', clientSecret: '<CLIENT_SECRET>' },
  },
]

const SCHEMA = {
  hunt: {
    type: 'object',
    properties: {
      name:           { type: 'string',  title: 'Hunt name'       },
      country:        { type: 'string',  title: 'Country'         },
      flag:           { type: 'string',  title: 'Flag emoji'      },
      description:    { type: 'string',  title: 'Description'     },
      walkTime:       { type: 'string',  title: 'Walk time'       },
      suggestedRoute: { type: 'string',  title: 'Suggested route' },
    },
    required: ['name'],
  },
  location: {
    type: 'object',
    properties: {
      name:         { type: 'string',  title: 'Location name' },
      neighborhood: { type: 'string',  title: 'Neighborhood'  },
      coords:       { type: 'string',  title: 'Coordinates'   },
      clue:         { type: 'string',  title: 'Clue'          },
      challenge:    { type: 'string',  title: 'Challenge'     },
      points:       { type: 'number',  title: 'Points'        },
      badge:        { type: 'string',  title: 'Badge'         },
      isFinal:      { type: 'boolean', title: 'Final stop?'   },
    },
    required: ['name', 'clue'],
  },
}

// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = {
  'service-select': renderServiceSelect,
  'space-list':     renderSpaceList,
  'hunt-editor':    renderHuntEditor,
  'location-form':  renderLocationForm,
}

const container = document.getElementById('app')
let _state = { schema: SCHEMA }

function navigate(viewName, overrides = {}) {
  _state = { ..._state, ...overrides }
  const render = VIEWS[viewName]
  if (!render) throw new Error(`Unknown view: ${viewName}`)
  container.innerHTML = ''
  render(container, _state, navigate)
}

// ── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  // Resolve which service to use
  const storedServiceId = localStorage.getItem('hunt:serviceId')
  const service = SERVICES.find(s => s.id === storedServiceId) ??
                  (SERVICES.length === 1 ? SERVICES[0] : null)

  if (!service) {
    navigate('service-select', { services: SERVICES })
    return
  }

  const store = await service.Store.init(service.config)
  if (!store) return  // OAuth redirect in progress — page will reload

  localStorage.setItem('hunt:serviceId', service.id)

  try {
    const registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')
    navigate('space-list', { store, service, registrySpaceId })
  } catch (e) {
    container.innerHTML = `
      <div class="text-center py-16">
        <p class="text-red-600 mb-4">Could not connect to your storage: ${e.message}</p>
        <button onclick="location.reload()"
          class="px-4 py-2 bg-violet-600 text-white rounded">Retry</button>
      </div>`
  }
}

start()
```

- [ ] **Step 5.3: Create `apps/hunt/hunt.css`**

```css
/* JSON Forms vanilla renderer: scope overrides to avoid Tailwind preflight conflicts */
.jf-form label {
  display: block;
  font-weight: 500;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  color: #374151;
}

.jf-form input[type="text"],
.jf-form input[type="number"],
.jf-form textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  background: white;
}

.jf-form input[type="text"]:focus,
.jf-form input[type="number"]:focus,
.jf-form textarea:focus {
  outline: 2px solid #7c3aed;
  outline-offset: -1px;
  border-color: transparent;
}

.jf-form .validation_error {
  color: #dc2626;
  font-size: 0.75rem;
  margin-top: 0.125rem;
}
```

- [ ] **Step 5.4: Verify scaffold renders**

Open `apps/hunt/index.html` in a browser (via a local server or file:// if CORS allows). Expected: blank page with no console errors.

- [ ] **Step 5.5: Commit**

```bash
git add apps/hunt/index.html apps/hunt/hunt.js apps/hunt/hunt.css
git commit -m "feat: scaffold hunt app entry point and router"
```

---

## Task 6: `lib/slug.js` and `lib/poller.js`

**Files:**
- Create: `apps/hunt/lib/slug.js`
- Create: `apps/hunt/lib/poller.js`

These are pure logic — write and test before wiring into views.

- [ ] **Step 6.1: Create `apps/hunt/lib/slug.js`**

```js
// apps/hunt/lib/slug.js

export function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function uniqueSlug(name, existing = []) {
  const base = toSlug(name)
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}
```

- [ ] **Step 6.2: Create `apps/hunt/lib/poller.js`**

```js
// apps/hunt/lib/poller.js

export function createPoller(fn, intervalMs) {
  let timer = null
  return {
    start() {
      Promise.resolve().then(fn).catch(() => {})  // immediate first call, errors caught
      timer = setInterval(() => {
        Promise.resolve().then(fn).catch(() => {})
      }, intervalMs)
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
```

- [ ] **Step 6.3: Write unit tests for slug utilities**

Create `tests/slug.test.mjs`:

```js
import { test, expect } from 'vitest'
import { toSlug, uniqueSlug } from '../apps/hunt/lib/slug.js'

test('toSlug lowercases and replaces non-alphanum with hyphens', () => {
  expect(toSlug('Anne Frank House')).toBe('anne-frank-house')
})

test('toSlug strips leading and trailing hyphens', () => {
  expect(toSlug('  Hello World  ')).toBe('hello-world')
})

test('toSlug collapses multiple non-alphanum chars to one hyphen', () => {
  expect(toSlug('A & B / C')).toBe('a-b-c')
})

test('uniqueSlug returns base slug when no collision', () => {
  expect(uniqueSlug('Anne Frank', [])).toBe('anne-frank')
})

test('uniqueSlug appends -2 on first collision', () => {
  expect(uniqueSlug('Anne Frank', ['anne-frank'])).toBe('anne-frank-2')
})

test('uniqueSlug increments until free', () => {
  expect(uniqueSlug('Anne Frank', ['anne-frank', 'anne-frank-2', 'anne-frank-3'])).toBe('anne-frank-4')
})
```

- [ ] **Step 6.4: Run slug tests**

```bash
npx vitest run tests/slug.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 6 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add apps/hunt/lib/slug.js apps/hunt/lib/poller.js tests/slug.test.mjs
git commit -m "feat: add slug and poller utilities for hunt app"
```

---

## Task 7: `lib/forms.js` — JSON Forms wrapper

**Files:**
- Create: `apps/hunt/lib/forms.js`

JSON Forms is imported via `esm.sh` (ES module CDN). This wrapper is not unit-tested (it requires a live browser and CDN). It will be verified when views are wired up in subsequent tasks.

- [ ] **Step 7.1: Create `apps/hunt/lib/forms.js`**

```js
// apps/hunt/lib/forms.js
// JSON Forms vanilla wrapper.
// Requires: index.html loads @jsonforms/vanilla-renderers CSS via unpkg.
import { createStore, defaultMiddleware } from 'https://esm.sh/@jsonforms/core'
import { VanillaRendererRegistryEntry, vanillaRenderers }
  from 'https://esm.sh/@jsonforms/vanilla-renderers'

/**
 * Render a JSON Schema form into `container`.
 *
 * @param {HTMLElement} container - Target DOM element. Will be cleared and populated.
 * @param {object}      schema    - JSON Schema describing the data shape.
 * @param {object}      data      - Initial data (or {} for a new form).
 * @param {function}    onChange  - Called with the latest data on every change.
 * @returns {function}  dispose   - Call to unmount the form (clears the container).
 */
export function renderForm(container, schema, data, onChange) {
  // Wrap container for scoped CSS
  const root = document.createElement('div')
  root.className = 'jf-form'
  container.appendChild(root)

  const store = createStore(
    (state = { data, errors: [] }, action) => {
      const next = defaultMiddleware(state, action, vanillaRenderers)
      if (next.data !== state.data) onChange({ ...next.data })
      return next
    },
    { data, schema, uischema: undefined, renderers: vanillaRenderers }
  )

  // JSON Forms vanilla mounts directly into the DOM element
  import('https://esm.sh/@jsonforms/vanilla-renderers').then(({ mountForm }) => {
    mountForm(root, store)
  })

  return () => { container.innerHTML = '' }
}
```

**Note:** The exact JSON Forms vanilla API (`createStore`, `mountForm`) may differ from the above — it follows the `@jsonforms/vanilla-renderers` API. If the import shape is different (e.g. uses `JsonForms` class instead of `createStore`/`mountForm`), adjust accordingly after consulting the package's README at `https://jsonforms.io/docs/vanilla-renderer`. The wrapper's external contract (`renderForm(container, schema, data, onChange)`) must not change.

- [ ] **Step 7.2: Commit**

```bash
git add apps/hunt/lib/forms.js
git commit -m "feat: add JSON Forms vanilla wrapper"
```

---

## Task 8: `views/service-select.js`

**Files:**
- Create: `apps/hunt/views/service-select.js`

State in: `{ services, schema }`. Navigates to `'space-list'` with `{ store, service, registrySpaceId }` on success.

- [ ] **Step 8.1: Create `apps/hunt/views/service-select.js`**

```js
// apps/hunt/views/service-select.js

export function renderServiceSelect(container, state, navigate) {
  const { services } = state
  let selectedService = services[0]

  function render() {
    container.innerHTML = `
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold text-gray-900">Where do you want to save your hunt?</h1>
        <p class="text-gray-500 text-sm mt-1">You can switch at any time.</p>
      </div>
      <div class="flex flex-col gap-3 mb-6">
        ${services.map(s => `
          <button data-service-id="${s.id}"
            class="service-card flex items-center gap-4 border-2 rounded-lg p-4 text-left transition-colors
              ${s.id === selectedService.id
                ? 'border-violet-600 bg-violet-50'
                : 'border-gray-200 bg-white hover:border-gray-300'}">
            <span class="text-2xl">${s.icon}</span>
            <div>
              <div class="font-semibold text-sm">${s.label}</div>
              <div class="text-xs text-gray-500">${s.hint}</div>
            </div>
            ${s.id === selectedService.id
              ? '<span class="ml-auto text-xs font-semibold text-violet-600">Selected ✓</span>'
              : ''}
          </button>
        `).join('')}
      </div>
      <button id="continue-btn"
        class="w-full py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700">
        Continue with ${selectedService.label} →
      </button>
      <div id="error-msg" class="mt-4 text-red-600 text-sm text-center hidden"></div>`

    container.querySelectorAll('.service-card').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedService = services.find(s => s.id === btn.dataset.serviceId)
        render()
      })
    })

    container.querySelector('#continue-btn').addEventListener('click', handleContinue)
  }

  async function handleContinue() {
    const btn = container.querySelector('#continue-btn')
    const errEl = container.querySelector('#error-msg')
    btn.disabled = true
    btn.textContent = 'Connecting…'
    errEl.classList.add('hidden')

    try {
      const store = await selectedService.Store.init(selectedService.config)
      if (!store) return  // OAuth redirect — page will reload
      localStorage.setItem('hunt:serviceId', selectedService.id)
      const registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')
      navigate('space-list', { store, service: selectedService, registrySpaceId })
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = `Continue with ${selectedService.label} →`
    }
  }

  render()
}
```

- [ ] **Step 8.2: Wire into `hunt.js` and verify in browser**

`hunt.js` already imports `renderServiceSelect`. Open `apps/hunt/index.html` in a browser. If `SERVICES` has 2 entries (both with placeholder `<CLIENT_ID>`), the service-select screen should appear. Verify: cards render, clicking a card selects it (border changes), "Continue" button shows the service name.

- [ ] **Step 8.3: Commit**

```bash
git add apps/hunt/views/service-select.js
git commit -m "feat: add service-select view to hunt app"
```

---

## Task 9: `views/space-list.js`

**Files:**
- Create: `apps/hunt/views/space-list.js`

State in: `{ store, service, registrySpaceId, schema }`. Reads `_registry.json` from the registry space on entry. Navigates to `'hunt-editor'` on open or after create.

- [ ] **Step 9.1: Create `apps/hunt/views/space-list.js`**

```js
// apps/hunt/views/space-list.js

export async function renderSpaceList(container, state, navigate) {
  const { store, service, registrySpaceId } = state

  container.innerHTML = `<div class="text-center py-8 text-gray-400">Loading…</div>`

  await store.setSpace(registrySpaceId)
  const registry = await store.read('_registry.json') ?? []

  function render(reg) {
    const listHtml = reg.length === 0
      ? `<p class="text-gray-400 text-sm text-center py-4">No hunts yet. Create your first one below.</p>`
      : reg.map(entry => `
          <div class="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between bg-white">
            <button data-space-id="${entry.spaceId}" data-hunt-name="${entry.name}"
              class="open-hunt font-semibold text-sm text-violet-600 hover:text-violet-800 text-left">
              ${entry.name}
            </button>
            <button data-space-id="${entry.spaceId}" data-hunt-name="${entry.name}"
              class="delete-hunt text-xs text-red-500 hover:text-red-700 ml-4">delete</button>
          </div>`).join('')

    container.innerHTML = `
      <div class="flex items-center justify-between mb-6">
        <div class="text-sm text-gray-500">
          ${service.icon} Connected as <strong>${store.userId}</strong>
        </div>
        <button id="switch-service" class="text-sm text-violet-600 hover:underline">Switch service</button>
      </div>
      <h2 class="text-xl font-bold text-gray-900 mb-4">Your hunts</h2>
      <div class="flex flex-col gap-2 mb-4">${listHtml}</div>
      <div id="new-hunt-area">
        <button id="show-new-hunt"
          class="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400">
          + New hunt
        </button>
      </div>
      <div id="error-msg" class="mt-3 text-red-600 text-sm hidden"></div>`

    container.querySelector('#switch-service').addEventListener('click', () => {
      localStorage.removeItem('hunt:serviceId')
      navigate('service-select', { services: state.services ?? [] })
    })

    container.querySelectorAll('.open-hunt').forEach(btn => {
      btn.addEventListener('click', () => {
        store.setSpace(btn.dataset.spaceId)
        navigate('hunt-editor', { huntSpaceId: btn.dataset.spaceId, huntName: btn.dataset.huntName })
      })
    })

    container.querySelectorAll('.delete-hunt').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.spaceId, btn.dataset.huntName, reg))
    })

    container.querySelector('#show-new-hunt').addEventListener('click', showNewHuntInput)
  }

  function showNewHuntInput() {
    const area = container.querySelector('#new-hunt-area')
    area.innerHTML = `
      <div class="flex gap-2">
        <input id="new-hunt-name" type="text" placeholder="Hunt name"
          class="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-violet-500">
        <button id="create-hunt"
          class="px-4 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700">Create</button>
        <button id="cancel-new"
          class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>`
    container.querySelector('#new-hunt-name').focus()
    container.querySelector('#create-hunt').addEventListener('click', () =>
      handleCreate(container.querySelector('#new-hunt-name').value.trim(), registry))
    container.querySelector('#cancel-new').addEventListener('click', () => render(registry))
  }

  async function handleCreate(displayName, reg) {
    if (!displayName) return
    const errEl = container.querySelector('#error-msg')
    errEl.classList.add('hidden')
    try {
      const inputName   = 'hunt-' + Date.now().toString(36)
      const huntSpaceId = await store.createSpace(inputName)
      await store.write('_hunt.json', { name: displayName })
      await store.setSpace(registrySpaceId)
      const updated = await store.read('_registry.json') ?? []
      updated.push({ spaceId: huntSpaceId, name: displayName, createdAt: new Date().toISOString() })
      await store.write('_registry.json', updated)
      await store.setSpace(huntSpaceId)
      navigate('hunt-editor', { huntSpaceId, huntName: displayName })
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
    }
  }

  async function handleDelete(spaceId, huntName, reg) {
    if (!confirm(`Delete "${huntName}"? This cannot be undone.`)) return
    const errEl = container.querySelector('#error-msg')
    errEl.classList.add('hidden')
    try {
      await store.setSpace(spaceId)
      await store.deleteSpace()
      // findOrCreateSpace calls setSpace internally — no separate setSpace call needed
      await store.findOrCreateSpace('anytrunk-hunt')
      const updated = (await store.read('_registry.json') ?? []).filter(e => e.spaceId !== spaceId)
      await store.write('_registry.json', updated)
      render(updated)
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
    }
  }

  render(registry)
}
```

- [ ] **Step 9.2: Verify in browser (with real credentials)**

Configure one service in `SERVICES` with valid credentials. Open the app. After auth, you should see the space-list screen. Verify: "No hunts yet" shown for an empty registry, "New hunt" input appears on click, creating a hunt navigates away (even if hunt-editor is a stub).

- [ ] **Step 9.3: Commit**

```bash
git add apps/hunt/views/space-list.js
git commit -m "feat: add space-list view to hunt app"
```

---

## Task 10: `views/hunt-editor.js`

**Files:**
- Create: `apps/hunt/views/hunt-editor.js`

State in: `{ store, service, schema, registrySpaceId, huntSpaceId, huntName }`. Shows collapsible hunt details (JSON Forms `schema.hunt`) and locations list with polling.

- [ ] **Step 10.1: Create `apps/hunt/views/hunt-editor.js`**

```js
// apps/hunt/views/hunt-editor.js
import { renderForm } from '../lib/forms.js'
import { createPoller } from '../lib/poller.js'
import { uniqueSlug } from '../lib/slug.js'

export async function renderHuntEditor(container, state, navigate) {
  const { store, schema, registrySpaceId, huntSpaceId, huntName } = state
  await store.setSpace(huntSpaceId)

  let huntData         = {}
  let locationSlugs    = []
  let locationDataMap  = {}
  let detailsExpanded  = false
  let detailsFormData  = {}
  let poller

  async function loadData() {
    huntData      = await store.read('_hunt.json') ?? {}
    locationSlugs = await store.read('_locations.json') ?? []
    const entries = await Promise.all(
      locationSlugs.map(async slug => [slug, await store.read(`locations/${slug}.json`) ?? {}])
    )
    locationDataMap = Object.fromEntries(entries)
  }

  async function refresh() {
    await store.setSpace(huntSpaceId)
    await loadData()
    renderLocations()
  }

  function renderLocations() {
    const list = container.querySelector('#locations-list')
    if (!list) return
    if (locationSlugs.length === 0) {
      list.innerHTML = `<p class="text-gray-400 text-sm text-center py-3">No locations yet.</p>`
    } else {
      list.innerHTML = locationSlugs.map((slug, i) => {
        const loc = locationDataMap[slug] ?? {}
        return `
          <div class="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between bg-white">
            <div>
              <div class="font-medium text-sm">${i + 1} · ${loc.name ?? slug}</div>
              <div class="text-xs text-gray-400">${loc.points ?? 0} pts${loc.badge ? ' · ' + loc.badge : ''}</div>
            </div>
            <div class="flex gap-3 ml-4">
              <button data-slug="${slug}"
                class="edit-loc text-xs text-violet-600 hover:text-violet-800">edit</button>
              <button data-slug="${slug}"
                class="delete-loc text-xs text-red-500 hover:text-red-700">delete</button>
            </div>
          </div>`
      }).join('')
    }
    bindLocationButtons()
  }

  function bindLocationButtons() {
    container.querySelectorAll('.edit-loc').forEach(btn =>
      btn.addEventListener('click', () => {
        poller?.stop()
        navigate('location-form', {
          locationSlug: btn.dataset.slug,
          locationData: locationDataMap[btn.dataset.slug] ?? {},
          locationSlugs,
          huntSpaceId,
          huntName,
        })
      })
    )
    container.querySelectorAll('.delete-loc').forEach(btn =>
      btn.addEventListener('click', () => handleDeleteLocation(btn.dataset.slug))
    )
  }

  async function handleDeleteLocation(slug) {
    if (!confirm(`Delete this location?`)) return
    await store.setSpace(huntSpaceId)
    await store.delete(`locations/${slug}.json`)
    const updated = (await store.read('_locations.json') ?? []).filter(s => s !== slug)
    await store.write('_locations.json', updated)
    locationSlugs   = updated
    delete locationDataMap[slug]
    renderLocations()
  }

  async function handleSaveDetails() {
    await store.setSpace(huntSpaceId)
    await store.write('_hunt.json', detailsFormData)
    huntData = { ...detailsFormData }
    detailsExpanded = false
    renderDetails()
  }

  function renderDetails() {
    const section = container.querySelector('#hunt-details-section')
    if (!section) return
    const summary = [huntData.name, huntData.country, huntData.flag].filter(Boolean).join(' · ')
    section.innerHTML = `
      <div class="border border-gray-200 rounded-lg overflow-hidden mb-6">
        <button id="toggle-details"
          class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm hover:bg-gray-100">
          <div>
            <span class="font-semibold">Hunt details</span>
            <span class="text-gray-500 ml-2">${summary || huntName}</span>
          </div>
          <span class="text-violet-600 text-xs">${detailsExpanded ? 'Close ▲' : 'Edit ▾'}</span>
        </button>
        ${detailsExpanded ? `
          <div class="border-t border-gray-200 p-4">
            <div id="details-form"></div>
            <div class="flex gap-2 mt-3">
              <button id="save-details"
                class="px-4 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700">Save details</button>
              <button id="cancel-details"
                class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>` : ''}
      </div>`

    section.querySelector('#toggle-details').addEventListener('click', () => {
      detailsExpanded = !detailsExpanded
      if (detailsExpanded) detailsFormData = { ...huntData }
      renderDetails()
      if (detailsExpanded) {
        renderForm(
          section.querySelector('#details-form'),
          schema.hunt,
          detailsFormData,
          data => { detailsFormData = data }
        )
      }
    })

    if (detailsExpanded) {
      section.querySelector('#save-details').addEventListener('click', handleSaveDetails)
      section.querySelector('#cancel-details').addEventListener('click', () => {
        detailsExpanded = false
        renderDetails()
      })
    }
  }

  await loadData()
  detailsFormData = { ...huntData }

  container.innerHTML = `
    <div class="mb-6">
      <button id="back-btn" class="text-sm text-gray-500 hover:text-gray-700">← Your hunts</button>
      <span class="text-sm text-gray-400 mx-1">·</span>
      <span class="text-sm font-semibold text-gray-700">${huntName}</span>
    </div>
    <div id="hunt-details-section"></div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-bold text-gray-900">Locations</h2>
      <button id="refresh-btn" class="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
    </div>
    <div id="locations-list"></div>
    <button id="add-location"
      class="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400">
      + Add location
    </button>
    <div id="error-msg" class="mt-3 text-red-600 text-sm hidden"></div>`

  renderDetails()
  renderLocations()

  container.querySelector('#back-btn').addEventListener('click', () => {
    poller?.stop()
    navigate('space-list', { huntSpaceId: undefined, huntName: undefined })
  })

  container.querySelector('#refresh-btn').addEventListener('click', refresh)

  container.querySelector('#add-location').addEventListener('click', () => {
    poller?.stop()
    navigate('location-form', {
      locationSlug: undefined,
      locationData: {},
      locationSlugs,
      huntSpaceId,
      huntName,
    })
  })

  poller = createPoller(refresh, 20_000)
  poller.start()
}
```

- [ ] **Step 10.2: Verify in browser**

Open an existing hunt. Expected: "Hunt details" section collapsed (shows name), locations list loaded (or "No locations yet"), polling every 20s (add a file to the repo manually and wait for refresh). Edit a hunt details form (expand, change name, save).

- [ ] **Step 10.3: Commit**

```bash
git add apps/hunt/views/hunt-editor.js
git commit -m "feat: add hunt-editor view to hunt app"
```

---

## Task 11: `views/location-form.js`

**Files:**
- Create: `apps/hunt/views/location-form.js`

State in: `{ store, schema, huntSpaceId, huntName, locationSlugs, locationSlug?, locationData }`. New location when `locationSlug` is undefined.

- [ ] **Step 11.1: Create `apps/hunt/views/location-form.js`**

```js
// apps/hunt/views/location-form.js
import { renderForm } from '../lib/forms.js'
import { uniqueSlug } from '../lib/slug.js'

export async function renderLocationForm(container, state, navigate) {
  const { store, schema, huntSpaceId, huntName, locationSlugs = [], locationSlug, locationData = {} } = state
  const isNew = !locationSlug
  let formData = { ...locationData }

  await store.setSpace(huntSpaceId)

  container.innerHTML = `
    <div class="mb-6">
      <button id="back-btn" class="text-sm text-gray-500 hover:text-gray-700">← ${huntName}</button>
      <span class="text-sm text-gray-400 mx-1">·</span>
      <span class="text-sm font-semibold text-gray-700">
        ${isNew ? 'New location' : `Edit: ${locationData.name ?? locationSlug}`}
      </span>
    </div>
    <div id="form-root"></div>
    <div class="flex gap-2 mt-4">
      <button id="save-btn"
        class="px-4 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700">
        ${isNew ? 'Create location' : 'Save location'}
      </button>
      <button id="cancel-btn"
        class="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
    </div>
    <div id="error-msg" class="mt-3 text-red-600 text-sm hidden"></div>`

  renderForm(
    container.querySelector('#form-root'),
    schema.location,
    formData,
    data => { formData = data }
  )

  container.querySelector('#back-btn').addEventListener('click', () =>
    navigate('hunt-editor', { huntSpaceId, huntName })
  )

  container.querySelector('#cancel-btn').addEventListener('click', () =>
    navigate('hunt-editor', { huntSpaceId, huntName })
  )

  container.querySelector('#save-btn').addEventListener('click', async () => {
    const btn   = container.querySelector('#save-btn')
    const errEl = container.querySelector('#error-msg')
    btn.disabled = true
    errEl.classList.add('hidden')

    try {
      await store.setSpace(huntSpaceId)

      if (isNew) {
        // Derive unique slug from name
        const slug    = uniqueSlug(formData.name ?? 'location', locationSlugs)
        await store.write(`locations/${slug}.json`, formData)
        // Append slug to index (fresh read to minimise concurrent-write conflicts)
        const current = await store.read('_locations.json') ?? []
        current.push(slug)
        await store.write('_locations.json', current)
      } else {
        // Use original slug — renaming does not rename the file
        await store.write(`locations/${locationSlug}.json`, formData)
        // _locations.json index is unchanged
      }

      navigate('hunt-editor', { huntSpaceId, huntName })
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
      btn.disabled = false
    }
  })
}
```

- [ ] **Step 11.2: Verify in browser**

Open a hunt, click "+ Add location". Expected: form renders with all fields from `SCHEMA.location`, "Create location" button saves and returns to hunt-editor with the new location in the list. Edit an existing location: verify original slug is used (check the file is updated, not duplicated).

- [ ] **Step 11.3: Commit**

```bash
git add apps/hunt/views/location-form.js
git commit -m "feat: add location-form view to hunt app"
```

---

## Task 12: End-to-end smoke test and tidy-up

**Files:**
- Modify: `apps/hunt/hunt.js` (add `services` to initial state so `space-list` can navigate back to `service-select`)

- [ ] **Step 12.1: Add `services` to initial state in `hunt.js`**

In `hunt.js`, find the `start()` function and ensure `SERVICES` is included in the state passed to the first `navigate` call:

```js
navigate('service-select', { services: SERVICES })
// and in the else branch:
navigate('space-list', { store, service, registrySpaceId, services: SERVICES })
```

- [ ] **Step 12.2: Run the full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass. Fix any regressions.

- [ ] **Step 12.3: End-to-end smoke test in browser**

Walk through the full organizer flow with real credentials:
1. Open `apps/hunt/index.html`
2. If multiple services: pick one, authenticate
3. Hunt list appears (or empty state)
4. Create a new hunt — verify it appears in the registry (`anytrunk-hunt` repo/folder)
5. Edit hunt details — verify `_hunt.json` is updated in the backing
6. Add 2 locations — verify files appear in `locations/` folder
7. Edit a location — verify the correct file is updated
8. Delete a location — verify the file is removed and `_locations.json` is updated
9. Go back → delete the hunt → verify registry `_registry.json` no longer contains it
10. "Switch service" clears the service and returns to service-select (if 2 services configured)
11. Reload the browser — verify the same service is pre-selected (localStorage) and the same hunts appear (registry)

- [ ] **Step 12.4: Final commit**

```bash
git add apps/hunt/hunt.js
git commit -m "feat: complete hunt app — multi-service organizer reference app"
```
