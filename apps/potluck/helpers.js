export function esc(string_) {
  return String(string_ ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

export function setStatus(message, isError = true) {
  let element = document.querySelector('#status');
  if (!element) {
    element = document.createElement('div');
    element.id = 'status';
    document.querySelector('#app').append(element);
  }
  element.className = isError ? 'err' : 'ok';
  element.textContent = message;
}

export function startPolling(function_, interval) {
  let timer = null;
  let paused = false;
  let rateLimited = false;

  function showRateLimitStatus(show) {
    if (show === rateLimited) return;
    rateLimited = show;
    setStatus(show ? 'Refreshing paused briefly…' : '', !show);
  }

  function schedule() {
    // eslint-disable-next-line no-use-before-define
    timer = setInterval(() => { if (!paused) tick(); }, interval);
  }

  async function tick() {
    try {
      await function_();
      showRateLimitStatus(false);
    } catch (error) {
      if (error.message?.includes('→ 429:')) {
        showRateLimitStatus(true);
        clearInterval(timer);
        timer = null;
        setTimeout(() => {
          showRateLimitStatus(false);
          if (!paused) schedule();
        }, 60_000);
      }
      // Non-429 errors: let fn's own error handler deal with them
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      paused = true;
      clearInterval(timer);
      timer = null;
    } else {
      paused = false;
      schedule();
    }
  });

  schedule();
}
