import { test, expect } from 'vitest'
import { assertCapabilities } from '../lib/capabilities.js'

test('assertCapabilities passes when all required caps present', () => {
  const store = {
    getCapabilities: () => ({ append: true, read: true }),
    constructor: { name: 'TestStore' },
  }
  expect(() => assertCapabilities(store, ['append', 'read'])).not.toThrow()
})

test('assertCapabilities throws listing all missing caps', () => {
  const store = {
    getCapabilities: () => ({ append: true }),
    constructor: { name: 'TestStore' },
  }
  expect(() => assertCapabilities(store, ['append', 'read', 'write']))
    .toThrow('TestStore is missing required capabilities: read, write')
})

test('assertCapabilities passes with empty required list', () => {
  const store = {
    getCapabilities: () => ({}),
    constructor: { name: 'TestStore' },
  }
  expect(() => assertCapabilities(store, [])).not.toThrow()
})
