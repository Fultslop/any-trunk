# LocalStore Design Spec

**Date:** 2026-03-24
**Goal:** Add a `LocalStore` backed by the browser's File System Access API as a third storage option in AnyTrunk, primarily for testing and local development without OAuth credentials.

---

## Overview

`LocalStore` extends `BaseStore` and stores all data as real JSON files on the user's filesystem. The user picks a root directory once; all spaces (hunts) are subdirectories within it. The root directory handle is persisted in IndexedDB so the user only picks once across browser sessions.

---

## File Map

### New Files

| File | Role |
|---|---|
| `lib/local-store.js` | `LocalStore` class extending `BaseStore` |
| `tests/helpers/mock-filesystem.mjs` | In-memory mock of the File System Access API |
| `tests/local-store.test.mjs` | Unit tests |

### Modified Files

| File | Change |
|---|---|
| `apps/hunt/hunt.js` | Add `LocalStore` as third entry in `SERVICES` |

---

## Architecture

### Space Model

Each space is a subdirectory of the user-chosen root folder. `_spaceId` holds the subdirectory name (e.g. `'anytrunk-hunt'`, `'hunt-1lk4j'`). The store holds the root `FileSystemDirectoryHandle` as `this._rootHandle` and derives space directory handles on demand via `this._rootHandle.getDirectoryHandle(this._spaceId)`.

### File Paths

Paths within a space map directly to the filesystem:
- `_hunt.json` → `<root>/<spaceId>/_hunt.json`
- `locations/foo.json` → `<root>/<spaceId>/locations/foo.json`

Nested paths are one level deep (folder + filename). The store creates the parent subdirectory if it does not exist on write.

### Root Handle Persistence

The root `FileSystemDirectoryHandle` is stored in IndexedDB under the key `'local:rootHandle'`. On `init()`:
1. Open IndexedDB, retrieve the stored handle
2. If found: call `queryPermission({mode: 'readwrite'})`
   - `'granted'` → use the stored handle
   - `'prompt'` → call `requestPermission()` (requires user gesture)
   - `'denied'` → fall through to picker
3. If no handle stored, or permission denied: call `showDirectoryPicker({mode: 'readwrite'})`, persist the new handle to IndexedDB
4. Return `new LocalStore(rootHandle)`

The "Continue with Local Files →" button click in `service-select.js` counts as the required user gesture.

### `userId`

Returns the root folder's name (e.g. `'my-hunts'`), surfaced from `rootHandle.name`.

### `static _storageKey`

`'local'` — used by `BaseStore.getRecentSpaces()` / `saveRecentSpace()` to namespace localStorage keys.

### `static getOnboardingUrl()`

Returns a platform-appropriate `file://` URL pointing to the recommended app-data parent directory. The user is dropped into the `Users/` or `home/` directory (username is not accessible from a static browser context) and navigates from there to create the `AnyTrunk` subfolder.

```js
static getOnboardingUrl() {
  const p = navigator.platform
  if (p.startsWith('Win')) return 'file:///C:/Users/'
  if (p.startsWith('Mac')) return 'file:///Users/'
  return 'file:///home/'
}
```

### `static getOnboardingHint()`

Returns a platform-appropriate path suggestion:

```js
static getOnboardingHint() {
  const p = navigator.platform
  if (p.startsWith('Win')) return 'Suggested location: AppData\\Local\\AnyTrunk'
  if (p.startsWith('Mac')) return 'Suggested location: Library/Application Support/AnyTrunk'
  return 'Suggested location: ~/.local/share/anytrunk'
}
```

---

## Method Specifications

### `static async init(config, { _rootHandle } = {})`

Standard `init()` entrypoint. The `_rootHandle` bypass param skips IndexedDB and picker in tests (same pattern as `GitHubStore`'s `token` param bypassing OAuth).

If `showDirectoryPicker()` is cancelled by the user, the browser throws an `AbortError`. `init()` lets this propagate — `service-select.js` catches it in its `try/catch` and displays the error message, which is the correct behaviour (the user deliberately cancelled).

### `async createSpace(name, opts = {})`

1. `rootHandle.getDirectoryHandle(name, {create: true})`
2. Write `_event.json` with `{ createdAt: new Date().toISOString() }`
3. `setSpace(name)`
4. Return `name`

### `async findOrCreateSpace(name)`

1. Try `rootHandle.getDirectoryHandle(name, {create: false})`
2. On `NotFoundError`: delegate to `createSpace(name)` and return result
3. On success: `setSpace(name)`, return `name`

### `async deleteSpace()`

1. Get space dir handle: `rootHandle.getDirectoryHandle(this._spaceId)`
2. Call `spaceDir.remove({recursive: true})`
3. Call `setSpace(null)` to clear `_spaceId`

Note: `FileSystemHandle.remove()` requires Chrome 110+. Acceptable for a dev/testing store.

### `async read(path)`

1. Navigate to file: if path contains `/`, get the parent subdir handle first, then the file handle
2. Return `null` on any `NotFoundError`
3. Read file text, return `JSON.parse(text)`

### `async write(path, data)`

1. If path contains `/`, create parent subdir via `getDirectoryHandle(folder, {create: true})`
2. Get/create file handle via `getFileHandle(filename, {create: true})`
3. Open writable, write `JSON.stringify(data, null, 2)`, close

### `async readAll()`

1. Iterate the space directory with `values()` — each yielded entry is `{ name, kind }`
2. Skip entries whose name starts with `_` (library metadata — per CLAUDE.md invariant)
3. Skip entries where `kind === 'directory'` (only reads top-level files — see L4)
4. For each remaining entry, re-fetch the file handle via `getFileHandle(entry.name)` to call `.getFile()` (do not use the yielded entry directly — see mock note below)
5. Read text, JSON.parse each file
6. Return array of parsed values

### `async append(data, opts = {})`

Delegates to `this.write(\`${opts.prefix ?? 'entries'}/${new Date().toISOString()}.json\`, data)`. Parent subdirectory is created by `write()` if it does not exist.

### `async delete(path)`

Navigate to file (handling nested path), call `.remove()`. Return silently on `NotFoundError`.

### `async join(spaceId, opts)`

Calls `setSpace(spaceId)` and returns. Local files have no access control — any tab with the same root folder can read/write any space by name, so "joining" is simply navigating to the space. This enables two-tab organizer+participant testing against the same root folder.

### `async addCollaborator(identity, opts)`

No-op — returns immediately. Local files have no access control to configure; the collaborator implicitly has access by virtue of sharing the same filesystem.

### `getCapabilities()`

```js
{
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
```

---

## Mock: `tests/helpers/mock-filesystem.mjs`

Exports `createMockFilesystem()` which returns a `FileSystemDirectoryHandle`-like object backed by a nested `Map`. Structure:

```
node = { kind: 'directory', children: Map<name, node> }
     | { kind: 'file', content: string }
```

### Mock API surface

| Method | Behaviour |
|---|---|
| `getDirectoryHandle(name, {create})` | Returns child dir node; throws `DOMException` `'NotFoundError'` if absent and `create: false` |
| `getFileHandle(name, {create})` | Returns file node; throws `DOMException` `'NotFoundError'` if absent and `create: false` |
| `getFile()` | Returns `{ text: async () => node.content }` |
| `createWritable()` | Returns `{ write(str) { node.content = str }, close() {} }` |
| `values()` | Async generator yielding plain `{ name, kind }` objects (not real `FileSystemHandle` instances — `readAll()` re-fetches handles via `getFileHandle()` rather than using the yielded object directly) |
| `remove({recursive})` | Deletes node from parent; throws if non-empty dir and `recursive` not set |
| `name` | The node's own name (set on construction) |
| `queryPermission()` | Returns `'granted'` |
| `requestPermission()` | Returns `'granted'` |

Also exports `mockPicker(handle)` which sets `global.showDirectoryPicker = () => Promise.resolve(handle)`.

IndexedDB is bypassed in tests via the `_rootHandle` constructor param on `init()`.

---

## Hunt App Integration

Add to `SERVICES` in `apps/hunt/hunt.js`:

```js
import { LocalStore } from '../../lib/local-store.js'

// in SERVICES array:
{
  id:    'local',
  label: 'Local Files',
  icon:  '📂',
  hint:  'Saves to a folder on your computer. For testing purposes only.',
  Store: LocalStore,
  config: {},
},
```

No other app changes are required. `LocalStore` implements the full `BaseStore` interface consumed by the existing views.

---

## Known Limitations (intentional)

| # | Limitation |
|---|---|
| L1 | `deleteSpace()` requires Chrome 110+ (`FileSystemHandle.remove()`) |
| L2 | No multi-tab write safety — concurrent writes from two tabs will race |
| L3 | `readAll()` only reads top-level `.json` files; does not recurse into subdirs |
| L4 | `addCollaborator` is a no-op — access control is not enforced on local files |
