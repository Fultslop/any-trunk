# Test Framework Migration — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Replace the hand-rolled test harness in `tests/github-store.test.mjs` with [Vitest](https://vitest.dev/), a mature, widely-used, ESM-native test framework. No test logic changes — only the harness is replaced.

---

## Motivation

The current harness is ~27 lines of custom code (`test()`, `assert()`, `assertEqual()`, `runAll()`, pass/fail counters). It lacks test isolation guarantees, has no watch mode, no built-in coverage, and produces minimal output. Vitest provides all of these with zero project-specific configuration and is the community standard for modern JavaScript projects.

---

## Scope

**In scope:**
- Install `vitest` as a devDependency
- Update the `test` npm script
- Replace the harness in `tests/github-store.test.mjs` with Vitest's API
- Add `beforeEach` for per-test reset (previously done inside `runAll()`)

**Out of scope:**
- Changes to `tests/helpers/mock-browser.mjs` or `tests/helpers/mock-fetch.mjs`
- Changes to any test logic or assertions
- Adding new tests
- Vitest configuration files (zero-config is sufficient)

---

## Dependency

```bash
npm install --save-dev vitest
```

Vitest requires Node.js 18+, which this project already mandates. No additional configuration file is needed — the existing `"type": "module"` in `package.json` is enough for Vitest to handle ESM correctly.

---

## `package.json` changes

```json
{
  "scripts": {
    "test":       "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

`vitest run` is the CI-friendly single-pass mode. `vitest` (no argument) starts interactive watch mode.

---

## Test file changes

### Imports

**Remove** the hand-rolled harness imports and declarations:

```js
// REMOVE these lines:
let passed = 0, failed = 0
const _queue = []
function test(name, fn) { _queue.push({ name, fn }) }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function assertEqual(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
async function runAll() { ... }
```

**Add** Vitest imports at the top:

```js
import { test, expect, beforeEach } from 'vitest'
```

### Per-test reset

**Remove** the manual `reset()` + `clearFetch()` calls from inside the old `runAll()` loop.

**Add** a `beforeEach` immediately after the helper imports:

```js
beforeEach(() => {
  reset()
  clearFetch()
})
```

Vitest calls `beforeEach` automatically before every `test()` block, providing the same isolation the old `runAll()` loop gave.

### Assertion replacements

| Old | New |
|---|---|
| `assert(cond)` | `expect(cond).toBe(true)` |
| `assert(cond, msg)` | `expect(cond, msg).toBe(true)` |
| `assertEqual(a, b)` | `expect(a).toBe(b)` |

Where a test checks that a `let threw = false` + try/catch pattern fires, replace with Vitest's built-in `await expect(fn).rejects.toThrow()` — see below.

### Exception tests

The current pattern:

```js
let threw = false
try { await GitHubStore.completeAuth() } catch { threw = true }
assert(threw, 'should throw on state mismatch')
```

Replace with:

```js
await expect(() => GitHubStore.completeAuth()).rejects.toThrow()
```

### Removal of `runAll()`

**Remove** the `runAll()` call at the bottom of the file. Vitest discovers and runs all `test()` blocks automatically.

---

## Files changed

| File | Change |
|---|---|
| `package.json` | Add `vitest` devDependency; update `test` script; add `test:watch` script |
| `tests/github-store.test.mjs` | Replace harness; add `beforeEach`; update assertions |
| `tests/helpers/mock-browser.mjs` | No change |
| `tests/helpers/mock-fetch.mjs` | No change |

---

## Verification

After migration, `npm test` must:
1. Run all existing tests
2. Pass with the same results as `node tests/github-store.test.mjs` did before
3. Print a formatted summary showing each test name and pass/fail status
