// GameInfo page — uses window.api and window.polling
(function () {
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  const gameIdRaw = getQueryParam('gameId');
  const gameId = gameIdRaw ? gameIdRaw.trim() : '';
  document.getElementById('gameIdDisplay').textContent = gameId || '—';

  const logoutBtn = document.getElementById('logoutBtn');
  const enterGameBtn = document.getElementById('enterGameBtn');
  const loggedInActions = document.getElementById('loggedInActions');
  const playersList = document.getElementById('playersList');
  const statusEl = document.getElementById('status');
  const loginNotice = document.getElementById('loginNotice');

  let lastEnterState = { text: null, disabled: null };
  let prevStage = null;

  async function fetchPublicInfo() {
    if (!gameId) return null;
    try {
      const res = await window.api.get(`/games/${encodeURIComponent(gameId)}`);
      if (!res || !res.success) return null;
      // response: { data: { game, players } }
      return res.data;
    } catch (e) {
      console.error('fetchPublicInfo error', e);
      return null;
    }
  }

  async function fetchScoreHistory() {
    if (!gameId) return null;
    try {
      const res = await window.api.get(`/scores/${encodeURIComponent(gameId)}/score-history`);
      if (!res || !res.success) return null;
      return res.data; // array of { id, username, scoreHistory }
    } catch (e) {
      console.error('fetchScoreHistory error', e);
      return null;
    }
  }

  function renderPlayers(players) {
    if (!players || players.length === 0) {
      playersList.textContent = '(no players yet)';
      return;
    }
    playersList.innerHTML = '';
    players.forEach(p => {
      const div = document.createElement('div');
      const hostLabel = p.is_host ? ' (host)' : '';
      div.textContent = `${p.username || p.user_id || p.id}${hostLabel}`;
      playersList.appendChild(div);
    });
  }

  function renderStatus(game) {
    if (!game) { statusEl.textContent = 'No game info'; return; }
    let stageLabel = String(game.stage);
    if (game.stage === 1) stageLabel = 'not_started';
    if (game.stage === 2) stageLabel = 'started';
    const displayStage = stageLabel === 'not_started' ? 'Not Started' : stageLabel === 'started' ? 'Started' : stageLabel;
    statusEl.textContent = `Stage: ${displayStage} — Players: ${game.currentPlayers || game.current_players || 0}/${game.maxPlayers || game.max_players || 0}`;
  }

  // draw score chart similar to legacy implementation
  function drawScoreChart(participants) {
    const canvas = document.getElementById('scoreChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0,0,w,h);
    if (!participants || participants.length === 0) {
      ctx.fillStyle = '#666'; ctx.fillText('No score history yet', 10, 20); return;
    }

    let maxLen = 0; let maxScore = 0;
    participants.forEach(p => { const hist = p.scoreHistory || p.score_history || []; maxLen = Math.max(maxLen, hist.length); hist.forEach(v => { if (typeof v === 'number') maxScore = Math.max(maxScore, v); }); });
    maxScore = Math.max(1, maxScore);
    const margin = 40; const plotW = w - margin * 2; const plotH = h - margin * 2;
    ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(margin, margin); ctx.lineTo(margin, margin + plotH); ctx.lineTo(margin + plotW, margin + plotH); ctx.stroke();
    const turns = Math.max(1, maxLen);
    for (let i = 0; i < turns; i++) { const x = margin + (i / Math.max(1, turns - 1)) * plotW; ctx.fillStyle = '#999'; ctx.fillText(String(i+1), x - 6, margin + plotH + 14); }
    const colors = ['#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6','#bcf60c'];
    participants.forEach((p, idx) => {
      const hist = p.scoreHistory || p.score_history || [];
      if (!hist || hist.length === 0) return;
      const color = colors[idx % colors.length]; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      hist.forEach((val, j) => { const x = margin + (j / Math.max(1, turns - 1)) * plotW; const y = margin + plotH - (val / maxScore) * plotH; if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
      const ly = 8 + idx * 14; ctx.fillStyle = color; ctx.fillRect(w - margin - 80, ly - 8, 10, 8); ctx.fillStyle = '#000'; ctx.fillText(p.username, w - margin - 64, ly);
    });
  }

  async function joinAsUser() {
    try {
      const res = await window.api.post(`/games/${encodeURIComponent(gameId)}/join`, {});
      if (!res || !res.success) {
        alert((res && res.error && res.error.message) || 'Failed to join game');
        return false;
      }
      return true;
    } catch (e) {
      console.error('joinAsUser error', e);
      alert('Failed to join game');
      return false;
    }
  }

  async function startGame() {
    const info = await fetchPublicInfo();
    if (!info || !info.game) return;
    const g = info.game;
    const isFull = (g.currentPlayers || g.current_players || 0) >= (g.maxPlayers || g.max_players || 0);
    if (!isFull) {
      const ok = confirm('Game is not full. Start anyway?'); if (!ok) return;
    }
    try {
      const res = await window.api.post(`/games/${encodeURIComponent(gameId)}/start`, {});
      if (res && res.success) {
        window.location.href = '/game';
      } else {
        alert((res && res.error && res.error.message) || 'Failed to start game');
      }
    } catch (e) { alert('Failed to start game'); }
  }

  logoutBtn.addEventListener('click', async () => {
    await window.api.post('/auth/logout');
    loginNotice.style.display = 'block'; loggedInActions.style.display = 'none'; enterGameBtn.disabled = true;
  });

  // Setup pollers
  const infoPollerKey = `gameInfo:${gameId}`;
  const historyPollerKey = `scoreHistory:${gameId}`;

  const infoPoller = window.polling.startPolling(infoPollerKey, async () => {
    return await fetchPublicInfo();
  }, 3000, { immediate: true });

  infoPoller.subscribe(async (err, result) => {
    if (err) { console.error('info poller error', err); return; }
    const info = result;
    if (!info) return;
    renderStatus(info.game);
    renderPlayers(info.players || []);

    // check session and update enter/join button state
    try {
      const who = await window.api.get('/auth/whoami');
      const sessionUser = who && who.success ? who.data : null;
      if (sessionUser) {
        loginNotice.style.display = 'none'; loggedInActions.style.display = 'block';
      } else {
        loginNotice.style.display = ''; loggedInActions.style.display = 'none'; enterGameBtn.disabled = true; enterGameBtn.textContent = 'Join / Enter Game';
      }

      // determine participant membership and host status
      const players = info.players || [];
      let amParticipant = false; let amHost = false;
      if (sessionUser && players.length) {
        const me = players.find(p => (p.user_id && sessionUser.id && p.user_id === sessionUser.id) || p.username === sessionUser.username);
        if (me) { amParticipant = true; amHost = !!me.is_host; }
      }

      const stageNum = info.game ? info.game.stage : null;
      const stageStr = stageNum === 1 ? 'not_started' : stageNum === 2 ? 'started' : String(stageNum);

      let desired = { text: '', disabled: true, handler: null };
      if (!sessionUser) {
        desired = { text: 'Join / Enter Game', disabled: true, handler: null };
      } else if (stageStr === 'completed') {
        desired = { text: 'Download Game', disabled: false, handler: () => {} };
      } else if (amParticipant) {
        if (stageStr === 'started') {
          desired = { text: 'Enter Game', disabled: false, handler: () => { window.location.href = '/game'; } };
        } else if (amHost && stageStr === 'not_started') {
          desired = { text: 'Start Game', disabled: false, handler: startGame };
        } else {
          desired = { text: 'Enter Game', disabled: true, handler: null };
        }
      } else {
        const hasRoom = info.game && ((info.game.currentPlayers || info.game.current_players || 0) < (info.game.maxPlayers || info.game.max_players || 0));
        if (stageStr === 'not_started' && hasRoom) {
          desired = { text: 'Join Game', disabled: false, handler: async () => { const ok = await joinAsUser(); if (ok) { await window.api.get('/auth/whoami'); } } };
        } else {
          desired = { text: 'Join Game', disabled: true, handler: null };
        }
      }

      if (lastEnterState.text !== desired.text || lastEnterState.disabled !== desired.disabled) {
        enterGameBtn.textContent = desired.text; enterGameBtn.disabled = desired.disabled; enterGameBtn.onclick = desired.handler; lastEnterState = { text: desired.text, disabled: desired.disabled };
      }

      if (amParticipant && prevStage !== null && prevStage !== stageStr && stageStr === 'started') {
        setTimeout(() => { window.location.href = '/game'; }, 50);
      }
      prevStage = stageStr;
    } catch (e) { console.error('session check error', e); }
  });

  const historyPoller = window.polling.startPolling(historyPollerKey, async () => {
    return await fetchScoreHistory();
  }, 3000, { immediate: true });

  historyPoller.subscribe((err, result) => {
    if (err) { console.error('history poller error', err); return; }
    if (!result) return;
    // result is array of participants { id, username, scoreHistory }
    drawScoreChart(result);
  });

  // initial load for UI elements
  (async function init() {
    if (!gameId) { statusEl.textContent = 'No gameId in URL'; playersList.textContent = ''; return; }
    const info = await fetchPublicInfo(); if (info) { renderStatus(info.game); renderPlayers(info.players || []); }
    const hist = await fetchScoreHistory(); if (hist) drawScoreChart(hist);
  })();

  // Back to lobby
  const backLobbyBtn = document.getElementById('backLobbyBtn'); if (backLobbyBtn) backLobbyBtn.addEventListener('click', () => { window.location.href = '/'; });

})();
