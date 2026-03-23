// lib/google-drive-store.js
export class GoogleDriveStore {
  constructor({ clientId, token, userEmail = null, _folderId = null } = {}) {
    this._clientId      = clientId
    this._token         = token
    this._userEmail     = userEmail
    this._folderId      = _folderId
    this._subfolderIdCache = {}
  }

  get isAuthenticated() { return !!this._token }
  get userEmail()       { return this._userEmail }

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
  static async beginAuth({ clientId }) {
    const { verifier, challenge } = await GoogleDriveStore._pkce()
    const state       = crypto.randomUUID()
    const _loc        = new URL(location.href)
    const redirectUri = _loc.origin + _loc.pathname
    sessionStorage.setItem('gd:auth', JSON.stringify({ clientId, state, codeVerifier: verifier, redirectUri }))
    sessionStorage.setItem('gd:returnUrl', location.href)

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file')
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
        code,
        redirect_uri:  stored.redirectUri,
        grant_type:    'authorization_code',
        code_verifier: stored.codeVerifier,
      }),
    })
    if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status}`)
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
  static async init({ clientId }) {
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

    // Branch 3: unauthenticated
    await GoogleDriveStore.beginAuth({ clientId })
    return null
  }

  // ── static UI utilities ────────────────────────────────────────────────────
  static hasToken()        { return !!sessionStorage.getItem('gd:token') }
  static onboardingUrl()   { return 'https://accounts.google.com/signup' }
  static onboardingHint()  { return 'You need a Google account' }

  static saveRecentSpace(spaceId) {
    const key      = 'gd:recentSpaces'
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]')
    const updated  = [spaceId, ...existing.filter(s => s !== spaceId)].slice(0, 5)
    localStorage.setItem(key, JSON.stringify(updated))
  }

  static getRecentSpaces() {
    return JSON.parse(localStorage.getItem('gd:recentSpaces') ?? '[]')
  }

  // ── data ops (stubs — implemented in Tasks 6-9) ────────────────────────────
  async createSpace()       { throw new Error('Not implemented') }
  async join()              { throw new Error('Not implemented') }
  async append()            { throw new Error('Not implemented') }
  async read()              { throw new Error('Not implemented') }
  async write()             { throw new Error('Not implemented') }
  async readAll()           { throw new Error('Not implemented') }
  async addCollaborator()   { throw new Error('Not implemented') }
  async closeSubmissions()  { throw new Error('Not implemented') }
  async archiveSpace()      { throw new Error('Not implemented') }
  async deleteSpace()       { throw new Error('Not implemented') }
  capabilities()            { throw new Error('Not implemented') }
}
