# End-to-End Manual Test Guide

This guide walks through a complete test of the PotluckApp from OAuth setup through
organizer event creation, participant join, dish submission, re-submission, observer
mode, and organizer lifecycle controls. No automated test covers the real GitHub OAuth
and API flow, so this manual test is the final verification step.

Estimated time: 30-45 minutes.

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

Now paste both values into `apps/potluck/main.js`. Open the file and find the CONFIG
block near the top:

```js
const CLIENT_ID     = '<CLIENT_ID>'
const CLIENT_SECRET = '<CLIENT_SECRET>'
```

Replace the placeholder strings with your actual Client ID and Client Secret.

> Security note: the client secret is visible in the browser. This is a known
> limitation of the POC — see design doc D1 for details. Do not reuse this OAuth App
> for anything other than local testing.

> Scope note: the app now requests the `delete_repo` scope in addition to `repo`.
> GitHub will show both in the authorization dialog. This is required for the
> "Delete event" lifecycle control added in the organizer dashboard.

---

## Step 2: Configure the CORS Proxy

The app uses `CORS_PROXY` to exchange the OAuth code for a token (the GitHub token
endpoint does not allow cross-origin requests from browsers). The default value in
`apps/potluck/main.js` is:

```js
const CORS_PROXY = 'http://localhost:8080'
```

This is already set to use the local proxy started in the next step. No changes needed.

---

## Step 3: Start the Servers

Open two terminal windows in the project root.

**Terminal 1 — CORS proxy:**

```bash
npm run proxy
```

This runs a local cors-anywhere server on port 8080. Leave this running.

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
   and click **Authorize**. You will see both `repo` and `delete_repo` listed in the
   permissions — this is expected.
2. After authorization you are redirected back to the app. You should see:
   **Potluck Organizer** with your Account A username.
3. In the **Event name** field, leave or edit the pre-filled name
   (e.g. `potluck-2026-03-21`).
4. Click **Create**. The app creates a GitHub repository under Account A and shows the
   organizer dashboard.
5. Under **Share join link**, follow the 6-step PAT creation checklist:
   - **Step 1:** Click **→ Open GitHub token page** to open GitHub's PAT creation page.
   - **Step 2:** The suggested token name (e.g. `potluck-2026-03-21-invite`) is shown
     with a **Copy** button — use it to copy the name into GitHub's Token name field.
   - **Step 3:** Set expiration to **7 days**.
   - **Step 4:** Under Repository access, choose **Only select repositories** and select
     the newly created event repo.
   - **Step 5:** Under Permissions → Repository permissions → Administration, set to
     **Read and write**.
   - **Step 6:** Click **Generate token**, copy the token from GitHub, then paste it
     into the input field on the organizer dashboard and click **Validate**.
6. If the token is valid you will see **Token valid ✓** and the **Copy join link**
   button appears. Click it to copy the full join URL (including `invite=<PAT>`) to
   your clipboard.

Keep this organizer window open.

---

## Step 5: Participant Onboarding Gate (Account B, no GitHub account scenario)

This step verifies the onboarding gate that shows before the OAuth redirect.

Open a **private/incognito browser window** and paste the join link into the address
bar, but **do not navigate yet**. Clear the `invite=...` and `repo=...` parts and
navigate to just:

```
http://localhost:3000/apps/potluck/index.html?mode=participant&repo={owner}/{repo}
```

(Replace `{owner}/{repo}` with the real repo name from the organizer dashboard.)

1. The **onboarding gate** appears: "You've been invited to a Potluck event. Do you
   have a GitHub account?"
2. Click **No, create a free account** — the `GitHubStore.onboardingHint()` text and
   a link to `github.com/signup` appear. The user stays on the page (no OAuth redirect).
3. Now navigate to the full join link (with `invite=` and `repo=` params) in the same
   incognito window.
4. The gate appears again (no token in sessionStorage yet).
5. Click **Yes, sign in with GitHub** — the OAuth redirect fires immediately.

---

## Step 6: Participant Joins and Submits (Account B)

Continuing in the same private/incognito window (after clicking "Yes" in Step 5):

1. Sign in as **Account B** on GitHub's authorization screen and click **Authorize**.
2. After redirect, the participant view loads. Verify the status badge reads
   **joined** (shown as a green badge).
3. In the **What are you bringing?** section, enter a dish name (e.g. `lasagne`) and
   an optional note (e.g. `vegetarian`).
4. Click **Submit**.
5. Verify the submission appears in the **Your submissions** table below the form, with
   the dish name and the label `<- current` in the last column.

---

## Step 7: Organizer Sees the Submission

Switch back to the organizer window (Account A).

The **Responses** table auto-refreshes every 30 seconds (polling pauses when the tab
is hidden and resumes when you switch back — so switching back should trigger a refresh
within the normal interval). Either wait up to 30 seconds or reload the page (you will
need to re-authenticate after a reload because session state is stored in
`sessionStorage`).

Verify that Account B's username and the dish submitted in Step 6 appear as a row in
the **Responses** table.

---

## Step 8: Participant Re-submits

In the participant window (Account B):

1. Enter a different dish name (e.g. `tiramisu`) in the **Dish** field.
2. Click **Submit**.
3. Verify the **Your submissions** table now shows two rows:
   - The first row (original dish) has no marker in the last column.
   - The second row (new dish) is **bold** and shows `<- current`.

Switch to the organizer window and wait for the next auto-refresh (or reload). Verify
that the Responses table shows the **latest** dish for Account B (e.g. `tiramisu`).

---

## Step 9: Observer Mode (no account required)

Observer mode provides a read-only view of a **public** event without authentication.

> Note: this step only works if the event repo is public. If you created a private repo
> in Step 4, you can either create a new event with `{ private: false }` (the code
> supports it) or skip this step.

Open a new **private/incognito window** and navigate to:

```
http://localhost:3000/apps/potluck/index.html?mode=observer&repo={owner}/{repo}
```

1. The submissions table loads immediately — no login prompt, no OAuth redirect.
2. The header shows **Read-only view** and **(refreshes every 30s)**.
3. Account B's dish should appear in the table.
4. To verify the closed-event banner: go to the organizer dashboard and click
   **Close submissions** (see Step 10). Then wait for the observer to refresh — a
   yellow **Submissions are closed** banner should appear above the table.

To verify private repo handling, navigate to:

```
http://localhost:3000/apps/potluck/index.html?mode=observer&repo={owner}/nonexistent
```

Expected: "This event is private. You need an invitation to participate."

---

## Step 10: Organizer Lifecycle Controls

Switch to the organizer window (Account A). At the bottom of the organizer dashboard,
below the Responses table, find the **Event lifecycle** section.

**Close submissions:**

1. Click **Close submissions**.
2. The button becomes **Submissions closed ✓** and is disabled.
3. The **Lock event** button appears.
4. If Account B's participant window is open and refreshes, a yellow
   **Submissions are closed** banner appears above the form.

**Lock event:**

1. Click **Lock event**.
2. A confirmation dialog appears: "This will archive the event on GitHub, making it
   permanently read-only…". Click **OK**.
3. The button becomes **Event locked ✓** and is disabled.
4. The **Delete event** button appears.
5. Verify on GitHub: go to `github.com/{owner}/{repo}` — the repo should show a
   yellow "This repository has been archived" banner.

**Delete event:**

1. Click **Delete event**.
2. A name confirmation input appears: "Type `{repo-name}` to confirm permanent
   deletion".
3. Type the wrong name — the **Permanently delete** button stays disabled.
4. Type the exact repo short name — the button enables.
5. Click **Permanently delete**.
6. On success, the organizer is redirected to `?mode=organizer` (the creation form)
   and the deleted repo no longer appears in the "Resume recent event" list.
7. To test the missing-scope error path: if Account A's token was issued before the
   `delete_repo` scope was added, GitHub returns 403. An error banner appears with a
   message referencing the missing scope; the Delete button resets and the name input
   is cleared. In this case, sign out, re-authorize the app (it will request the new
   scope), and retry.

---

## Step 11: Participant Revisits Without the Join Link

This step verifies that a participant who is already a collaborator can return to the
event without the `invite` token in the URL.

1. Close the participant browser window entirely.
2. Open a new private/incognito window and navigate to:

   ```
   http://localhost:3000/apps/potluck/index.html?mode=participant&repo={owner}/{repo}
   ```

   Replace `{owner}/{repo}` with the full repository name. Note there is **no**
   `invite=` parameter.

3. The onboarding gate appears (no token in sessionStorage). Click **Yes, sign in with
   GitHub**.
4. Sign in as Account B when prompted.
5. Verify the **joined** badge appears. The app skips the collaborator invite step
   because Account B is already a collaborator.
6. The submission form and history load normally.

---

## Step 12: Cleanup

After testing:

1. Revoke the Fine-Grained PAT created in Step 4:
   - Go to `https://github.com/settings/tokens` (Account A)
   - Find the `{repo-name}-invite` token and click **Delete**
2. If the event repo still exists (Step 10 was skipped or the delete was skipped),
   delete it manually from Account A's GitHub repository settings, or use the
   **Delete event** button in the organizer dashboard.
3. Optionally revoke or delete the OAuth App under `github.com/settings/developers`.

---

## Troubleshooting

**CORS error on token exchange**

The browser console shows a CORS or network error when exchanging the OAuth code for a
token. Check that:
- The CORS proxy is running (`npm run proxy` in Terminal 1).
- `CORS_PROXY` in `apps/potluck/main.js` is set to `http://localhost:8080`.
- No firewall or antivirus is blocking localhost port 8080.

**401 Unauthorized on API calls**

The GitHub token has expired or the session was lost. Close the tab, reopen the correct
URL (including `?mode=organizer` or `?mode=participant&repo=...`), and authenticate
again. Session state is stored in `sessionStorage` and is cleared when the tab is
closed.

**PUT /collaborators fails with 404**

The invite token is invalid or targets the wrong repository. Verify that:
- The Fine-Grained PAT passed the **Validate** step in Step 4 (showed "Token valid ✓").
- The PAT is scoped to the specific repository created in Step 4.
- The join link was not truncated when copying.

**Delete event fails with "missing delete_repo scope"**

The OAuth token was issued before `delete_repo` was added to the requested scopes.
Clear sessionStorage (or close and reopen the browser tab), re-authorize the app — the
new authorization will include `delete_repo` — then retry the delete.

**Already authenticated but shows the login page**

This is expected. `sessionStorage` is cleared when a tab is closed. Navigating to the
app URL again will restart the OAuth flow. You do not need to re-authorize on GitHub
(the app is already authorized); the redirect back will complete quickly.

**Participant sees onboarding gate even though they have an account**

This is correct behavior when no token is in sessionStorage (e.g. fresh incognito
window). Click **Yes, sign in with GitHub** to proceed through OAuth.

**Observer mode shows "This event is private"**

Either the repo is private (observer mode requires public repos) or the repo name in
the URL is wrong. Check the URL and verify the repo visibility on GitHub.

**`npx serve` not found**

Install it globally or use an alternative static server:

```bash
npm install -g serve
# or
python3 -m http.server 3000
```

When using `python3 -m http.server`, note that it serves from the current directory, so
navigate to `http://localhost:3000/apps/potluck/index.html?mode=organizer` manually.
