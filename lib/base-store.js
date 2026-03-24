// lib/base-store.js
export class BaseStore {

  // ── Shared state ──────────────────────────────────────────────────────────
  _spaceId = null

  // ── Shared implementations ────────────────────────────────────────────────
  setSpace(id) { this._spaceId = id }

  getRecentSpaces() {
    return JSON.parse(localStorage.getItem(`${this.constructor._storageKey}:recentSpaces`) ?? '[]')
  }

  static saveRecentSpace(id) {
    const key     = `${this._storageKey}:recentSpaces`
    const updated = [id, ...JSON.parse(localStorage.getItem(key) ?? '[]').filter(s => s !== id)].slice(0, 5)
    localStorage.setItem(key, JSON.stringify(updated))
  }

  // ── Required overrides ────────────────────────────────────────────────────
  static get _storageKey() { throw new Error(`${this.name} must declare static _storageKey`) }

  static async init(config)     { throw new Error(`${this.name}.init() not implemented`) }
  static getOnboardingUrl()     { throw new Error(`${this.name}.getOnboardingUrl() not implemented`) }
  static getOnboardingHint()    { throw new Error(`${this.name}.getOnboardingHint() not implemented`) }

  get userId()                  { throw new Error(`${this.constructor.name}.userId not implemented`) }

  getCapabilities()             { throw new Error('not implemented') }
  async read(path)              { throw new Error('not implemented') }
  async readAll()               { throw new Error('not implemented') }
  async append(data, opts)      { throw new Error('not implemented') }
  async write(path, data)       { throw new Error('not implemented') }
  async createSpace(name, opts) { throw new Error('not implemented') }
  async join(spaceId, opts)     { throw new Error('not implemented') }
  async deleteSpace()           { throw new Error('not implemented') }
}
