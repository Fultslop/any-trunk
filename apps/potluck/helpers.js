export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function setStatus(msg, isError = true) {
  let el = document.getElementById('status')
  if (!el) {
    el = document.createElement('div')
    el.id = 'status'
    document.getElementById('app').appendChild(el)
  }
  el.className = isError ? 'err' : 'ok'
  el.textContent = msg
}

// stub — implemented in GitHub experience improvements plan
export function startPolling(fn, interval) {}
