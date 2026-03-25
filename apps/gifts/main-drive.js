// apps/gifts/main-drive.js
// Gift Registry backed by Google Drive.
// URL params:
//   ?mode=organizer            → organizer view (create/manage event)
//   ?mode=participant&space=X  → participant view (join + claim)

import { GoogleDriveStore } from '../../lib/google-drive-store.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Register a Google OAuth app at console.cloud.google.com.
// Authorised redirect URI: this page's URL (e.g. http://localhost:5500/apps/gifts/gifts-drive.html)
// Enable the Google Drive API in the Cloud Console.
const CLIENT_ID = '<CLIENT_ID>';
const CLIENT_SECRET = '<CLIENT_SECRET>';
// ─────────────────────────────────────────────────────────────────────────────

function esc(string_) {
  return String(string_)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

const parameters = new URLSearchParams(location.search);
const mode = parameters.get('mode');
const spaceParameter = parameters.get('space');

function renderOnboardingGate(_spaceParameter, { url, hint, signIn }) {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <h1>🎁 Gift Registry (Google Drive)</h1>
    <p>You need a Google account to participate.</p>
    <button id="yes-btn">Sign in with Google</button>
    <button id="no-btn">I don't have an account</button>
    <p id="hint" style="display:none">${esc(hint)}
      <a href="${esc(url)}" target="_blank">Create account →</a>
    </p>
  `;
  document.querySelector('#yes-btn').addEventListener('click', () => signIn());
  document.querySelector('#no-btn').addEventListener('click', () => {
    document.querySelector('#hint').style.display = 'block';
  });
}

// ── ORGANIZER ─────────────────────────────────────────────────────────────────

async function renderOrganizer(store) {
  const app = document.querySelector('#app');
  const recentSpaces = store.getRecentSpaces();
  let activeSpace = spaceParameter ?? recentSpaces[0] ?? null;

  if (activeSpace) store.setSpace(activeSpace);

  async function renderDashboard() {
    const wishlist = activeSpace ? await store.read('_wishlist.json') : null;
    const participants = activeSpace ? await store.readAll() : [];

    const claims = {};
    for (const { username, latest } of participants) {
      if (latest?.item) {
        if (!claims[latest.item]) claims[latest.item] = [];
        claims[latest.item].push(username);
      }
    }

    const items = wishlist?.items ?? [];
    const joinUrl = activeSpace
      ? `${location.origin}${location.pathname}?mode=participant&space=${activeSpace}`
      : null;

    app.innerHTML = `
      <h1>🎁 Gift Registry (Google Drive)</h1>
      ${activeSpace ? `<p style="font-size:0.85em;opacity:0.6">Space: ${esc(activeSpace)}</p>` : ''}
      <section id="create">
        <h2>Create event</h2>
        <input id="evtName" placeholder="Event name">
        <label>
          <input type="radio" name="mode" value="email" checked> Email invite (private)
        </label>
        <label>
          <input type="radio" name="mode" value="link"> Link sharing (anyone)
        </label>
        <button id="btnCreate">Create</button>
      </section>
      ${activeSpace ? `
        <section id="wishlist">
          <h2>Wish list</h2>
          <textarea id="itemsInput" placeholder="One item per line">${(items).join('\n')}</textarea>
          <button id="btnSaveWishlist">Save wish list</button>
        </section>
        <section id="participants">
          <h2>Participants</h2>
          ${participants.length === 0
    ? '<p>No submissions yet.</p>'
    : participants.map((p) => `<p>${esc(p.username)}: ${esc(p.latest?.item ?? '—')}</p>`).join('')}
        </section>
        <section id="invite">
          <h2>Invite link</h2>
          <input value="${esc(joinUrl)}" readonly style="width:100%">
        </section>
        <section>
          <button id="btnClose">Close submissions</button>
          <button id="btnDelete">Delete event</button>
        </section>
      ` : ''}
    `;

    document.querySelector('#btnCreate')?.addEventListener('click', async () => {
      const name = document.querySelector('#evtName').value.trim();
      const accessMode = document.querySelector('input[name="mode"]:checked').value;
      if (!name) return;
      activeSpace = await store.createSpace(name, { accessMode });
      store.setSpace(activeSpace);
      await renderDashboard();
    });

    document.querySelector('#btnSaveWishlist')?.addEventListener('click', async () => {
      const lines = document.querySelector('#itemsInput').value.split('\n').map((s) => s.trim()).filter(Boolean);
      await store.write('_wishlist.json', { items: lines });
      await renderDashboard();
    });

    document.querySelector('#btnClose')?.addEventListener('click', async () => {
      await store.closeSubmissions();
      alert('Submissions closed.');
    });

    document.querySelector('#btnDelete')?.addEventListener('click', async () => {
      if (!confirm('Delete this event permanently?')) return;
      await store.deleteSpace();
      activeSpace = null;
      await renderDashboard();
    });
  }

  await renderDashboard();
  setInterval(renderDashboard, 60_000);
}

// ── PARTICIPANT ───────────────────────────────────────────────────────────────

async function renderParticipant(store) {
  const app = document.querySelector('#app');
  if (!spaceParameter) {
    app.innerHTML = '<p>No space ID in URL. Ask the organizer for the participant link.</p>';
    return;
  }

  app.innerHTML = '<p>Joining registry…</p>';
  try {
    await store.join(spaceParameter);
  } catch (error) {
    app.innerHTML = `<p style="color:red">Failed to join: ${esc(error.message)}</p>`;
    return;
  }

  const wishlist = await store.read('_wishlist.json');
  const items = wishlist?.items ?? [];

  app.innerHTML = `
    <h1>🎁 Gift Registry (Google Drive)</h1>
    <p>Signed in as: ${esc(store.userId)}</p>
    <h2>Pick a gift</h2>
    ${items.length === 0
    ? '<p>No items on the wish list yet. Check back later.</p>'
    : items.map((item) => `
          <label>
            <input type="radio" name="item" value="${esc(item)}"> ${esc(item)}
          </label><br>
        `).join('')}
    <button id="btnClaim">Claim item</button>
    <p id="status"></p>
  `;

  document.querySelector('#btnClaim')?.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="item"]:checked')?.value;
    if (!selected) return;
    await store.append({ item: selected }, { prefix: store.userId });
    document.querySelector('#status').textContent = `You claimed: ${selected}`;
  });
}

async function main() {
  const result = await GoogleDriveStore.init({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    mode,
  });
  if (!result) return; // redirecting to Google
  if (result.status === 'onboarding') {
    renderOnboardingGate(null, result);
    return;
  }
  const store = result;

  await (mode === 'participant' ? renderParticipant(store) : renderOrganizer(store));
}

try {
  await main();
} catch (error) {
  document.querySelector('#app').innerHTML = `<p style="color:red">Error: ${esc(error.message)}</p>`;
  // eslint-disable-next-line no-console
  console.error(error);
}
