// lib/github-store.js
import { BaseStore } from './base-store.js'

export class GitHubStore extends BaseStore {
  static _storageKey = 'gh'

  constructor({ clientId, clientSecret, token = null, repoFullName = null, _username = null, corsProxy = 'https://cors-anywhere.herokuapp.com' } = {}) {
    super()
    this._clientId     = clientId
    this._clientSecret = clientSecret
    this._token        = token
    this._spaceId      = repoFullName   // internal field renamed; constructor param unchanged
    this._username     = _username
    this._corsProxy    = corsProxy
    this._readOnly     = false
  }

  get isAuthenticated() { return !!this._token }
  get userId() { return this._username }

  static beginAuth({ clientId, clientSecret, corsProxy = 'https://cors-anywhere.herokuapp.com' } = {}) {
    const state = crypto.randomUUID()
    sessionStorage.setItem('gh:auth', JSON.stringify({ clientId, clientSecret, state, corsProxy }))
    sessionStorage.setItem('gh:returnUrl', location.href)
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('scope', 'repo,delete_repo')
    url.searchParams.set('state', state)
    location.href = url.toString()
  }

  static async completeAuth() {
    const stored = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}')
    const params = new URLSearchParams(location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    if (!code) throw new Error('No code in URL')
    if (state !== stored.state) throw new Error('State mismatch — possible CSRF')

    const corsProxy = stored.corsProxy ?? 'https://cors-anywhere.herokuapp.com'
    const resp = await fetch(
      `${corsProxy}/https://github.com/login/oauth/access_token`,
        {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: stored.clientId,
          client_secret: stored.clientSecret,
          code,
        }),
      }
    )
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

    return new GitHubStore({ clientId: stored.clientId, clientSecret: stored.clientSecret,
                             token: access_token, _username: login, corsProxy })
  }

  async _apiCall(method, path, body = undefined) {
    if (this._readOnly && method !== 'GET') {
      throw new Error('This store is read-only. initReadOnly() does not support write operations.')
    }
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`
    const opts = {
      method,
      headers: {
        ...(this._token ? { Authorization: `Bearer ${this._token}` } : {}),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const resp = await fetch(url, opts)
    if (!resp.ok && resp.status !== 404) {
      const err = await resp.text()
      throw new Error(`GitHub API ${method} ${path} → ${resp.status}: ${err}`)
    }
    // Returns raw Response. On 404, resp.ok is false but no throw — callers must check resp.ok.
    return resp
  }

  async _writeFile(path, data, sha) {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
    const action = (sha !== null && sha !== undefined) ? 'update' : 'create'
    const body = { message: `${action} ${path}`, content }
    if (sha !== null && sha !== undefined) body.sha = sha
    return this._apiCall('PUT', `/repos/${this._spaceId}/contents/${path}`, body)
  }

  async addCollaborator(username) {
    await this._apiCall('PUT', `/repos/${this._spaceId}/collaborators/${username}`)
  }

  async join(repoFullName, inviteToken) {
    if (this._readOnly) throw new Error('This store is read-only. initReadOnly() does not support write operations.')
    this._spaceId = repoFullName
    const [owner, repo] = repoFullName.split('/')

    // Step 1: Add collaborator using organizer's invite token (NOT this._token)
    const addResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/collaborators/${this._username}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${inviteToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permission: 'push' }),
      }
    )

    // Empty body = user is already a collaborator — nothing more to do.
    // Non-empty body = invitation just created — must auto-accept.
    // Do NOT check status code alone: GitHub returns 204 in both cases.
    const text = await addResp.text()
    if (!addResp.ok) {
      throw new Error(`Failed to add collaborator: HTTP ${addResp.status}: ${text}`)
    }
    if (!text || !text.trim()) {
      this.constructor.saveRecentSpace(repoFullName)
      return
    }

    // Step 2: Auto-accept using participant's own token
    await this._autoAcceptInvitation(repoFullName)
    this.constructor.saveRecentSpace(repoFullName)
  }

  async _autoAcceptInvitation(repoFullName) {
    const invResp = await fetch('https://api.github.com/user/repository_invitations', {
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!invResp.ok) throw new Error(`Failed to list invitations: HTTP ${invResp.status}`)
    const list = await invResp.json()
    const invite = list.find(i => i.repository.full_name === repoFullName)
    if (!invite) return  // already a collaborator or invitation already accepted — nothing to do

    const acceptResp = await fetch(
      `https://api.github.com/user/repository_invitations/${invite.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this._token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )
    if (!acceptResp.ok) throw new Error(`Failed to accept invitation: HTTP ${acceptResp.status}`)
  }

  async write(path, data) {
    const getResp = await this._apiCall('GET', `/repos/${this._spaceId}/contents/${path}`)
    const sha = getResp.ok ? (await getResp.json()).sha : null
    await this._writeFile(path, data, sha)
  }

  async closeSubmissions() {
    const current = await this.read('_event.json')
    await this.write('_event.json', { ...(current ?? {}), closed: true })
  }

  async archiveSpace() {
    await this._apiCall('PATCH', `/repos/${this._spaceId}`, { archived: true })
  }

  async deleteSpace() {
    if (this._readOnly) throw new Error('This store is read-only. initReadOnly() does not support write operations.')
    const resp = await fetch(`https://api.github.com/repos/${this._spaceId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (resp.status === 403) {
      throw new Error("Cannot delete repo: your OAuth token is missing the 'delete_repo' scope. Re-authorise the app to grant this permission.")
    }
    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`GitHub API DELETE /repos/${this._spaceId} → ${resp.status}: ${err}`)
    }
  }

  async append(data, { prefix }) {
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const path = `${prefix}/${timestamp}.json`
    await this._writeFile(path, data, null)
  }

  async read(path) {
    const resp = await this._apiCall('GET', `/repos/${this._spaceId}/contents/${path}`)
    if (!resp.ok) return null
    const { content } = await resp.json()
    return JSON.parse(decodeURIComponent(escape(atob(content.replace(/\n/g, '')))))
  }

  async list(prefix) {
    const resp = await this._apiCall('GET', `/repos/${this._spaceId}/contents/${prefix}`)
    if (!resp.ok) return []
    const items = await resp.json()
    return items
      .filter(i => i.type === 'file')
      .map(i => ({ path: i.path, sha: i.sha }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  async readAll() {
    const rootResp = await this._apiCall('GET', `/repos/${this._spaceId}/contents/`)
    if (!rootResp.ok) return []
    const root = await rootResp.json()

    const participantDirs = root.filter(
      i => i.type === 'dir' && !i.name.startsWith('_')
    )

    const results = await Promise.all(participantDirs.map(async dir => {
      const files = await this.list(dir.name)
      const entries = await Promise.all(
        files.map(async f => ({ path: f.path, data: await this.read(f.path) }))
      )
      return {
        username: dir.name,
        entries,
        latest: entries.length > 0 ? entries[entries.length - 1].data : null,
      }
    }))
    return results.sort((a, b) => a.username.localeCompare(b.username))
  }

  async createSpace(name, { private: isPrivate = true } = {}) {
    let repoResp
    try {
      repoResp = await this._apiCall('POST', '/user/repos', {
        name, private: isPrivate, auto_init: false,
      })
    } catch (e) {
      if (e.message.includes('→ 422:')) {
        throw new Error(`An event named '${name}' already exists in your account. Try '${name}-2' or choose a different name.`)
      }
      throw e
    }
    const { full_name, owner } = await repoResp.json()
    this._spaceId = full_name
    const event = { name, created: new Date().toISOString(), owner: owner.login }
    await this._writeFile('_event.json', event, null)
    this.constructor.saveRecentSpace(full_name)
    return full_name
  }

  static async init({ clientId, clientSecret, corsProxy, repoFullName = null, inviteToken = null, mode = null } = {}) {
    const params        = new URLSearchParams(location.search)
    const code          = params.get('code')
    const existingToken = sessionStorage.getItem('gh:token')

    if (code) {
      await GitHubStore.completeAuth()
      const returnUrl = sessionStorage.getItem('gh:returnUrl')
      sessionStorage.removeItem('gh:returnUrl')
      location.href = returnUrl ?? location.href.split('?')[0]
      return null
    }

    if (existingToken) {
      const username = sessionStorage.getItem('gh:username')
      const storedCorsProxy = JSON.parse(sessionStorage.getItem('gh:auth') ?? '{}').corsProxy
        ?? 'https://cors-anywhere.herokuapp.com'
      return new GitHubStore({ clientId, clientSecret, corsProxy: storedCorsProxy, token: existingToken, repoFullName, _username: username })
    }

    if (mode === 'participant') {
      return {
        status: 'onboarding',
        url:    GitHubStore.getOnboardingUrl(),
        hint:   GitHubStore.getOnboardingHint(),
        signIn: () => GitHubStore.beginAuth({ clientId, clientSecret, corsProxy }),
      }
    }

    GitHubStore.beginAuth({ clientId, clientSecret, corsProxy })
    return null
  }

  static async initReadOnly({ repoFullName }) {
    const store = new GitHubStore({ repoFullName })
    store._readOnly = true
    const resp = await store._apiCall('GET', `/repos/${repoFullName}/contents/`)
    if (!resp.ok) {
      throw new Error('Repo not found or is private. Use GitHubStore.init() to access private repos.')
    }
    return store
  }

  static getOnboardingUrl()  { return 'https://github.com/signup' }
  static getOnboardingHint() { return 'You need a GitHub account' }

  getCapabilities() {
    return {
      createSpace: true, join: true, append: true,
      read: true, readAll: true, write: true,
      addCollaborator: true, closeSubmissions: true,
      archiveSpace: true, deleteSpace: true,
      binaryData: true,
    }
  }
}
