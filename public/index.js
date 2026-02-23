let session = null;

async function initLobby() {
  // wire up auth buttons
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('registerBtn').addEventListener('click', register);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('profileBtn').addEventListener('click', () => { window.location.href = '/profile.html'; });

  await refreshSession();
  await fetchGameList();

  // Poll frequently for fast UI updates without re-wiring buttons
  setInterval(async () => {
    await refreshSession();
    await fetchGameList();
  }, 300);
}

async function refreshSession() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    session = await res.json();
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

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    await refreshSession();
    fetchGameList();
  } else {
    alert(data.message || 'Login failed');
  }
}

async function register() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username || !password) return alert('Username and password required');

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    await refreshSession();
    fetchGameList();
  } else {
    alert(data.message || 'Registration failed');
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
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

async function fetchGameList() {
  const res = await fetch('/api/listGames');
  const data = await res.json();
  const container = document.getElementById('gamesContainer');
  container.innerHTML = '';
  if (!data || !Array.isArray(data.gameIds)) return;

  // Fetch details for all games in parallel
  const details = await Promise.all(data.gameIds.map(id =>
    fetch(`/api/publicGame/${encodeURIComponent(id)}`).then(r => r.ok ? r.json().catch(() => null) : null).catch(() => null)
  ));

  // Filter out failures and normalize
  const games = details.map(d => d && d.success ? d : null).map((d, idx) => ({ id: data.gameIds[idx], info: d })).filter(g => g.info !== null);

  const loggedIn = session && session.loggedIn;

  if (!loggedIn) {
    // single major category: All Games
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
        row.appendChild(document.createTextNode(` — ${item.info.game.current_players}/${item.info.game.max_players}`));
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

  const uid = session.user.userId;
  games.forEach(g => {
    const stage = stageKey(g.info.game.stage);
    const players = g.info.players || [];
    const isMine = players.some(p => p.user_id === uid || p.username === session.user.username);
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
        // show host if available
        const host = (item.info.players || []).find(p => p.is_host);
        if (host) row.appendChild(document.createTextNode(` — host: ${host.username} — ${item.info.game.current_players}/${item.info.game.max_players}`));
        else row.appendChild(document.createTextNode(` — ${item.info.game.current_players}/${item.info.game.max_players}`));
        ul.appendChild(row);
      });
      major.appendChild(ul);
    });
    return major;
  };

  container.appendChild(renderMajor('My Games', myGames));
  container.appendChild(renderMajor('Other Games', otherGames));
}