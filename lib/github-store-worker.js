// lib/github-store-worker.js
import { GitHubStore } from './github-store.js'

export class WorkerGitHubStore extends GitHubStore {
  constructor({ clientId, workerUrl, token = null, repoFullName = null, _username = null } = {}) {
    super({ clientId, token, repoFullName, _username })
    this._workerUrl = workerUrl
  }

  // Signature change: workerUrl replaces clientSecret
  // Note: requests 'repo' scope only (not 'delete_repo'). deleteSpace() is inherited
  // from the base class but is out of scope for the gifts app and would fail at runtime
  // with a 403 if called. This is intentional — see "Out of Scope" in the design spec.
  static beginAuth(clientId, workerUrl) {
    const state = crypto.randomUUID()
    sessionStorage.setItem('gh:auth', JSON.stringify({ clientId, workerUrl, state }))
    sessionStorage.setItem('gh:returnUrl', location.href)
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('scope', 'repo')
    url.searchParams.set('state', state)
    location.href = url.toString()
  }

  // Calls workerUrl/oauth/token instead of cors-anywhere
  static async completeAuth() {
    const stored = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}')
    const params = new URLSearchParams(location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    if (!code) throw new Error('No code in URL')
    if (state !== stored.state) throw new Error('State mismatch — possible CSRF')

    const resp = await fetch(`${stored.workerUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status}`)
    const { access_token } = await resp.json()
    if (!access_token) throw new Error('Token exchange failed: no access_token in response')
    sessionStorage.setItem('gh:token', access_token)

    const userResp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` }
    })
    if (!userResp.ok) throw new Error(`Failed to fetch user: HTTP ${userResp.status}`)
    const { login } = await userResp.json()
    if (!login) throw new Error('Failed to fetch user: no login in response')
    sessionStorage.setItem('gh:username', login)

    return new WorkerGitHubStore({
      clientId: stored.clientId, workerUrl: stored.workerUrl,
      token: access_token, _username: login,
    })
  }

  static async init({ clientId, workerUrl, repoFullName = null, mode = null } = {}) {
    const params           = new URLSearchParams(location.search)
    const code             = params.get('code')
    const existingToken    = sessionStorage.getItem('gh:token')
    const existingUsername = sessionStorage.getItem('gh:username')

    if (code) {
      await WorkerGitHubStore.completeAuth()
      const returnUrl = sessionStorage.getItem('gh:returnUrl')
      sessionStorage.removeItem('gh:returnUrl')
      location.href = returnUrl ?? location.href.split('?')[0]
      return null
    }

    if (existingToken) {
      const storedWorkerUrl = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}').workerUrl ?? workerUrl
      return new WorkerGitHubStore({
        clientId, workerUrl: storedWorkerUrl,
        token: existingToken, repoFullName,
        _username: existingUsername,
      })
    }

    if (mode === 'participant') {
      return {
        status: 'onboarding',
        url:    WorkerGitHubStore.getOnboardingUrl(),
        hint:   WorkerGitHubStore.getOnboardingHint(),
        signIn: () => WorkerGitHubStore.beginAuth(clientId, workerUrl),
      }
    }

    WorkerGitHubStore.beginAuth(clientId, workerUrl)
    return null
  }

  // Calls Worker /spaces/register; stores inviteCode in localStorage
  async register() {
    const resp = await fetch(`${this._workerUrl}/spaces/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: this._spaceId, token: this._token }),
    })
    if (!resp.ok) throw new Error(`register failed: HTTP ${resp.status}`)
    const { inviteCode } = await resp.json()
    localStorage.setItem(`gifts:${encodeURIComponent(this._spaceId)}:inviteCode`, inviteCode)
    return inviteCode
  }

  static getInviteCode(repoFullName) {
    return localStorage.getItem(`gifts:${encodeURIComponent(repoFullName)}:inviteCode`)
  }

  getCapabilities() {
    return {
      createSpace: true, join: true, append: true,
      read: true, readAll: true, write: true,
      addCollaborator: true, closeSubmissions: true,
      archiveSpace: true, deleteSpace: true,
      binaryData: true,
    }
  }

  // Calls Worker /spaces/invite; then unconditionally calls _autoAcceptInvitation
  async join(repoFullName, inviteCode) {
    this._spaceId = repoFullName

    const resp = await fetch(`${this._workerUrl}/spaces/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoFullName, username: this._username, inviteCode }),
    })
    if (!resp.ok) throw new Error(`join failed: HTTP ${resp.status}`)

    // Always attempt auto-accept — _autoAcceptInvitation returns silently if
    // no pending invitation exists (already-a-collaborator case)
    await this._autoAcceptInvitation(repoFullName)
    this.constructor.saveRecentSpace(repoFullName)
  }
}
