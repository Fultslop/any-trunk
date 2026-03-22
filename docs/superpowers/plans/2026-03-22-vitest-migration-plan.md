# Vitest Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled test harness in `tests/github-store.test.mjs` with Vitest, a mature ESM-native test framework, without changing any test logic.

**Architecture:** Two tasks — install Vitest and wire up the npm script, then migrate the test file by replacing the harness declarations with Vitest's API. The mock helpers (`mock-browser.mjs`, `mock-fetch.mjs`) are untouched. All 18 existing tests continue to pass.

**Tech Stack:** [Vitest](https://vitest.dev/) v3, Node.js 18+, ESM (`"type": "module"`)

**Spec:** `docs/superpowers/specs/2026-03-22-test-framework-migration-design.md`

---

## File Map

| Action | Path | Change |
|---|---|---|
| Modify | `package.json` | Add `vitest` devDependency; update `test` script; add `test:watch` script |
| Modify | `tests/github-store.test.mjs` | Replace harness; add `beforeEach`; update assertions; fix exception test |
| No change | `tests/helpers/mock-browser.mjs` | — |
| No change | `tests/helpers/mock-fetch.mjs` | — |

---

### Task 1: Install Vitest and update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vitest as a dev dependency**

```bash
npm install --save-dev vitest
```

Expected: `vitest` appears in `package.json` under `devDependencies` and `package-lock.json` is updated.

- [ ] **Step 2: Update the npm scripts**

In `package.json`, replace the `scripts` block with:

```json
"scripts": {
  "test":       "vitest run",
  "test:watch": "vitest",
  "proxy":      "node proxy.mjs"
}
```

`vitest run` is the single-pass CI mode. `vitest` (no argument) starts interactive watch mode.

- [ ] **Step 3: Verify Vitest is wired up**

```bash
npm test
```

Expected: Vitest starts, discovers `tests/github-store.test.mjs`, but reports 0 tests found or runs the file with unexpected output — this is expected at this stage because the test file still uses the old hand-rolled `test()` function, not Vitest's. The important thing is that Vitest runs without crashing.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest as dev dependency"
```

---

### Task 2: Migrate the test file

**Files:**
- Modify: `tests/github-store.test.mjs`

This task replaces every hand-rolled harness construct with its Vitest equivalent. All test logic (mock setup, assertions against actual values) is unchanged.

- [ ] **Step 1: Replace the harness block with Vitest imports**

At the top of `tests/github-store.test.mjs`, **remove lines 6–27** (the entire harness):

```js
// DELETE everything from here:
let passed = 0, failed = 0
const _queue = []
function test(name, fn) { _queue.push({ name, fn }) }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function assertEqual(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
async function runAll() {
  for (const { name, fn } of _queue) {
    reset()
    clearFetch()
    try {
      await fn()
      console.log('✓', name); passed++
    } catch(e) {
      console.error('✗', name, '\n ', e.message); failed++
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
}
// DELETE everything up to here
```

**Add** this import line at the very top of the file (line 1, before the existing `import { reset }` line):

```js
import { test, expect, beforeEach } from 'vitest'
```

The top of the file should now look like:

```js
import { test, expect, beforeEach } from 'vitest'
import { reset } from './helpers/mock-browser.mjs'
import { clearFetch, mockFetch } from './helpers/mock-fetch.mjs'
import { GitHubStore } from '../lib/github-store.js'
```

- [ ] **Step 2: Add beforeEach for per-test reset**

Immediately after the four import lines (and before the first `test()` call), add:

```js
beforeEach(() => {
  reset()
  clearFetch()
  lastRedirect = null
})
```

`reset()` clears sessionStorage/localStorage and resets the location mock. `clearFetch()` removes the mock fetch handler. `lastRedirect = null` resets the module-level redirect tracker so redirect assertions in one test don't bleed into the next.

Note: `lastRedirect` is declared further down in the file at the module level (`let lastRedirect = null`) — leave that declaration in place. The `beforeEach` resets it to `null` before each test.

- [ ] **Step 3: Replace all `assert()` calls**

Replace every `assert(cond)` and `assert(cond, msg)` call with `expect(cond).toBe(true)`. Drop the message argument — Vitest prints actual vs. expected values automatically.

There are ~34 `assert()` calls in the file (excluding the one exception test handled in Step 5). Apply this pattern to every one:

| Old | New |
|---|---|
| `assert(!s.isAuthenticated, 'should not be authenticated with no token')` | `expect(!s.isAuthenticated).toBe(true)` |
| `assert(stored.state && stored.state.length > 8, 'state should be a random string')` | `expect(stored.state && stored.state.length > 8).toBe(true)` |
| `assert(lastRedirect?.includes('github.com/login/oauth/authorize'), 'should redirect to GitHub')` | `expect(lastRedirect?.includes('github.com/login/oauth/authorize')).toBe(true)` |
| `assert(store.isAuthenticated, 'should be authenticated')` | `expect(store.isAuthenticated).toBe(true)` |
| `assert(result === null)` | `expect(result === null).toBe(true)` |

Apply the same `expect(cond).toBe(true)` substitution to all remaining `assert()` calls in the file.

- [ ] **Step 4: Replace all `assertEqual()` calls**

Replace every `assertEqual(a, b)` with `expect(a).toBe(b)`. There are ~23 `assertEqual()` calls in the file:

| Old | New |
|---|---|
| `assertEqual(store.username, 'johndoe')` | `expect(store.username).toBe('johndoe')` |
| `assertEqual(repoFullName, 'johndoe/potluck-test')` | `expect(repoFullName).toBe('johndoe/potluck-test')` |
| `assertEqual(result.length, 2)` | `expect(result.length).toBe(2)` |
| `assertEqual(result[0].path, 'bob/2026-03-21T14:00:00.000Z.json')` | `expect(result[0].path).toBe('bob/2026-03-21T14:00:00.000Z.json')` |

Apply `expect(a).toBe(b)` to all remaining `assertEqual()` calls in the file.

- [ ] **Step 5: Replace the exception test**

Find the try/catch pattern (around line 100):

```js
let threw = false
try { await GitHubStore.completeAuth() } catch { threw = true }
assert(threw, 'should throw on state mismatch')
```

Replace it with:

```js
await expect(GitHubStore.completeAuth()).rejects.toThrow()
```

Pass the **promise** directly — not wrapped in `() => ...`. `rejects` expects a live promise. There is only one exception test in the file.

- [ ] **Step 6: Remove the `runAll()` call**

At the very bottom of the file, delete the last line:

```js
runAll()   // DELETE this line
```

Vitest discovers and runs all `test()` blocks automatically — no manual invocation needed.

- [ ] **Step 7: Run the tests and verify all pass**

```bash
npm test
```

Expected output: Vitest runs 20 tests across the file, all passing. The output will look similar to:

```
 ✓ tests/github-store.test.mjs (20)

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

If any test fails, the failure message will show the actual vs. expected values. Check whether the assertion was converted correctly or whether a `beforeEach` reset is missing.

- [ ] **Step 8: Commit**

```bash
git add tests/github-store.test.mjs
git commit -m "chore: migrate test harness from hand-rolled to Vitest"
```
