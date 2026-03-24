# Scavenger Hunt App — Design Spec

**Date:** 2026-03-24
**Scope:** Organizer-side scavenger hunt app demonstrating multi-service selection, JSON Schema-driven forms, and full CRUD on structured data files. Participant flow (starting the hunt, tracking progress, scoring) is out of scope.

---

## Background

Previous specs established `BaseStore` as an abstract base (2026-03-24), `GoogleDriveStore` as a second backend (2026-03-23), and a unified `init()` contract across all stores. The potluck and gifts apps demonstrated append-only participant flows backed by GitHub and Google Drive respectively.

This spec introduces three new capabilities:

1. **Multi-service selection UI** — the app developer configures which services are available; the app presents a picker to the organizer when more than one is configured.
2. **Structured CRUD via JSON Schema** — the developer declares two schemas (hunt metadata, location) in config; the app renders JSON Forms for both.
3. **`delete(path)`** on `BaseStore` — required to remove individual location files from the backing.

---

## Goals

1. Build `apps/hunt/` — a scavenger hunt organizer app backed by any AnyTrunk-compatible store.
2. Add `delete(path)` to `BaseStore`, `GitHubStore`, `WorkerGitHubStore`, and `GoogleDriveStore`.
3. Demonstrate developer-configured JSON Schema driving a fully functional form UI (JSON Forms vanilla).
4. Give the organizer a smooth 4-screen flow: service select → space list → hunt editor → location form.
5. Use Tailwind CSS (CDN, no build step) for a credible visual result.

---

## Non-goals

- Participant flow: joining a hunt, submitting check-ins, tracking progress, scoring.
- Starting, ending, archiving, or deleting a hunt from the participant perspective.
- Inviting participants (out of scope for this spec).
- Binary file uploads (images, audio) — `binaryData` capability remains declared but unused here.
- A provider registry or `AnyTrunk.init()` routing for `WorkerGitHubStore` (still imported directly).

---

## File Changes

### New files

| File | Role |
|---|---|
| `apps/hunt/index.html` | Single entry point. Loads Tailwind CDN, JSON Forms CDN, imports `hunt.js`. |
| `apps/hunt/hunt.js` | SPA logic: config, view router, all 4 views. |
| `apps/hunt/hunt.css` | Minimal overrides on top of Tailwind (component tokens, collapsible animation). |

### Updated files

| File | Change |
|---|---|
| `lib/base-store.js` | Add `async delete(path)` as a required override stub. |
| `lib/github-store.js` | Implement `delete(path)`: fetch SHA then `DELETE /repos/{owner}/{repo}/contents/{path}`. |
| `lib/github-store-worker.js` | No override needed — inherits `delete(path)` from `GitHubStore`. The user's token is stored in `sessionStorage` and used directly for all GitHub API calls (same as `read()` and `write()`). The Worker is only needed for OAuth token exchange. |
| `lib/google-drive-store.js` | Implement `delete(path)`: resolve file ID then `DELETE /drive/v3/files/{fileId}`. |

---

## Configuration

The developer configures the app near the top of `hunt.js`:

```js
// ── CONFIG ───────────────────────────────────────────────────────────────────
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
    config: { clientId: '<CLIENT_ID>' },
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

If `SERVICES` contains only one entry, service selection is skipped entirely and the app initialises that store directly.

---

## Service Selection Persistence

The chosen service ID is stored in `localStorage` under `hunt:serviceId`. On startup, if a stored ID matches a configured service, the app skips the service-select screen and initialises that store immediately. The organizer can always return to service-select via a "Switch service" link in the space-list header.

---

## Data Model

Each hunt is a space (GitHub repo or Drive folder) with the following structure:

```
my-hunt/
  _hunt.json          ← hunt metadata (matches SCHEMA.hunt)
  _locations.json     ← ordered index: ["anne-frank", "homomonument", ...]
  locations/
    anne-frank.json   ← location data (matches SCHEMA.location)
    homomonument.json
    waterlooplein.json
```

**`_hunt.json`** is written by `createSpace` (from the hunt name) and updated when the organizer saves hunt details. It is read on every visit to the hunt editor.

**`_locations.json`** is the source of truth for the ordered list of locations. The app manages it on every add and delete. It contains an array of slugified location IDs (e.g. `"anne-frank"`), derived from the location name at creation time.

**`locations/{id}.json`** contains the full location data matching `SCHEMA.location`. Written on create/edit; deleted (via `store.delete()`) on remove.

**Slug derivation:** `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`. Collisions are resolved by appending `-2`, `-3`, etc., checked against the existing index.

---

## Screen Flow

```
app starts
↓ stored serviceId found AND matches a configured service?
├── yes → skip service-select, call StoreClass.init()
└── no  → [service-select] → user picks → call StoreClass.init()

StoreClass.init() returns null → redirecting to OAuth (nothing to render)
StoreClass.init() returns store → [space-list]

[space-list]
├── click hunt name → store.setSpace(id) → [hunt-editor]
├── click "New hunt" → prompt for name → store.createSpace(name) → [hunt-editor]
└── click delete → confirm → store.deleteSpace() → refresh list

[hunt-editor]
├── "Hunt details" section (collapsed by default, expands to JSON Forms form for SCHEMA.hunt)
├── locations list (read from _locations.json + individual files)
├── click "edit" on a location → [location-form] with existing data
├── click "Add location" → [location-form] with empty form
└── click "delete" on a location → confirm → store.delete() + update _locations.json

[location-form]
├── JSON Forms rendered from SCHEMA.location
├── "Save location" → store.write() + update _locations.json → back to hunt-editor
└── "Cancel" → back to hunt-editor
```

---

## Views

### ① service-select

Rendered only when `SERVICES.length > 1` and no valid stored service ID.

- Shows one card per configured service (icon, label, hint).
- Selected card gets a highlight border.
- "Continue with [service]" button calls `StoreClass.init({ ...config })` (no `mode` — omitting it triggers the organizer/redirect path in `init()`).
- On `init()` returning `null` (redirecting to OAuth): do nothing — the redirect will happen.
- On `init()` returning a store instance: save `serviceId` to `localStorage`, navigate to `space-list`.

### ② space-list

- Header: service icon + "Connected to [service] as **userId**" · "Switch service" link (clears `hunt:serviceId`, navigates to `service-select`).
- Lists entries from `store.getRecentSpaces()`. Each row: hunt name (clickable) + "delete" link.
- Delete: confirm dialog → `store.deleteSpace()` → remove from recent spaces display.
- "New hunt" button: inline name input appears → on submit, `store.createSpace(name)` → `store.write('_hunt.json', { name })` → navigate to `hunt-editor`. Note: `createSpace` always writes `_event.json` to the space (existing store behaviour). `_hunt.json` is a second, app-level write on top of that. Both files will coexist in the space; `_event.json` is harmless and ignored by the hunt app.

### ③ hunt-editor

- Breadcrumb: "← Your hunts · **[hunt name]**"
- **Hunt details** section: collapsed by default, shows summary (name · country · flag). Click "Edit ▾" to expand. Expanded state renders JSON Forms from `SCHEMA.hunt` pre-filled with `_hunt.json` data. "Save details" calls `store.write('_hunt.json', data)`. "Cancel" collapses.
- **Locations list**: reads `_locations.json` for the ordered ID list (treats a `null` result as `[]` — `_locations.json` may be absent on a brand-new hunt). Reads `store.read('locations/{id}.json')` for each entry. Displays position number, name, points, badge. "edit" → location-form (passes the original slug alongside the data). "delete" → confirm → `store.delete('locations/{id}.json')` + update `_locations.json`.
- **"+ Add location"** button navigates to location-form with an empty form and no slug (new).
- Polls every 30 seconds: re-reads `_locations.json` and all location files. A "Refresh" button triggers this immediately. The poll interval (`clearInterval`) must be cancelled when the view navigates away — failure to do so would fire stale callbacks while the user is on the location-form.

### ④ location-form

- Breadcrumb: "← [hunt name] · **[Edit: Location name | New location]**"
- Renders JSON Forms from `SCHEMA.location`, pre-filled with existing data (edit) or empty (new).
- **Save (new location)**: derive slug from `name` (see slug derivation in Data Model) → `store.write('locations/{slug}.json', data)` → append slug to `_locations.json` → navigate back to hunt-editor.
- **Save (existing location)**: use the original slug passed in from hunt-editor (do NOT re-derive from the current name — renaming a location does not rename its file, per L2) → `store.write('locations/{original-slug}.json', data)` → `_locations.json` is unchanged → navigate back to hunt-editor.
- **Cancel**: navigate back to hunt-editor without saving.

---

## JSON Forms Integration

`hunt.js` is a module (`<script type="module">`) and imports JSON Forms directly via `esm.sh`:

```js
import { createAjv }         from 'https://esm.sh/@jsonforms/core'
import { vanillaRenderers, createVanillaRenderers }
                              from 'https://esm.sh/@jsonforms/vanilla-renderers'
```

`esm.sh` produces ES module output with named exports — this works correctly when imported from a `type="module"` script. A plain `<script src>` tag would load the file but expose nothing on `window`; module imports are required.

A thin `renderForm(container, schema, data, onChange)` wrapper initialises JSON Forms with the vanilla renderer set and wires up the change callback. The caller owns the data object and passes it to `store.write()` on save.

The `uischema` (layout) is omitted — JSON Forms derives a default vertical layout from the schema. This is sufficient for MVP; a custom `uischema` can be added per-app later.

---

## `delete(path)` — New BaseStore Method

### BaseStore stub

```js
async delete(path) { throw new Error('not implemented') }
```

### GitHubStore implementation

```js
async delete(path) {
  // 1. GET /repos/{owner}/{repo}/contents/{prefix}/{path} to obtain the file SHA
  // 2. DELETE /repos/{owner}/{repo}/contents/{prefix}/{path}
  //    body: { message: `delete ${path}`, sha }
}
```

The `prefix` is `this._spaceId` (the repo's default prefix path, same as used by `read` and `write`).

### WorkerGitHubStore implementation

Proxied through the Cloudflare Worker using the same pattern as `write`. The worker forwards the DELETE request to GitHub using the stored PAT.

### GoogleDriveStore implementation

```js
async delete(path) {
  // 1. Resolve file ID via path-to-ID resolution (same as read())
  // 2. DELETE /drive/v3/files/{fileId}
  //    If the API returns 404, treat the file as already deleted and return silently.
  //    (Consistent with GitHubStore L1 handling.)
  // Note: GoogleDriveStore._api() throws on any non-OK status. For the DELETE call,
  //       use fetch() directly (or catch the thrown error and check for 404) rather
  //       than routing through _api() — same pattern as deleteSpace() in GitHubStore.
  // Note: do NOT clear _subfolderIdCache — the parent subfolder still exists after
  //       a file inside it is deleted. Cache-clearing is only relevant if a subfolder
  //       itself is deleted, which is not a use case here.
}
```

---

## Change Awareness

The hunt-editor polls on a 30-second interval:

1. Re-read `_locations.json`.
2. Re-read all location files listed in the index.
3. Re-render the locations list with the fresh data.

This picks up adds, deletes, and content edits made directly in the backing (GitHub commits, Drive file edits) without needing change tracking. A "Refresh" button triggers the same cycle immediately. The poll interval is cleared (`clearInterval`) when navigating away from hunt-editor.

---

## Known Limitations

| # | Issue |
|---|---|
| L1 | `delete()` on `GitHubStore` makes two API calls (GET for SHA + DELETE). If another client deletes the same file between these two calls, the DELETE will return 404. This is acceptable at MVP — the app should handle the 404 gracefully and treat it as already deleted. |
| L2 | Location ID slugs are derived from the name at creation time. Renaming a location does not rename its file — the old slug persists. To rename the file, the user must delete and recreate the location. |
| L3 | `_locations.json` is the app's index and is not intrinsically ordered in the backing. If two organizer sessions write `_locations.json` concurrently, the later write wins (last-write-wins). Concurrent editing is not supported at MVP. |
| L4 | JSON Forms vanilla renderer styles may conflict with Tailwind's reset. A small `hunt.css` scoped override (`#jsonforms-root`) is expected. |
| L5 | No Worker changes are needed for `delete()`. `WorkerGitHubStore` only proxies OAuth token exchange through the Worker; all content API calls (`read`, `write`, `delete`, etc.) go directly to `api.github.com` using the user's token stored in `sessionStorage`. |
| L6 | Service selection stores the service ID in `localStorage` but not the auth token (tokens are in `sessionStorage` per existing behaviour). Closing and reopening the browser tab will re-run OAuth but skip service-select. |
