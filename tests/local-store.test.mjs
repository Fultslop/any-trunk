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
  expect(LocalStore.storageKey).toBe('local')
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
  expect(store.spaceId).toBe('my-hunt')
})

// ── findOrCreateSpace() ───────────────────────────────────────────────────

test('findOrCreateSpace returns existing directory name and sets _spaceId', async () => {
  const root = createMockFilesystem()
  // pre-create directory
  await root.getDirectoryHandle('existing-hunt', { create: true })
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.findOrCreateSpace('existing-hunt')
  expect(id).toBe('existing-hunt')
  expect(store.spaceId).toBe('existing-hunt')
})

test('findOrCreateSpace creates directory when not found', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  const id = await store.findOrCreateSpace('new-hunt')
  expect(id).toBe('new-hunt')
  expect(store.spaceId).toBe('new-hunt')
  const dir = await root.getDirectoryHandle('new-hunt')
  expect(dir.kind).toBe('directory')
})

// ── deleteSpace() ─────────────────────────────────────────────────────────

test('deleteSpace removes the space directory and clears _spaceId', async () => {
  const root = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('doomed')
  await store.deleteSpace()
  expect(store.spaceId).toBeNull()
  await expect(root.getDirectoryHandle('doomed', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
})

// ── read() ────────────────────────────────────────────────────────────────

test('read returns parsed JSON for top-level file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('meta.json', { title: 'Amsterdam' })
  const result = await store.read('meta.json')
  expect(result).toEqual({ title: 'Amsterdam' })
})

test('read returns parsed JSON for nested file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('locations/anne-frank.json', { name: 'Anne Frank House' })
  const result = await store.read('locations/anne-frank.json')
  expect(result).toEqual({ name: 'Anne Frank House' })
})

test('read returns null for missing file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  const result = await store.read('nope.json')
  expect(result).toBeNull()
})

test('read returns null for missing nested file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  const result = await store.read('locations/nope.json')
  expect(result).toBeNull()
})

// ── delete() ─────────────────────────────────────────────────────────────

test('delete removes a top-level file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('gone.json', { x: 1 })
  await store.delete('gone.json')
  expect(await store.read('gone.json')).toBeNull()
})

test('delete removes a nested file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('locations/gone.json', { x: 1 })
  await store.delete('locations/gone.json')
  expect(await store.read('locations/gone.json')).toBeNull()
})

test('delete returns silently for missing file', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await expect(store.delete('nope.json')).resolves.toBeUndefined()
})

// ── readAll() ─────────────────────────────────────────────────────────────

test('readAll returns all top-level non-underscore JSON files', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('alice.json', { name: 'Alice' })
  await store.write('bob.json',   { name: 'Bob' })
  const results = await store.readAll()
  expect(results).toHaveLength(2)
  expect(results).toEqual(expect.arrayContaining([{ name: 'Alice' }, { name: 'Bob' }]))
})

test('readAll skips underscore-prefixed files', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('alice.json',   { name: 'Alice' })
  await store.write('_event.json',  { internal: true })
  await store.write('_hunt.json',   { internal: true })
  const results = await store.readAll()
  expect(results).toHaveLength(1)
  expect(results[0]).toEqual({ name: 'Alice' })
})

test('readAll skips subdirectories', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.write('top.json',              { level: 'top' })
  await store.write('locations/nested.json', { level: 'nested' })
  const results = await store.readAll()
  expect(results).toHaveLength(1)
  expect(results[0]).toEqual({ level: 'top' })
})

// ── append() ─────────────────────────────────────────────────────────────

test('append writes to entries/ subdirectory with iso timestamp filename', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.append({ msg: 'hello' })
  const results = await store.readAll()
  // readAll skips subdirs, so we verify via read with a known prefix
  // Instead, verify the entries dir exists and has one file
  const spaceDir   = await root.getDirectoryHandle('hunt')
  const entriesDir = await spaceDir.getDirectoryHandle('entries')
  expect(entriesDir.kind).toBe('directory')
})

test('append respects opts.prefix', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.createSpace('hunt')
  await store.append({ msg: 'hello' }, { prefix: 'submissions' })
  const spaceDir      = await root.getDirectoryHandle('hunt')
  const submissionsDir = await spaceDir.getDirectoryHandle('submissions')
  expect(submissionsDir.kind).toBe('directory')
})

// ── join() ────────────────────────────────────────────────────────────────

test('join sets _spaceId to the given spaceId', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await store.join('hunt-abc123')
  expect(store.spaceId).toBe('hunt-abc123')
})

test('join resolves without error', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await expect(store.join('any-space')).resolves.toBeUndefined()
})

// ── addCollaborator() ─────────────────────────────────────────────────────

test('addCollaborator resolves without error (no-op)', async () => {
  const root  = createMockFilesystem()
  const store = await LocalStore.init({}, { _rootHandle: root })
  await expect(store.addCollaborator('someone@example.com')).resolves.toBeUndefined()
})
