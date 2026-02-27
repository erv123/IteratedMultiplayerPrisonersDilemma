// Centralized frontend API wrapper
(function () {
  function buildUrl(path) {
    if (!path) return '/api';
    if (path.startsWith('/api')) return path;
    if (path.startsWith('/')) return '/api' + path;
    return '/api/' + path.replace(/^\//, '');
  }

  async function fetchJSON(path, options = {}) {
    // Derive a normalized debug name from the path (replace ids with :id)
    try {
      const origPath = path || '';
      const normalized = String(origPath)
        // replace UUID-like segments
        .replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/g, '/:id')
        // replace numeric segments
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        // collapse multiple slashes
        .replace(/\/+/g, '/')
        .replace(/(^\/|\/$)/g, '');
      const debugName = normalized.replace(/\//g, '.');
      options.headers = Object.assign({}, options.headers || {}, { 'X-Debug-Name': debugName });
    } catch (e) {
      // ignore debug name failures
    }

    const url = buildUrl(path);
    const opts = Object.assign({}, options);
    opts.credentials = opts.credentials || 'same-origin';

    opts.headers = Object.assign({}, opts.headers || {});
    opts.headers.Accept = opts.headers.Accept || 'application/json';

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      // Network error
      const e = new Error('Network error');
      e.cause = err;
      throw e;
    }

    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (err) {
        const e = new Error('Invalid JSON response');
        e.status = res.status;
        throw e;
      }
    }

    if (res.status === 401) {
      try {
        window.dispatchEvent(new CustomEvent('sessionExpired', { detail: { status: 401 } }));
      } catch (e) {}
    }

    // Return parsed envelope when available, otherwise a simple object
    return json === null ? { success: res.ok, status: res.status } : json;
  }

  function get(path) {
    return fetchJSON(path, { method: 'GET' });
  }

  function post(path, body) {
    return fetchJSON(path, { method: 'POST', body });
  }

  function put(path, body) {
    return fetchJSON(path, { method: 'PUT', body });
  }

  function del(path, body) {
    return fetchJSON(path, { method: 'DELETE', body });
  }

  // expose to window for legacy pages without bundling
  window.api = {
    fetchJSON,
    get,
    post,
    put,
    del,
  };
})();
