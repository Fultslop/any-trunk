// tests/helpers/mock-browser.mjs
// Call reset() between tests to clear storage state.

function makeStorage() {
  let store = {}
  return {
    getItem:    k     => store[k] ?? null,
    setItem:    (k,v) => { store[k] = String(v) },
    removeItem: k     => { delete store[k] },
    clear:      ()    => { store = {} },
    _store:     () => store,
  }
}

export const sessionStorage = makeStorage()
export const localStorage   = makeStorage()

export let location = { href: 'http://localhost/', search: '' }

// Captured once on the first reset() call, after the test file has had a chance
// to install its own property descriptor on global.location.
let _capturedLocationSetter = undefined

export function setLocation(href) {
  // Lazily capture whatever setter the test file installed via Object.defineProperty.
  if (_capturedLocationSetter === undefined) {
    const desc = Object.getOwnPropertyDescriptor(global, 'location')
    _capturedLocationSetter = desc?.set ?? null
  }

  let _href = href
  const proxyLocation = {
    get href() { return _href },
    set href(v) {
      _href = v
      // Forward to the test-file setter (if any) so it can update its own tracking vars.
      if (_capturedLocationSetter) _capturedLocationSetter(v)
    },
    get search() {
      return _href.includes('?') ? '?' + _href.split('?')[1] : ''
    },
  }

  Object.defineProperty(global, 'location', {
    configurable: true,
    get: () => proxyLocation,
    set: (v) => { proxyLocation.href = typeof v === 'string' ? v : (v?.href ?? String(v)) },
  })

  location = proxyLocation
}

export function reset() {
  sessionStorage.clear()
  localStorage.clear()
  setLocation('http://localhost/')
}

// Patch globals so the library picks them up
global.sessionStorage = sessionStorage
global.localStorage   = localStorage
global.location       = location
