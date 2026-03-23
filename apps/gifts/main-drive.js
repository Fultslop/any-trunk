// apps/gifts/main-drive.js
// Gift Registry backed by Google Drive.
// URL params:
//   ?mode=organizer            → organizer view (create/manage event)
//   ?mode=participant&space=X  → participant view (join + claim)

import { GoogleDriveStore } from '../../lib/google-drive-store.js'

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Register a Google OAuth app at console.cloud.google.com.
// Authorised redirect URI: this page's URL (e.g. http://localhost:5500/apps/gifts/gifts-drive.html)
// Enable the Google Drive API in the Cloud Console.
const CLIENT_ID = '<GOOGLE_CLIENT_ID>'
// ─────────────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const params     = new URLSearchParams(location.search)
const mode       = params.get('mode')
const spaceParam = params.get('space')

async function main() {
  const store = await GoogleDriveStore.init({ clientId: CLIENT_ID })
  if (!store) return  // redirecting to Google

  if (mode === 'participant') {
    await renderParticipant(store)
  } else {
    await renderOrganizer(store)
  }
}

// ── ORGANIZER ─────────────────────────────────────────────────────────────────

async function renderOrganizer(store) {
  const app     = document.getElementById('app')
  const recentSpaces = GoogleDriveStore.getRecentSpaces()
  let activeSpace    = spaceParam ?? recentSpaces[0] ?? null

  if (activeSpace) store._folderId = activeSpace

  async function renderDashboard() {
    const wishlist    = activeSpace ? await store.read('_wishlist.json') : null
    const participants = activeSpace ? await store.readAll() : []

    const claims = {}
    for (const { username, latest } of participants) {
      if (latest?.item) {
        if (!claims[latest.item]) claims[latest.item] = []
        claims[latest.item].push(username)
      }
    }

    const items     = wishlist?.items ?? []
    const joinUrl   = activeSpace
      ? `${location.origin}${location.pathname}?mode=participant&space=${activeSpace}`
      : null

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
            : participants.map(p =>
                `<p>${esc(p.username)}: ${esc(p.latest?.item ?? '—')}</p>`
              ).join('')}
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
    `

    document.getElementById('btnCreate')?.addEventListener('click', async () => {
      const name = document.getElementById('evtName').value.trim()
      const accessMode = document.querySelector('input[name="mode"]:checked').value
      if (!name) return
      activeSpace = await store.createSpace(name, { accessMode })
      await renderDashboard()
    })

    document.getElementById('btnSaveWishlist')?.addEventListener('click', async () => {
      const lines = document.getElementById('itemsInput').value.split('\n').map(s => s.trim()).filter(Boolean)
      await store.write('_wishlist.json', { items: lines })
      await renderDashboard()
    })

    document.getElementById('btnClose')?.addEventListener('click', async () => {
      await store.closeSubmissions()
      alert('Submissions closed.')
    })

    document.getElementById('btnDelete')?.addEventListener('click', async () => {
      if (!confirm('Delete this event permanently?')) return
      await store.deleteSpace()
      activeSpace = null
      await renderDashboard()
    })
  }

  await renderDashboard()
}

// ── PARTICIPANT ───────────────────────────────────────────────────────────────

async function renderParticipant(store) {
  const app = document.getElementById('app')
  if (!spaceParam) {
    app.innerHTML = `<p>No space ID in URL. Ask the organizer for the participant link.</p>`
    return
  }

  app.innerHTML = `<p>Joining registry…</p>`
  try {
    await store.join(spaceParam)
  } catch (e) {
    app.innerHTML = `<p style="color:red">Failed to join: ${esc(e.message)}</p>`
    return
  }

  const wishlist = await store.read('_wishlist.json')
  const items    = wishlist?.items ?? []

  app.innerHTML = `
    <h1>🎁 Gift Registry (Google Drive)</h1>
    <p>Signed in as: ${esc(store.userEmail)}</p>
    <h2>Pick a gift</h2>
    ${items.length === 0
      ? '<p>No items on the wish list yet. Check back later.</p>'
      : items.map((item, i) => `
          <label>
            <input type="radio" name="item" value="${esc(item)}"> ${esc(item)}
          </label><br>
        `).join('')}
    <button id="btnClaim">Claim item</button>
    <p id="status"></p>
  `

  document.getElementById('btnClaim')?.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="item"]:checked')?.value
    if (!selected) return
    await store.append({ item: selected }, { prefix: store.userEmail })
    document.getElementById('status').textContent = `You claimed: ${selected}`
  })
}

main().catch(e => {
  document.getElementById('app').innerHTML = `<p style="color:red">Error: ${esc(e.message)}</p>`
  console.error(e)
})
