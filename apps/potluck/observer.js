import { GitHubStore } from '../../lib/github-store.js'
import { esc } from './helpers.js'

export async function renderObserver(repoParam) {
  const app = document.getElementById('app')
  if (!repoParam) {
    app.innerHTML = `<p>Invalid observer link — missing <code>repo</code> parameter.</p>`
    return
  }
  let store
  try {
    store = await GitHubStore.initReadOnly({ repoFullName: repoParam })
  } catch (e) {
    if (e.message.includes('not found or is private')) {
      app.innerHTML = `<p>This event is private. You need an invitation to participate.</p>`
    } else {
      app.innerHTML = `<p class="err">Could not load event: ${esc(e.message)}</p>`
    }
    return
  }

  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">
      <strong>${esc(repoParam)}</strong> &nbsp;·&nbsp;
      <span style="color:#888">Read-only view</span>
      <span style="font-size:0.8rem;color:#888"> (refreshes every 30s)</span>
    </p>
    <div id="closed-banner" style="display:none">
      <p style="background:#fff3cd;padding:0.6rem;border-radius:4px;margin-top:1rem">
        Submissions are closed. No new entries are being accepted.
      </p>
    </div>
    <div id="responses-table">Loading...</div>
  `

  async function refreshObserver() {
    const el = document.getElementById('responses-table')
    if (!el) return
    try {
      const eventMeta = await store.read('_event.json')
      const closedBanner = document.getElementById('closed-banner')
      if (closedBanner) closedBanner.style.display = eventMeta?.closed ? 'block' : 'none'
      const participants = await store.readAll()
      if (!participants.length) {
        el.innerHTML = '<p style="color:#888;margin-top:0.5rem">No responses yet.</p>'
        return
      }
      el.innerHTML = `<table>
        <thead><tr><th>Participant</th><th>Dish</th><th>Note</th><th>Time</th></tr></thead>
        <tbody>
          ${participants.map(p => {
            const last = p.entries[p.entries.length - 1]
            const time = last
              ? new Date((last.path.split('/').pop() ?? '').replace('.json','')
                  .replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'))
                .toLocaleTimeString()
              : '—'
            return `<tr>
              <td>${esc(p.username)}</td>
              <td>${esc(p.latest?.dish ?? '—')}</td>
              <td>${esc(p.latest?.note ?? '')}</td>
              <td>${time}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>`
    } catch(e) {
      const el2 = document.getElementById('responses-table')
      if (el2) el2.innerHTML = `<p class="err">Error: ${esc(e.message)}</p>`
    }
  }

  await refreshObserver()
  setInterval(refreshObserver, 30_000)
}
