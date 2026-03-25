# Scavenger Hunt App — Design Spec

**Date:** 2026-03-24
**Scope:** Organizer-side scavenger hunt app demonstrating multi-service selection, JSON Schema-driven forms, and full CRUD on structured data files. Built as the AnyTrunk reference app and developer template. Participant flow is out of scope for this iteration.

---

## Background

Previous specs established `BaseStore` as an abstract base (2026-03-24), `GoogleDriveStore` as a second backend (2026-03-23), and a unified `init()` contract across all stores. The potluck and gifts apps demonstrated append-only participant flows backed by GitHub and Google Drive respectively.

This spec introduces four new capabilities:

1. **Multi-service selection UI** — the app developer configures which services are available; the app presents a picker to the organizer when more than one is configured.
2. **Structured CRUD via JSON Schema** — the developer declares two schemas (hunt metadata, location) in config; the app renders JSON Forms for both.
3. **`delete(path)`** on `BaseStore` — required to remove individual location files from the backing.
4. **`findOrCreateSpace(name)`** on `BaseStore` — opens a well-known space by name if it exists, creates it if not, and returns the native space ID. Used to manage the registry space without requiring a try/catch in app code.

---

## Goals

1. Build `apps/hunt/` as the AnyTrunk **reference app and developer template**: industry-standard dependencies (Tailwind, JSON Forms), clearly separated concerns (one file per view, dedicated utility modules), minimal homebrew code.
2. Add `delete(path)` and `findOrCreateSpace(name)` to `BaseStore`, `GitHubStore`, and `GoogleDriveStore`.
3. Demonstrate developer-configured JSON Schema driving a fully functional form UI (JSON Forms vanilla renderers, no build step).
4. Give the organizer a smooth 4-screen flow: service select → hunt list → hunt editor → location form.
5. Solve cross-device discovery via a fixed-name registry space (`anytrunk-hunt`).

---

## Non-goals

- Participant flow: joining a hunt, submitting check-ins, tracking progress, scoring.
- Starting, ending, archiving, or deleting a hunt from the participant perspective.
- Inviting participants.
- Binary file uploads (images, audio).
- A provider registry or `AnyTrunk.init()` routing layer for `WorkerGitHubStore` (still imported directly by the app).

---

## File Changes

### New files

| File | Role |
|---|---|
| `apps/hunt/index.html` | Entry point. Loads Tailwind CDN, JSON Forms CSS CDN. Imports `hunt.js` as a module. |
| `apps/hunt/hunt.js` | Bootstrap: config constants (`SERVICES`, `SCHEMA`), app startup, view router. |
| `apps/hunt/hunt.css` | Scoped overrides for JSON Forms vanilla renderer (Tailwind reset compatibility). |
| `apps/hunt/views/service-select.js` | View: choose a service. |
| `apps/hunt/views/space-list.js` | View: list, open, create, and delete hunts. |
| `apps/hunt/views/hunt-editor.js` | View: edit hunt details and manage locations. |
| `apps/hunt/views/location-form.js` | View: create/edit a single location via JSON Forms. |
| `apps/hunt/lib/forms.js` | Thin wrapper: `renderForm(container, schema, data, onChange)` using JSON Forms vanilla. |
| `apps/hunt/lib/slug.js` | Pure utility: `toSlug(name)` and `uniqueSlug(name, existing[])`. |
| `apps/hunt/lib/poller.js` | Utility: `createPoller(fn, intervalMs)` — returns `{ start, stop }`. |

### Updated files

| File | Change |
|---|---|
| `lib/base-store.js` | Add `async delete(path)` and `async findOrCreateSpace(name)` as required override stubs. |
| `lib/github-store.js` | Implement `delete(path)` and `findOrCreateSpace(name)`. |
| `lib/github-store-worker.js` | Inherits `delete(path)` from `GitHubStore` (no override needed — all content API calls go directly to `api.github.com` using the user's `sessionStorage` token). Implement `findOrCreateSpace(name)` identically to `GitHubStore`. |
| `lib/google-drive-store.js` | Implement `delete(path)` and `findOrCreateSpace(name)`. |

---

## Configuration

All developer-supplied configuration lives at the top of `hunt.js`, clearly delimited. View modules receive only what they need via `state` and `navigate` — they do not import config directly.

```js
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
```

If `SERVICES` has only one entry, service selection is skipped and that store is initialised directly.

---

## Service Selection Persistence

The chosen service ID is stored in `localStorage` under `hunt:serviceId`. On startup, if a stored value matches a configured service, the app skips service-select and initialises that store immediately. The organizer can always return to service-select via a "Switch service" link in the hunt-list header.

---

## Space Layout and Hunt Discovery

### The problem

`getRecentSpaces()` is localStorage-only. On a new device or after clearing storage, the organizer's hunts are invisible.

### Solution: fixed-name registry space

The app maintains one well-known space per service account: **`anytrunk-hunt`** (a GitHub repo or Drive folder with that exact name). On every startup, after authentication, the app calls:

```js
const registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')
```

`findOrCreateSpace` returns the **native space ID** — for GitHub this is the full repo name (e.g. `alice/anytrunk-hunt`); for Drive this is the folder's Drive ID. The app holds this value in a local variable and uses it whenever switching back to the registry.

This space contains a single file:

```
anytrunk-hunt/
  _registry.json    ← [{ spaceId, name, createdAt }]
```

`spaceId` in each registry entry is likewise the native space ID returned by `createSpace` — not the input name. For GitHub: the full repo name (`alice/hunt-lnzzr4`). For Drive: the Drive folder ID.

### Hunt spaces

Each hunt is its own space (repo or Drive folder). The **input name** passed to `createSpace` is derived from a base-36 timestamp:

```js
const inputName = 'hunt-' + Date.now().toString(36)   // e.g. "hunt-lnzzr4"
const spaceId   = await store.createSpace(inputName)   // returns native ID
```

The display name (organizer-chosen) is stored in `_registry.json` and in `_hunt.json` within the space — never derived from the space ID.

```
hunt-lnzzr4/            ← GitHub repo name or Drive folder name
  _hunt.json            ← hunt metadata (matches SCHEMA.hunt)
  _locations.json       ← ordered index of location slugs: ["anne-frank", "homomonument"]
  locations/
    anne-frank.json     ← location data (matches SCHEMA.location)
    homomonument.json
```

### Creating a hunt

1. Organizer enters a display name (e.g. "Amsterdam Freedom Hunt").
2. App generates `inputName = 'hunt-' + Date.now().toString(36)`.
3. `const huntSpaceId = await store.createSpace(inputName)` — creates the repo/folder; captures the returned native ID. Note: `createSpace` always writes `_event.json` to the new space as a side effect (existing store behaviour). This file is harmless — the hunt app never reads it, and `readAll()` skips `_`-prefixed files per the library invariant.
4. `await store.write('_hunt.json', { name: displayName })`.
5. Switch back to registry: `await store.setSpace(registrySpaceId)`.
6. Read, update, and write registry: `const reg = await store.read('_registry.json') ?? []; reg.push({ spaceId: huntSpaceId, name: displayName, createdAt: new Date().toISOString() }); await store.write('_registry.json', reg)`.
7. Switch to hunt space: `await store.setSpace(huntSpaceId)` → navigate to hunt-editor.

### Deleting a hunt

1. Confirm dialog.
2. `await store.setSpace(huntSpaceId)` → `await store.deleteSpace()`.
3. Switch back to registry: `await store.findOrCreateSpace('anytrunk-hunt')` (not `setSpace` — Drive needs name-to-ID resolution after a space switch).
4. Read, filter, and write registry: remove the entry with matching `spaceId`, write back.
5. Re-render hunt list.

### Location slugs

`toSlug(name)`: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`.

`uniqueSlug(name, existing[])`: appends `-2`, `-3`, etc. if the slug already exists in the `_locations.json` array.

---

## Screen Flow

```
app starts
↓ stored serviceId matches a configured service?
├── yes → init that store, skip service-select
└── no  → [service-select] → user picks → init store

store.init() returns null → OAuth redirect in progress, nothing to render
store.init() returns store instance
  → registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')
  ├── throws → show error message + retry button
  └── ok → read _registry.json (treat null as []) → [space-list]

[space-list]
├── click hunt → store.setSpace(huntSpaceId) → [hunt-editor]
├── "New hunt" → name input → createSpace + update registry → [hunt-editor]
└── delete hunt → confirm → deleteSpace + findOrCreateSpace(registry) + update registry → refresh

[hunt-editor]
├── "Hunt details" (collapsed) → expand → JSON Forms (SCHEMA.hunt) → save → store.write('_hunt.json')
├── locations list → read _locations.json + each locations/{slug}.json
├── click "edit" → [location-form] with existing data + original slug
├── "Add location" → [location-form] empty
└── "delete" location → confirm → store.delete('locations/{slug}.json') + update _locations.json

[location-form]
├── JSON Forms (SCHEMA.location)
├── save (new) → uniqueSlug → store.write + read/push/write _locations.json → [hunt-editor]
├── save (edit) → store.write(original slug) → _locations.json unchanged → [hunt-editor]
└── cancel → [hunt-editor]
```

---

## Views

Each view is a JS module exporting a single function:

```js
export function render(container, state, navigate) { ... }
```

`state` contains `{ store, schema, registrySpaceId, huntSpaceId?, huntName?, locationSlugs?, locationSlug?, locationData? }` — only the fields relevant to that view. `registrySpaceId` is always present and forwarded in every `navigate` call (the router merges state, so views only need to pass overrides). `navigate(viewName, stateOverrides)` is the router's transition function, defined in `hunt.js`.

### ① service-select (`views/service-select.js`)

- Rendered only when `SERVICES.length > 1` and no valid stored service ID.
- One card per configured service. Selected card highlighted.
- "Continue" button calls `StoreClass.init({ ...config })`.
- `init()` returns `null` → OAuth redirect, do nothing.
- `init()` returns store → save `hunt:serviceId` to localStorage → `registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')` → on error, show error + retry; on success, `navigate('space-list', { store, registrySpaceId })`.

### ② space-list (`views/space-list.js`)

- Header: service icon · "Connected as **userId**" · "Switch service" link (clears `hunt:serviceId`, `navigate('service-select')`).
- Entry: `await store.setSpace(registrySpaceId)` → `const registry = await store.read('_registry.json') ?? []`.
- Each row: hunt display name (clickable) + "delete" link.
- **Open hunt**: `await store.setSpace(entry.spaceId)` → `navigate('hunt-editor', { huntSpaceId: entry.spaceId, huntName: entry.name })`.
- **New hunt**: inline name input → generate `inputName` → `huntSpaceId = await store.createSpace(inputName)` → `store.write('_hunt.json', { name })` → `store.setSpace(registrySpaceId)` → read/push/write `_registry.json` → `store.setSpace(huntSpaceId)` → `navigate('hunt-editor', { huntSpaceId, huntName })`.
- **Delete**: confirm → `store.setSpace(entry.spaceId)` → `store.deleteSpace()` → `store.findOrCreateSpace('anytrunk-hunt')` → read/filter/write `_registry.json` → re-render.

### ③ hunt-editor (`views/hunt-editor.js`)

- Entry: `await store.setSpace(huntSpaceId)`.
- Breadcrumb: "← Your hunts · **[huntName]**".
- **Hunt details** (collapsed by default): shows summary (name · country · flag). Expands to `renderForm` using `schema.hunt` and `_hunt.json` data. "Save details" → `store.write('_hunt.json', data)`. "Cancel" collapses.
- **Locations list**: `const currentSlugs = await store.read('_locations.json') ?? []` → `store.read('locations/{slug}.json')` for each → render rows (position, name, points, badge). "edit" → `navigate('location-form', { slug, data, locationSlugs: currentSlugs })`. "delete" → confirm → `store.delete('locations/{slug}.json')` + read/filter/write `_locations.json`.
- **"+ Add location"**: `navigate('location-form', { locationSlugs: currentSlugs })` — passes the currently-loaded slug list so location-form can check for collisions without a redundant read.
- **Polling**: `createPoller` at 20s; calls `stop()` on navigate. "Refresh" button triggers immediately.

### ④ location-form (`views/location-form.js`)

- Breadcrumb: "← [huntName] · **Edit: [name] | New location**".
- `renderForm(container, schema.location, data, onChange)`.
- **Save (new)**: `slug = uniqueSlug(data.name, state.locationSlugs)` → `store.write('locations/' + slug + '.json', data)` → read `_locations.json` (fresh read to minimise L3 conflicts), push slug, write back → navigate back.
- **Save (edit)**: `store.write('locations/' + originalSlug + '.json', data)` → `_locations.json` unchanged → navigate back. Do NOT re-derive the slug from the current name (see L2).
- **Cancel**: navigate back without writing.

---

## Utility Modules

### `lib/forms.js`

Imports `@jsonforms/core` and `@jsonforms/vanilla-renderers` from `esm.sh` (ES module named exports, requires `<script type="module">`). Exports:

```js
export function renderForm(container, schema, data, onChange)
// Initialises JSON Forms with vanillaRenderers.
// onChange(updatedData) is called on every field change.
// Returns a dispose() function to clean up the instance.
```

No `uischema` passed — JSON Forms derives a default vertical layout. Custom `uischema` can be added per-field later without changing the wrapper.

### `lib/slug.js`

```js
export function toSlug(name)                        // "Anne Frank House" → "anne-frank-house"
export function uniqueSlug(name, existing[])        // appends -2, -3, etc. on collision
```

Pure functions, no side effects.

### `lib/poller.js`

```js
export function createPoller(fn, intervalMs)
// Returns { start(), stop() }.
// start() calls fn() immediately, then on each interval.
// stop() clears the interval.
// Errors thrown by fn() are caught silently — the poller continues on the next interval.
```

---

## New BaseStore Methods

### `delete(path)`

```js
// BaseStore stub
async delete(path) { throw new Error('not implemented') }
```

**GitHubStore:**
```js
async delete(path) {
  // 1. GET /repos/{owner}/{repo}/contents/{spaceId}/{path} to obtain the file SHA.
  //    If 404, return silently (already deleted).
  // 2. DELETE /repos/{owner}/{repo}/contents/{spaceId}/{path}
  //    body: { message: `delete ${path}`, sha }
  //    Use _apiCall(). If resp.ok, return.
  //    If resp.status === 404, return silently.
  //    Otherwise throw.
}
```

**GoogleDriveStore:**
```js
async delete(path) {
  // 1. Resolve file ID:
  //    Note: _findFile returns { id, name } or null — use .id for all subsequent calls.
  //    - Split path by '/'. If multi-component (e.g. 'locations/anne-frank.json'),
  //      resolve subfolder first: const sub = await _findFile(parts[0], this._spaceId)
  //      If not found (null), return silently. Use sub.id as parentId below.
  //    - const f = await _findFile(filename, parentId)
  //      If not found (null), return silently. Use f.id in the DELETE URL.
  // 2. DELETE /drive/v3/files/{fileId} using fetch() directly (not _api()).
  //    If 204, return.
  //    If 404, return silently.
  //    Otherwise throw.
  // Note: do NOT clear _subfolderIdCache — the parent folder still exists.
}
```

### `findOrCreateSpace(name)`

```js
// BaseStore stub
async findOrCreateSpace(name) { throw new Error('not implemented') }
// Returns the native space ID (string). Also sets the store's active space.
```

**GitHubStore:**
```js
async findOrCreateSpace(name) {
  // 1. GET /repos/{owner}/{name}.
  //    If 200: setSpace(data.full_name); return data.full_name.
  //    If 404: spaceId = await createSpace(name); return spaceId.
  //    Otherwise throw.
}
```

**GoogleDriveStore:**
```js
async findOrCreateSpace(name) {
  // 1. const file = await _findFile(name, 'root')
  //    ('root' is the Drive API alias for the user's root folder.)
  //    If file: setSpace(file.id); return file.id.
  //    If null: spaceId = await createSpace(name); return spaceId.
}
```

Note: `'root'` is the Drive API's well-known alias for the user's root folder.

---

## Change Awareness

Hunt-editor polls on a 20-second interval via `createPoller`:

1. Re-read `_locations.json`.
2. Re-read all location files listed in the index.
3. Re-render the locations list with the fresh data.

Picks up adds, deletes, and in-place edits made directly in the backing (GitHub commits, Drive file edits). "Refresh" button triggers the same cycle immediately. Poller is stopped on every view transition.

---

## Known Limitations

| # | Issue |
|---|---|
| L1 | `delete()` on `GitHubStore` makes two API calls (GET for SHA, then DELETE). A 404 on either is treated as already-deleted and handled silently. |
| L2 | Location slugs are derived from the name at creation time. Renaming a location in the form does not rename its file. To rename the file, the user must delete and recreate the location. |
| L3 | `_locations.json` and `_registry.json` are written with last-write-wins semantics. Concurrent organizer sessions on the same hunt or registry are not supported at MVP. |
| L4 | JSON Forms vanilla renderer styles may conflict with Tailwind's preflight reset. `hunt.css` provides scoped overrides under a wrapper element (e.g. `.jf-form`). |
| L5 | `WorkerGitHubStore` inherits `delete()` from `GitHubStore` with no changes — all content API calls use the user's `sessionStorage` token directly. The Worker is only involved in OAuth token exchange. |
| L6 | Service selection persists the service ID in `localStorage` but not the auth token (`sessionStorage`). Reopening the browser will re-run OAuth but skip service-select. |
| L7 | The `anytrunk-hunt` registry space name is fixed. If a user runs two different AnyTrunk apps using this convention, they would share the same registry. Future apps should use app-specific names (e.g. `anytrunk-gifts`). |
