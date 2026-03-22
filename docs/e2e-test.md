# End-to-End Manual Test Guide

This guide walks through a complete test of the PotluckApp from OAuth setup through
organizer event creation, participant join, dish submission, and re-submission. No
automated test covers the real GitHub OAuth and API flow, so this manual test is the
final verification step.

Estimated time: 20-30 minutes.

---

## Prerequisites

- Node.js 18 or later (`node --version`)
- Two GitHub accounts:
  - **Account A** — will act as the event organizer
  - **Account B** — will act as a participant
- The repository checked out and dependencies available (`npm` in PATH)

---

## Step 1: Register a GitHub OAuth App

All steps below are performed while signed in to **Account A**.

1. Go to `https://github.com/settings/developers`
2. Click **OAuth Apps** in the left sidebar, then **New OAuth App**
3. Fill in the form:
   - **Application name:** `PotluckPOC`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/apps/potluck/index.html`
4. Click **Register application**
5. On the next page, note the **Client ID**
6. Click **Generate a new client secret** and note the **Client Secret**

Now paste both values into `apps/potluck/index.html`. Open the file and find the
CONFIG block near the top of the `<script>` tag:

```js
const CLIENT_ID     = 'YOUR_CLIENT_ID_HERE'
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE'
```

Replace the placeholder strings with your actual Client ID and Client Secret.

> Security note: the client secret is visible in the browser. This is a known
> limitation of the POC — see design doc D1 for details. Do not reuse this OAuth App
> for anything other than local testing.

---

## Step 2: Configure the CORS Proxy

The app uses `CORS_PROXY` to exchange the OAuth code for a token (the GitHub token
endpoint does not allow cross-origin requests from browsers). The default value in
`apps/potluck/index.html` is:

```js
const CORS_PROXY = 'https://cors-anywhere.herokuapp.com'
```

For local development you should run your own proxy instead. Change this line to:

```js
const CORS_PROXY = 'http://localhost:8080'
```

The proxy is started in the next step.

---

## Step 3: Start the Servers

Open two terminal windows in the project root.

**Terminal 1 — CORS proxy:**

```bash
npm install cors-anywhere
npm run proxy
```

This runs a local cors-anywhere server. By default it listens on port 8080
(controlled by the `PORT` environment variable). Leave this running.

**Terminal 2 — Static file server:**

```bash
npx serve . -l 3000
```

This serves the project root on `http://localhost:3000`. Leave this running.

> **Important:** `serve` strips `.html` extensions via 301 redirects by default, which drops
> the `?code=&state=` query string that GitHub appends to the callback URL. The `serve.json`
> in the project root sets `"cleanUrls": false` to prevent this. Without it, `completeAuth()`
> is never reached and the app loops back to GitHub on every load.

Verify both are up before proceeding:
- CORS proxy: `Invoke-WebRequest http://localhost:8080 -UseBasicParsing` (PowerShell)
  or `curl -s http://localhost:8080` (bash/WSL) — a response or "missing headers"
  message is normal
- File server: open `http://localhost:3000` in a browser and confirm you see a
  directory listing

---

## Step 4: Organizer Creates an Event (Account A)

Open a browser window and navigate to:

```
http://localhost:3000/apps/potluck/index.html?mode=organizer
```

1. The page redirects to GitHub's OAuth authorization screen. Sign in as **Account A**
   and click **Authorize**.
2. After authorization you are redirected back to the app. You should see:
   **Potluck Organizer** with your Account A username.
3. In the **Event name** field, leave or edit the pre-filled name
   (e.g. `potluck-2026-03-21`).
4. Click **Create**. The app creates a GitHub repository under Account A and shows the
   organizer dashboard.
5. Under **Share join link**, click the link that opens
   `github.com/settings/personal-access-tokens/new` to create a Fine-Grained PAT:
   - **Token name:** the pre-filled description is fine
   - **Expiration:** 7 days (or shorter)
   - **Resource owner:** Account A
   - **Repository access:** Only select repositories — choose the newly created repo
   - **Permissions:** Repository permissions → Administration → **Read and Write**
   - Click **Generate token** and copy the token (starts with `github_pat_` or `ghp_`)
6. Paste the PAT into the **Paste it here** input field on the organizer dashboard.
7. Click **Copy join link**. The full join URL (including `invite=<PAT>`) is now in
   your clipboard.

Keep this organizer window open.

---

## Step 5: Participant Joins and Submits (Account B)

Open a **private/incognito browser window** so Account A's GitHub session does not
interfere.

1. Paste the join link (copied in Step 4) into the address bar and navigate to it.
2. The page redirects to GitHub. Sign in as **Account B** and authorize the app.
3. After redirect, the participant view loads. Verify the status badge reads
   **joined** (shown as a green badge).
4. In the **What are you bringing?** section, enter a dish name (e.g. `lasagne`) and
   an optional note (e.g. `vegetarian`).
5. Click **Submit**.
6. Verify the submission appears in the **Your submissions** table below the form, with
   the dish name and the label `<- current` in the last column.

---

## Step 6: Organizer Sees the Submission

Switch back to the organizer window (Account A).

The **Responses** table auto-refreshes every 30 seconds. Either wait up to 30 seconds
or reload the page (you will need to re-authenticate after a reload because session
state is stored in `sessionStorage` which does not persist across page loads — see
Step 8 for the reload URL format).

Verify that Account B's username and the dish submitted in Step 5 appear as a row in
the **Responses** table.

---

## Step 7: Participant Re-submits

In the participant window (Account B):

1. Enter a different dish name (e.g. `tiramisu`) in the **Dish** field.
2. Click **Submit**.
3. Verify the **Your submissions** table now shows two rows:
   - The first row (original dish) has no marker in the last column.
   - The second row (new dish) is **bold** and shows `<- current`.

Switch to the organizer window and wait for the next auto-refresh (or reload). Verify
that the Responses table shows the **latest** dish for Account B (e.g. `tiramisu`).

---

## Step 8: Participant Revisits Without the Join Link

This step verifies that a participant who is already a collaborator can return to the
event without the `invite` token in the URL.

1. Close the participant browser window entirely.
2. Open a new private/incognito window and navigate to:

   ```
   http://localhost:3000/apps/potluck/index.html?mode=participant&repo={owner}/{repo}
   ```

   Replace `{owner}/{repo}` with the full repository name shown on the organizer
   dashboard (e.g. `accounta/potluck-2026-03-21`). Note there is **no** `invite=`
   parameter.

3. Sign in as Account B when prompted.
4. Verify the **joined** badge appears. The app skips the collaborator invite step
   because Account B is already a collaborator.
5. The submission form and history load normally.

---

## Step 9: Cleanup

After testing:

1. Revoke the Fine-Grained PAT created in Step 4:
   - Go to `https://github.com/settings/tokens` (Account A)
   - Find the `potluck-invite-*` token and click **Delete**
2. Optionally delete the test repository from Account A's GitHub settings.
3. Optionally revoke or delete the OAuth App under `github.com/settings/developers`.

---

## Troubleshooting

**CORS error on token exchange**

The browser console shows a CORS or network error when exchanging the OAuth code for a
token. Check that:
- The CORS proxy is running (`npm run proxy` in Terminal 1).
- `CORS_PROXY` in `apps/potluck/index.html` is set to `http://localhost:8080`.
- No firewall or antivirus is blocking localhost port 8080.

**401 Unauthorized on API calls**

The GitHub token has expired or the session was lost. Close the tab, reopen the correct
URL (including `?mode=organizer` or `?mode=participant&repo=...`), and authenticate
again. Session state is stored in `sessionStorage` and is cleared when the tab is
closed.

**PUT /collaborators fails with 404**

The invite token is invalid or targets the wrong repository. Verify that:
- The Fine-Grained PAT was created with **Administration: Read and Write** permission.
- The PAT is scoped to the specific repository created in Step 4.
- The join link was not truncated when copying.

**Already authenticated but shows the login page**

This is expected. `sessionStorage` is cleared when a tab is closed. Navigating to the
app URL again will restart the OAuth flow. You do not need to re-authorize on GitHub
(the app is already authorized); the redirect back will complete quickly.

**`npx serve` not found**

Install it globally or use an alternative static server:

```bash
npm install -g serve
# or
python3 -m http.server 3000
```

When using `python3 -m http.server`, note that it serves from the current directory, so
navigate to `http://localhost:3000/apps/potluck/index.html?mode=organizer` manually.
