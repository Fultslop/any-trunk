import { test, expect } from 'vitest'
import { LocalStore } from '../lib/local-store.js'
import { createMockFilesystem, mockPicker } from './helpers/mock-filesystem.mjs'

// ── init() & constructor ──────────────────────────────────────────────────

test('init() with _rootHandle bypass returns a LocalStore instance', async () => {
  const root = createMockFilesystem('my-hunts')
  const store = await LocalStore.init({}, { _rootHandle: root })
  expect(store).toBeInstanceOf(LocalStore)
})

test('userId returns the root folder name', async () => {
  const root = createMockFilesystem('my-hunts')
  const store = await LocalStore.init({}, { _rootHandle: root })
  expect(store.userId).toBe('my-hunts')
})

// ── getCapabilities() ─────────────────────────────────────────────────────

test('getCapabilities() returns expected shape', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const caps = store.getCapabilities()
  expect(caps.read).toBe(true)
  expect(caps.write).toBe(true)
  expect(caps.append).toBe(true)
  expect(caps.readAll).toBe(true)
  expect(caps.createSpace).toBe(true)
  expect(caps.deleteSpace).toBe(true)
  expect(caps.delete).toBe(true)
  expect(caps.findOrCreateSpace).toBe(true)
  expect(caps.join).toBe(true)
  expect(caps.addCollaborator).toBe(true)
  expect(caps.closeSubmissions).toBe(false)
  expect(caps.archiveSpace).toBe(false)
})

// ── static members ────────────────────────────────────────────────────────

test('_storageKey is "local"', () => {
  expect(LocalStore._storageKey).toBe('local')
})

// Note: getOnboardingUrl() and getOnboardingHint() call navigator.platform which
// is not available in the Vitest Node environment. They are browser-only and
// verified manually. Do not add unit tests for them here.
