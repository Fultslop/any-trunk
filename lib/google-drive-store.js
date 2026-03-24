// lib/google-drive-store.js
import { BaseStore } from './base-store.js'

export class GoogleDriveStore extends BaseStore {
  static _storageKey = 'gd'

  constructor({ clientId, token, userEmail = null, _folderId = null } = {}) {
    super()
    this._clientId           = clientId
    this._token              = token
    this._userEmail          = userEmail
    this._spaceId            = _folderId   // constructor param name retained; internal field renamed
    this._subfolderIdCache   = {}
  }

  get isAuthenticated() { return !!this._token }
  get userEmail()       { return this._userEmail }
  get userId()          { return this._userEmail }

  // ── setSpace override — persist to sessionStorage ─────────────────────────
  setSpace(id) {
    super.setSpace(id)
    if (id) sessionStorage.setItem('gd:folderId', id)
    else    sessionStorage.removeItem('gd:folderId')
  }

  // ── PKCE helper ────────────────────────────────────────────────────────────
  static async _pkce() {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const verifier = btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const data      = new TextEncoder().encode(verifier)
    const digest    = await crypto.subtle.digest('SHA-256', data)
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    return { verifier, challenge }
  }

  // ── beginAuth ──────────────────────────────────────────────────────────────
  static async beginAuth({ clientId, clientSecret }) {
    const { verifier, challenge } = await GoogleDriveStore._pkce()
    const state       = crypto.randomUUID()
    const _loc        = new URL(location.href)
    const redirectUri = _loc.origin + _loc.pathname
    sessionStorage.setItem('gd:auth', JSON.stringify({ clientId, clientSecret, state, codeVerifier: verifier, redirectUri }))
    sessionStorage.setItem('gd:returnUrl', location.href)

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive email')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('access_type', 'offline')
    location.href = url.toString()
  }

  // ── completeAuth ───────────────────────────────────────────────────────────
  static async completeAuth() {
    const raw = sessionStorage.getItem('gd:auth')
    if (!raw) throw new Error('Auth session not found — beginAuth was not called or sessionStorage was cleared')
    const stored = JSON.parse(raw)

    const params = new URLSearchParams(location.search)
    const code   = params.get('code')
    const state  = params.get('state')
    if (state !== stored.state) throw new Error('State mismatch — possible CSRF')

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     stored.clientId,
        client_secret: stored.clientSecret,
        code,
        redirect_uri:  stored.redirectUri,
        grant_type:    'authorization_code',
        code_verifier: stored.codeVerifier,
      }),
    })
    if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status} — ${await resp.text()}`)
    const { access_token, refresh_token } = await resp.json()
    if (!access_token) throw new Error('Token exchange failed: no access_token in response')

    sessionStorage.setItem('gd:token', access_token)
    if (refresh_token) sessionStorage.setItem('gd:refreshToken', refresh_token)

    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!userResp.ok) throw new Error(`Failed to fetch user: HTTP ${userResp.status}`)
    const { email, name } = await userResp.json()
    sessionStorage.setItem('gd:user', JSON.stringify({ email, name }))

    sessionStorage.removeItem('gd:auth')
    // Note: gd:returnUrl is left for init() to consume
    return new GoogleDriveStore({ clientId: stored.clientId, token: access_token, userEmail: email })
  }

  // ── init() ─────────────────────────────────────────────────────────────────
  static async init({ clientId, clientSecret, mode = null } = {}) {
    const params = new URLSearchParams(location.search)
    const code   = params.get('code')

    if (code) {
      // Branch 1: returning from Google OAuth
      await GoogleDriveStore.completeAuth()
      const returnUrl = sessionStorage.getItem('gd:returnUrl')
      sessionStorage.removeItem('gd:returnUrl')
      // returnUrl null = direct callback navigation; strip ?code= as fallback
      location.href = returnUrl ?? location.href.split('?')[0]
      return null
    }

    const existingToken = sessionStorage.getItem('gd:token')
    if (existingToken) {
      // Branch 2: rehydrate
      const { email } = JSON.parse(sessionStorage.getItem('gd:user') ?? '{}')
      const folderId  = sessionStorage.getItem('gd:folderId') ?? null
      return new GoogleDriveStore({ clientId, token: existingToken, userEmail: email, _folderId: folderId })
    }

    if (mode === 'participant') {
      return {
        status: 'onboarding',
        url:    GoogleDriveStore.getOnboardingUrl(),
        hint:   GoogleDriveStore.getOnboardingHint(),
        signIn: () => GoogleDriveStore.beginAuth({ clientId, clientSecret }),
      }
    }

    // Branch 3: unauthenticated
    await GoogleDriveStore.beginAuth({ clientId, clientSecret })
    return null
  }

  // ── static UI utilities ────────────────────────────────────────────────────
  static getOnboardingUrl()  { return 'https://accounts.google.com/signup' }
  static getOnboardingHint() { return 'You need a Google account' }

  // ── internal API helper ─────────────────────────────────────────────────────
  async _api(method, path, body = undefined, { query = {} } = {}) {
    const base = 'https://www.googleapis.com'
    const url  = new URL(path.startsWith('http') ? path : `${base}${path}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)

    const opts = {
      method,
      headers: { Authorization: `Bearer ${this._token}` },
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const resp = await fetch(url.toString(), opts)
    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`Drive API ${method} ${path} → ${resp.status}: ${err}`)
    }
    return resp
  }

  // ── internal: write JSON file (create or update) ────────────────────────────
  async _writeFile(name, parentId, data, existingFileId = null) {
    const content = JSON.stringify(data)
    if (existingFileId) {
      // Update existing file
      const resp = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json' }, body: content }
      )
      if (!resp.ok) throw new Error(`Drive update file failed: ${resp.status}`)
      return existingFileId
    }
    // Create new file (multipart)
    const boundary = '-------314159265358979323846'
    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' }),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n')
    const resp = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` }, body: multipart }
    )
    if (!resp.ok) throw new Error(`Drive create file failed: ${resp.status}`)
    const { id } = await resp.json()
    return id
  }

  // ── internal: resolve file ID by name in a parent folder ───────────────────
  async _findFile(name, parentId) {
    const q    = `name='${name}' and '${parentId}' in parents and trashed=false`
    const resp = await this._api('GET', '/drive/v3/files', undefined, { query: { q, fields: 'files(id,name)' } })
    const { files } = await resp.json()
    return files?.[0] ?? null
  }

  // ── internal: resolve subfolder ID (with cache) ─────────────────────────────
  async _subfolderFor(name) {
    if (this._subfolderIdCache[name]) return this._subfolderIdCache[name]
    const f = await this._findFile(name, this._spaceId)
    if (f) { this._subfolderIdCache[name] = f.id; return f.id }
    // Create subfolder
    const resp = await this._api('POST', '/drive/v3/files', {
      name, mimeType: 'application/vnd.google-apps.folder', parents: [this._spaceId],
    })
    const { id } = await resp.json()
    this._subfolderIdCache[name] = id
    return id
  }

  // ── createSpace ──────────────────────────────────────────────────────────────
  async createSpace(name, { accessMode = 'email' } = {}) {
    // Create root folder
    const folderResp = await this._api('POST', '/drive/v3/files', {
      name, mimeType: 'application/vnd.google-apps.folder',
    })
    const { id: folderId } = await folderResp.json()
    this.setSpace(folderId)

    // Set link-sharing if requested
    if (accessMode === 'link') {
      await this._api('POST', `/drive/v3/files/${folderId}/permissions`, {
        role: 'writer', type: 'anyone',
      })
    }

    // Write _event.json
    await this._writeFile('_event.json', folderId, {
      name, created: new Date().toISOString(), owner: this._userEmail, accessMode,
    })

    this.constructor.saveRecentSpace(folderId)
    return folderId
  }

  // ── join ─────────────────────────────────────────────────────────────────────
  async join(folderId) {
    this.setSpace(folderId)
    // Verify access by reading _event.json
    const eventData = await this.read('_event.json')
    if (!eventData) throw new Error(`Cannot access space: folder ${folderId} not found or inaccessible`)
    this.constructor.saveRecentSpace(folderId)
  }

  // ── read ─────────────────────────────────────────────────────────────────────
  async read(path) {
    const parts    = path.split('/')
    let parentId   = this._spaceId
    const filename = parts[parts.length - 1]

    if (parts.length > 1) {
      // resolve subfolder
      const subName = parts.slice(0, -1).join('/')
      const sf      = await this._findFile(subName, this._spaceId)
      if (!sf) return null
      parentId = sf.id
    }

    const file = await this._findFile(filename, parentId)
    if (!file) return null

    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      { headers: { Authorization: `Bearer ${this._token}` } }
    )
    if (!resp.ok) return null
    return resp.json()
  }

  // ── write ─────────────────────────────────────────────────────────────────
  async write(path, data) {
    const parts    = path.split('/')
    let parentId   = this._spaceId
    const filename = parts[parts.length - 1]

    if (parts.length > 1) {
      parentId = await this._subfolderFor(parts.slice(0, -1).join('/'))
    }

    const existing = await this._findFile(filename, parentId)
    await this._writeFile(filename, parentId, data, existing?.id ?? null)
  }

  // ── delete ────────────────────────────────────────────────────────────────
  async delete(path) {
    const parts    = path.split('/')
    const filename = parts[parts.length - 1]
    let parentId   = this._spaceId

    if (parts.length > 1) {
      const sub = await this._findFile(parts[0], this._spaceId)
      if (!sub) return   // subfolder not found — nothing to delete
      parentId = sub.id
    }

    const file = await this._findFile(filename, parentId)
    if (!file) return   // file not found — return silently

    // Route through _api() for consistent auth headers
    // _api() throws with "Drive API ... → {status}: ..." on errors; 204 (success) does not throw
    try {
      await this._api('DELETE', `/drive/v3/files/${file.id}`)
    } catch (e) {
      if (e.message.includes('→ 404:')) return   // already deleted — return silently
      throw e
    }
  }

  // ── findOrCreateSpace ────────────────────────────────────────────────────
  async findOrCreateSpace(name) {
    // Search in Drive root — 'root' is the Drive API alias for the user's root folder
    const file = await this._findFile(name, 'root')
    if (file) {
      this.setSpace(file.id)
      return file.id
    }
    return this.createSpace(name)
  }

  // ── append ────────────────────────────────────────────────────────────────
  async append(data, { prefix }) {
    const subfolderId = await this._subfolderFor(prefix)
    const timestamp   = new Date().toISOString().replace(/:/g, '-')
    const filename    = `${timestamp}.json`
    await this._writeFile(filename, subfolderId, data)
  }

  async readAll() {
    // 1. List participant subfolders
    const q        = `'${this._spaceId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const listResp = await this._api('GET', '/drive/v3/files', undefined, { query: { q, fields: 'files(id,name)' } })
    const { files: folders } = await listResp.json()

    // 2. Skip _ prefixed folders
    const participants = folders.filter(f => !f.name.startsWith('_'))

    // 3. For each subfolder, list files and read each
    const results = await Promise.all(participants.map(async folder => {
      const fq    = `'${folder.id}' in parents and mimeType='application/json' and trashed=false`
      const fResp = await this._api('GET', '/drive/v3/files', undefined, {
        query: { q: fq, fields: 'files(id,name)', orderBy: 'name' }
      })
      const { files } = await fResp.json()

      const entries = await Promise.all(files.map(async file => {
        const contentResp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          { headers: { Authorization: `Bearer ${this._token}` } }
        )
        if (!contentResp.ok) throw new Error(`Drive content fetch failed: ${contentResp.status}`)
        const data = await contentResp.json()
        return { path: `${folder.name}/${file.name}`, data }
      }))

      return {
        username: folder.name,
        entries,
        // orderBy=name on ISO-timestamp filenames = chronological order
        latest: entries.length > 0 ? entries[entries.length - 1].data : null,
      }
    }))

    return results.sort((a, b) => a.username.localeCompare(b.username))
  }

  async addCollaborator(email) {
    // Read accessMode from _event.json
    const event = await this.read('_event.json')
    if (event?.accessMode === 'link') {
      throw new Error('addCollaborator() is not supported in link-access spaces. Share the space URL directly with participants.')
    }
    await this._api('POST', `/drive/v3/files/${this._spaceId}/permissions`, {
      role: 'writer', type: 'user', emailAddress: email,
    })
  }

  async closeSubmissions() {
    const current = await this.read('_event.json')
    await this.write('_event.json', { ...(current ?? {}), closed: true })
  }

  async archiveSpace() {
    const permResp = await this._api('GET', `/drive/v3/files/${this._spaceId}/permissions`, undefined, {
      query: { fields: 'permissions(id,role,type)' }
    })
    const { permissions } = await permResp.json()
    await Promise.all(
      permissions
        .filter(p => p.role !== 'owner')
        .map(p => this._api('PATCH', `/drive/v3/files/${this._spaceId}/permissions/${p.id}`, { role: 'reader' }))
    )
  }

  async deleteSpace() {
    await this._api('DELETE', `/drive/v3/files/${this._spaceId}`)
    this.setSpace(null)   // handles both _spaceId and sessionStorage
    this._subfolderIdCache = {}
  }

  getCapabilities() {
    return {
      createSpace: true, join: true, append: true,
      read: true, readAll: true, write: true, delete: true,
      addCollaborator: true, closeSubmissions: true,
      archiveSpace: true, deleteSpace: true,
      findOrCreateSpace: true,
      binaryData: true,
    }
  }
}
