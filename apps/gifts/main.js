import { WorkerGitHubStore } from '../../lib/github-store-worker.js'
import { renderOrganizer } from './organizer.js'
import { renderParticipant, renderOnboardingGate } from './participant.js'

// ── CONFIG ────────────────────────────────────────────────────────────────
// Deploy workers/anytrunk-worker/ to Cloudflare and paste the worker URL here.
// Register a GitHub OAuth App — put clientSecret in the Worker, not here.
const CLIENT_ID  = '<CLIENT_ID>'
const WORKER_URL = '<WORKER_URL>'
// ─────────────────────────────────────────────────────────────────────────

const params      = new URLSearchParams(location.search)
const mode        = params.get('mode')    // 'organizer' | 'participant'
const repoParam   = params.get('repo')
const inviteParam = params.get('invite')  // opaque invite code (not a PAT)

async function main() {
  if (mode === 'participant') {
    const hasCode = new URLSearchParams(location.search).has('code')
    if (!WorkerGitHubStore.hasToken() && !hasCode) {
      renderOnboardingGate(repoParam, { clientId: CLIENT_ID, workerUrl: WORKER_URL })
      return
    }
  }

  const store = await WorkerGitHubStore.init({
    clientId:     CLIENT_ID,
    workerUrl:    WORKER_URL,
    repoFullName: repoParam,
  })
  if (!store) return  // redirecting to GitHub

  if (mode === 'participant') {
    await renderParticipant(store, repoParam, inviteParam)
  } else {
    await renderOrganizer(store, repoParam)
  }
}

main().catch(e => {
  document.getElementById('app').innerHTML =
    `<p class="err">Startup error: ${e.message}</p>`
  console.error(e)
})
