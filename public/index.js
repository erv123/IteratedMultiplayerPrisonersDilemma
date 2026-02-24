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

async function initLobby() {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('registerBtn').addEventListener('click', register);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('profileBtn').addEventListener('click', () => { window.location.href = 'profile.html'; });
  document.getElementById('createGameBtn').addEventListener('click', () => { window.location.href = 'createGame.html'; });

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

  if (session && session.loggedIn) {
    loginForm.style.display = 'none';
    loggedInActions.style.display = 'block';
    document.getElementById('welcomeMsg').textContent = `Hello, ${session.user.username}`;
  } else {
    loginForm.style.display = '';
    loggedInActions.style.display = 'none';
    document.getElementById('welcomeMsg').textContent = '';
  }
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
  if (stageNum === 1) return 'not_started';
  if (stageNum === 2) return 'started';
  return 'completed';
}

function makeGameLink(gameId) {
  const a = document.createElement('a');
  a.href = `gameInfo.html?gameId=${encodeURIComponent(gameId)}`;
  a.textContent = gameId;
  a.style.textDecoration = 'none';
  a.style.color = 'blue';
  return a;
}

async function renderGameListFromRows(rows) {
  const container = document.getElementById('gamesContainer');
  container.innerHTML = '';
  if (!Array.isArray(rows)) return;

  // For each row we need metadata and player list; batch fetch details and scores
  const ids = rows.map(r => r.id);
  const metas = await Promise.all(ids.map(id => window.api.get(`/games/${encodeURIComponent(id)}`).catch(() => null)));
  const playersList = await Promise.all(ids.map(id => window.api.get(`/scores/${encodeURIComponent(id)}/scores`).catch(() => null)));

  const games = ids.map((id, idx) => {
    const meta = metas[idx] && metas[idx].success ? metas[idx].data : (rows[idx] || {});
    const players = playersList[idx] && playersList[idx].success ? playersList[idx].data : [];
    return { id, info: { game: meta, players } };
  }).filter(g => g.info && g.info.game);

  const loggedIn = session && session.loggedIn;

  if (!loggedIn) {
    const major = document.createElement('div');
    const h = document.createElement('h4'); h.textContent = 'All Games'; major.appendChild(h);

    const subs = { not_started: [], started: [], completed: [] };
    games.forEach(g => {
      const stage = stageKey(g.info.game.stage);
      subs[stage].push(g);
    });

    Object.entries(subs).forEach(([k, list]) => {
      const sh = document.createElement('h5'); sh.textContent = k.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); major.appendChild(sh);
      const ul = document.createElement('div');
      list.forEach(item => {
        const row = document.createElement('div');
        row.appendChild(makeGameLink(item.id));
        row.appendChild(document.createTextNode(` — ${item.info.game.currentPlayers || item.info.game.current_players || 0}/${item.info.game.maxPlayers || item.info.game.max_players || 0}`));
        ul.appendChild(row);
      });
      major.appendChild(ul);
    });

    container.appendChild(major);
    return;
  }

  // Logged in: split into My Games and Other Games
  const myGames = { not_started: [], started: [], completed: [] };
  const otherGames = { not_started: [], started: [], completed: [] };

  const uid = session.user && session.user.id;
  games.forEach(g => {
    const stage = stageKey(g.info.game.stage);
    const players = g.info.players || [];
    const isMine = players.some(p => p.user_id === uid || p.id === uid || p.username === session.user.username);
    if (isMine) myGames[stage].push(g); else otherGames[stage].push(g);
  });

  const renderMajor = (title, buckets) => {
    const major = document.createElement('div');
    const h = document.createElement('h4'); h.textContent = title; major.appendChild(h);
    Object.entries(buckets).forEach(([k, list]) => {
      const sh = document.createElement('h5'); sh.textContent = k.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); major.appendChild(sh);
      const ul = document.createElement('div');
      list.forEach(item => {
        const row = document.createElement('div');
        row.appendChild(makeGameLink(item.id));
        const host = (item.info.players || []).find(p => p.is_host || p.isHost);
        if (host) row.appendChild(document.createTextNode(` — host: ${host.username} — ${item.info.game.currentPlayers || item.info.game.current_players || 0}/${item.info.game.maxPlayers || item.info.game.max_players || 0}`));
        else row.appendChild(document.createTextNode(` — ${item.info.game.currentPlayers || item.info.game.current_players || 0}/${item.info.game.maxPlayers || item.info.game.max_players || 0}`));
        ul.appendChild(row);
      });
      major.appendChild(ul);
    });
    return major;
  };

  const containerFrag = document.createDocumentFragment();
  containerFrag.appendChild(renderMajor('My Games', myGames));
  containerFrag.appendChild(renderMajor('Other Games', otherGames));
  container.innerHTML = '';
  container.appendChild(containerFrag);
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
