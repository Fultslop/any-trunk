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

export function startPolling(fn, interval) {
  let timer = null
  let paused = false
  let rateLimited = false

  function showRateLimitStatus(show) {
    if (show === rateLimited) return
    rateLimited = show
    setStatus(show ? 'Refreshing paused briefly…' : '', !show)
  }

  async function tick() {
    try {
      await fn()
      showRateLimitStatus(false)
    } catch(e) {
      if (e.message?.includes('→ 429:')) {
        showRateLimitStatus(true)
        clearInterval(timer)
        timer = null
        setTimeout(() => {
          showRateLimitStatus(false)
          if (!paused) schedule()
        }, 60_000)
        return
      }
      // Non-429 errors: let fn's own error handler deal with them
    }
  }

  function schedule() {
    timer = setInterval(() => { if (!paused) tick() }, interval)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      paused = true
      clearInterval(timer)
      timer = null
    } else {
      paused = false
      schedule()
    }
  })

  schedule()
}
