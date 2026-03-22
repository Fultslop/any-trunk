import { GitHubStore } from '../../lib/github-store.js'
import { renderOrganizer } from './organizer.js'
import { renderParticipant, renderOnboardingGate } from './participant.js'
import { renderObserver } from './observer.js'

// ── CONFIG ────────────────────────────────────────────────────────────────
// Register a GitHub OAuth App at github.com/settings/developers
// Callback URL must match the URL where this file is served.
// Note these are just placeholders, this client does not exist
const CLIENT_ID     = '<CLIENT_ID>'
// ⚠ exposed in client — see D1 in design spec
const CLIENT_SECRET = '<CLIENT_SECRET>'  
// Local dev: run `npm run proxy` then set to 'http://localhost:8080'
// Production: deploy a Cloudflare Worker (see D2 in design spec)
const CORS_PROXY    = 'http://localhost:8080'
// ─────────────────────────────────────────────────────────────────────────

const params      = new URLSearchParams(location.search)
const mode        = params.get('mode')     // 'organizer' | 'participant' | 'observer'
const repoParam   = params.get('repo')
const inviteParam = params.get('invite')

async function main() {
  if (mode === 'observer') {
    await renderObserver(repoParam)
    return
  }

  // Participant gate: check auth state before triggering OAuth redirect
  if (mode === 'participant') {
    const hasCode = new URLSearchParams(location.search).has('code')
    if (!GitHubStore.hasToken() && !hasCode) {
      renderOnboardingGate(repoParam, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, corsProxy: CORS_PROXY })
      return
    }
  }

  const store = await GitHubStore.init({
    clientId:     CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    corsProxy:    CORS_PROXY,
    repoFullName: repoParam,
    inviteToken:  inviteParam,
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
