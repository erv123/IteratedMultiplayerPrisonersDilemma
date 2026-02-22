// Parse query param `gameId` and display it
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

let gameId = getQueryParam('gameId');
if (gameId) gameId = gameId.trim();
document.getElementById('gameIdDisplay').textContent = gameId || '—';

// UI elements
const loginSection = document.getElementById('loginSection');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const enterGameBtn = document.getElementById('enterGameBtn');
const loggedInActions = document.getElementById('loggedInActions');
const playersList = document.getElementById('playersList');
const statusEl = document.getElementById('status');

async function refreshPublicInfo() {
  if (!gameId) {
    statusEl.textContent = 'No gameId in URL';
    playersList.textContent = '';
    return null;
  }
  try {
    const res = await fetch(`/api/publicGame/${encodeURIComponent(gameId)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('publicGame fetch failed', res.status, text);
      statusEl.textContent = `Status: Game not found (HTTP ${res.status})`;
      playersList.textContent = '';
      return null;
    }
    const data = await res.json();
    const g = data.game;

    // interpret stage numeric -> string (use consistent lowercase tokens)
    let stageLabel = String(g.stage);
    if (g.stage === 1) stageLabel = 'not_started';
    if (g.stage === 2) stageLabel = 'started';

    // display a nicer label to users
    const displayStage = stageLabel === 'not_started' ? 'Not Started' : stageLabel === 'started' ? 'Started' : stageLabel;
    statusEl.textContent = `Stage: ${displayStage} — Players: ${g.current_players}/${g.max_players}`;

    if (data.players && data.players.length > 0) {
      playersList.innerHTML = '';
      data.players.forEach(p => {
        const div = document.createElement('div');
        div.textContent = p.username + (p.is_host ? ' (host)' : '');
        playersList.appendChild(div);
      });
    } else {
      playersList.textContent = '(no players yet)';
    }

    return { game: g, players: data.players };
  } catch (e) {
    console.error('refreshPublicInfo error', e);
    statusEl.textContent = 'Error fetching game info';
    return null;
  }
}

// Login / join
loginBtn.addEventListener('click', async () => {
  const user = document.getElementById('gi_username').value.trim();
  const pass = document.getElementById('gi_password').value;
  if (!user || !pass) {
    alert('Username and password are required');
    return;
  }

  try {
    const res = await fetch('/api/joinGame', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, username: user, password: pass })
    });

    const data = await res.json();
    if (data.success) {
      // logged in
      loginSection.style.display = 'none';
      loggedInActions.style.display = 'block';
      enterGameBtn.disabled = false;
      await refreshPublicInfo();
    } else {
      alert(data.message || 'Login failed');
    }
  } catch (e) {
    console.error(e);
  }
});

// Enter game (server will check session)
enterGameBtn.addEventListener('click', () => {
  window.location.href = '/game';
});

// Start game (host) — used when host sees not_started
async function startGame() {
  // fetch latest public info to get current players/max
  const info = await refreshPublicInfo();
  if (!info) return;
  const g = info.game;

  const isFull = g.current_players >= g.max_players;
  if (!isFull) {
    const ok = confirm('Game is not full. Start anyway?');
    if (!ok) return;
  }

  // call server to start
  const res = await fetch('/api/startGame', { method: 'POST', credentials: 'same-origin' });
  const data = await res.json();
  if (data.success) {
    // navigate to game
    window.location.href = '/game';
  } else {
    alert(data.message || 'Failed to start game');
  }
}

// Logout
logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  loginSection.style.display = 'block';
  loggedInActions.style.display = 'none';
  enterGameBtn.disabled = true;
});

// Initialize
enterGameBtn.disabled = true;
refreshPublicInfo();
// poll every second
let prevStage = null;
setInterval(async () => {
  const info = await refreshPublicInfo();

  // Update UI based on session and game state
  try {
    const s = await fetch('/api/session', { credentials: 'same-origin' });
    const sessionData = await s.json();

    const loggedInHere = sessionData.loggedIn && sessionData.user && sessionData.user.gameId === gameId;
    // Determine host status by asking server for current player's record
    let amHost = false;
    if (loggedInHere) {
      try {
        const mp = await fetch('/api/myPlayer', { credentials: 'same-origin' });
        if (mp.ok) {
          const mpData = await mp.json();
          if (mpData.success && mpData.player) {
            const isHostVal = mpData.player.is_host;
            amHost = (isHostVal === 1 || isHostVal === '1' || isHostVal === true);
          }
        }
      } catch (e) {
        console.error('failed to fetch myPlayer', e);
      }
    }

    // Determine stage label
    const stageNum = info && info.game ? info.game.stage : null;
    const stageStr = stageNum === 1 ? 'not_started' : stageNum === 2 ? 'started' : String(stageNum);

    if (loggedInHere) {
      loginSection.style.display = 'none';
      loggedInActions.style.display = 'block';
      // host and not started -> show Start Game button
      if (amHost && stageStr === 'not_started') {
        enterGameBtn.textContent = 'Start Game';
        enterGameBtn.onclick = startGame;
        enterGameBtn.disabled = false;
      } else {
        enterGameBtn.textContent = 'Enter Game';
        enterGameBtn.onclick = () => { window.location.href = '/game'; };

        // non-host: disable enter if not started
        if (!amHost && stageStr !== 'started') {
          enterGameBtn.disabled = true;
        } else {
          enterGameBtn.disabled = false;
        }
      }

      // Only auto-navigate once when the stage transitions to 'started'
      if (prevStage !== null && prevStage !== stageStr && stageStr === 'started') {
        setTimeout(() => { window.location.href = '/game'; }, 50);
      }
      prevStage = stageStr;
    } else {
      // not logged in locally
      loginSection.style.display = '';
      loggedInActions.style.display = 'none';
      enterGameBtn.disabled = true;
      enterGameBtn.textContent = 'Enter Game';
    }
  } catch (e) {
    console.error('polling session error', e);
  }
}, 1000);

// If a session already exists for this game, reflect logged-in state
async function checkSessionForGame() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.loggedIn && data.user && data.user.gameId === gameId) {
      // user already logged into this game
      loginSection.style.display = 'none';
      loggedInActions.style.display = 'block';
      enterGameBtn.disabled = false;
      await refreshPublicInfo();
    }
  } catch (e) {
    console.error('checkSessionForGame failed', e);
  }
}

checkSessionForGame();

// Back to lobby button
const backLobbyBtn = document.getElementById('backLobbyBtn');
if (backLobbyBtn) {
  backLobbyBtn.addEventListener('click', () => {
    window.location.href = '/';
  });
}
