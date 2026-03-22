import { GitHubStore } from '../../lib/github-store.js'
import { esc, setStatus } from './helpers.js'

export async function renderParticipant(store, repoParam, inviteParam) {
  const app = document.getElementById('app')

  if (!repoParam) {
    app.innerHTML = `<p>Invalid join link — missing <code>repo</code> parameter.</p>`
    return
  }

  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">
      <strong>${esc(repoParam)}</strong><br>
      Signed in as <strong>${esc(store.username)}</strong>
      &nbsp;·&nbsp; <span id="join-status">Joining...</span>
    </p>
    <div id="status"></div>
  `

  try {
    if (inviteParam) {
      await store.join(repoParam, inviteParam)
    } else {
      store._repoFullName = repoParam
    }
    document.getElementById('join-status').innerHTML = `<span class="badge">joined ✓</span>`
  } catch(e) {
    setStatus(`Join failed: ${e.message}`)
    return
  }

  app.insertAdjacentHTML('beforeend', `
    <hr>
    <div class="section">
      <strong>What are you bringing?</strong>
      <label>Dish
        <input id="dish-input" type="text" placeholder="e.g. tiramisu" />
      </label>
      <label>Note <span style="color:#999;font-size:0.8rem">(optional)</span>
        <input id="note-input" type="text" placeholder="e.g. contains nuts" />
      </label>
      <button id="submit-btn">Submit</button>
    </div>
    <hr>
    <div class="section">
      <strong>Your submissions</strong>
      <div id="history">Loading...</div>
    </div>
  `)

  document.getElementById('submit-btn').onclick = async () => {
    const btn = document.getElementById('submit-btn')
    const dish = document.getElementById('dish-input').value.trim()
    if (!dish) { setStatus('Dish name required'); return }
    const note = document.getElementById('note-input').value.trim()
    btn.disabled = true
    setStatus('Submitting...', false)
    try {
      await store.append({ dish, note: note || undefined }, { prefix: store.username })
      document.getElementById('dish-input').value = ''
      document.getElementById('note-input').value = ''
      setStatus('Submitted!', false)
      await renderHistory(store)
    } catch(e) {
      setStatus(e.message)
    } finally {
      btn.disabled = false
    }
  }

  await renderHistory(store)
}

export async function renderHistory(store) {
  const el = document.getElementById('history')
  if (!el) return
  try {
    const files = await store.list(store.username)
    if (!files.length) {
      el.innerHTML = '<p style="color:#888">No submissions yet.</p>'
      return
    }
    const entries = await Promise.all(
      files.map(async f => ({ path: f.path, data: await store.read(f.path) }))
    )
    const latestPath = entries[entries.length - 1].path
    el.innerHTML = `<table>
      <thead><tr><th>Time</th><th>Dish</th><th>Note</th><th></th></tr></thead>
      <tbody>
        ${entries.map(e => {
          const time = new Date((e.path.split('/').pop() ?? '').replace('.json','')
            .replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'))
            .toLocaleTimeString()
          const isCurrent = e.path === latestPath
          return `<tr${isCurrent ? ' style="font-weight:bold"' : ''}>
            <td>${time}</td>
            <td>${esc(e.data?.dish ?? '—')}</td>
            <td>${esc(e.data?.note ?? '')}</td>
            <td>${isCurrent ? '← current' : ''}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
  } catch(e) {
    el.innerHTML = `<p class="err">Could not load history: ${e.message}</p>`
  }
}

export function renderOnboardingGate(repoParam, { clientId, clientSecret, corsProxy } = {}) {
  const app = document.getElementById('app')
  app.innerHTML = `
    <h1>Potluck</h1>
    <p class="sub">You've been invited to a Potluck event.</p>
    <div class="section">
      <strong>Do you have a GitHub account?</strong>
      <p style="font-size:0.9rem;color:#555;margin-top:0.5rem">
        This app uses GitHub to store event data. You'll need an account to participate.
      </p>
      <button id="yes-btn" style="margin-right:0.5rem">Yes, sign in with GitHub</button>
      <button id="no-btn">No, create a free account</button>
    </div>
    <div id="onboarding-hint" style="display:none;margin-top:1rem"></div>
  `

  document.getElementById('yes-btn').onclick = () => {
    GitHubStore.init({
      clientId,
      clientSecret,
      corsProxy,
      repoFullName: repoParam,
    })
  }

  document.getElementById('no-btn').onclick = () => {
    const hint = document.getElementById('onboarding-hint')
    hint.style.display = 'block'
    hint.innerHTML = `
      <p>${esc(GitHubStore.onboardingHint())}</p>
      <a href="${esc(GitHubStore.onboardingUrl())}" target="_blank">
        Create a free GitHub account →
      </a>
      <p style="font-size:0.85rem;color:#555;margin-top:0.75rem">
        Once you have an account, return to this page and click "Yes, sign in with GitHub".
      </p>
    `
  }
}
