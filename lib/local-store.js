// lib/local-store.js
import { BaseStore } from './base-store.js';

export class LocalStore extends BaseStore {
  static storageKey = 'local';

  #rootHandle;

  constructor(rootHandle) {
    super();
    this.#rootHandle = rootHandle;
  }

  get userId() { return this.#rootHandle.name; }

  static getOnboardingUrl() {
    const p = navigator.platform;
    if (p.startsWith('Win')) return 'file:///C:/Users/';
    if (p.startsWith('Mac')) return 'file:///Users/';
    return 'file:///home/';
  }

  static getOnboardingHint() {
    const p = navigator.platform;
    if (p.startsWith('Win')) return 'Suggested location: AppData\\Local\\AnyTrunk';
    if (p.startsWith('Mac')) return 'Suggested location: Library/Application Support/AnyTrunk';
    return 'Suggested location: ~/.local/share/anytrunk';
  }

  // eslint-disable-next-line no-unused-vars
  static async init(config = {}, { _rootHandle, gesture = false } = {}) {
    if (_rootHandle) return new LocalStore(_rootHandle);

    const stored = await LocalStore.idbGet();
    if (stored) {
      const perm = await stored.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return new LocalStore(stored);
      if (perm === 'prompt' && gesture) {
        const result = await stored.requestPermission({ mode: 'readwrite' });
        if (result === 'granted') return new LocalStore(stored);
      }
    }

    // showDirectoryPicker and requestPermission both require a user gesture
    if (!gesture) return null;

    // eslint-disable-next-line no-undef
    const handle = await showDirectoryPicker({ mode: 'readwrite' });
    await LocalStore.idbPut(handle);
    return new LocalStore(handle);
  }

  // ── IndexedDB helpers ────────────────────────────────────────────────────

  static idbOpen() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('anytrunk-local', 1);
      request.addEventListener('upgradeneeded', (event_) => event_.target.result.createObjectStore('handles'));
      request.addEventListener('success', (event_) => resolve(event_.target.result));
      request.addEventListener('error', () => reject(request.error));
    });
  }

  static async idbGet() {
    try {
      const database = await LocalStore.idbOpen();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('handles', 'readonly');
        const request = tx.objectStore('handles').get('local:rootHandle');
        request.addEventListener('success', () => resolve(request.result ?? null));
        request.addEventListener('error', () => reject(request.error));
      });
    } catch { return null; }
  }

  static async idbPut(handle) {
    const database = await LocalStore.idbOpen();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'local:rootHandle');
      tx.addEventListener('complete', resolve);
      tx.addEventListener('error', () => reject(tx.error));
    });
  }

  // ── Capabilities ─────────────────────────────────────────────────────────

  getCapabilities() {
    return {
      createSpace: true,
      join: true,
      append: true,
      read: true,
      readAll: true,
      write: true,
      addCollaborator: true,
      closeSubmissions: false,
      archiveSpace: false,
      deleteSpace: true,
      delete: true,
      findOrCreateSpace: true,
    };
  }

  // ── Stubs (implemented in subsequent tasks) ───────────────────────────────

  // eslint-disable-next-line no-unused-vars
  async createSpace(name, options = {}) {
    await this.#rootHandle.getDirectoryHandle(name, { create: true });
    // setSpace must come before write() since write() reads this.spaceId
    this.setSpace(name);
    await this.write('_event.json', { createdAt: new Date().toISOString() });
    return name;
  }

  async findOrCreateSpace(name) {
    try {
      await this.#rootHandle.getDirectoryHandle(name, { create: false });
      this.setSpace(name);
      return name;
    } catch (error) {
      if (error.name === 'NotFoundError') return this.createSpace(name);
      throw error;
    }
  }

  async deleteSpace() {
    const spaceDirectory = await this.#rootHandle.getDirectoryHandle(this.spaceId);
    await spaceDirectory.remove({ recursive: true });
    this.setSpace(null);
  }

  // Navigate to { directoryHandle, filename } for a given path within the current space.
  // Throws NotFoundError if intermediate directories don't exist.
  async navigate(path) {
    const parts = path.split('/');
    const filename = parts.at(-1);
    const spaceDirectory = await this.#rootHandle.getDirectoryHandle(this.spaceId);
    if (parts.length === 1) return { directoryHandle: spaceDirectory, filename };
    const subDirectory = await spaceDirectory.getDirectoryHandle(parts[0]);
    return { directoryHandle: subDirectory, filename };
  }

  async read(path) {
    try {
      const { directoryHandle, filename } = await this.navigate(path);
      const fileHandle = await directoryHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text());
    } catch (error) {
      if (error.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async write(path, data) {
    const parts = path.split('/');
    const filename = parts.at(-1);
    const createOptions = { create: true };
    const spaceDirectory = await this.#rootHandle.getDirectoryHandle(this.spaceId, createOptions);
    let directoryHandle = spaceDirectory;
    if (parts.length > 1) {
      // Paths are at most one directory deep (e.g. 'locations/foo.json') — per spec.
      directoryHandle = await spaceDirectory.getDirectoryHandle(parts[0], { create: true });
    }
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  async readAll() {
    const spaceDirectory = await this.#rootHandle.getDirectoryHandle(this.spaceId);
    const results = [];
    for await (const entry of spaceDirectory.values()) {
      if (!entry.name.startsWith('_') && entry.kind !== 'directory') {
        const fileHandle = await spaceDirectory.getFileHandle(entry.name);
        const file = await fileHandle.getFile();
        results.push(JSON.parse(await file.text()));
      }
    }
    return results;
  }

  async append(data, options = {}) {
    const prefix = options.prefix ?? 'entries';
    await this.write(`${prefix}/${new Date().toISOString()}.json`, data);
  }

  async delete(path) {
    try {
      const { directoryHandle, filename } = await this.navigate(path);
      const fileHandle = await directoryHandle.getFileHandle(filename);
      await fileHandle.remove();
    } catch (error) {
      if (error.name === 'NotFoundError') return;
      throw error;
    }
  }

  async join(spaceId, options) { // eslint-disable-line no-unused-vars
    this.setSpace(spaceId);
  }

  async addCollaborator() {
    // no-op — local files have no access control to configure
  }
}
