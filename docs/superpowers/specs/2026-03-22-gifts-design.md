# Gifts App — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

The gifts app is the second AnyTrunk demo. Where potluck demonstrates the zero-backend pattern (GitHub as storage, browser as runtime, no server), gifts demonstrates the **hardened pattern** — adding a minimal Worker backend that fixes the potluck POC's known security limitations (D1–D3) without changing the library's data API or the experience for organizers and participants.

The app itself is a simple wishlist/claim registry: an organizer creates a list of desired gifts; participants claim one to avoid duplicates. The app is intentionally simple — it exists to showcase the library usage pattern, not to be a feature-complete product.

The two apps together form a progression:

| | Potluck | Gifts |
|---|---|---|
| Infrastructure | Zero — browser only | Minimal — one deployed Worker |
| Developer effort | Low | Moderate (Worker deploy + config) |
| Organizer effort | High (manual PAT creation) | Low (click, done) |
| Security | POC-grade | Production-grade auth |

---

## Project Structure

```
lib/
  github-store.js              ← unchanged
  github-store-worker.js       ← WorkerGitHubStore extends GitHubStore (new)
apps/
  potluck/index.html           ← unchanged
  gifts/index.html             ← new demo app
workers/
  anytrunk-worker/
    index.js                   ← Cloudflare Worker (reference implementation)
    wrangler.toml              ← Cloudflare config
```

The two import lines capture the tradeoff in full:

```js
// potluck — base class, no Worker required
import { GitHubStore } from '../../lib/github-store.js'
const store = await GitHubStore.init({ clientId, clientSecret, corsProxy })

// gifts — subclass, Worker required
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'
const store = await WorkerGitHubStore.init({ clientId, workerUrl })
```

---

## Deferred Items Resolved

The potluck spec identified four deferred items. This design addresses three:

| # | Item | Resolution |
|---|---|---|
| D1 | `client_secret` in client code | Moved to Worker env var — never in client code |
| D2 | Token exchange via public CORS proxy | Replaced with own Worker endpoint |
| D3 | Organizer must manually create a PAT | Worker handles collaborator addition using stored organizer token |
| D4 | Invite PAT embedded in participant URL | Invite URL now contains an opaque code, not a raw PAT — partially mitigated |

D4 is not fully resolved: the opaque invite code still grants anyone who holds it the ability to self-add as a collaborator to the specific repo. The mitigation is the same as potluck — revoke or expire the code after the signup window. Full resolution requires per-participant invite links, which is out of scope.

---

## Worker HTTP Interface

The Worker is a platform-agnostic HTTP contract. Any server that implements these three endpoints can replace the Cloudflare Worker. The library only knows a `workerUrl`.

```
POST /oauth/token
  body:    { code: string }
  returns: { access_token: string }
  does:    exchanges GitHub OAuth code for token using stored client_secret
           fixes D1 (secret off client) and D2 (own proxy, not cors-anywhere)

POST /spaces/register
  body:    { repo: string, token: string }
  returns: { inviteCode: string }
  does:    stores organizer's OAuth token in KV keyed by repo;
           generates and stores an opaque random invite code mapped to that repo;
           returns the invite code to the app
           called once by organizer after createSpace()

POST /spaces/invite
  body:    { repo: string, username: string, inviteCode: string }
  returns: 200 or 403
  does:    validates invite code against KV;
           calls PUT /repos/{repo}/collaborators/{username}
           using the stored organizer token — token never exposed to client
           fixes D3
```

**Worker secrets (env vars, never in code):**
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

**Worker KV stores:**
- `repo:{repo}:token` → organizer's OAuth token
- `repo:{repo}:inviteCode` → opaque random string

The invite code in the participant URL is a short random string — not a PAT. If it leaks, it can only be used to add oneself as a collaborator to that specific repo during the open signup window. The organizer token never leaves the Worker.

---

## Platform Alternatives

The Cloudflare Worker is the reference implementation. The Worker's HTTP interface is the stable contract — any platform that can run serverless functions and provide secret storage can host an equivalent.

| Platform | Compute | Secret storage | KV/state | Notes |
|---|---|---|---|---|
| **Cloudflare Workers** *(reference)* | Workers | Secrets (env) | Workers KV | Simplest story; `wrangler deploy`; generous free tier |
| **Vercel / Netlify** | Edge/serverless functions | Env vars | Vercel KV / Netlify Blob (add-on cost) | Familiar git-push deploy; KV is weaker than CF |
| **AWS Lambda + API Gateway** | Lambda | Secrets Manager | DynamoDB | Most control; most complexity; IAM overhead |
| **Azure / GCP** | Functions | Key Vault / Secret Manager | Table Storage / Firestore | Enterprise-appropriate; same trade-offs as AWS |
| **Self-hosted Node.js** | Any server | Env vars | Any store | Maximum portability; requires a running server |

**Why not use Cloudflare's data layer for app data?**

The Worker's KV stores only infrastructure state — OAuth tokens and invite codes, not application data. Application data (wishlists, claims) still lives entirely in GitHub repos. The "bring your own storage" model refers to application data; secret management is a separate concern that exists regardless of storage choice. Using Cloudflare D1 or KV for application data would be a different library with a different value proposition — AnyTrunk's premise is GitHub as the storage layer.

Developers already running a backend do not need the Worker at all — they implement the three endpoints in whatever they already have and point `workerUrl` there.

---

## WorkerGitHubStore Subclass

```js
// lib/github-store-worker.js
class WorkerGitHubStore extends GitHubStore {
  constructor({ clientId, workerUrl, token, repoFullName })
  //   clientId:   GitHub OAuth app client ID (still needed for /authorize redirect)
  //   workerUrl:  base URL of the deployed Worker
  //   no clientSecret — lives in Worker env

  // Overrides — same external signatures, different internals
  static beginAuth(clientId, workerUrl)
  //   stores workerUrl in sessionStorage instead of clientSecret

  static async completeAuth()
  //   POSTs { code } to {workerUrl}/oauth/token instead of cors-anywhere
  //   Worker exchanges code for token using stored client_secret; returns access_token

  static async init(config)
  //   same lifecycle as base class; passes workerUrl through

  // New — called by organizer after createSpace()
  async register()
  //   POSTs { repo, token } to {workerUrl}/spaces/register
  //   Worker stores organizer token; returns inviteCode
  //   inviteCode stored on instance for generating the join URL

  // Override — inviteCode replaces raw PAT
  async join(repoFullName, inviteCode)
  //   POSTs { repo, username, inviteCode } to {workerUrl}/spaces/invite
  //   Worker validates code and calls PUT /collaborators using stored organizer token
  //   then auto-accepts invitation (same base class logic)
}
```

---

## What Stays the Same

### Library data API — identical in both apps

| Method | Potluck | Gifts |
|---|---|---|
| `store.createSpace()` | ✓ | ✓ |
| `store.readAll()` | ✓ | ✓ |
| `store.append()` | ✓ | ✓ |
| `store.write()` | ✓ | ✓ |
| `store.read()` | ✓ | ✓ |
| `store.isAuthenticated` / `.username` | ✓ | ✓ |
| `setInterval(() => store.readAll(), 30s)` | ✓ | ✓ |
| `_` prefix reservation | ✓ | ✓ |
| `{username}/{timestamp}.json` pattern | ✓ | ✓ |
| `_event.json` metadata | ✓ | ✓ |
| `sessionStorage` rehydration lifecycle | ✓ | ✓ |

Only `completeAuth()` and `join()` change internally — and their signatures stay the same. The data layer is identical.

> *"AnyTrunk apps are written against the same data API regardless of backend; the Worker only changes how trust is established, not what you do with it once it is."*

### User experience — nearly identical

| | Potluck | Gifts |
|---|---|---|
| Organizer needs GitHub account | ✓ | ✓ |
| Participant needs GitHub account | ✓ | ✓ |
| Participant can sign up via Google (GitHub supports it) | ✓ | ✓ |
| Organizer becomes repo owner | ✓ | ✓ |
| Participants added as repo collaborators | ✓ | ✓ |
| Everyone goes through GitHub OAuth | ✓ | ✓ |
| Organizer shares a join URL | ✓ | ✓ |
| Participant clicks link, authorizes, done | ✓ | ✓ |
| Organizer manually creates a PAT | ✓ | — |
| Invite URL contains a raw PAT | ✓ | — |

The gifts app is strictly better UX for organizers — fewer steps, no GitHub Settings detour. Participants notice no difference. The cost of that improvement falls entirely on the developer, not on users.

---

## What Changes

| | Potluck | Gifts |
|---|---|---|
| `clientSecret` location | Client code | Worker env var |
| Token exchange | Public CORS proxy (`cors-anywhere`) | Own Worker endpoint |
| Organizer creates invite | Manual PAT on GitHub Settings | Click — Worker handles it |
| Invite URL contains | Raw Fine-Grained PAT | Opaque invite code |
| Library import | `github-store.js` | `github-store-worker.js` |
| Developer must deploy | Nothing | A Worker |

---

## Data Model

```
{owner}/{repo}/
  _event.json        # { name, created, owner } — same as potluck
  _wishlist.json     # { items: ["Coffee maker", "Blender", ...] } — organizer-authored
  alice/
    2026-03-22T10:00:00.000Z.json   # { item: "Coffee maker" }
  bob/
    2026-03-22T10:05:00.000Z.json   # { item: "Blender" }
```

**Claim resolution:** first claim per item wins — determined by lexicographic timestamp sort across all participant entries. No locking, no transactions. If two people claim the same item simultaneously, both writes succeed; the app surfaces the conflict and lets them sort it out. Same eventual-consistency-via-append-only-log model as potluck.

**`_wishlist.json` schema:**
```json
{ "items": ["Coffee maker", "Blender", "Cookbook"] }
```
Written by the organizer via `store.write('_wishlist.json', { items })`. Participants read it via `store.read('_wishlist.json')`.

**Claim entry schema:**
```json
{ "item": "Coffee maker" }
```
Written by participants via `store.append({ item }, { prefix: username })`.

---

## Organizer Flow

1. Open `?mode=organizer` → OAuth (no `clientSecret` in code or URL)
2. Fill in event name → `store.createSpace(name)` → private GitHub repo created
3. App calls `store.register()` → Worker stores organizer token; returns `inviteCode`
4. Add wishlist items → `store.write('_wishlist.json', { items })`
5. Share join URL: `?mode=participant&repo={owner}/{repo}&invite={inviteCode}`
   — opaque code, not a PAT
6. Watch live: wishlist with claimed/unclaimed status and claimant names
7. Responses poll via `store.readAll()` every 30s (same as potluck)

---

## Participant Flow

1. Open join URL → OAuth
2. `store.join(repo, inviteCode)` fires automatically:
   - POSTs to Worker `/spaces/invite` with repo + username + inviteCode
   - Worker validates code and calls `PUT /collaborators/{username}` using stored organizer token
   - If already a collaborator, Worker returns 200 and skips the invite
   - Participant's own token then auto-accepts the invitation (same as potluck base logic)
3. `store.read('_wishlist.json')` → show wishlist with claimed/unclaimed status
4. Click to claim → `store.append({ item }, { prefix: username })`
5. Claimed items show claimant's username; own claim shown as "You"

---

## Gifts UI

**Organizer mode:**
```
┌─────────────────────────────────────────┐
│  Gift Registry — Organizer              │
│  Signed in as: alice                    │
│                                         │
│  [Create new registry]                  │
│  Event name: [birthday-2026-04-01    ]  │
│  [Create]                               │
│                                         │
│  ── or resume ──────────────────────    │
│  > birthday-2026-04-01  (2 claimed)     │
│                                         │
│  ── active registry ────────────────    │
│  Repo: alice/birthday-2026-04-01        │
│  Join link: [Copy join link]            │
│                                         │
│  ── wishlist ───────────────────────    │
│  Item             [Add item: _______ ]  │
│  Coffee maker     → claimed by bob      │
│  Blender          → unclaimed           │
│  Cookbook         → claimed by carol    │
└─────────────────────────────────────────┘
```

**Participant mode:**
```
┌─────────────────────────────────────────┐
│  Gift Registry — alice/birthday-2026    │
│  Signed in as: bob                      │
│  Status: joined ✓                       │
│                                         │
│  ── wishlist ───────────────────────    │
│  Coffee maker     [Claim]               │
│  Blender          You ✓                 │
│  Cookbook         claimed by carol      │
└─────────────────────────────────────────┘
```

No CSS framework. Plain styles, mobile-readable. Same visual language as potluck.

---

## Developer Tradeoffs

### What a developer needs beyond potluck

1. A deployed Worker — Cloudflare reference implementation, or any server implementing the three HTTP endpoints
2. A GitHub OAuth app — same as potluck, but `clientSecret` goes into the Worker's env, not client code
3. Worker configured with:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - A KV namespace (or equivalent) for organizer tokens and invite codes

### What a developer gets in return

- No secrets in client code
- No dependency on a third-party CORS proxy
- Organizer never touches GitHub Settings to create a PAT
- Invite URLs contain opaque codes, not credentials

### The honest cost

Deploying a Cloudflare Worker is a one-time ~15 minute setup: `wrangler deploy`, two env vars, one KV namespace binding. It is not a database, not a server to maintain, not an ongoing ops burden. But it is a hard prerequisite — the gifts pattern cannot work without it, and debugging a misconfigured Worker is a different class of problem than debugging a pure browser app.

The potluck pattern has zero infrastructure prerequisites beyond a GitHub OAuth app registration. That is its superpower and its limitation. The gifts pattern trades that purity for security and organizer UX. Neither is wrong — they are points on a spectrum.

---

## Known Limitations

### Scaling ceiling

GitHub-as-storage is optimised for small groups. The practical ceiling is roughly tens of participants per event and tens of concurrent events before GitHub API rate limits become a concern:

- Each authenticated user gets 5,000 API requests/hour against their own token
- `readAll()` is expensive per call — a 100-participant registry makes ~200+ GitHub API calls per poll
- An organizer polling every 30s for a large registry burns through quota quickly
- Rate limits are per-user token, not per app — so many small events fan out fine; one very large event does not

The Worker scales without limit (Cloudflare Workers are globally distributed; at 1M requests/day the cost is approximately $15/month on the paid plan). GitHub does not scale the same way.

> *Apps expecting hundreds of participants or high-frequency polling should evaluate whether GitHub-as-storage remains appropriate.*

### D4 partial mitigation only

The opaque invite code still allows anyone who holds the join URL to self-add as a collaborator during the open signup window. Full mitigation requires per-participant invite links with single-use codes — out of scope for this demo.

---

## Tutorial Documentation

The gifts app introduces the need for a second tutorial alongside the existing `docs/e2e-test.md`. The documentation set should be restructured as three files:

| File | Content |
|---|---|
| `docs/tutorial.md` | Prerequisites, GitHub OAuth app setup, local server setup — shared foundation for both apps |
| `docs/tutorial-potluck.md` | Potluck walkthrough — references `tutorial.md` for setup |
| `docs/tutorial-gifts.md` | Gifts walkthrough — references `tutorial-potluck.md` for shared concepts; focuses on Worker deploy and the differences |

Each file uses the same step-by-step format as `e2e-test.md` with lightweight callouts at moments where library behavior is non-obvious or where gifts diverges from potluck. `docs/e2e-test.md` is retired when the tutorial set is complete.

---

## Out of Scope

- Per-participant invite links (single-use codes)
- Wishlist item removal or editing by organizer after participants have claimed
- Organizer lifecycle controls (close/lock/delete) — potluck already demonstrates these
- Any UI beyond functional / readable
- Multiple simultaneous registries per organizer (localStorage supports it; UI shows one at a time)
