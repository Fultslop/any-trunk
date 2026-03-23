# AnyTrunk Tutorial — Gifts App

The gifts app demonstrates the **hardened pattern**: a Cloudflare Worker handles OAuth
token exchange and collaborator invites. No secrets in client code. No manual PAT creation.

**Complete `docs/tutorial.md` first.**

Compared to potluck, this tutorial has one extra section (deploying the Worker). After
that, the organizer and participant flows are noticeably simpler.

Estimated time: 45–60 minutes (including Worker deployment).

---

## Step 1: Deploy the Cloudflare Worker

You will need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

**Install wrangler:**
```bash
npm install -g wrangler
wrangler login
```

**Create a KV namespace:**
```bash
cd workers/anytrunk-worker
npx wrangler kv namespace create anytrunk
```

Copy the `id` from the output and paste it into `workers/anytrunk-worker/wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "KV"
id = "PASTE_YOUR_ID_HERE"
```

**Set secrets** (these replace `CLIENT_SECRET` and `CORS_PROXY` from potluck — they live
in the Worker, never in client code):
```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Enter the values from your OAuth App when prompted.

**Deploy:**
```bash
npx wrangler deploy
```

Note the Worker URL (e.g. `https://anytrunk-worker.your-subdomain.workers.dev`).

Return to the project root before continuing:
```bash
cd ../..
```

> The Worker handles three endpoints: `/oauth/token` (fixes D1+D2 — secret off client,
> own proxy), `/spaces/register` (generates invite codes), and `/spaces/invite` (fixes D3
> — adds collaborators using a stored organizer token without exposing it to the client).

---

## Step 2: Configure the App

Open `apps/gifts/main.js` and fill in:

```js
const CLIENT_ID  = '<your Client ID>'      // same OAuth App as registered in prerequisites
const WORKER_URL = '<your Worker URL>'     // e.g. https://anytrunk-worker.your-sub.workers.dev
```

No `CLIENT_SECRET` here — it lives in the Worker.

---

## Step 3: Organizer Creates a Registry (Account A)

Navigate to:
```
http://localhost:3000/apps/gifts/index.html?mode=organizer
```

1. GitHub OAuth screen appears. Sign in as **Account A** and authorize.

   > The library (`WorkerGitHubStore.completeAuth()`) POSTs the OAuth code to the Worker's
   > `/oauth/token` endpoint instead of cors-anywhere. The Worker exchanges it for a token
   > using the stored `GITHUB_CLIENT_SECRET` — the secret never touches the browser.

2. Fill in a registry name (e.g. `birthday-2026-04-01`) and click **Create**.
   Same as potluck: `store.createSpace(name)` creates a private GitHub repo.

3. The app immediately calls `store.register()` after creation.

   > `register()` POSTs `{ repo, token }` to the Worker's `/spaces/register` endpoint.
   > The Worker stores the organizer's token in KV and returns an opaque invite code.
   > The invite code is stored in `localStorage` — no PAT creation needed.

   Notice: no GitHub Settings detour. No PAT checklist. This is D3 resolved.

4. Add wishlist items using the **Add** button. Each item is written to `_wishlist.json`
   via `store.write('_wishlist.json', { items })`.

5. Click **Copy join link** and share it with participants.

   > The join URL contains an opaque code (e.g. `?invite=a3f8c1d2...`), not a raw PAT.
   > This is D4 partially mitigated — the code grants collaborator access but is not
   > directly usable as a GitHub credential.

---

## Step 4: Participant Joins (Account B)

Open a **private/incognito window** and navigate to the join link.

1. The onboarding gate appears — click **Yes, sign in with GitHub**.
2. Sign in as **Account B** and authorize.

   > Token exchange goes through the Worker — Account B's `client_secret` is never in
   > the browser.

3. The **joined ✓** badge appears. Behind the scenes:
   - `store.join()` POSTed `{ repo, username, inviteCode }` to the Worker's `/spaces/invite`
   - The Worker validated the invite code and called `PUT /collaborators/{username}`
     using the **stored organizer token** — Account B never saw the organizer's token
   - `_autoAcceptInvitation()` then accepted the invitation using Account B's own token

   Compare to potluck: the PAT that was embedded in the URL is now stored server-side.

4. The wishlist appears. Click **Claim** on an item.
   The library calls `store.append({ item }, { prefix: username })` — same API as potluck.

---

## Step 5: Organizer Sees Claims

Back in the organizer window, claimed items show the claimant's name. The app polls
`store.readAll()` every 30s — same mechanism as potluck.

> The data layer is identical between the two apps. Only the auth flow changed.

---

## Step 6: Cleanup

1. Delete the repo from the organizer dashboard or GitHub directly
2. Optionally delete the Worker: `npx wrangler delete anytrunk-worker`
3. Optionally revoke the OAuth App under `github.com/settings/developers`

---

## Troubleshooting

**Worker returns 400 on token exchange** — Check that `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` secrets are set correctly in the Worker (`npx wrangler secret list`).

**Worker returns 403 on invite** — The invite code in the URL may be stale. Open the
organizer dashboard, which will regenerate and display the current join link.

**401 Unauthorized on GitHub API calls** — Same as potluck: token expired or session lost.
Close the tab, reopen the URL, re-authenticate.

**`wrangler deploy` fails with KV namespace error** — Confirm the `id` in `wrangler.toml`
matches the output of `npx wrangler kv namespace list`.
