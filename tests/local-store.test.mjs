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

// ── createSpace() ─────────────────────────────────────────────────────────

test('createSpace creates a subdirectory and writes _event.json', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.createSpace('my-hunt')
  expect(id).toBe('my-hunt')
  // directory was created
  const dir = await root.getDirectoryHandle('my-hunt')
  expect(dir.kind).toBe('directory')
  // _event.json was written
  const fileHandle = await dir.getFileHandle('_event.json')
  const file = await fileHandle.getFile()
  const data = JSON.parse(await file.text())
  expect(data.createdAt).toBeDefined()
})

test('createSpace sets _spaceId', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('my-hunt')
  expect(store._spaceId).toBe('my-hunt')
})

// ── findOrCreateSpace() ───────────────────────────────────────────────────

test('findOrCreateSpace returns existing directory name and sets _spaceId', async () => {
  const root = createMockFilesystem()
  // pre-create directory
  await root.getDirectoryHandle('existing-hunt', { create: true })
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.findOrCreateSpace('existing-hunt')
  expect(id).toBe('existing-hunt')
  expect(store._spaceId).toBe('existing-hunt')
})

test('findOrCreateSpace creates directory when not found', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.findOrCreateSpace('new-hunt')
  expect(id).toBe('new-hunt')
  expect(store._spaceId).toBe('new-hunt')
  const dir = await root.getDirectoryHandle('new-hunt')
  expect(dir.kind).toBe('directory')
})

// ── deleteSpace() ─────────────────────────────────────────────────────────

test('deleteSpace removes the space directory and clears _spaceId', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('doomed')
  await store.deleteSpace()
  expect(store._spaceId).toBeNull()
  await expect(root.getDirectoryHandle('doomed', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
})
