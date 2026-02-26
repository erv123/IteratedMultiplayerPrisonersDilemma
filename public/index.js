/*
public/index.js - Lobby page behavior (refactored)

Required exported / top-level functions (documented here for tests):
- initLobby() : Promise<void>
  - Description: initialize lobby UI, wire buttons, start polling for session and games
  - Preconditions: `window.api` and `window.polling` are available
  - Side effects: registers DOM event listeners, starts pollers

- refreshSession() : Promise<void>
  - Description: fetch `/api/auth/whoami` via `window.api.get` and update local `session` state

- updateAuthUI() : void
  - Description: update the login/logout UI based on `session` object

- login() : Promise<void>
  - Description: POST `/api/auth/login` with username/password using `window.api.post` and refresh session

- register() : Promise<void>
  - Description: POST `/api/auth/register` with username/password using `window.api.post` and refresh session

- logout() : Promise<void>
  - Description: POST `/api/auth/logout` (compat) and refresh session

- fetchGameList() : Promise<void>
  - Description: fetch list of games via `GET /api/games` and per-game metadata via `GET /api/games/:gameId` and player lists via `/api/scores/:gameId/scores`, then render into `#gamesContainer`.

- makeGameLink(gameId) : HTMLAnchorElement
  - Description: DOM helper to create a link to `gameInfo.html?gameId=`

- stageKey(stageNum) : string
  - Description: map numeric stage to string key `not_started|started|completed`

All functions return consistent behavior and emit UI updates rather than throwing for recoverable network errors.
*/

let session = null;
// cache of last rendered game state by gameId to avoid unnecessary DOM updates
const _prevGameRenderMap = new Map();
// track previous login state to detect transitions
let _prevSessionLoggedIn = null;

async function initLobby() {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('registerBtn').addEventListener('click', register);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  // allow Enter key in login fields to trigger login
  const userInput = document.getElementById('username');
  const passInput = document.getElementById('password');
  if (userInput) userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); login(); } });
  if (passInput) passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); login(); } });
  document.getElementById('profileBtn').addEventListener('click', () => { window.location.href = '/profile'; });
  document.getElementById('createGameBtn').addEventListener('click', () => { window.location.href = '/createGame'; });

  // handle centralized sessionExpired event
  window.addEventListener('sessionExpired', () => { refreshSession(); });

  // start polling for session and games using the centralized poller
  try {
    const sessionPoll = window.polling.startPolling('lobby.session', async () => {
      return await window.api.get('/auth/whoami');
    }, 2000, { immediate: true, backoff: { factor: 2, maxMs: 30000 }, jitter: 0.15 });

    sessionPoll.subscribe((err, res) => {
      if (!err && res && res.success) {
        session = res.data ? { loggedIn: true, user: res.data } : { loggedIn: false };
      } else {
        session = { loggedIn: false };
      }
      updateAuthUI();
    });

    const gamesPoll = window.polling.startPolling('lobby.games', async () => {
      return await window.api.get('/games');
    }, 3000, { immediate: true, backoff: { factor: 2, maxMs: 60000 }, jitter: 0.1 });

    gamesPoll.subscribe(async (err, res) => {
      if (!err && res && res.success) {
        await renderGameListFromRows(res.data || []);
      } else {
        // show empty or error state
        const container = document.getElementById('gamesContainer');
        container.innerHTML = '<div>Unable to load games</div>';
      }
    });
  } catch (e) {
    // fallback: single-shot refreshes
    await refreshSession();
    await fetchGameList();
  }
}

async function refreshSession() {
  try {
    const res = await window.api.get('/auth/whoami');
    if (res && res.success && res.data) session = { loggedIn: true, user: res.data };
    else session = { loggedIn: false };
  } catch (e) {
    console.error('session fetch failed', e);
    session = { loggedIn: false };
  }
  updateAuthUI();
}

function updateAuthUI() {
  const loginForm = document.getElementById('loginForm');
  const loggedInActions = document.getElementById('loggedInActions');
  const loggedInNow = !!(session && session.loggedIn);

  // If login state changed (login -> logout or logout -> login), clear render cache and force full redraw
  if (_prevSessionLoggedIn !== null && _prevSessionLoggedIn !== loggedInNow) {
    _prevGameRenderMap.clear();
    // clear container so next fetch builds correct sections for the new auth state
    const container = document.getElementById('gamesContainer');
    if (container) container.innerHTML = '';
    // request a fresh fetch to rebuild UI according to new auth state
    try { fetchGameList(); } catch (e) { /* ignore */ }
  }

  if (loggedInNow) {
    loginForm.style.display = 'none';
    loggedInActions.style.display = 'block';
    document.getElementById('welcomeMsg').textContent = `Hello, ${session.user.username}`;
  } else {
    loginForm.style.display = '';
    loggedInActions.style.display = 'none';
    document.getElementById('welcomeMsg').textContent = '';
  }

  // show/hide create game button based on auth
  const createBtn = document.getElementById('createGameBtn');
  if (createBtn) createBtn.style.display = loggedInNow ? '' : 'none';

  _prevSessionLoggedIn = loggedInNow;
}

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username || !password) return alert('Username and password required');

  try {
    const data = await window.api.post('/auth/login', { username, password });
    if (data && data.success) {
      await refreshSession();
      fetchGameList();
    } else {
      alert((data && data.error && data.error.message) || 'Login failed');
    }
  } catch (e) {
    alert('Network error');
  }
}

async function register() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username || !password) return alert('Username and password required');

  try {
    const data = await window.api.post('/auth/register', { username, password });
    if (data && data.success) {
      await refreshSession();
      fetchGameList();
    } else {
      alert((data && data.error && data.error.message) || 'Registration failed');
    }
  } catch (e) {
    alert('Network error');
  }
}

async function logout() {
  try {
    await window.api.post('/auth/logout');
  } catch (e) {
    // ignore
  }
  await refreshSession();
  fetchGameList();
}

function stageKey(stageNum) {
  // Accept numeric or string inputs. If already a known key, return it.
  if (typeof stageNum === 'string') {
    const s = stageNum.trim();
    if (s === 'not_started' || s === 'started' || s === 'completed') return s;
  }
  const n = Number(stageNum);
  if (!Number.isNaN(n)) {
    if (n === 1) return 'not_started';
    if (n === 2) return 'started';
  }
  return 'completed';
}

function makeGameLink(gameId, name) {
  const a = document.createElement('a');
  a.href = `/gameInfo?gameId=${encodeURIComponent(gameId)}`;
  a.textContent = (name && String(name).trim()) ? String(name) : String(gameId);
  a.style.textDecoration = 'none';
  a.style.color = 'blue';
  return a;
}

async function renderGameListFromRows(rows) {
  const container = document.getElementById('gamesContainer');
  if (!Array.isArray(rows)) return;
  console.log('renderGameListFromRows start', { rowsCount: Array.isArray(rows) ? rows.length : 0, sessionLoggedIn: !!(session && session.loggedIn) });

  // For each row we need metadata and player list; batch fetch details and scores
  const ids = rows.map(r => r.id);
  const metas = await Promise.all(ids.map(id => window.api.get(`/games/${encodeURIComponent(id)}`).catch(() => null)));
  const playersList = await Promise.all(ids.map(id => window.api.get(`/scores/${encodeURIComponent(id)}`).catch(() => null)));
  console.log('renderGameListFromRows fetched', { metas: metas.length, playersLists: playersList.length });

  const games = ids.map((id, idx) => {
    const meta = metas[idx] && metas[idx].success ? metas[idx].data : (rows[idx] || {});
    const players = playersList[idx] && playersList[idx].success ? playersList[idx].data : [];
    return { id, info: { game: meta, players } };
  }).filter(g => g.info && g.info.game);
  console.log('renderGameListFromRows built games', { count: games.length, sample: games.slice(0,3) });

  const loggedIn = session && session.loggedIn;

  // helper: ensure a named section exists and return its body element
  function ensureSection(containerEl, key, title) {
    let sect = containerEl.querySelector(`[data-section="${key}"]`);
    if (!sect) {
      sect = document.createElement('div');
      sect.setAttribute('data-section', key);
      const h = document.createElement('h4'); h.textContent = title; sect.appendChild(h);
      const body = document.createElement('div'); body.setAttribute('data-body', ''); sect.appendChild(body);
      containerEl.appendChild(sect);
    }
    return sect.querySelector('[data-body]');
  }

  // utility to create a stable DOM id for data attributes
  function domIdFor(gameId) {
    return String(gameId);
  }

  // Build buckets similar to previous behavior
  if (!loggedIn) {
    console.log('renderGameListFromRows: rendering public (not logged in) view');
    const body = ensureSection(container, 'allGames', 'All Games');
      const subs = { not_started: [], started: [], completed: [] };
      games.forEach(g => {
        const sNum = Number(g.info.game && g.info.game.stage);
        const stage = (sNum === 1) ? 'not_started' : (sNum === 2) ? 'started' : 'completed';
        subs[stage].push(g);
      });

    const currentIds = new Set();
    Object.entries(subs).forEach(([k, list]) => {
      const subKey = `all-${k}`;
      let subBody = body.querySelector(`[data-subsection="${subKey}"]`);
      if (!subBody) {
        const sh = document.createElement('h5'); sh.textContent = k.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        body.appendChild(sh);
        subBody = document.createElement('div'); subBody.setAttribute('data-subsection', subKey);
        body.appendChild(subBody);
      } else {
        // keep existing subBody
      }

      list.forEach(item => {
        const id = domIdFor(item.id);
        currentIds.add(id);
        const host = (item.info.players || []).find(p => p.is_host || p.isHost);
        const currentCount = (item.info && item.info.players) ? (item.info.players.length) : (item.info.game && (item.info.game.currentPlayers || item.info.game.current_players) || 0);
        const maxCount = (item.info && item.info.game) ? (item.info.game.maxPlayers || item.info.game.max_players || 0) : 0;
        const textKey = JSON.stringify({ stage: k, current: currentCount, max: maxCount, host: host && host.username });
        const prev = _prevGameRenderMap.get(id);
        let row = subBody.querySelector(`[data-game-id="${id}"]`);
        if (prev === textKey && row) { console.log('renderGameListFromRows: skip unchanged', id); return; }

        if (!row) {
          row = document.createElement('div');
          row.setAttribute('data-game-id', id);
          const link = makeGameLink(item.id, (item.info && item.info.game && item.info.game.name));
          link.setAttribute('data-link', '');
          row.appendChild(link);
          const txt = document.createElement('span'); txt.setAttribute('data-meta', ''); row.appendChild(txt);
          subBody.appendChild(row);
          console.log('renderGameListFromRows: created row', id, { name: (item.info && item.info.game && item.info.game.name) });
        }

        const link = row.querySelector('[data-link]');
        const txt = row.querySelector('[data-meta]');
        link.textContent = (item.info && item.info.game && item.info.game.name) ? String(item.info.game.name) : String(item.id);
        txt.textContent = ` — ${currentCount}/${maxCount}`;
        console.log('renderGameListFromRows: updated row', id, { linkText: link.textContent, metaText: txt.textContent });

        _prevGameRenderMap.set(id, textKey);
      });

      // remove stale children in this subsection
      const children = Array.from(subBody.querySelectorAll('[data-game-id]'));
      children.forEach(c => { const gid = c.getAttribute('data-game-id'); if (!currentIds.has(gid)) { c.remove(); _prevGameRenderMap.delete(gid); console.log('renderGameListFromRows: removed stale', gid); } });
    });

    return;
  }

  // Logged in view: My Games and Other Games
  const myGames = { not_started: [], started: [], completed: [] };
  const otherGames = { not_started: [], started: [], completed: [] };
  const uid = session.user && session.user.id;
  games.forEach(g => {
    const sNum = Number(g.info.game && g.info.game.stage);
    const stage = (sNum === 1) ? 'not_started' : (sNum === 2) ? 'started' : 'completed';
    const players = g.info.players || [];
    // My games are games where the current user is a participant (joined), not just the host
    const isMine = players.some(p => (p.user_id && uid && p.user_id === uid) || (p.id && uid && p.id === uid) || (p.username && session.user && p.username === session.user.username));
    if (isMine) myGames[stage].push(g); else otherGames[stage].push(g);
  });

  const currentIds = new Set();

  const renderBucket = (title, buckets, containerKey) => {
    const body = ensureSection(container, containerKey, title).parentElement.querySelector('[data-body]') || ensureSection(container, containerKey, title);
    console.log('renderGameListFromRows: renderBucket', containerKey, Object.keys(buckets).reduce((acc,k)=> (acc[k]=buckets[k].length, acc), {}));
    Object.entries(buckets).forEach(([k, list]) => {
      const subKey = `${containerKey}-${k}`;
      let subBody = body.querySelector(`[data-subsection="${subKey}"]`);
      if (!subBody) {
        const sh = document.createElement('h5'); sh.textContent = k.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        body.appendChild(sh);
        subBody = document.createElement('div'); subBody.setAttribute('data-subsection', subKey);
        body.appendChild(subBody);
      }

        list.forEach(item => {
        const id = domIdFor(item.id);
        currentIds.add(id);
        const host = (item.info.players || []).find(p => p.is_host || p.isHost);
        const currentCount = (item.info && item.info.players) ? (item.info.players.length) : (item.info.game && (item.info.game.currentPlayers || item.info.game.current_players) || 0);
        const maxCount = (item.info && item.info.game) ? (item.info.game.maxPlayers || item.info.game.max_players || 0) : 0;
        const textKey = JSON.stringify({ stage: k, current: currentCount, max: maxCount, host: host && host.username });
        const prev = _prevGameRenderMap.get(id);
        let row = subBody.querySelector(`[data-game-id="${id}"]`);
        if (prev === textKey && row) { console.log('renderGameListFromRows: skip unchanged', id); return; }

        if (!row) {
          row = document.createElement('div');
          row.setAttribute('data-game-id', id);
          const link = makeGameLink(item.id, (item.info && item.info.game && item.info.game.name));
          link.setAttribute('data-link', '');
          row.appendChild(link);
          const txt = document.createElement('span'); txt.setAttribute('data-meta', ''); row.appendChild(txt);
          subBody.appendChild(row);
          console.log('renderGameListFromRows: created row', id, { name: (item.info && item.info.game && item.info.game.name) });
        }

        const link = row.querySelector('[data-link]');
        const txt = row.querySelector('[data-meta]');
        link.textContent = (item.info && item.info.game && item.info.game.name) ? String(item.info.game.name) : String(item.id);
        if (host) txt.textContent = ` — host: ${host.username} — ${currentCount}/${maxCount}`;
        else txt.textContent = ` — ${currentCount}/${maxCount}`;

        _prevGameRenderMap.set(id, textKey);
        console.log('renderGameListFromRows: updated row', id, { linkText: link.textContent || null, metaText: txt.textContent || null });
      });

      // cleanup stale
      const children = Array.from(subBody.querySelectorAll('[data-game-id]'));
      children.forEach(c => { const gid = c.getAttribute('data-game-id'); if (!currentIds.has(gid)) { c.remove(); _prevGameRenderMap.delete(gid); } });
    });
  };

  renderBucket('My Games', myGames, 'myGames');
  renderBucket('Other Games', otherGames, 'otherGames');
}

async function fetchGameList() {
  try {
    const res = await window.api.get('/games');
    if (!res || !res.success) return renderGameListFromRows([]);
    await renderGameListFromRows(res.data || []);
  } catch (e) {
    console.error('failed to fetch games', e);
  }
}

// Expose minimal functions for tests
window.lobby = { initLobby, refreshSession, fetchGameList };
