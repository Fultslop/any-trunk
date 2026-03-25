// apps/hunt/lib/poller.js

export function createPoller(function_, intervalMs) {
  let timer = null;
  return {
    start() {
      Promise.resolve().then(function_).catch(() => {}); // immediate first call, errors caught
      timer = setInterval(() => {
        Promise.resolve().then(function_).catch(() => {});
      }, intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
