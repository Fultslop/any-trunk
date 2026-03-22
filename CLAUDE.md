# AnyTrunk

Zero-backend shared datastore library. GitHub is the persistence layer; the browser is the runtime. No server, no database, no build step.

## Commands

```bash
npm test        # unit tests (Node.js 18+, no framework)
npm run proxy   # CORS proxy on http://localhost:8080 (required for OAuth token exchange)
```

## Architecture

- `lib/github-store.js` — vanilla ES module class, no dependencies, no bundler
- `apps/potluck/index.html` — demo app, imports lib via relative path
- Tests use Node.js native fetch; mocks in `tests/helpers/`

**Key invariants — do not change without updating the design spec:**
- `_` prefix is reserved for library metadata (`_event.json`, etc.) — `readAll()` skips these
- `append()` always writes `{prefix}/{iso-timestamp}.json`; lexicographic = chronological
- Polling (`setInterval`) is the **app's** responsibility — `readAll()` is a plain async call
- `join()` uses two tokens: invite PAT (organizer's) for `PUT /collaborators`, own token for auto-accept
- `PUT /collaborators` returns empty body when already a collaborator — do NOT use HTTP status to discriminate (GitHub returns 204 in both cases)

## Known limitations (intentional MVP trade-offs, not bugs)

| # | Issue |
|---|---|
| D1 | `clientSecret` exposed in client-side code |
| D2 | Token exchange via public CORS proxy |
| D3 | Invite token created manually by organizer |
| D4 | Invite PAT embedded in participant URL |

D1+D2+D3 collapse into a single Cloudflare Worker — the recommended post-MVP path. Do not attempt to fix these piecemeal.

## File map

| File | Role |
|---|---|
| `lib/github-store.js` | GitHubStore class — all GitHub API + auth |
| `apps/potluck/index.html` | Demo app (organizer + participant modes via `?mode=`) |
| `tests/github-store.test.mjs` | Unit tests |
| `tests/helpers/mock-browser.mjs` | sessionStorage/localStorage/location mocks |
| `tests/helpers/mock-fetch.mjs` | Configurable GitHub API fetch mock |
| `docs/superpowers/specs/2026-03-21-potluck-design.md` | Full design spec |
