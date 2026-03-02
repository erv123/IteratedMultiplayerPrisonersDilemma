// presence.js - client-side heartbeat and unload handling for presence
(function(){
  if (!window || !window.api) return;

  const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30s
  let hbTimer = null;

  async function sendHeartbeat() {
    try {
      // use keepalive so it can run during unload
      await fetch('/api/presence/heartbeat', { method: 'POST', keepalive: true });
    } catch (e) { /* ignore */ }
  }

  function sendOfflineBeacon() {
    try {
      const url = window.location.origin + '/api/presence/offline';
      // send minimal payload; server only needs session cookie
      const blob = new Blob(['{}'], { type: 'application/json' });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, blob);
      } else {
        // fallback to synchronous XHR (not ideal) — try fetch keepalive
        fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  function startHeartbeat() {
    if (hbTimer) return;
    // immediate heartbeat then interval
    sendHeartbeat();
    hbTimer = setInterval(() => sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  // Start heartbeat when page is visible; stop when hidden to reduce load
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeartbeat(); else startHeartbeat();
  });

  // On pagehide / beforeunload / unload, send offline beacon so presence is cleared promptly
  window.addEventListener('pagehide', sendOfflineBeacon);
  window.addEventListener('beforeunload', sendOfflineBeacon);
  window.addEventListener('unload', sendOfflineBeacon);

  // Start now if visible
  if (!document.hidden) startHeartbeat();

  // Expose for debugging
  window.__presence = { startHeartbeat, stopHeartbeat, sendOfflineBeacon };
})();
