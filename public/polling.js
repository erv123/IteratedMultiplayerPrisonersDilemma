// Central polling manager with exponential backoff and jitter
(function () {
  const pollers = new Map();

  function startPolling(key, fn, intervalMs, opts = {}) {
    if (pollers.has(key)) return pollers.get(key).controller;

    const listeners = new Set();
    const backoff = Object.assign({ factor: 2, maxMs: 60000 }, opts.backoff || {});
    const jitter = typeof opts.jitter === 'number' ? opts.jitter : 0.1;
    let stopped = false;
    let currentInterval = intervalMs;

    async function tick() {
      if (stopped) return;
      try {
        const result = await fn();
        // reset interval on success
        currentInterval = intervalMs;
        listeners.forEach((l) => {
          try { l(null, result); } catch (e) { console.error('poll listener error', e); }
        });
      } catch (err) {
        listeners.forEach((l) => {
          try { l(err, null); } catch (e) { console.error('poll listener error', e); }
        });
        // backoff
        currentInterval = Math.min(backoff.maxMs, Math.floor(currentInterval * backoff.factor));
        // apply jitter
        const variance = Math.floor(currentInterval * jitter);
        currentInterval = Math.max(1000, currentInterval + Math.floor((Math.random() * 2 - 1) * variance));
      }

      if (!stopped) {
        setTimeout(tick, currentInterval);
      }
    }

    // schedule first run
    setTimeout(tick, opts.immediate === false ? currentInterval : 0);

    const controller = {
      stop() {
        stopped = true;
        pollers.delete(key);
      },
      subscribe(listener) { listeners.add(listener); },
      unsubscribe(listener) { listeners.delete(listener); },
    };

    pollers.set(key, { controller, listeners });
    return controller;
  }

  function stopPolling(key) {
    const entry = pollers.get(key);
    if (entry) entry.controller.stop();
  }

  function subscribe(key, listener) {
    const entry = pollers.get(key);
    if (!entry) throw new Error('No poller for key: ' + key);
    entry.listeners.add(listener);
  }

  function unsubscribe(key, listener) {
    const entry = pollers.get(key);
    if (!entry) return;
    entry.listeners.delete(listener);
  }

  window.polling = { startPolling, stopPolling, subscribe, unsubscribe };
})();
