import { test, expect, beforeEach } from 'vitest'
import { reset } from './helpers/mock-browser.mjs'
import { BaseStore } from '../lib/base-store.js'

beforeEach(() => reset())

// ── _storageKey safety ────────────────────────────────────────────────────

test('_storageKey throws if subclass does not declare it', () => {
  class BrokenStore extends BaseStore {}
  expect(() => BrokenStore._storageKey).toThrow(/BrokenStore must declare static _storageKey/)
})

test('_storageKey works when subclass declares it', () => {
  class GoodStore extends BaseStore { static _storageKey = 'gs' }
  expect(GoodStore._storageKey).toBe('gs')
})

// ── setSpace ─────────────────────────────────────────────────────────────

test('setSpace sets _spaceId on the instance', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  const store = new S()
  expect(store._spaceId).toBeNull()
  store.setSpace('abc-123')
  expect(store._spaceId).toBe('abc-123')
})

// ── saveRecentSpace / getRecentSpaces ─────────────────────────────────────

test('saveRecentSpace persists under storageKey namespace', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  S.saveRecentSpace('space-1')
  expect(localStorage.getItem('ts:recentSpaces')).toBe('["space-1"]')
})

test('getRecentSpaces reads from storageKey namespace', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  S.saveRecentSpace('space-1')
  const store = new S()
  expect(store.getRecentSpaces()).toEqual(['space-1'])
})

test('saveRecentSpace deduplicates and caps at 5', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  for (let i = 0; i < 7; i++) S.saveRecentSpace(`space-${i}`)
  expect(new S().getRecentSpaces()).toHaveLength(5)
})

test('saveRecentSpace moves existing entry to front', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  S.saveRecentSpace('a')
  S.saveRecentSpace('b')
  S.saveRecentSpace('a')
  const spaces = new S().getRecentSpaces()
  expect(spaces[0]).toBe('a')
  expect(spaces[1]).toBe('b')
  expect(spaces).toHaveLength(2)
})

test('two subclasses with different _storageKey have separate lists', () => {
  class A extends BaseStore { static _storageKey = 'aa' }
  class B extends BaseStore { static _storageKey = 'bb' }
  A.saveRecentSpace('space-a')
  B.saveRecentSpace('space-b')
  expect(new A().getRecentSpaces()).toEqual(['space-a'])
  expect(new B().getRecentSpaces()).toEqual(['space-b'])
})

// ── stubs throw ───────────────────────────────────────────────────────────

test('init stub throws not implemented', async () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  await expect(S.init({})).rejects.toThrow(/not implemented/)
})

test('getOnboardingUrl stub throws not implemented', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  expect(() => S.getOnboardingUrl()).toThrow(/not implemented/)
})

test('getOnboardingHint stub throws not implemented', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  expect(() => S.getOnboardingHint()).toThrow(/not implemented/)
})

test('instance method stubs throw not implemented', async () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  const store = new S()
  await expect(store.read('x.json')).rejects.toThrow(/not implemented/)
  await expect(store.readAll()).rejects.toThrow(/not implemented/)
  await expect(store.append({}, { prefix: 'x' })).rejects.toThrow(/not implemented/)
  await expect(store.write('x.json', {})).rejects.toThrow(/not implemented/)
  await expect(store.createSpace('name')).rejects.toThrow(/not implemented/)
  await expect(store.join('id')).rejects.toThrow(/not implemented/)
  await expect(store.deleteSpace()).rejects.toThrow(/not implemented/)
  await expect(store.delete('x.json')).rejects.toThrow(/not implemented/)
  await expect(store.findOrCreateSpace('name')).rejects.toThrow(/not implemented/)
  expect(() => store.getCapabilities()).toThrow(/not implemented/)
})

test('userId stub throws not implemented', () => {
  class S extends BaseStore { static _storageKey = 'ts' }
  const store = new S()
  expect(() => store.userId).toThrow(/not implemented/)
})
