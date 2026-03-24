// lib/local-store.js
import { BaseStore } from './base-store.js'

export class LocalStore extends BaseStore {
  static _storageKey = 'local'

  constructor(rootHandle) {
    super()
    this._rootHandle = rootHandle
  }

  get userId() { return this._rootHandle.name }

  static getOnboardingUrl() {
    const p = navigator.platform
    if (p.startsWith('Win')) return 'file:///C:/Users/'
    if (p.startsWith('Mac')) return 'file:///Users/'
    return 'file:///home/'
  }

  static getOnboardingHint() {
    const p = navigator.platform
    if (p.startsWith('Win')) return 'Suggested location: AppData\\Local\\AnyTrunk'
    if (p.startsWith('Mac')) return 'Suggested location: Library/Application Support/AnyTrunk'
    return 'Suggested location: ~/.local/share/anytrunk'
  }

  static async init(config = {}, { _rootHandle } = {}) {
    if (_rootHandle) return new LocalStore(_rootHandle)

    const stored = await LocalStore._idbGet()
    if (stored) {
      const perm = await stored.queryPermission({ mode: 'readwrite' })
      if (perm === 'granted') return new LocalStore(stored)
      if (perm === 'prompt') {
        const result = await stored.requestPermission({ mode: 'readwrite' })
        if (result === 'granted') return new LocalStore(stored)
      }
      // denied — fall through to picker
    }

    const handle = await showDirectoryPicker({ mode: 'readwrite' })
    await LocalStore._idbPut(handle)
    return new LocalStore(handle)
  }

  // ── IndexedDB helpers ────────────────────────────────────────────────────

  static _idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('anytrunk-local', 1)
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles')
      req.onsuccess = e => resolve(e.target.result)
      req.onerror = () => reject(req.error)
    })
  }

  static async _idbGet() {
    try {
      const db = await LocalStore._idbOpen()
      return new Promise((resolve, reject) => {
        const tx  = db.transaction('handles', 'readonly')
        const req = tx.objectStore('handles').get('local:rootHandle')
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror   = () => reject(req.error)
      })
    } catch { return null }
  }

  static async _idbPut(handle) {
    const db = await LocalStore._idbOpen()
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('handles', 'readwrite')
      const req = tx.objectStore('handles').put(handle, 'local:rootHandle')
      tx.oncomplete = resolve
      tx.onerror    = () => reject(tx.error)
    })
  }

  // ── Capabilities ─────────────────────────────────────────────────────────

  getCapabilities() {
    return {
      createSpace:       true,
      join:              true,
      append:            true,
      read:              true,
      readAll:           true,
      write:             true,
      addCollaborator:   true,
      closeSubmissions:  false,
      archiveSpace:      false,
      deleteSpace:       true,
      delete:            true,
      findOrCreateSpace: true,
    }
  }

  // ── Stubs (implemented in subsequent tasks) ───────────────────────────────

  async createSpace(name, opts = {})    { throw new Error('not implemented') }
  async findOrCreateSpace(name)         { throw new Error('not implemented') }
  async deleteSpace()                   { throw new Error('not implemented') }
  async read(path)                      { throw new Error('not implemented') }
  async write(path, data)               { throw new Error('not implemented') }
  async readAll()                       { throw new Error('not implemented') }
  async append(data, opts = {})         { throw new Error('not implemented') }
  async delete(path)                    { throw new Error('not implemented') }
  async join(spaceId, opts)             { throw new Error('not implemented') }
  async addCollaborator(identity, opts) { throw new Error('not implemented') }
}
