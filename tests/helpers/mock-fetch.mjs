// tests/helpers/mock-fetch.mjs
let _handler = null

export function mockFetch(handler) { _handler = handler }
export function clearFetch()       { _handler = null }

global.fetch = async (url, opts = {}) => {
  if (!_handler) throw new Error(`Unexpected fetch: ${url}`)
  const result = await _handler(url, opts)
  if (!result || typeof result.status !== 'number') {
    throw new Error(`mockFetch handler for "${url}" must return { status, body }`)
  }
  // handler returns { status, body } — we wrap it
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    json: async () => JSON.parse(body),
    text: async () => body,
  }
}
