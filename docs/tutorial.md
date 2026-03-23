# AnyTrunk Tutorial — Prerequisites & Setup

This guide covers the prerequisites shared by both the **Potluck** and **Gifts** walkthroughs.
Complete this section first, then follow the app-specific tutorial.

---

## Prerequisites

- Node.js 18 or later (`node --version`)
- Two GitHub accounts:
  - **Account A** — will act as the event organizer
  - **Account B** — will act as a participant
- The repository checked out and dependencies installed (`npm install`)

---

## Step 1: Register a GitHub OAuth App

All steps below are performed while signed in to **Account A**.

1. Go to `https://github.com/settings/developers`
2. Click **OAuth Apps** → **New OAuth App**
3. Fill in:
   - **Application name:** `AnyTrunkDemo`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** depends on which app you are testing:
     - Potluck: `http://localhost:3000/apps/potluck/index.html`
     - Gifts: `http://localhost:3000/apps/gifts/index.html`
4. Click **Register application**
5. Note the **Client ID** — you will paste it into the app's config
6. Click **Generate a new client secret** and note the **Client Secret**
   - Potluck: paste into `apps/potluck/main.js` as `CLIENT_SECRET`
   - Gifts: this goes into the Worker env, not client code — see `docs/tutorial-gifts.md`

---

## Step 2: Start the Static File Server

Open a terminal in the project root:

```bash
npx serve . -l 3000
```

Verify: open `http://localhost:3000` — you should see a directory listing.

> `serve.json` in the project root sets `"cleanUrls": false` to prevent 301 redirects
> from stripping the `?code=&state=` query string that GitHub appends to the callback URL.
> Without it, OAuth completes but the app never receives the code.

Now follow the app-specific tutorial:

- Potluck (zero-backend, CORS proxy): `docs/tutorial-potluck.md`
- Gifts (hardened, Cloudflare Worker): `docs/tutorial-gifts.md`
