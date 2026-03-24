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

  async createSpace(name, opts = {}) {
    await this._rootHandle.getDirectoryHandle(name, { create: true })
    // setSpace must come before write() since write() reads this._spaceId
    this.setSpace(name)
    await this.write('_event.json', { createdAt: new Date().toISOString() })
    return name
  }

  async findOrCreateSpace(name) {
    try {
      await this._rootHandle.getDirectoryHandle(name, { create: false })
      this.setSpace(name)
      return name
    } catch (e) {
      if (e.name === 'NotFoundError') return this.createSpace(name)
      throw e
    }
  }

  async deleteSpace() {
    const dir = await this._rootHandle.getDirectoryHandle(this._spaceId)
    await dir.remove({ recursive: true })
    this.setSpace(null)
  }

  // Navigate to { dirHandle, filename } for a given path within the current space.
  // Throws NotFoundError if intermediate directories don't exist.
  async _navigate(path) {
    const parts    = path.split('/')
    const filename = parts[parts.length - 1]
    const spaceDir = await this._rootHandle.getDirectoryHandle(this._spaceId)
    if (parts.length === 1) return { dirHandle: spaceDir, filename }
    const subDir = await spaceDir.getDirectoryHandle(parts[0])
    return { dirHandle: subDir, filename }
  }

  async read(path) {
    try {
      const { dirHandle, filename } = await this._navigate(path)
      const fileHandle = await dirHandle.getFileHandle(filename)
      const file       = await fileHandle.getFile()
      return JSON.parse(await file.text())
    } catch (e) {
      if (e.name === 'NotFoundError') return null
      throw e
    }
  }

  async write(path, data) {
    const parts    = path.split('/')
    const filename = parts[parts.length - 1]
    const spaceDir = await this._rootHandle.getDirectoryHandle(this._spaceId, { create: true })
    let dirHandle  = spaceDir
    if (parts.length > 1) {
      // Paths are at most one directory deep (e.g. 'locations/foo.json') — per spec.
      dirHandle = await spaceDir.getDirectoryHandle(parts[0], { create: true })
    }
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
    const writable   = await fileHandle.createWritable()
    await writable.write(JSON.stringify(data, null, 2))
    await writable.close()
  }
  async readAll() {
    const spaceDir = await this._rootHandle.getDirectoryHandle(this._spaceId)
    const results  = []
    for await (const entry of spaceDir.values()) {
      if (entry.name.startsWith('_'))    continue
      if (entry.kind === 'directory')    continue
      const fileHandle = await spaceDir.getFileHandle(entry.name)
      const file       = await fileHandle.getFile()
      results.push(JSON.parse(await file.text()))
    }
    return results
  }

  async append(data, opts = {}) {
    const prefix = opts.prefix ?? 'entries'
    await this.write(`${prefix}/${new Date().toISOString()}.json`, data)
  }

  async delete(path) {
    try {
      const { dirHandle, filename } = await this._navigate(path)
      const fileHandle = await dirHandle.getFileHandle(filename)
      await fileHandle.remove()
    } catch (e) {
      if (e.name === 'NotFoundError') return
      throw e
    }
  }
  async join(spaceId, opts) {
    this.setSpace(spaceId)
  }

  async addCollaborator() {
    // no-op — local files have no access control to configure
  }
}
