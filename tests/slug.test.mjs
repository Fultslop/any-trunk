import { test, expect } from 'vitest'
import { toSlug, uniqueSlug } from '../apps/hunt/lib/slug.js'

test('toSlug lowercases and replaces non-alphanum with hyphens', () => {
  expect(toSlug('Anne Frank House')).toBe('anne-frank-house')
})

test('toSlug strips leading and trailing hyphens', () => {
  expect(toSlug('  Hello World  ')).toBe('hello-world')
})

test('toSlug collapses multiple non-alphanum chars to one hyphen', () => {
  expect(toSlug('A & B / C')).toBe('a-b-c')
})

test('uniqueSlug returns base slug when no collision', () => {
  expect(uniqueSlug('Anne Frank', [])).toBe('anne-frank')
})

test('uniqueSlug appends -2 on first collision', () => {
  expect(uniqueSlug('Anne Frank', ['anne-frank'])).toBe('anne-frank-2')
})

test('uniqueSlug increments until free', () => {
  expect(uniqueSlug('Anne Frank', ['anne-frank', 'anne-frank-2', 'anne-frank-3'])).toBe('anne-frank-4')
})
