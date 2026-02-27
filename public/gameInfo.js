// GameInfo page — uses window.api and window.polling
(function () {
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  const gameIdRaw = getQueryParam('gameId');
  const gameId = gameIdRaw ? gameIdRaw.trim() : '';
  document.getElementById('gameIdDisplay').textContent = gameId || '—';
  // game name will be populated after fetch
  const loggedUserEl = document.getElementById('loggedUserDisplay');

  const logoutBtn = document.getElementById('logoutBtn');
  const enterGameBtn = document.getElementById('enterGameBtn');
  const downloadGameBtn = document.getElementById('downloadGameBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
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
      // `res.data` may be either the game object (new) or { game } (older shape)
      const game = res.data && res.data.game ? res.data.game : res.data;
      let players = [];
      try {
        const rp = await window.api.get(`/games/${encodeURIComponent(gameId)}/participants`);
        if (rp && rp.success) players = rp.data || [];
      } catch (e) { console.error('fetch participants error', e); }
      return { game, players };
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

    const displayStage = game.stage === 1 ? 'Not Started' : game.stage === 2 ? 'Started' : game.stage === 3 ? 'Completed' : String(game.stage);
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
          window.location.href = `/game?gameId=${encodeURIComponent(gameId)}`;
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
    // show game name
    try { document.getElementById('gameNameDisplay').textContent = info.game && info.game.name ? info.game.name : (gameId || '—'); } catch (e) {}

    // check session and update enter/join button state
    try {
      const who = await window.api.get('/auth/whoami');
      const sessionUser = who && who.success ? who.data : null;
      if (sessionUser) {
        loginNotice.style.display = 'none';
        loggedInActions.style.display = 'block';
        try { loggedUserEl.textContent = sessionUser.username; } catch (e) {}
      } else {
        loginNotice.style.display = '';
        loggedInActions.style.display = 'none';
        enterGameBtn.disabled = true;
        enterGameBtn.textContent = 'Join / Enter Game';
        try { loggedUserEl.textContent = '(not logged in)'; } catch (e) {}
      }

      // determine participant membership and host status
      const players = info.players || [];
      let amParticipant = false; let amHost = false;
      if (sessionUser && players.length) {
        const me = players.find(p => {
          if (!p) return false;
          // compare numeric/string ids safely
          if (p.user_id != null && sessionUser.id != null && String(p.user_id) === String(sessionUser.id)) return true;
          if (p.username && sessionUser.username && p.username === sessionUser.username) return true;
          return false;
        });
        if (me) { amParticipant = true; amHost = !!(me.is_host === 1 || me.is_host === true); }
      }

      const stageNum = info.game ? info.game.stage : null;

      let desired = { text: '', disabled: true, handler: null };
      // Decide Join/Enter/Start button state
      if (!sessionUser) {
        desired = { text: 'Join / Enter Game', disabled: true, handler: null };
      } else if (amParticipant) {
        if (stageNum === 2) {
          desired = { text: 'Enter Game', disabled: false, handler: () => { window.location.href = `/game?gameId=${encodeURIComponent(gameId)}`; } };
        } else if (amHost && stageNum === 1) {
          desired = { text: 'Start Game', disabled: false, handler: startGame };
        } else {
          desired = { text: 'Enter Game', disabled: true, handler: null };
        }
      } else {
        const hasRoom = info.game && ((info.game.currentPlayers || info.game.current_players || 0) < (info.game.maxPlayers || info.game.max_players || 0));
        if (stageNum === 1 && hasRoom) {
          desired = { text: 'Join Game', disabled: false, handler: async () => { const ok = await joinAsUser(); if (ok) { await window.api.get('/auth/whoami'); window.location.reload(); } } };
        } else {
          desired = { text: 'Join Game', disabled: true, handler: null };
        }
      }

      if (lastEnterState.text !== desired.text || lastEnterState.disabled !== desired.disabled) {
        enterGameBtn.textContent = desired.text; enterGameBtn.disabled = desired.disabled; enterGameBtn.onclick = desired.handler; lastEnterState = { text: desired.text, disabled: desired.disabled };
      }

      // Manage Download button visibility and handler (independent of login)
      if (downloadGameBtn) {
        if (stageNum === 3) {
          downloadGameBtn.style.display = '';
          downloadGameBtn.onclick = async () => {
            try {
              if (!confirm('Download game as CSV?')) return;
              const url = `/api/games/${encodeURIComponent(gameId)}/download`;
              const resp = await fetch(url, { credentials: 'same-origin' });
              if (!resp.ok) { const body = await resp.json().catch(() => null); const msg = body && body.error && body.error.message ? body.error.message : 'Failed to fetch game data'; alert(msg); return; }
              const payload = await resp.json();
              if (!payload || !payload.success || !payload.data) { alert('Invalid game data'); return; }
              const { game, participants, turns } = payload.data;

              // CSV helper
              const esc = v => { if (v === null || v === undefined) return ''; const s = String(v); if (s.indexOf(',') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('"') >= 0) return '"' + s.replace(/"/g,'""') + '"'; return s; };
              const toCsv = (rows, cols) => { const lines = []; lines.push(cols.join(',')); (rows || []).forEach(r => { const vals = cols.map(c => esc(r[c])); lines.push(vals.join(',')); }); return lines.join('\n'); };

              const gpub = Object.assign({}, game || {}); if (gpub.id) delete gpub.id; gpub.payoff_matrix = gpub.payoff_matrix ? String(gpub.payoff_matrix) : '';
              const gamesCsv = toCsv([gpub], ['name','stage','current_turn','end_chance','history_limit','payoff_matrix','error_chance','max_players','current_players','created_at']);

              const partsPub = (participants || []).map(p => ({ username: p.username, total_score: p.total_score, ready_for_next_turn: p.ready_for_next_turn, is_host: p.is_host, score_history: p.score_history ? String(p.score_history) : '' }));
              const participantsCsv = toCsv(partsPub, ['username','total_score','ready_for_next_turn','is_host','score_history']);

              // Use server-provided player/target names if available; fall back to ids
              const turnsPub = (turns || []).map(t => ({ turn_number: t.turn_number, player: t.player || t.player_id || '', target: t.target || t.target_id || '', choice: t.choice, applied_choice: t.applied_choice, opponent_choice: t.opponent_choice, points_awarded: t.points_awarded, created_at: t.created_at }));
              const turnsCsv = toCsv(turnsPub, ['turn_number','player','target','choice','applied_choice','opponent_choice','points_awarded','created_at']);

              const out = [];
              out.push('"=== Games ==="'); out.push(gamesCsv); out.push(''); out.push('"=== Participants ==="'); out.push(participantsCsv); out.push(''); out.push('"=== Turns ==="'); out.push(turnsCsv);
              const body = out.join('\n'); const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
              // use sanitized game name if available, fallback to gameId
              const safeName = (game && game.name) ? String(game.name).replace(/[^a-z0-9-_]/gi, '_') : gameId;
              const filename = `game_${safeName}_export.csv`;
              const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
            } catch (e) { console.error('download error', e); alert('Download failed'); }
          };
        } else {
          downloadGameBtn.style.display = 'none';
          downloadGameBtn.onclick = null;
        }
      }

      // ZIP download button
      if (downloadZipBtn) {
        if (stageNum === 3) {
          downloadZipBtn.style.display = '';
          downloadZipBtn.onclick = async () => {
            try {
              if (!confirm('Download game as ZIP?')) return;
              const url = `/api/games/${encodeURIComponent(gameId)}/download`;
              const resp = await fetch(url, { credentials: 'same-origin' });
              if (!resp.ok) { const body = await resp.json().catch(() => null); const msg = body && body.error && body.error.message ? body.error.message : 'Failed to fetch game data'; alert(msg); return; }
              const payload = await resp.json();
              if (!payload || !payload.success || !payload.data) { alert('Invalid game data'); return; }
              const { game, participants, turns } = payload.data;

              const esc = v => { if (v === null || v === undefined) return ''; const s = String(v); if (s.indexOf(',') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('"') >= 0) return '"' + s.replace(/"/g,'""') + '"'; return s; };
              const toCsv = (rows, cols) => { const lines = []; lines.push(cols.join(',')); (rows || []).forEach(r => { const vals = cols.map(c => esc(r[c])); lines.push(vals.join(',')); }); return lines.join('\n'); };

              const gpub = Object.assign({}, game || {}); if (gpub.id) delete gpub.id; gpub.payoff_matrix = gpub.payoff_matrix ? String(gpub.payoff_matrix) : '';
              const gamesCsv = toCsv([gpub], ['name','stage','current_turn','end_chance','history_limit','payoff_matrix','error_chance','max_players','current_players','created_at']);
              const partsPub = (participants || []).map(p => ({ username: p.username, total_score: p.total_score, ready_for_next_turn: p.ready_for_next_turn, is_host: p.is_host, score_history: p.score_history ? String(p.score_history) : '' }));
              const participantsCsv = toCsv(partsPub, ['username','total_score','ready_for_next_turn','is_host','score_history']);
              const turnsPub = (turns || []).map(t => ({ turn_number: t.turn_number, player: t.player || t.player_id || '', target: t.target || t.target_id || '', choice: t.choice, applied_choice: t.applied_choice, opponent_choice: t.opponent_choice, points_awarded: t.points_awarded, created_at: t.created_at }));
              const turnsCsv = toCsv(turnsPub, ['turn_number','player','target','choice','applied_choice','opponent_choice','points_awarded','created_at']);

              // Load JSZip if not present
              async function loadJSZip() {
                if (window.JSZip) return window.JSZip;
                return new Promise((resolve, reject) => {
                  const s = document.createElement('script');
                  s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.0/dist/jszip.min.js';
                  s.onload = () => resolve(window.JSZip);
                  s.onerror = reject;
                  document.head.appendChild(s);
                });
              }

              const JSZip = await loadJSZip();
              if (!JSZip) return alert('Failed to load zip library');
              const zip = new JSZip();
              zip.file('games.csv', gamesCsv);
              zip.file('participants.csv', participantsCsv);
              zip.file('turns.csv', turnsCsv);
              const content = await zip.generateAsync({ type: 'blob' });
              // use sanitized game name if available, fallback to gameId
              const safeNameZip = (game && game.name) ? String(game.name).replace(/[^a-z0-9-_]/gi, '_') : gameId;
              const filename = `game_${safeNameZip}_export.zip`;
              const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
            } catch (e) { console.error('zip download error', e); alert('ZIP download failed'); }
          };
        } else {
          downloadZipBtn.style.display = 'none';
          downloadZipBtn.onclick = null;
        }
      }

      if (amParticipant && prevStage !== null && prevStage !== stageNum && stageNum === 2) {
        setTimeout(() => { window.location.href = `/game?gameId=${encodeURIComponent(gameId)}`; }, 50);
      }
      prevStage = stageNum;
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
