// Parse query param `gameId` and display it
function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

let gameId = getQueryParam('gameId');
if (gameId) gameId = gameId.trim();
document.getElementById('gameIdDisplay').textContent = gameId || '—';

// UI elements
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

// Fetch score history and draw a simple line chart on the canvas
async function refreshScoreChart() {
  if (!gameId) return;
  try {
    const res = await fetch(`/api/scoreHistory/${encodeURIComponent(gameId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    const participants = data.participants || [];
    const canvas = document.getElementById('scoreChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0,0,w,h);

    if (participants.length === 0) {
      ctx.fillStyle = '#666';
      ctx.fillText('No score history yet', 10, 20);
      return;
    }

    // Determine max length and max score
    let maxLen = 0;
    let maxScore = 0;
    participants.forEach(p => {
      if (Array.isArray(p.score_history)) {
        maxLen = Math.max(maxLen, p.score_history.length);
        p.score_history.forEach(v => { if (typeof v === 'number') maxScore = Math.max(maxScore, v); });
      }
    });
    maxScore = Math.max(maxScore, 1);

    // margins
    const margin = 40;
    const plotW = w - margin * 2;
    const plotH = h - margin * 2;

    // draw axes
    ctx.strokeStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin, margin + plotH);
    ctx.lineTo(margin + plotW, margin + plotH);
    ctx.stroke();

    // x-axis ticks (turns)
    const turns = Math.max(1, maxLen);
    for (let i = 0; i < turns; i++) {
      const x = margin + (i / Math.max(1, turns - 1)) * plotW;
      ctx.fillStyle = '#999';
      ctx.fillText(String(i+1), x - 6, margin + plotH + 14);
    }

    // colors palette
    const colors = ['#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c'];

    // plot each participant
    participants.forEach((p, idx) => {
      const hist = Array.isArray(p.score_history) ? p.score_history : [];
      if (hist.length === 0) return;
      const color = colors[idx % colors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      hist.forEach((val, j) => {
        const x = margin + (j / Math.max(1, turns - 1)) * plotW;
        const y = margin + plotH - (val / maxScore) * plotH;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // draw legend
      const lx = margin + 8;
      const ly = 8 + idx * 14;
      ctx.fillStyle = color;
      ctx.fillRect(w - margin - 80, ly - 8, 10, 8);
      ctx.fillStyle = '#000';
      ctx.fillText(p.username, w - margin - 64, ly);
    });
  } catch (e) {
    console.error('refreshScoreChart error', e);
  }
}

// Helper: join current game as logged-in user (only adds participant, does not navigate)
async function joinAsUser() {
  try {
    const res = await fetch('/api/joinGameAsUser', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'Failed to join game');
      return false;
    }

    // Refresh UI to reflect new participant membership
    await refreshPublicInfo();
    return true;
  } catch (e) {
    console.error('joinAsUser error', e);
    alert('Failed to join game');
    return false;
  }
}

function downloadGamePlaceholder() {
  // empty placeholder — intentionally does nothing for now
}

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
  const notice = document.getElementById('loginNotice');
  if (notice) notice.style.display = 'block';
  loggedInActions.style.display = 'none';
  enterGameBtn.disabled = true;
});

// Initialize
enterGameBtn.disabled = true;
refreshPublicInfo();
// poll frequently for responsive UI, but avoid re-wiring button handlers unnecessarily
let prevStage = null;
let lastEnterState = { text: null, disabled: null };
setInterval(async () => {
  const info = await refreshPublicInfo();

  // Update UI based on session and game state
  try {
    const s = await fetch('/api/session', { credentials: 'same-origin' });
    const sessionData = await s.json();

    // Determine stage label
    const stageNum = info && info.game ? info.game.stage : null;
    const stageStr = stageNum === 1 ? 'not_started' : stageNum === 2 ? 'started' : String(stageNum);

    // find if the current session user is a participant in this game
    let amParticipant = false;
    let amHost = false;
    if (sessionData.loggedIn && sessionData.user) {
      const uid = sessionData.user.userId;
      if (info && info.players && Array.isArray(info.players)) {
        const mePart = info.players.find(p => p.user_id === uid || p.username === sessionData.user.username);
        if (mePart) {
          amParticipant = true;
          amHost = !!mePart.is_host;
        }
      }
    }

    if (sessionData.loggedIn && sessionData.user) {
      document.getElementById('loginNotice').style.display = 'none';
      loggedInActions.style.display = 'block';

      // Compute desired state for enter button
      let desired = { text: '', disabled: true, handler: null };

      if (stageStr === 'completed') {
        desired.text = 'Download Game';
        desired.disabled = false;
        desired.handler = downloadGamePlaceholder;
      } else if (amParticipant) {
        if (stageStr === 'started') {
          desired.text = 'Enter Game';
          desired.disabled = false;
          desired.handler = () => { window.location.href = '/game'; };
        } else if (amHost && stageStr === 'not_started') {
          desired.text = 'Start Game';
          desired.disabled = false;
          desired.handler = startGame;
        } else {
          desired.text = 'Enter Game';
          desired.disabled = true;
          desired.handler = null;
        }
      } else {
        const hasRoom = info && info.game && (info.game.current_players < info.game.max_players);
        if (stageStr === 'not_started' && hasRoom) {
          desired.text = 'Join Game';
          desired.disabled = false;
          desired.handler = async () => {
            const ok = await joinAsUser();
            if (ok) {
              await fetch('/api/session', { credentials: 'same-origin' });
              await refreshPublicInfo();
            }
          };
        } else {
          desired.text = 'Join Game';
          desired.disabled = true;
          desired.handler = null;
        }
      }

      // Apply only when changed to avoid unnecessary resets
      if (lastEnterState.text !== desired.text || lastEnterState.disabled !== desired.disabled) {
        enterGameBtn.textContent = desired.text;
        enterGameBtn.disabled = desired.disabled;
        enterGameBtn.onclick = desired.handler;
        lastEnterState = { text: desired.text, disabled: desired.disabled };
      }

      // auto-navigate when stage transitions to started for participants
      if (amParticipant && prevStage !== null && prevStage !== stageStr && stageStr === 'started') {
        setTimeout(() => { window.location.href = '/game'; }, 50);
      }
      prevStage = stageStr;
    } else {
      document.getElementById('loginNotice').style.display = '';
      loggedInActions.style.display = 'none';
      enterGameBtn.disabled = true;
      enterGameBtn.textContent = 'Join / Enter Game';
    }
  } catch (e) {
    console.error('polling session error', e);
  }
}, 300);

// If a session already exists for this game, reflect logged-in state
async function checkSessionForGame() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.loggedIn) {
      loggedInActions.style.display = 'block';
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
