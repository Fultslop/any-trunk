# AnyTrunk

Turn any file-based storage into a zero-backend shared datastore for small-group collaborative apps.

No server. No database. The storage provider is the persistence layer; the browser is the runtime.

---

## How it works

AnyTrunk provides a uniform API over file-based storage backends. Each backend turns a container (a GitHub repo, a Google Drive folder, a GitLab project) into a shared document store. Multiple users write to the same container using their own credentials; any user can read the full state.

The current implementation uses **GitHub** as the storage backend via the GitHub REST API and OAuth.

---

## Quick start

```html
<script type="module">
  import { GitHubStore } from './lib/github-store.js'

  const store = await GitHubStore.init({
    clientId:     'YOUR_OAUTH_APP_CLIENT_ID',
    clientSecret: 'YOUR_OAUTH_APP_CLIENT_SECRET',
    corsProxy:    'http://localhost:8080',   // see CORS proxy section
  })

  // organizer: create a shared space
  const repoFullName = await store.createSpace('my-event-2026')

  // write a document
  await store.write('config.json', { theme: 'dark' })

  // append a timestamped entry (append-only log model)
  await store.append({ dish: 'tiramisu' }, { prefix: store.userId })

  // read everything back
  const participants = await store.readAll()
  // → [{ username, entries: [{ path, data }], latest }]
</script>
```

---

## Demo app

`apps/potluck/` is a reference implementation — a potluck organiser where an organiser collects dish submissions from participants. It demonstrates the full lifecycle: OAuth, space creation, participant self-registration via invite link, append-only submissions, and live polling.

See [docs/e2e-test.md](docs/e2e-test.md) for a step-by-step manual test guide.

---

## API — GitHubStore

### Construction and auth

```js
// Single entry point — handles the full OAuth lifecycle automatically.
// If ?code= is in the URL: exchanges it for a token, then restores the original URL.
// If a token is in sessionStorage: rehydrates and returns immediately.
// Otherwise: redirects to GitHub OAuth.
const store = await GitHubStore.init({
  clientId,       // GitHub OAuth App client ID
  clientSecret,   // GitHub OAuth App client secret  ⚠ see Known Limitations
  corsProxy,      // URL of CORS proxy (required — see below)
  repoFullName,   // optional: '{owner}/{repo}' to pre-select a space
})

store.isAuthenticated  // boolean
store.userId           // authenticated user's GitHub login
```

Lower-level auth methods (used internally by `init`):

```js
GitHubStore.beginAuth(clientId, clientSecret, corsProxy)  // redirects to GitHub
await GitHubStore.completeAuth()                          // exchanges ?code= for token
```

### Space management (organizer)

```js
// Creates a private GitHub repo and writes _event.json to it.
// Returns '{owner}/{repo}'.
const repoFullName = await store.createSpace('event-name', { private: true })

// Adds a GitHub user as a collaborator (push access).
await store.addCollaborator('username')
```

### Self-registration (participant)

```js
// Uses inviteToken (organizer's Fine-Grained PAT) to add the current user as a
// collaborator, then auto-accepts the invitation using the participant's own token.
// Idempotent: if the user is already a collaborator, the accept step is skipped.
await store.join(repoFullName, inviteToken)
```

### Data operations

```js
// Write (create or overwrite) a document at a fixed path.
await store.write('config.json', { key: 'value' })

// Append a timestamped document. Writes to {prefix}/{iso-timestamp}.json.
// Lexicographic order of filenames = chronological order.
await store.append({ dish: 'lasagna' }, { prefix: store.userId })

// Read a single document. Returns null if not found.
const data = await store.read('config.json')

// List all files under a path prefix. Returns [{ path, sha }], sorted.
const files = await store.list('alice')

// Read all participant data. Skips '_'-prefixed paths (library metadata).
// Returns an array sorted by username.
const all = await store.readAll()
// → [{ username, entries: [{ path, data }], latest }]
```

### Local persistence

```js
// Save a space to localStorage for one-click resume.
GitHubStore.saveRecentSpace(spaceId)

// Returns up to 5 most-recently-used spaces (call on a store instance).
store.getRecentSpaces()
// → ['{owner}/{repo}', ...]
```

---

## Data model

Each space is a container (GitHub repo) with this layout:

```
{owner}/{repo}/
  _event.json              # library metadata — skipped by readAll()
  {username}/
    {iso-timestamp}.json   # one file per entry (colons replaced with hyphens)
```

Any top-level directory whose name does **not** start with `_` is treated as a participant namespace. Library-reserved paths use the `_` prefix (`_event.json`, etc.).

`readAll()` returns:

```js
[
  {
    username: 'alice',
    entries: [
      { path: 'alice/2026-03-21T14-30-00.000Z.json', data: { dish: 'lasagna' } },
      { path: 'alice/2026-03-21T15-05-00.000Z.json', data: { dish: 'tiramisu' } },
    ],
    latest: { dish: 'tiramisu' }   // entries[entries.length - 1].data
  }
]
```

---

## CORS proxy

GitHub's OAuth token endpoint blocks direct browser requests. A CORS proxy is required.

**Local development:**

```bash
npm run proxy   # starts cors-anywhere on http://localhost:8080
```

Set `corsProxy: 'http://localhost:8080'` in your `GitHubStore.init()` config.

**Production:** Deploy a Cloudflare Worker that proxies only the token exchange endpoint. See Known Limitations D2.

---

## Running the tests

```bash
npm test
```

Node.js 18 or later required (native fetch).

---

## Known limitations

These are intentional MVP trade-offs, not bugs. See [docs/superpowers/specs/2026-03-21-potluck-design.md](docs/superpowers/specs/2026-03-21-potluck-design.md) for the full deferred-items table.

| # | Issue | Fix |
|---|---|---|
| D1 | `clientSecret` exposed in client-side code | Replace with GitHub Device Flow or a Cloudflare Worker |
| D2 | Token exchange proxied via a public CORS proxy | Replace with your own Cloudflare Worker |
| D3 | Invite token created manually by the organiser | Extend the Worker to handle collaborator addition |
| D4 | Invite token embedded in the participant URL | Revoke the token after the signup window closes |

D1 + D2 + D3 collapse into a single small Cloudflare Worker — the recommended post-MVP path.

---

## Roadmap

- [ ] GitLab backend
- [x] Google Drive backend
- [x] Provider interface (`BaseStore` abstract class)
- [ ] Cloudflare Worker for token exchange (fixes D1–D3)

---

## Project structure

```
anytrunk/
  lib/
    github-store.js        # GitHubStore — vanilla ES module, no build step
  apps/
    potluck/
      index.html           # Reference demo app
  tests/
    github-store.test.mjs  # Unit tests (Node.js, no framework)
    helpers/
      mock-browser.mjs
      mock-fetch.mjs
  docs/
    e2e-test.md            # Manual end-to-end test guide
    superpowers/specs/     # Design documents
```

---

## License

MIT