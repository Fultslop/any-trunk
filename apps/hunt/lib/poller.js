// apps/hunt/lib/poller.js

export function createPoller(fn, intervalMs) {
  let timer = null
  return {
    start() {
      Promise.resolve().then(fn).catch(() => {})  // immediate first call, errors caught
      timer = setInterval(() => {
        Promise.resolve().then(fn).catch(() => {})
      }, intervalMs)
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
