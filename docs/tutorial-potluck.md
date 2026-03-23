# AnyTrunk Tutorial — Potluck App

The potluck app demonstrates the **zero-backend pattern**: GitHub is the storage layer,
the browser is the runtime. A public CORS proxy handles the OAuth token exchange, and the
organizer creates a Fine-Grained PAT manually to invite participants.

**Complete `docs/tutorial.md` first.**

Estimated time: 30–45 minutes.

---

## Step 1: Configure the App

Open `apps/potluck/main.js` and fill in the config block near the top:

```js
const CLIENT_ID     = '<your Client ID>'
const CLIENT_SECRET = '<your Client Secret>'   // ⚠ visible in browser — POC only, see D1
const CORS_PROXY    = 'http://localhost:8080'
```

> The client secret is visible in the browser source. This is a known limitation of the
> potluck POC — see D1 in the design spec. Do not reuse this OAuth App for anything beyond
> local testing.

---

## Step 2: Start the CORS Proxy

Open a second terminal in the project root:

```bash
npm run proxy
```

This runs a local cors-anywhere server on port 8080.

> The library (`completeAuth()`) POSTs to GitHub's token endpoint via this proxy because
> browsers block direct cross-origin requests to `github.com/login/oauth/access_token`.
> In the gifts app, a Cloudflare Worker replaces this proxy — see D2 in the design spec.

Verify both servers are running:
- Proxy: `curl -s http://localhost:8080` — a response or "missing headers" is normal
- File server: `http://localhost:3000` shows a directory listing

---

## Step 3: Organizer Creates an Event (Account A)

Navigate to:
```
http://localhost:3000/apps/potluck/index.html?mode=organizer
```

1. GitHub OAuth screen appears. Sign in as **Account A** and click **Authorize**.
2. You are redirected back. You should see **Potluck Organizer** with your Account A username.

   > After OAuth, the library stores the token in `sessionStorage` and redirects to the
   > original URL. The app reloads with the token available — no second OAuth redirect.

3. Fill in an event name (e.g. `potluck-2026-03-21`) and click **Create**.
   The library calls `store.createSpace(name)` — this creates a private GitHub repo and
   writes `_event.json` to it.

4. Under **Share join link**, follow the 6-step PAT checklist:
   - Click **→ Open GitHub token page**
   - Token name: copy the suggested name
   - Expiration: **7 days**
   - Repository access: **Only select repositories** → select the new repo
   - Permissions → Repository permissions → Administration: **Read and write**
   - Click **Generate token**, copy it, paste into the app, click **Validate**

   > The PAT is embedded in the join URL. This is D3+D4 — see the design spec. The gifts
   > app eliminates this step entirely via the Worker.

5. Click **Copy join link** and save it. Keep this window open.

---

## Step 4: Participant Joins (Account B)

Open a **private/incognito window** and navigate to the join link.

1. The onboarding gate appears — click **Yes, sign in with GitHub**.
2. Sign in as **Account B** and authorize.
3. The **joined ✓** badge appears. The library called `store.join()` which:
   - Used the PAT in the URL to call `PUT /collaborators/{username}` (adding Account B)
   - Used Account B's own token to accept the invitation via `PATCH /repository_invitations/{id}`

4. Enter a dish name and click **Submit**.
   The library calls `store.append({ dish }, { prefix: username })` — writes
   `{username}/{timestamp}.json` to the repo.

---

## Step 5: Organizer Sees the Submission

Back in the organizer window, wait up to 30 seconds (the app polls `store.readAll()`
every 30s). Account B's dish should appear in the Responses table.

> `readAll()` enumerates top-level repo directories, skipping `_`-prefixed entries
> (like `_event.json`). Each participant directory is a GitHub username; files inside
> are submissions sorted lexicographically by timestamp.

---

## Step 6: Participant Re-submits

In the participant window, enter a different dish and click **Submit**. Two rows appear
in the history; the latest is marked `← current`.

Back in the organizer window, the table shows the latest dish after the next poll.

---

## Step 7: Cleanup

1. Revoke the PAT: `github.com/settings/tokens` → delete the `{repo}-invite` token
2. Delete the repo from the organizer dashboard (**Delete event**) or from GitHub directly
3. Optionally revoke the OAuth App under `github.com/settings/developers`

---

## Troubleshooting

**CORS error on token exchange** — Check that `npm run proxy` is running and that
`CORS_PROXY` in `main.js` is `http://localhost:8080`.

**401 Unauthorized** — Token has expired or session was lost. Close the tab, reopen the
URL, and re-authenticate. Tokens are stored in `sessionStorage` and cleared on tab close.

**PUT /collaborators fails with 404** — The PAT targets the wrong repo or has expired.
Re-generate a new PAT in the organizer dashboard.

**Already authenticated but shows the login page** — Expected on fresh incognito window.
`sessionStorage` is cleared when a tab closes. Click **Yes, sign in with GitHub**.
