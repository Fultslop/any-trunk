import { GitHubStore } from '../../lib/github-store.js'
import { esc, setStatus, startPolling } from './helpers.js'

export async function renderOrganizer(store, repoParam) {
  const app = document.getElementById('app')

  if (store._repoFullName) {
    await renderOrganizerDashboard(store, repoParam)
    return
  }

  const recent = GitHubStore.getRecentSpaces()
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

  app.innerHTML = `
    <h1>Potluck Organizer</h1>
    <p class="sub">
      Signed in as <strong>${esc(store.username)}</strong> &nbsp;·&nbsp;
      <strong>${esc(store._repoFullName)}</strong>
    </p>

    <div class="section">
  <strong>Share join link</strong>
  <p style="font-size:0.9rem;color:#555;margin-top:0.5rem">
    Create an invite token on GitHub so participants can join:
  </p>
  <ol style="font-size:0.9rem;line-height:2.4">
    <li>
      <a id="pat-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank">
        → Open GitHub token page
      </a>
    </li>
    <li>
      Token name: <code id="pat-name-hint"></code>
      <button id="copy-name-btn" style="font-size:0.8rem;padding:0.2rem 0.5rem;margin-left:0.4rem">Copy</button>
    </li>
    <li>Expiration: <strong>7 days</strong></li>
    <li>Repository access: <em>Only select repositories</em> → <code id="repo-name-hint"></code></li>
    <li>Permissions: <em>Repository permissions → Administration → Read and write</em></li>
    <li>
      Generate token, then paste here:
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.25rem">
        <input id="pat-input" type="text" placeholder="github_pat_..." style="flex:1" />
        <button id="validate-btn">Validate</button>
      </div>
      <span id="validate-status" style="font-size:0.85rem;margin-top:0.25rem;display:block"></span>
    </li>
  </ol>
  <div id="invite-link-section" style="display:none;margin-top:1rem">
    <button id="copy-btn">Copy join link</button>
    <span id="link-preview" style="font-size:0.8rem;color:#666;margin-left:0.5rem"></span>
    <p style="font-size:0.8rem;color:#c00;margin-top:0.5rem">
      ⚠ Set this token to expire in 7 days — revoke it from GitHub Settings when the event is over.
    </p>
  </div>
</div>

    <hr>

    <div class="section">
      <strong>Responses</strong>
      <span style="font-size:0.8rem;color:#888"> (refreshes every 30s)</span>
      <div id="responses-table">Loading...</div>
    </div>
    <div id="status"></div>
    <hr>
    <div class="section">
      <strong>Event lifecycle</strong>
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap">
        <button id="close-btn">Close submissions</button>
        <button id="lock-btn" style="display:none">Lock event</button>
        <button id="delete-btn" style="display:none">Delete event</button>
      </div>
      <div id="delete-confirm" style="display:none;margin-top:0.75rem">
        <label style="font-size:0.9rem">
          Type <strong id="delete-repo-hint"></strong> to confirm permanent deletion:
          <input id="delete-name-input" type="text" style="width:100%;margin-top:0.25rem" />
        </label>
        <button id="delete-confirm-btn" style="margin-top:0.5rem;background:#c00;color:#fff;border:none;padding:0.4rem 1rem;border-radius:4px;cursor:pointer" disabled>
          Permanently delete
        </button>
        <button id="delete-cancel-btn" style="margin-top:0.5rem;margin-left:0.5rem">Cancel</button>
      </div>
    </div>
  `

  const repoName         = store._repoFullName?.split('/')[1] ?? ''
  const suggestedName    = `${repoName}-invite`
  const joinBase         = `${location.origin}${location.pathname}?mode=participant&repo=${store._repoFullName}`
  const patInput         = document.getElementById('pat-input')
  const validateBtn      = document.getElementById('validate-btn')
  const validateStatus   = document.getElementById('validate-status')
  const inviteSection    = document.getElementById('invite-link-section')
  const copyBtn          = document.getElementById('copy-btn')
  const preview          = document.getElementById('link-preview')

  document.getElementById('pat-name-hint').textContent = suggestedName
  document.getElementById('repo-name-hint').textContent = store._repoFullName ?? ''
  document.getElementById('copy-name-btn').onclick = () => {
    navigator.clipboard.writeText(suggestedName)
    document.getElementById('copy-name-btn').textContent = 'Copied!'
    setTimeout(() => { document.getElementById('copy-name-btn').textContent = 'Copy' }, 2000)
  }

  validateBtn.onclick = async () => {
    const token = patInput.value.trim()
    if (!token) { validateStatus.textContent = 'Paste a token first.'; return }
    validateBtn.disabled = true
    validateStatus.textContent = 'Validating...'
    validateStatus.className = ''
    try {
      const resp = await fetch(`https://api.github.com/repos/${store._repoFullName}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
      })
      if (resp.status === 401) {
        validateStatus.textContent = 'Token is invalid or expired — re-generate it at step 1.'
        validateStatus.className = 'err'
        inviteSection.style.display = 'none'
      } else if (!resp.ok) {
        validateStatus.textContent = 'Token cannot access this repo — check steps 4 and 5.'
        validateStatus.className = 'err'
        inviteSection.style.display = 'none'
      } else {
        const data = await resp.json()
        if (!data.permissions?.admin) {
          validateStatus.textContent = 'Token cannot access this repo — check steps 4 and 5.'
          validateStatus.className = 'err'
          inviteSection.style.display = 'none'
        } else {
          validateStatus.textContent = 'Token valid ✓'
          validateStatus.className = 'ok'
          inviteSection.style.display = 'block'
          const full = `${joinBase}&invite=${token}`
          preview.textContent = full.length > 70 ? full.slice(0, 70) + '…' : full
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(full)
            copyBtn.textContent = 'Copied!'
            setTimeout(() => { copyBtn.textContent = 'Copy join link' }, 2000)
          }
        }
      }
    } catch(e) {
      validateStatus.textContent = `Validation error: ${esc(e.message)}`
      validateStatus.className = 'err'
    } finally {
      validateBtn.disabled = false
    }
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
  startPolling(refreshTable, 30_000)

  const closeBtn         = document.getElementById('close-btn')
  const lockBtn          = document.getElementById('lock-btn')
  const deleteBtn        = document.getElementById('delete-btn')
  const deleteConfirm    = document.getElementById('delete-confirm')
  const deleteRepoHint   = document.getElementById('delete-repo-hint')
  const deleteNameInput  = document.getElementById('delete-name-input')
  const deleteConfirmBtn = document.getElementById('delete-confirm-btn')
  const deleteCancelBtn  = document.getElementById('delete-cancel-btn')
  const repoShortName    = store._repoFullName?.split('/')[1] ?? store._repoFullName

  closeBtn.onclick = async () => {
    closeBtn.disabled = true
    setStatus('Closing submissions...', false)
    try {
      await store.closeSubmissions()
      closeBtn.textContent = 'Submissions closed ✓'
      setStatus('', false)
      lockBtn.style.display = 'inline'
    } catch(e) {
      setStatus(e.message)
      closeBtn.disabled = false
    }
  }

  lockBtn.onclick = async () => {
    if (!confirm('This will archive the event on GitHub, making it permanently read-only. You will not be able to reopen submissions. Continue?')) return
    lockBtn.disabled = true
    setStatus('Locking event...', false)
    try {
      await store.archiveSpace()
      lockBtn.textContent = 'Event locked ✓'
      setStatus('', false)
      deleteBtn.style.display = 'inline'
    } catch(e) {
      setStatus(e.message)
      lockBtn.disabled = false
    }
  }

  deleteBtn.onclick = () => {
    deleteRepoHint.textContent = repoShortName
    deleteConfirm.style.display = 'block'
    deleteBtn.style.display = 'none'
  }

  deleteCancelBtn.onclick = () => {
    deleteConfirm.style.display = 'none'
    deleteBtn.style.display = 'inline'
    deleteNameInput.value = ''
    deleteConfirmBtn.disabled = true
  }

  deleteNameInput.addEventListener('input', () => {
    deleteConfirmBtn.disabled = deleteNameInput.value.trim() !== repoShortName
  })

  deleteConfirmBtn.onclick = async () => {
    deleteConfirmBtn.disabled = true
    setStatus('Deleting event...', false)
    try {
      await store.deleteSpace()
      const key = 'gh:recentSpaces'
      const repos = JSON.parse(localStorage.getItem(key) ?? '[]')
      localStorage.setItem(key, JSON.stringify(repos.filter(r => r !== store._repoFullName)))
      location.href = `${location.pathname}?mode=organizer`
    } catch(e) {
      setStatus(e.message)
      deleteNameInput.value = ''
      deleteConfirmBtn.disabled = true
      deleteConfirm.style.display = 'none'
      deleteBtn.style.display = 'inline'
    }
  }
}
