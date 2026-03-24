# LocalStore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `LocalStore` backed by the File System Access API as a third storage option in AnyTrunk, enabling test/dev use without OAuth credentials.

**Architecture:** Single `lib/local-store.js` extending `BaseStore`. Root `FileSystemDirectoryHandle` persisted in IndexedDB — each space is a subdirectory of the root. Unit tests use an in-memory mock of the File System Access API (`tests/helpers/mock-filesystem.mjs`). Hunt app gets a third `SERVICES` entry.

**Tech Stack:** Vanilla ES modules, File System Access API, IndexedDB. Vitest for tests.

---

## File Map

| File | Action | Role |
|---|---|---|
| `tests/helpers/mock-filesystem.mjs` | Create | In-memory mock of File System Access API |
| `lib/local-store.js` | Create | `LocalStore` class |
| `tests/local-store.test.mjs` | Create | Unit tests (built up task by task) |
| `apps/hunt/hunt.js` | Modify | Add `LocalStore` to `SERVICES` |

---

## Task 1: In-memory filesystem mock

**Files:**
- Create: `tests/helpers/mock-filesystem.mjs`

This is a test helper — no unit tests for the mock itself. Write it carefully; every subsequent task depends on it.

- [ ] **Step 1.1: Create `tests/helpers/mock-filesystem.mjs`**

```js
// tests/helpers/mock-filesystem.mjs
//
// In-memory mock of the File System Access API.
// Implements the subset of the API used by LocalStore.

function domEx(name) {
  const e = new Error(name)
  e.name = name
  return e
}

function createFileNode(name, parentRef) {
  let content = ''
  return {
    kind: 'file',
    name,
    async getFile() {
      return { text: async () => content }
    },
    async createWritable() {
      return {
        async write(str) { content = str },
        async close() {},
      }
    },
    async remove() {
      parentRef._children.delete(name)
    },
  }
}

function createDirNode(name, parentRef) {
  const node = {
    kind: 'directory',
    name,
    _children: new Map(),

    async getDirectoryHandle(childName, { create = false } = {}) {
      if (node._children.has(childName)) {
        const child = node._children.get(childName)
        if (child.kind !== 'directory') throw domEx('TypeMismatchError')
        return child
      }
      if (!create) throw domEx('NotFoundError')
      const child = createDirNode(childName, node)
      node._children.set(childName, child)
      return child
    },

    async getFileHandle(childName, { create = false } = {}) {
      if (node._children.has(childName)) {
        const child = node._children.get(childName)
        if (child.kind !== 'file') throw domEx('TypeMismatchError')
        return child
      }
      if (!create) throw domEx('NotFoundError')
      const child = createFileNode(childName, node)
      node._children.set(childName, child)
      return child
    },

    async *values() {
      for (const [childName, child] of node._children) {
        yield { name: childName, kind: child.kind }
      }
    },

    async remove({ recursive = false } = {}) {
      if (!recursive && node._children.size > 0) throw domEx('InvalidModificationError')
      if (recursive) node._children.clear()
      if (parentRef) parentRef._children.delete(name)
    },

    async queryPermission() { return 'granted' },
    async requestPermission() { return 'granted' },
  }
  return node
}

/**
 * Create an in-memory root directory handle for use in tests.
 * Pass the returned handle as `_rootHandle` to `LocalStore.init()`.
 */
export function createMockFilesystem(name = 'test-root') {
  return createDirNode(name, null)
}

/**
 * Override `global.showDirectoryPicker` to return the given handle.
 * Call in tests that exercise the picker path of `LocalStore.init()`.
 */
export function mockPicker(handle) {
  global.showDirectoryPicker = async () => handle
}
```

- [ ] **Step 1.2: Commit**

```bash
git add tests/helpers/mock-filesystem.mjs
git commit -m "test: add in-memory File System Access API mock"
```

---

## Task 2: LocalStore skeleton — constructor, `init()`, static members, `getCapabilities()`

**Files:**
- Create: `lib/local-store.js`
- Create: `tests/local-store.test.mjs`

- [ ] **Step 2.1: Create `tests/local-store.test.mjs` with skeleton tests**

```js
import { test, expect } from 'vitest'
import { LocalStore } from '../lib/local-store.js'
import { createMockFilesystem, mockPicker } from './helpers/mock-filesystem.mjs'

// ── init() & constructor ──────────────────────────────────────────────────

test('init() with _rootHandle bypass returns a LocalStore instance', async () => {
  const root = createMockFilesystem('my-hunts')
  const store = await LocalStore.init({}, { _rootHandle: root })
  expect(store).toBeInstanceOf(LocalStore)
})

test('userId returns the root folder name', async () => {
  const root = createMockFilesystem('my-hunts')
  const store = await LocalStore.init({}, { _rootHandle: root })
  expect(store.userId).toBe('my-hunts')
})

// ── getCapabilities() ─────────────────────────────────────────────────────

test('getCapabilities() returns expected shape', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const caps = store.getCapabilities()
  expect(caps.read).toBe(true)
  expect(caps.write).toBe(true)
  expect(caps.append).toBe(true)
  expect(caps.readAll).toBe(true)
  expect(caps.createSpace).toBe(true)
  expect(caps.deleteSpace).toBe(true)
  expect(caps.delete).toBe(true)
  expect(caps.findOrCreateSpace).toBe(true)
  expect(caps.join).toBe(true)
  expect(caps.addCollaborator).toBe(true)
  expect(caps.closeSubmissions).toBe(false)
  expect(caps.archiveSpace).toBe(false)
})

// ── static members ────────────────────────────────────────────────────────

test('_storageKey is "local"', () => {
  expect(LocalStore._storageKey).toBe('local')
})

// Note: getOnboardingUrl() and getOnboardingHint() call navigator.platform which
// is not available in the Vitest Node environment. They are browser-only and
// verified manually. Do not add unit tests for them here.
```

- [ ] **Step 2.2: Run tests — verify they fail**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 4 tests fail (module not found or similar).

- [ ] **Step 2.3: Create `lib/local-store.js` skeleton**

```js
// lib/local-store.js
import { BaseStore } from './base-store.js'

export class LocalStore extends BaseStore {
  static _storageKey = 'local'

  constructor(rootHandle) {
    super()
    this._rootHandle = rootHandle
  }

  get userId() { return this._rootHandle.name }

  static getOnboardingUrl() {
    const p = navigator.platform
    if (p.startsWith('Win')) return 'file:///C:/Users/'
    if (p.startsWith('Mac')) return 'file:///Users/'
    return 'file:///home/'
  }

  static getOnboardingHint() {
    const p = navigator.platform
    if (p.startsWith('Win')) return 'Suggested location: AppData\\Local\\AnyTrunk'
    if (p.startsWith('Mac')) return 'Suggested location: Library/Application Support/AnyTrunk'
    return 'Suggested location: ~/.local/share/anytrunk'
  }

  static async init(config = {}, { _rootHandle } = {}) {
    if (_rootHandle) return new LocalStore(_rootHandle)

    const stored = await LocalStore._idbGet()
    if (stored) {
      const perm = await stored.queryPermission({ mode: 'readwrite' })
      if (perm === 'granted') return new LocalStore(stored)
      if (perm === 'prompt') {
        const result = await stored.requestPermission({ mode: 'readwrite' })
        if (result === 'granted') return new LocalStore(stored)
      }
      // denied — fall through to picker
    }

    const handle = await showDirectoryPicker({ mode: 'readwrite' })
    await LocalStore._idbPut(handle)
    return new LocalStore(handle)
  }

  // ── IndexedDB helpers ────────────────────────────────────────────────────

  static _idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('anytrunk-local', 1)
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles')
      req.onsuccess = e => resolve(e.target.result)
      req.onerror = () => reject(req.error)
    })
  }

  static async _idbGet() {
    try {
      const db = await LocalStore._idbOpen()
      return new Promise((resolve, reject) => {
        const tx  = db.transaction('handles', 'readonly')
        const req = tx.objectStore('handles').get('local:rootHandle')
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror   = () => reject(req.error)
      })
    } catch { return null }
  }

  static async _idbPut(handle) {
    const db = await LocalStore._idbOpen()
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('handles', 'readwrite')
      const req = tx.objectStore('handles').put(handle, 'local:rootHandle')
      tx.oncomplete = resolve
      tx.onerror    = () => reject(tx.error)
    })
  }

  // ── Capabilities ─────────────────────────────────────────────────────────

  getCapabilities() {
    return {
      createSpace:       true,
      join:              true,
      append:            true,
      read:              true,
      readAll:           true,
      write:             true,
      addCollaborator:   true,
      closeSubmissions:  false,
      archiveSpace:      false,
      deleteSpace:       true,
      delete:            true,
      findOrCreateSpace: true,
    }
  }

  // ── Stubs (implemented in subsequent tasks) ───────────────────────────────

  async createSpace(name, opts = {})    { throw new Error('not implemented') }
  async findOrCreateSpace(name)         { throw new Error('not implemented') }
  async deleteSpace()                   { throw new Error('not implemented') }
  async read(path)                      { throw new Error('not implemented') }
  async write(path, data)               { throw new Error('not implemented') }
  async readAll()                       { throw new Error('not implemented') }
  async append(data, opts = {})         { throw new Error('not implemented') }
  async delete(path)                    { throw new Error('not implemented') }
  async join(spaceId, opts)             { throw new Error('not implemented') }
  async addCollaborator(identity, opts) { throw new Error('not implemented') }
}
```

- [ ] **Step 2.4: Run tests — verify they pass**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add lib/local-store.js tests/local-store.test.mjs
git commit -m "feat: add LocalStore skeleton with init, getCapabilities"
```

---

## Task 3: Space operations — `createSpace()`, `findOrCreateSpace()`, `deleteSpace()`

**Files:**
- Modify: `lib/local-store.js`
- Modify: `tests/local-store.test.mjs`

- [ ] **Step 3.1: Append failing tests to `tests/local-store.test.mjs`**

```js
// ── createSpace() ─────────────────────────────────────────────────────────

test('createSpace creates a subdirectory and writes _event.json', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.createSpace('my-hunt')
  expect(id).toBe('my-hunt')
  // directory was created
  const dir = await root.getDirectoryHandle('my-hunt')
  expect(dir.kind).toBe('directory')
  // _event.json was written
  const fileHandle = await dir.getFileHandle('_event.json')
  const file = await fileHandle.getFile()
  const data = JSON.parse(await file.text())
  expect(data.createdAt).toBeDefined()
})

test('createSpace sets _spaceId', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('my-hunt')
  expect(store._spaceId).toBe('my-hunt')
})

// ── findOrCreateSpace() ───────────────────────────────────────────────────

test('findOrCreateSpace returns existing directory name and sets _spaceId', async () => {
  const root = createMockFilesystem()
  // pre-create directory
  await root.getDirectoryHandle('existing-hunt', { create: true })
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.findOrCreateSpace('existing-hunt')
  expect(id).toBe('existing-hunt')
  expect(store._spaceId).toBe('existing-hunt')
})

test('findOrCreateSpace creates directory when not found', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.findOrCreateSpace('new-hunt')
  expect(id).toBe('new-hunt')
  expect(store._spaceId).toBe('new-hunt')
  const dir = await root.getDirectoryHandle('new-hunt')
  expect(dir.kind).toBe('directory')
})

// ── deleteSpace() ─────────────────────────────────────────────────────────

test('deleteSpace removes the space directory and clears _spaceId', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('doomed')
  await store.deleteSpace()
  expect(store._spaceId).toBeNull()
  await expect(root.getDirectoryHandle('doomed', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
})
```

- [ ] **Step 3.2: Run tests — verify they fail**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 5 new tests fail with "not implemented".

- [ ] **Step 3.3: Replace the three stubs in `lib/local-store.js`**

Replace:
```js
async createSpace(name, opts = {})    { throw new Error('not implemented') }
async findOrCreateSpace(name)         { throw new Error('not implemented') }
async deleteSpace()                   { throw new Error('not implemented') }
```

With:
```js
async createSpace(name, opts = {}) {
  await this._rootHandle.getDirectoryHandle(name, { create: true })
  // setSpace must come before write() since write() reads this._spaceId
  this.setSpace(name)
  await this.write('_event.json', { createdAt: new Date().toISOString() })
  return name
}

async findOrCreateSpace(name) {
  try {
    await this._rootHandle.getDirectoryHandle(name, { create: false })
    this.setSpace(name)
    return name
  } catch (e) {
    if (e.name === 'NotFoundError') return this.createSpace(name)
    throw e
  }
}

async deleteSpace() {
  const dir = await this._rootHandle.getDirectoryHandle(this._spaceId)
  await dir.remove({ recursive: true })
  this.setSpace(null)
}
```

Note: `createSpace` calls `this.write()`, which is still a stub at this point. It will be implemented in Task 4. For the tests to pass, `write()` must be implemented first — see Step 3.4.

- [ ] **Step 3.4: Also implement `write()` now (needed by `createSpace`)**

Replace:
```js
async write(path, data)               { throw new Error('not implemented') }
```

With:
```js
async write(path, data) {
  const parts    = path.split('/')
  const filename = parts[parts.length - 1]
  const spaceDir = await this._rootHandle.getDirectoryHandle(this._spaceId, { create: true })
  let dirHandle  = spaceDir
  if (parts.length > 1) {
    // Paths are at most one directory deep (e.g. 'locations/foo.json') — per spec.
    dirHandle = await spaceDir.getDirectoryHandle(parts[0], { create: true })
  }
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
  const writable   = await fileHandle.createWritable()
  await writable.write(JSON.stringify(data, null, 2))
  await writable.close()
}
```

- [ ] **Step 3.5: Run tests — verify they pass**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add lib/local-store.js tests/local-store.test.mjs
git commit -m "feat: implement LocalStore space operations and write()"
```

---

## Task 4: File operations — `read()`, `delete()`, `readAll()`, `append()`

**Files:**
- Modify: `lib/local-store.js`
- Modify: `tests/local-store.test.mjs`

- [ ] **Step 4.1: Append failing tests to `tests/local-store.test.mjs`**

```js
// ── read() ────────────────────────────────────────────────────────────────

test('read returns parsed JSON for top-level file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('meta.json', { title: 'Amsterdam' })
  const result = await store.read('meta.json')
  expect(result).toEqual({ title: 'Amsterdam' })
})

test('read returns parsed JSON for nested file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('locations/anne-frank.json', { name: 'Anne Frank House' })
  const result = await store.read('locations/anne-frank.json')
  expect(result).toEqual({ name: 'Anne Frank House' })
})

test('read returns null for missing file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  const result = await store.read('nope.json')
  expect(result).toBeNull()
})

test('read returns null for missing nested file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  const result = await store.read('locations/nope.json')
  expect(result).toBeNull()
})

// ── delete() ─────────────────────────────────────────────────────────────

test('delete removes a top-level file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('gone.json', { x: 1 })
  await store.delete('gone.json')
  expect(await store.read('gone.json')).toBeNull()
})

test('delete removes a nested file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('locations/gone.json', { x: 1 })
  await store.delete('locations/gone.json')
  expect(await store.read('locations/gone.json')).toBeNull()
})

test('delete returns silently for missing file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await expect(store.delete('nope.json')).resolves.toBeUndefined()
})

// ── readAll() ─────────────────────────────────────────────────────────────

test('readAll returns all top-level non-underscore JSON files', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('alice.json', { name: 'Alice' })
  await store.write('bob.json',   { name: 'Bob' })
  const results = await store.readAll()
  expect(results).toHaveLength(2)
  expect(results).toEqual(expect.arrayContaining([{ name: 'Alice' }, { name: 'Bob' }]))
})

test('readAll skips underscore-prefixed files', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('alice.json',   { name: 'Alice' })
  await store.write('_event.json',  { internal: true })
  await store.write('_hunt.json',   { internal: true })
  const results = await store.readAll()
  expect(results).toHaveLength(1)
  expect(results[0]).toEqual({ name: 'Alice' })
})

test('readAll skips subdirectories', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('top.json',              { level: 'top' })
  await store.write('locations/nested.json', { level: 'nested' })
  const results = await store.readAll()
  expect(results).toHaveLength(1)
  expect(results[0]).toEqual({ level: 'top' })
})

// ── append() ─────────────────────────────────────────────────────────────

test('append writes to entries/ subdirectory with iso timestamp filename', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.append({ msg: 'hello' })
  const results = await store.readAll()
  // readAll skips subdirs, so we verify via read with a known prefix
  // Instead, verify the entries dir exists and has one file
  const spaceDir   = await root.getDirectoryHandle('hunt')
  const entriesDir = await spaceDir.getDirectoryHandle('entries')
  expect(entriesDir.kind).toBe('directory')
})

test('append respects opts.prefix', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.append({ msg: 'hello' }, { prefix: 'submissions' })
  const spaceDir      = await root.getDirectoryHandle('hunt')
  const submissionsDir = await spaceDir.getDirectoryHandle('submissions')
  expect(submissionsDir.kind).toBe('directory')
})
```

- [ ] **Step 4.2: Run tests — verify they fail**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 13 new tests fail with "not implemented".

- [ ] **Step 4.3: Implement `read()`, `delete()`, `readAll()`, `append()` in `lib/local-store.js`**

Add a private navigation helper first (add before the stubs section):

```js
// Navigate to { dirHandle, filename } for a given path within the current space.
// Throws NotFoundError if intermediate directories don't exist.
async _navigate(path) {
  const parts    = path.split('/')
  const filename = parts[parts.length - 1]
  const spaceDir = await this._rootHandle.getDirectoryHandle(this._spaceId)
  if (parts.length === 1) return { dirHandle: spaceDir, filename }
  const subDir = await spaceDir.getDirectoryHandle(parts[0])
  return { dirHandle: subDir, filename }
}
```

Then replace the four remaining stubs:

```js
async read(path) {
  try {
    const { dirHandle, filename } = await this._navigate(path)
    const fileHandle = await dirHandle.getFileHandle(filename)
    const file       = await fileHandle.getFile()
    return JSON.parse(await file.text())
  } catch (e) {
    if (e.name === 'NotFoundError') return null
    throw e
  }
}

async readAll() {
  const spaceDir = await this._rootHandle.getDirectoryHandle(this._spaceId)
  const results  = []
  for await (const entry of spaceDir.values()) {
    if (entry.name.startsWith('_'))    continue
    if (entry.kind === 'directory')    continue
    const fileHandle = await spaceDir.getFileHandle(entry.name)
    const file       = await fileHandle.getFile()
    results.push(JSON.parse(await file.text()))
  }
  return results
}

async append(data, opts = {}) {
  const prefix = opts.prefix ?? 'entries'
  await this.write(`${prefix}/${new Date().toISOString()}.json`, data)
}

async delete(path) {
  try {
    const { dirHandle, filename } = await this._navigate(path)
    const fileHandle = await dirHandle.getFileHandle(filename)
    await fileHandle.remove()
  } catch (e) {
    if (e.name === 'NotFoundError') return
    throw e
  }
}
```

- [ ] **Step 4.4: Run tests — verify they pass**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add lib/local-store.js tests/local-store.test.mjs
git commit -m "feat: implement LocalStore file operations (read, write, readAll, append, delete)"
```

---

## Task 5: Collaboration — `join()`, `addCollaborator()`

**Files:**
- Modify: `lib/local-store.js`
- Modify: `tests/local-store.test.mjs`

- [ ] **Step 5.1: Append failing tests to `tests/local-store.test.mjs`**

```js
// ── join() ────────────────────────────────────────────────────────────────

test('join sets _spaceId to the given spaceId', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.join('hunt-abc123')
  expect(store._spaceId).toBe('hunt-abc123')
})

test('join resolves without error', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await expect(store.join('any-space')).resolves.toBeUndefined()
})

// ── addCollaborator() ─────────────────────────────────────────────────────

test('addCollaborator resolves without error (no-op)', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await expect(store.addCollaborator('someone@example.com')).resolves.toBeUndefined()
})
```

- [ ] **Step 5.2: Run tests — verify they fail**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

Expected: 3 new tests fail with "not implemented".

- [ ] **Step 5.3: Replace the two stubs in `lib/local-store.js`**

```js
async join(spaceId, opts) {
  this.setSpace(spaceId)
}

async addCollaborator() {
  // no-op — local files have no access control to configure
}
```

- [ ] **Step 5.4: Run tests — verify they pass**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run tests/local-store.test.mjs --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5.5: Run the full test suite to check for regressions**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add lib/local-store.js tests/local-store.test.mjs
git commit -m "feat: implement LocalStore join and addCollaborator"
```

---

## Task 6: Hunt app integration

**Files:**
- Modify: `apps/hunt/hunt.js`

- [ ] **Step 6.1: Add `LocalStore` import and SERVICES entry to `apps/hunt/hunt.js`**

Read `apps/hunt/hunt.js` first. Add the import after the existing two store imports:

```js
import { LocalStore } from '../../lib/local-store.js'
```

Then add a third entry to the `SERVICES` array:

```js
{
  id:    'local',
  label: 'Local Files',
  icon:  '📂',
  hint:  'Saves to a folder on your computer. For testing purposes only.',
  Store: LocalStore,
  config: {},
},
```

- [ ] **Step 6.2: Run the full test suite to verify nothing broke**

```bash
cd c:/Users/lassc/Code/js/any-trunk && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6.3: Commit**

```bash
git add apps/hunt/hunt.js
git commit -m "feat: add LocalStore to hunt app SERVICES"
```
