# Multi-Backend Abstraction + Google Drive Adapter — Design Spec

**Date:** 2026-03-23
**Scope:** Spec 1 of 3 (Capability abstraction + Google Drive adapter). Scavenger hunt app and two-backend demo are separate specs to follow.

---

## Background

AnyTrunk currently supports a single backing system: GitHub. The library's core model (append-only entries, shared spaces, organizer/participant roles) is not GitHub-specific — it maps onto any system that supports read, write, and collaborative access. This spec defines the abstraction layer that formalises the provider contract and adds Google Drive as a second backend.

---

## Goals

1. Define a canonical capability contract that any AnyTrunk provider must satisfy.
2. Add `GoogleDriveStore` as a parallel implementation alongside `GitHubStore`.
3. Introduce `AnyTrunk.init(config)` as the unified, backend-agnostic entry point for apps.
4. Enable runtime capability detection and startup guards.
5. Update `GitHubStore.beginAuth` to use a config-object signature for consistency.

---

## Non-goals

- Plugin/registry system for dynamically registering backends (noted as future work — see Known Limitations).
- Scavenger hunt demo app (Spec 2).
- Two-backend side-by-side demo (Spec 3).
- `writeBinary(path, blob)` method surface — `binaryData` capability is declared in this spec but the method is defined in Spec 2 where it is first needed.

---

## Capability Tiers

Every AnyTrunk provider declares its capabilities via `store.capabilities()`. Apps use this to guard features or reject incompatible backends at startup.

### Required — backend is rejected without these

| Operation | Description |
|---|---|
| `createSpace(name, options?)` | Create a new shared space |
| `join(spaceId, options?)` | Participant joins an existing space |
| `append(data, { prefix })` | Write a new timestamped entry |
| `read(path)` | Read a single file by path |
| `readAll()` | Read all participant submissions |

### Recommended — app degrades gracefully without these

| Operation | Description |
|---|---|
| `write(path, data)` | Overwrite a specific file (e.g. metadata) |
| `addCollaborator(identity)` | Add a participant by identity (email or username) |
| `closeSubmissions()` | Mark the event as closed |

### Optional — backend earns a gold star

| Operation | Description |
|---|---|
| `archiveSpace()` | Make space read-only / archived |
| `deleteSpace()` | Permanently remove the space |

### Capability flags (no corresponding method in this spec)

| Flag | Description |
|---|---|
| `binaryData` | Backend can store binary data in entries. Method surface defined in Spec 2. |

### Static UI utilities (not part of `capabilities()`, but expected on all stores)

Each store class should implement these static helpers for app UI code:

| Method | Description |
|---|---|
| `hasToken()` | Returns true if a valid token exists in sessionStorage — without making an API call |
| `onboardingUrl()` | Returns the provider's account signup URL (for "don't have an account?" links) |
| `onboardingHint()` | Returns a short human-readable string describing what account is needed |
| `saveRecentSpace(spaceId)` | Persists a recently-used space ID to localStorage |
| `getRecentSpaces()` | Returns the list of recently-used space IDs from localStorage |

**Rename in `GitHubStore`:** The existing `saveRecentRepo(repoFullName)` and `getRecentRepos()` must be renamed to `saveRecentSpace` / `getRecentSpaces` for consistency. This is a breaking change — add to the Updated Files table and update all call sites in the apps.

**localStorage keys:** `GitHubStore.saveRecentSpace` uses `gh:recentSpaces`. `GoogleDriveStore.saveRecentSpace` uses `gd:recentSpaces`. The previous `potluck:recentRepos` key is abandoned; existing stored values are not migrated (acceptable for MVP).

---

## File Changes

### New files

| File | Role |
|---|---|
| `lib/anytrunk.js` | Primary entry point. `AnyTrunk.init(config)` routes on `config.provider`. Re-exports `assertCapabilities`. |
| `lib/capabilities.js` | Canonical capability names + `assertCapabilities(store, required[])` utility. |
| `lib/google-drive-store.js` | `GoogleDriveStore` class — parallel to `GitHubStore`, same operation surface. |
| `tests/google-drive-store.test.mjs` | Unit tests for `GoogleDriveStore` (mock fetch, same pattern as GitHub tests). |

### Updated files

| File | Change |
|---|---|
| `lib/github-store.js` | Update `beginAuth` to config-object signature. Update internal `init()` call to `beginAuth`. Add `capabilities()`. Rename `saveRecentRepo` → `saveRecentSpace`, `getRecentRepos` → `getRecentSpaces`. |
| `lib/github-store-worker.js` | Add `capabilities()`. Not routable via `AnyTrunk.init()` yet — see Known Limitations. |
| `tests/github-store.test.mjs` | Update call sites for new `beginAuth` signature and renamed utility methods. Add `capabilities()` tests. |
| `apps/potluck/index.html` | Update to `AnyTrunk.init(config)`, new `beginAuth` signature, and renamed utility methods. |
| `apps/gifts/index.html` | Update to `AnyTrunk.init(config)`, new `beginAuth` signature, and renamed utility methods. |
| `README.md` (if it exists) | Update `beginAuth` usage examples to config-object signature and renamed utility methods. |

---

## createSpace() Options Are Backend-Specific

`createSpace(name, options?)` options are not abstracted by `AnyTrunk` — they pass through to the backend unchanged:

- `GitHubStore.createSpace(name, { private: true })` — controls repo visibility
- `GoogleDriveStore.createSpace(name, { accessMode: 'email' | 'link' })` — controls collaboration mode

Apps that pass `{ private: true }` to a Drive-backed store will have the unknown key silently ignored (Drive always uses `accessMode`, defaulting to `'email'`). Apps intending to be backend-agnostic should document which options they pass and what the fallback behaviour is on each backend.

---

## AnyTrunk Entry Point

`lib/anytrunk.js` is the recommended import for apps that want to be backend-agnostic. Individual store classes remain importable directly for advanced use cases (e.g. `WorkerGitHubStore`).

```js
import { GitHubStore } from './github-store.js'
import { GoogleDriveStore } from './google-drive-store.js'
import { assertCapabilities } from './capabilities.js'

export { assertCapabilities }

export const AnyTrunk = {
  async init(config) {
    switch (config.provider) {
      case 'github':       return GitHubStore.init(config)
      case 'google-drive': return GoogleDriveStore.init(config)
      default: throw new Error(`Unknown provider: "${config.provider}"`)
    }
  }
}
```

App usage:

```js
import { AnyTrunk, assertCapabilities } from '../lib/anytrunk.js'

// GitHub
const store = await AnyTrunk.init({ provider: 'github', clientId, clientSecret, corsProxy })

// Google Drive
const store = await AnyTrunk.init({ provider: 'google-drive', clientId })

// Startup guard
assertCapabilities(store, ['createSpace', 'join', 'append', 'readAll'])

// Graceful degradation
const caps = store.capabilities()
if (caps.addCollaborator) showInviteButton()
if (caps.archiveSpace)   showArchiveButton()
```

---

## Capabilities Contract

`lib/capabilities.js` defines the canonical capability names and the `assertCapabilities` utility.

```js
export const CAPS = {
  createSpace: 'Create a new shared space',
  join: 'Participant joins a space',
  append: 'Write a new timestamped entry',
  read: 'Read a single file',
  readAll: 'Read all participant submissions',
  write: 'Overwrite a specific file',
  addCollaborator: 'Add a participant by identity',
  closeSubmissions: 'Mark event as closed',
  archiveSpace: 'Make space read-only',
  deleteSpace: 'Permanently remove the space',
  binaryData: 'Backend can store binary data in entries (method surface defined in Spec 2)',
}

export function assertCapabilities(store, required) {
  const caps = store.capabilities()
  const missing = required.filter(cap => !caps[cap])
  if (missing.length > 0) {
    throw new Error(
      `${store.constructor.name} is missing required capabilities: ${missing.join(', ')}`
    )
  }
}
```

---

## GoogleDriveStore

### Auth — PKCE (no client secret, no CORS proxy)

Google Drive uses PKCE. No `clientSecret` is required and Google's token endpoint supports CORS natively, so no proxy is needed.

#### beginAuth / completeAuth

**`completeAuth()` is a low-level public method** (same pattern as `GitHubStore.completeAuth()`). It handles the token exchange only — it does not redirect. The post-auth redirect is always the responsibility of `init()`. Apps should not call `completeAuth()` directly unless they manage the full auth flow themselves.

**`redirect_uri`:** Both `beginAuth` and `completeAuth` use `location.origin + location.pathname` (i.e. the current page without query params) as the `redirect_uri`. This value is computed at call time, not passed in config. It must be registered in the Google Cloud Console as an authorised redirect URI. `beginAuth` stores it in `gd:auth` so `completeAuth` can use the identical value in the token exchange.

```js
GoogleDriveStore.beginAuth({ clientId })
// 1. Generate code_verifier (random 43-128 char string) and code_challenge (SHA-256 of verifier, base64url-encoded)
// 2. Compute redirectUri = location.origin + location.pathname
// 3. Store { clientId, codeVerifier, state, redirectUri } in sessionStorage under key 'gd:auth'
// 4. Store current URL in sessionStorage under key 'gd:returnUrl'
// 5. Redirect to accounts.google.com/o/oauth2/v2/auth with:
//      client_id, redirect_uri, response_type=code, scope=drive.file,
//      state, code_challenge, code_challenge_method=S256, access_type=offline

const store = await GoogleDriveStore.completeAuth()
// 0. Read raw = sessionStorage.getItem('gd:auth')
//    If null → throw Error('Auth session not found — beginAuth was not called or sessionStorage was cleared')
// 1. Read stored = JSON.parse(raw)
// 2. Verify state param in URL matches stored.state (throws on mismatch — CSRF guard)
// 3. POST to oauth2.googleapis.com/token with:
//      client_id=stored.clientId, code, redirect_uri=stored.redirectUri,
//      grant_type=authorization_code, code_verifier=stored.codeVerifier
//    (No proxy needed — Google's token endpoint supports CORS)
// 4. Store access_token in sessionStorage under key 'gd:token'
// 5. Store refresh_token in sessionStorage under key 'gd:refreshToken' (if present)
// 6. GET oauth2.googleapis.com/v2/userinfo → store { email, name } under key 'gd:user'
// 7. Remove 'gd:auth' from sessionStorage (leave 'gd:returnUrl' — consumed by init())
// 8. Return new GoogleDriveStore({ clientId, token: access_token, userEmail: email })
// Note: does NOT read or remove 'gd:returnUrl' — that is init()'s responsibility.
//       The return value is used by callers invoking completeAuth() directly (advanced use).
//       init() Branch 1 discards it — the instance is reconstructed in Branch 2 after
//       the post-auth redirect. Do not optimise it away.
```

#### sessionStorage keys

| Key | Contents |
|---|---|
| `gd:auth` | `{ clientId, state, codeVerifier, redirectUri }` — present only during auth flow |
| `gd:token` | Access token string |
| `gd:refreshToken` | Refresh token string (used to renew expired access tokens) |
| `gd:user` | `{ email, name }` |
| `gd:returnUrl` | URL to restore after auth completes — set by `beginAuth`, consumed and removed by `init()` |
| `gd:folderId` | Current space folder ID — set by `createSpace()` and `join()`, rehydrated by `init()` |

#### init()

`GoogleDriveStore.init(config)` follows the same three-branch logic as `GitHubStore.init()`:

```js
static async init({ clientId }) {
  const params = new URLSearchParams(location.search)
  const code   = params.get('code')

  if (code) {
    // Branch 1: returning from Google auth — complete the flow
    const store = await GoogleDriveStore.completeAuth()
    const returnUrl = sessionStorage.getItem('gd:returnUrl')
    sessionStorage.removeItem('gd:returnUrl')
    // returnUrl is null only if the user navigated directly to the callback URL
    // without going through beginAuth. Stripping ?code= from the current URL is the correct fallback.
    location.href = returnUrl ?? location.href.split('?')[0]
    return null
  }

  const existingToken = sessionStorage.getItem('gd:token')
  if (existingToken) {
    // Branch 2: already authenticated — rehydrate from sessionStorage
    const { email, name } = JSON.parse(sessionStorage.getItem('gd:user') ?? '{}')
    const folderId = sessionStorage.getItem('gd:folderId') ?? null
    return new GoogleDriveStore({ clientId, token: existingToken, userEmail: email, _folderId: folderId })
  }

  // Branch 3: not authenticated — redirect to Google
  GoogleDriveStore.beginAuth({ clientId })
  return null
}
```

### Data Model

Space = Drive folder. Structure mirrors GitHub's repo layout:

```
my-event/                             ← Drive folder (ID = spaceId)
  _event.json                         ← metadata (name, created, owner, accessMode)
  alice@gmail.com/                    ← participant subfolder (named by email)
    2026-03-23T10-00-00.000Z.json
  bob@gmail.com/
    2026-03-23T11-00-00.000Z.json
```

- `_` prefix convention preserved — `readAll()` skips folders starting with `_`.
- Lexicographic order of filenames = chronological order (same invariant as GitHub).
- Participant namespace = Google email address (`this._userEmail` after auth).

#### spaceId

`createSpace(name, options?)` creates a Drive folder and returns its **Drive folder ID** as the `spaceId`. This ID is what the organiser shares with participants (e.g. in a URL param `?space=1Abc...`). Participants pass it to `join(spaceId)`.

Apps receive and pass the spaceId as an opaque string — they do not construct or inspect Drive IDs. The statement "apps never interact with Drive IDs" means apps do not construct queries or paths using IDs; the spaceId is treated the same way as a GitHub `repoFullName` — an opaque handle.

#### join() signature

```js
// Drive: join takes only the folder ID — no invite token needed
await store.join(folderId)
// 1. Set this._folderId = folderId
// 2. Write gd:folderId to sessionStorage
// 3. Fetch _event.json from the folder (to verify access and read accessMode)
// 4. Call GoogleDriveStore.saveRecentSpace(folderId)
// Returns void. Throws if the folder is inaccessible.
```

Unlike `GitHubStore.join(repoFullName, inviteToken)`, no second token is required. In `email` mode the organiser has already granted access via `addCollaborator` before sharing the link. In `link` mode the folder is open to anyone with the ID.

**Precondition for data operations:** `this._folderId` must be set (via `createSpace` or `join`) before calling `append`, `read`, `readAll`, `write`, or any other data operation. `capabilities()` does not guard this — it is the app's responsibility to call `createSpace` or `join` first. Calling a data operation without `_folderId` will throw an internal error.

#### createSpace() and saveRecentSpace

```js
const spaceId = await store.createSpace(name, { accessMode: 'email' })
// 1. POST to drive/v3/files to create a folder named `name`
// 2. Set this._folderId = folder.id; write gd:folderId to sessionStorage
// 3. If accessMode === 'link': set folder sharing to anyone-with-link = editor
// 4. Write _event.json: { name, created, owner: this._userEmail, accessMode }
// 5. Call GoogleDriveStore.saveRecentSpace(folder.id)
// Returns folder.id (the spaceId)
```

#### read(path) — path-to-ID resolution

`read(path)` accepts a slash-separated path string identical in format to `GitHubStore.read()`. Resolution proceeds as follows:

```
read('alice@gmail.com/2026-03-23T10-00-00.000Z.json')
  → split on '/' → ['alice@gmail.com', '2026-03-23T10-00-00.000Z.json']
  → resolve 'alice@gmail.com' subfolder: check this._subfolderIdCache,
    or query: name='alice@gmail.com' and '{this._folderId}' in parents
  → resolve '2026-03-23T10-00-00.000Z.json' file: query name='...' and '{subFolderId}' in parents
  → GET /drive/v3/files/{fileId}?alt=media
  → parse JSON, return

read('_event.json')
  → no slash → treat as file in root folder (this._folderId)
  → query: name='_event.json' and '{this._folderId}' in parents
  → GET content, parse JSON, return
```

#### ID Resolution (internal)

Drive has no path API. Files are addressed by ID. `GoogleDriveStore` maintains an internal ID cache to avoid repeated searches:

- After `createSpace` / `join`, `this._folderId` is set on the instance and stored in `sessionStorage` under `gd:folderId`.
- Subfolder IDs are resolved on first access and cached in `this._subfolderIdCache` (plain object, keyed by subfolder name).
- File IDs are not cached — they are resolved fresh per call via `files.list` query: `name='foo.json' and '{parentId}' in parents and trashed=false`.

#### readAll() algorithm and return shape

```
readAll()
  1. GET /drive/v3/files?q='{this._folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)
     → list of participant subfolders
  2. Filter out folders whose name starts with '_'
  3. For each subfolder in parallel:
     a. GET /drive/v3/files?q='{subfolderId}' in parents and mimeType='application/json' and trashed=false&fields=files(id,name)&orderBy=name
        → list of entry files, sorted by name (lexicographic = chronological)
     b. For each file: GET /drive/v3/files/{fileId}?alt=media → parse JSON
     c. Build: { username: subfolder.name, entries: [{ path, data }], latest }
  4. Sort results by username (same as GitHub)
  5. Return array
```

Return shape — identical to `GitHubStore.readAll()`:

```js
[
  {
    username: 'alice@gmail.com',   // Google email address (Drive equivalent of GitHub login)
    entries:  [{ path: 'alice@gmail.com/2026-03-23T10-00-00.000Z.json', data: { ... } }],
    latest:   { ... },             // data from last entry, or null
  },
  ...
]
```

Apps that render `result.username` will display an email address in Drive mode. This is intentional — the display formatting is the app's responsibility.

### Collaboration Modes

Set at `createSpace` time via `options.accessMode`, stored in `_event.json`.

| Mode | `createSpace` call | `join` behaviour | `addCollaborator` |
|---|---|---|---|
| `email` | `createSpace(name, { accessMode: 'email' })` | Organiser pre-adds participant; `join(folderId)` sets `this._folderId` + fetches `_event.json` | Drive Permissions API: add email as editor |
| `link` | `createSpace(name, { accessMode: 'link' })` | Folder is link-shared (anyone with link = editor); `join(folderId)` sets `this._folderId` + fetches `_event.json` | Not applicable |

Default `accessMode` if omitted: `'email'`.

### append() timestamp format

`GoogleDriveStore.append()` must use the same timestamp normalisation as `GitHubStore.append()`:

```js
const timestamp = new Date().toISOString().replace(/:/g, '-')
// e.g. '2026-03-23T10-00-00.000Z'
```

This preserves the lexicographic = chronological invariant.

### write(path, data)

```
write('_event.json', { closed: true })
  1. Resolve file ID: query name='_event.json' and '{this._folderId}' in parents
  2. If file exists: PATCH /drive/v3/files/{fileId}?uploadType=media
       Content-Type: application/json, body: JSON.stringify(data)
  3. If file not found: POST /drive/v3/files?uploadType=multipart
       metadata: { name, parents: [this._folderId] }, media: JSON.stringify(data)
```

Path parsing follows the same rule as `read()`: a slash-separated path resolves the leading segment as a subfolder, the trailing segment as the filename. If the path contains no slash (e.g. `'_event.json'`), the file is resolved directly in the root folder (`this._folderId`).

### addCollaborator() in link mode

`capabilities()` returns `addCollaborator: true` unconditionally because the capability describes what the backend *can* do in `email` mode. Apps that need to conditionally show an invite UI must check `accessMode` from `_event.json` after `join()`. The table in Collaboration Modes is the reference.

In `link` mode, calling `addCollaborator(email)` **throws** with a clear message:

```
Error: addCollaborator() is not supported in link-access spaces.
Share the space URL directly with participants.
```

Silently ignoring the call would mask a likely app logic error.

### closeSubmissions() vs archiveSpace()

These are distinct operations on Drive (as they are on GitHub):

- `closeSubmissions()` — writes `{ closed: true }` into `_event.json` (identical to GitHub behaviour). Does not change Drive permissions.
- `archiveSpace()` — downgrades all non-owner Drive permissions on the folder to `reader`:
  ```
  1. GET /drive/v3/files/{this._folderId}/permissions?fields=permissions(id,role,type)
  2. For each permission where role != 'owner':
       PATCH /drive/v3/files/{this._folderId}/permissions/{permissionId}  body: { role: 'reader' }
  ```
  The owner's permission cannot be changed and is skipped. Does not modify `_event.json`.

### deleteSpace()

```js
await store.deleteSpace()
// DELETE /drive/v3/files/{this._folderId}
// Permanently deletes the folder and all contents. Not reversible.
// Clears gd:folderId from sessionStorage.
// Clears this._folderId and this._subfolderIdCache on the instance.
```

### capabilities() return value

```js
{
  createSpace: true,
  join: true,
  append: true,
  read: true,
  readAll: true,
  write: true,
  addCollaborator: true,  // see Known Limitations L2
  closeSubmissions: true,
  archiveSpace: true,
  deleteSpace: true,
  binaryData: true,       // Drive supports file content upload (multipart); method surface in Spec 2
}
```

### Static UI utilities

```js
GoogleDriveStore.hasToken()        // !! sessionStorage.getItem('gd:token')
GoogleDriveStore.onboardingUrl()   // 'https://accounts.google.com/signup'
GoogleDriveStore.onboardingHint()  // 'You need a Google account'
GoogleDriveStore.saveRecentSpace(folderId)   // persists to localStorage under 'gd:recentSpaces'
GoogleDriveStore.getRecentSpaces()           // returns array from localStorage
```

---

## GitHubStore Changes

### beginAuth signature update

```js
// Before (positional)
GitHubStore.beginAuth(clientId, clientSecret, corsProxy)

// After (config object)
GitHubStore.beginAuth({ clientId, clientSecret, corsProxy })
```

The internal call inside `GitHubStore.init()` must also be updated. This is a breaking change. All call sites must be updated — see Updated Files above.

### capabilities() added

```js
capabilities() {
  return {
    createSpace: true, join: true, append: true,
    read: true, readAll: true, write: true,
    addCollaborator: true, closeSubmissions: true,
    archiveSpace: true, deleteSpace: true,
    binaryData: true,   // base64 via Contents API; method surface in Spec 2
  }
}
```

### WorkerGitHubStore

`lib/github-store-worker.js` is updated to add `capabilities()` (returns the same shape as `GitHubStore.capabilities()`). It is **not** routable via `AnyTrunk.init()` in this spec — apps that need the Worker backend import `WorkerGitHubStore` directly. Adding `provider: 'github-worker'` routing is deferred to a future spec (see Known Limitations L1).

---

## Auth Limitations — Updated

| Limitation | GitHub (raw) | GitHub + Worker | Google Drive |
|---|---|---|---|
| D1 — clientSecret exposed | ⚠️ Yes | ✅ Solved | ✅ PKCE — no secret needed |
| D2 — CORS proxy required | ⚠️ Yes | ✅ Solved | ✅ Google supports CORS natively |
| D3 — invite token manual setup | ⚠️ Yes | ✅ Solved | ✅ Email or link-share — no token |
| D4 — invite PAT in URL | ⚠️ Yes | ✅ Solved | ✅ No PAT — folder ID in URL only |

Both backends reach the same clean state via different paths. GitHub needs a Cloudflare Worker; Google Drive gets there natively. The Worker path remains the recommended post-MVP path for GitHub.

---

## Testing

`tests/google-drive-store.test.mjs` follows the same pattern as `tests/github-store.test.mjs`:
- Mock `fetch` to simulate Drive API responses (`files.list`, `files.get`, `files.create`, `files.update`, `permissions.create`).
- Test each operation independently.
- Test `capabilities()` return shape.
- Test `assertCapabilities` throws with a clear message for missing capabilities.
- Test PKCE flow: `beginAuth` stores correct sessionStorage keys; `completeAuth` exchanges code without a proxy.

---

## Known Limitations

| # | Issue |
|---|---|
| L1 | `AnyTrunk.init` uses a hardcoded `switch` on `config.provider`. `WorkerGitHubStore` is not routable via `AnyTrunk.init()`. A proper plugin/registry system and `github-worker` routing should be designed when a third backend is introduced. |
| L2 | `addCollaborator: true` in `GoogleDriveStore.capabilities()` is only meaningful in `email` accessMode. In `link` mode the method throws (see addCollaborator() section). Apps must read `_event.json` after `join()` to determine `accessMode` before offering an invite UI. A future refinement could make `capabilities()` dynamic post-join, but this adds complexity not warranted at MVP. |
| L3 | `readAll()` on Drive makes N+2 API calls (1 folder list + N subfolder lists + N×M file reads). Rate limits are generous (12,000 req/min/user) but worth monitoring at scale. |
| L4 | `list()` is a public method on `GitHubStore` but is used only internally. It is not part of the capability contract and `GoogleDriveStore` implements it as a private helper only. Apps should not depend on `list()` directly. |
| L5 | `binaryData: true` is declared in `capabilities()` for both backends but the `writeBinary(path, blob)` method is not defined in this spec. The flag signals intent. The method surface is defined in Spec 2 (scavenger hunt). |
| L6 | _(see L8 — token expiry handling)_ |
| L7 | `GoogleDriveStore.init()` does not accept `folderId` in the config (unlike `GitHubStore.init()` which accepts `repoFullName`). This is intentional: Drive folder IDs are runtime artifacts of `createSpace()`/`join()`, not static config values. Apps that embed a known space in their config should call `init()` then `join(folderId)` in sequence. |
| L8 | Google OAuth access tokens expire after 1 hour. Token refresh via `gd:refreshToken` is not implemented in this spec. The fallback behavior on 401 (detected in each API method's error handling, not in `init()`): clear `gd:token` from sessionStorage and redirect to `beginAuth` (re-auth, not silent failure). This should be replaced with silent refresh (`grant_type=refresh_token` POST to `oauth2.googleapis.com/token`) before production use. |
| L9 | `binaryData: true` for `GitHubStore` stores content as base64 via the Contents API. Base64 inflates size by ~33% and the Contents API has a 100 MB file limit (~75 MB of real binary data). Spec 2 must account for this constraint when designing `writeBinary`. |
