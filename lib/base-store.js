// lib/base-store.js
export class BaseStore {
  // ── Shared state ──────────────────────────────────────────────────────────
  spaceId = null;

  // ── Shared implementations ────────────────────────────────────────────────
  setSpace(id) { this.spaceId = id; }

  getRecentSpaces() {
    return JSON.parse(localStorage.getItem(`${this.constructor.storageKey}:recentSpaces`) ?? '[]');
  }

  // Save the most recent space to local storage so next time we
  // visit we use this space.
  static saveRecentSpace(id) {
    const key = `${this.storageKey}:recentSpaces`;
    const updated = [id, ...JSON.parse(localStorage.getItem(key) ?? '[]').filter((s) => s !== id)].slice(0, 5);
    localStorage.setItem(key, JSON.stringify(updated));
  }

  // ── Required overrides ────────────────────────────────────────────────────
  static get storageKey() { throw new Error(`${this.name} must declare static storageKey`); }

  // eslint-disable-next-line no-unused-vars
  static async init(config) { throw new Error(`${this.name}.init() not implemented`); }

  static getOnboardingUrl() { throw new Error(`${this.name}.getOnboardingUrl() not implemented`); }

  static getOnboardingHint() { throw new Error(`${this.name}.getOnboardingHint() not implemented`); }

  get userId() { throw new Error(`${this.constructor.name}.userId not implemented`); }

  getCapabilities() { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async read(path) { throw new Error('not implemented'); }

  async readAll() { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async append(data, options) { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async write(path, data) { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async createSpace(name, options) { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async join(spaceId, options) { throw new Error('not implemented'); }

  async deleteSpace() { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async delete(path) { throw new Error('not implemented'); }

  // eslint-disable-next-line no-unused-vars
  async findOrCreateSpace(name) { throw new Error('not implemented'); }
}
