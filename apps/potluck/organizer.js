import { GitHubStore } from '../../lib/github-store.js'
import { esc, setStatus } from './helpers.js'

export async function renderOrganizer(store, repoParam) {
  const app = document.getElementById('app')

  if (store._repoFullName) {
    await renderOrganizerDashboard(store, repoParam)
    return
  }

  const recent = GitHubStore.getRecentRepos()
  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">Signed in as <strong>${esc(store.username)}</strong></p>

    <div class="section">
      <strong>Create new event</strong>
      <label>Event name
        <input id="event-name" type="text"
          value="potluck-${new Date().toISOString().slice(0,10)}" />
      </label>
      <button id="create-btn">Create</button>
    </div>

    ${recent.length ? `
    <hr>
    <div class="section">
      <strong>Resume recent event</strong>
      <ul style="margin:0.5rem 0;padding-left:1.2rem">
        ${recent.map(r => `<li><a href="?mode=organizer&repo=${encodeURIComponent(r)}">${esc(r)}</a></li>`).join('')}
      </ul>
    </div>` : ''}
    <div id="status"></div>
  `

  document.getElementById('create-btn').onclick = async () => {
    const name = document.getElementById('event-name').value.trim()
    if (!name) { setStatus('Event name required'); return }
    setStatus('Creating...', false)
    try {
      await store.createSpace(name)
      await renderOrganizerDashboard(store, repoParam)
    } catch(e) { setStatus(e.message) }
  }
}

export async function renderOrganizerDashboard(store, repoParam) {
  const app = document.getElementById('app')
  const patUrl = `https://github.com/settings/personal-access-tokens/new`
    + `?description=potluck-invite-${encodeURIComponent(store._repoFullName?.split('/')[1] ?? '')}`
  const joinBase = `${location.origin}${location.pathname}`
    + `?mode=participant&repo=${store._repoFullName}`

  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">
      Signed in as <strong>${esc(store.username)}</strong> &nbsp;·&nbsp;
      <strong>${esc(store._repoFullName)}</strong>
    </p>

    <div class="section">
      <strong>Share join link</strong>
      <ol style="font-size:0.9rem;line-height:2">
        <li>Create an invite token:
          <a href="${patUrl}" target="_blank">→ GitHub PAT (administration:write, this repo only)</a>
        </li>
        <li>Paste it here:
          <input id="pat-input" type="text" placeholder="ghp_..." style="display:inline;width:260px" />
        </li>
        <li>
          <button id="copy-btn" disabled>Copy join link</button>
          <span id="link-preview" style="font-size:0.8rem;color:#666;margin-left:0.5rem"></span>
        </li>
      </ol>
      <p style="font-size:0.8rem;color:#c00;margin-top:0.5rem">
        ⚠ This link contains a secret token. Anyone with it can join the event.
        Revoke the token at GitHub after the signup window closes.
      </p>
    </div>

    <hr>

    <div class="section">
      <strong>Responses</strong>
      <span style="font-size:0.8rem;color:#888"> (refreshes every 30s)</span>
      <div id="responses-table">Loading...</div>
    </div>
    <div id="status"></div>
  `

  const patInput = document.getElementById('pat-input')
  const copyBtn  = document.getElementById('copy-btn')
  const preview  = document.getElementById('link-preview')

  patInput.addEventListener('input', () => {
    const val = patInput.value.trim()
    copyBtn.disabled = !val
    const full = `${joinBase}&invite=${val}`
    preview.textContent = val ? (full.length > 70 ? full.slice(0, 70) + '…' : full) : ''
  })

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(`${joinBase}&invite=${patInput.value.trim()}`)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => { copyBtn.textContent = 'Copy join link' }, 2000)
  }

  async function refreshTable() {
    const el = document.getElementById('responses-table')
    if (!el) return
    try {
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
      if (el2) el2.innerHTML = `<p class="err">Error: ${e.message}</p>`
    }
  }

  await refreshTable()
  setInterval(refreshTable, 30_000)
}
