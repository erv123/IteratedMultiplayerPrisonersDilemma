// Game page script — uses window.api and window.polling
(function () {
  function getQueryParam(name) { const params = new URLSearchParams(window.location.search); return params.get(name); }

  const gameIdRaw = getQueryParam('gameId');
  const gameId = gameIdRaw ? gameIdRaw.trim() : '';
  document.getElementById('gameId').textContent = gameId || '—';

  const usernameEl = document.getElementById('username');
  const turnDisplay = document.getElementById('turnDisplay');
  const actionHeader = document.getElementById('actionHeader');
  const playerListEl = document.getElementById('playerList');
  const leaderboardEl = document.getElementById('leaderboard');
  const historyContainer = document.getElementById('historyContainer');
  const endTurnBtn = document.getElementById('endTurnBtn');

  let sessionUser = null;
  let myParticipantId = null;
  let activeChoices = {}; // map targetId -> 'peace'|'war' for current turn
  let myHistory = []; // resolved history entries for logged-in participant
  let _prevHistoryHtml = '';
  let _prevReadyFlag = null;
  let currentTurn = 0;
  let _prevTurn = null;
  let _prevPlayersKey = null;
  let _prevButtonFormattingKey = null;
  let _prevParticipantId = null;

  async function initSession() {
    try {
      const who = await window.api.get('/auth/whoami');
      sessionUser = (who && who.success) ? who.data : null;
      try { usernameEl.textContent = sessionUser ? sessionUser.username : '(guest)'; } catch (e) {}
    } catch (e) { sessionUser = null; }
  }

  async function fetchGameInfo() {
    if (!gameId) return null;
    try {
      const res = await window.api.get(`/games/${encodeURIComponent(gameId)}`);
      if (!res || !res.success) return null;
      const game = res.data && res.data.game ? res.data.game : res.data;
      let players = [];
      try {
        const rp = await window.api.get(`/games/${encodeURIComponent(gameId)}/participants`);
        if (rp && rp.success) players = rp.data || [];
      } catch (e) { console.error('fetch participants error', e); }
      return { game, players };
    } catch (e) { console.error('fetchGameInfo error', e); return null; }
  }

  // Fetch active choices for the current turn for this participant
  async function fetchActiveChoices(participantId) {
    if (!participantId) return {};
    try {
      const r = await window.api.get(`/participants/${encodeURIComponent(participantId)}/activeChoices`);
      if (!r || !r.success) return {};
      const rows = Array.isArray(r.data) ? r.data : [];
      const map = {};
      rows.forEach(rr => {
        const tid = rr.target_id !== undefined ? rr.target_id : (rr.targetId !== undefined ? rr.targetId : rr.targetId);
        const choice = rr.choice;
        if (tid !== undefined && choice !== undefined) map[String(tid)] = choice;
      });
      return map;
    } catch (e) { console.error('fetchActiveChoices failed', e); return {}; }
  }

  // Fetch resolved history for this participant (owner-only)
  async function fetchMyHistory(participantId) {
    if (!participantId) return [];
    try {
      const r = await window.api.get(`/participants/${encodeURIComponent(participantId)}/myHistory`);
      if (!r || !r.success) return [];
      return Array.isArray(r.data) ? r.data : [];
    } catch (e) { console.error('fetchMyHistory failed', e); return []; }
  }

  function renderLeaderboard(players) {
    if (!Array.isArray(players) || players.length === 0) { leaderboardEl.textContent = '(no players yet)'; return; }
    leaderboardEl.innerHTML = '';
    const list = document.createElement('div');
    players.slice().sort((a,b)=> (b.total_score||0)-(a.total_score||0)).forEach(p => {
      const d = document.createElement('div');
      d.textContent = `${p.username || p.user_id || p.id} — ${p.total_score || p.totalScore || 0}`;
      list.appendChild(d);
    });
    leaderboardEl.appendChild(list);
  }

  function clearPlayerList() { playerListEl.innerHTML = ''; }

  function makeChoiceButton(label, cls) { const b = document.createElement('button'); b.textContent = label; b.className = `choice-btn ${cls}`; return b; }

  function disableTurnUI() { document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true); if (endTurnBtn) endTurnBtn.disabled = true; }
  function enableTurnUI() { document.querySelectorAll('.choice-btn').forEach(b => b.disabled = false); if (endTurnBtn) endTurnBtn.disabled = false; }

  function applySelectedStyles(rowEl, choice) {
    const pbtn = rowEl.querySelector('.peace-btn'); const wbtn = rowEl.querySelector('.war-btn');
    const wantPeace = choice === 'peace';
    const wantWar = choice === 'war';
    if (pbtn) {
      const has = pbtn.classList.contains('selected-peace');
      if (wantPeace && !has) pbtn.classList.add('selected-peace');
      else if (!wantPeace && has) pbtn.classList.remove('selected-peace');
    }
    if (wbtn) {
      const has = wbtn.classList.contains('selected-war');
      if (wantWar && !has) wbtn.classList.add('selected-war');
      else if (!wantWar && has) wbtn.classList.remove('selected-war');
    }
  }

  async function renderPlayers(players) {
    clearPlayerList();
    if (!Array.isArray(players) || players.length === 0) { playerListEl.textContent = '(no players)'; return; }

    // determine my participant id from latest players list and sessionUser
    if (sessionUser && sessionUser.id !== undefined && sessionUser.id !== null) {
      const me = players.find(p => (p.user_id !== undefined && p.user_id !== null && String(p.user_id) === String(sessionUser.id)) || p.username === sessionUser.username);
      myParticipantId = me ? me.id : null;
    } else {
      myParticipantId = null;
    }

    // NOTE: server choices are fetched in the poller and stored in `activeChoices` (authoritative for current turn).

    // update ready header text
    const readyCount = players.reduce((c,p)=> c + (Number(p.ready_for_next_turn||p.readyForNextTurn||0)===1 ? 1 : 0), 0);
    const totalPlayers = players.length;
    if (_prevReadyFlag === 1) { /* no-op */ }

    // Build rows for opponents only (exclude self)
    players.forEach(p => {
      if (String(p.id) === String(myParticipantId)) return; // skip me
      const row = document.createElement('div'); row.className = 'player-row'; row.dataset.playerId = String(p.id);
      const name = document.createElement('div'); name.className = 'player-name'; name.textContent = p.username || p.user_id || p.id;

      const peaceBtn = makeChoiceButton('Peace', 'peace-btn'); peaceBtn.classList.add('peace-btn');
      const warBtn = makeChoiceButton('War', 'war-btn'); warBtn.classList.add('war-btn');

      row.appendChild(name); row.appendChild(peaceBtn); row.appendChild(warBtn);

      peaceBtn.addEventListener('click', () => selectChoice(p.id, 'peace'));
      warBtn.addEventListener('click', () => selectChoice(p.id, 'war'));

      // apply existing selected state (only change classes if needed)
      const sel = activeChoices[String(p.id)]; if (sel) applySelectedStyles(row, sel);

      playerListEl.appendChild(row);
    });

    // If not participant, show notice and disable buttons
    if (!myParticipantId) {
      actionHeader.textContent = '(You are not a participant)';
      disableTurnUI();
    } else {
      actionHeader.textContent = 'Choose Your Actions';
      // enable/disable based on _prevReadyFlag
      if (_prevReadyFlag === 1) disableTurnUI(); else enableTurnUI();
    }

    // No post-render fetch needed — rows were created using `activeChoices`.
  }

  async function selectChoice(targetId, choice) {
    if (!myParticipantId) return alert('Not a participant');
    // optimistic UI (apply immediately; will be reconciled with server authoritative data)
    activeChoices[String(targetId)] = choice;
    const row = document.querySelector(`.player-row[data-player-id="${targetId}"]`);
    if (row) applySelectedStyles(row, choice);
    try {
      await window.api.post(`/participants/${encodeURIComponent(myParticipantId)}/choice`, { targetId, choice });
      // after successful save, reload formatting from server to ensure authoritative state
      await reloadButtonFormatting(myParticipantId);
    } catch (e) { console.error('save choice failed', e); }
  }

  async function endTurn() {
    if (!myParticipantId) return alert('Not a participant');
    // verify against authoritative server choices that player has made a choice for every opponent
    try {
      const opponentIds = Array.from(document.querySelectorAll('.player-row')).map(r => r.dataset.playerId);
      const serverChoices = await fetchActiveChoices(myParticipantId);
      const missing = opponentIds.find(id => !serverChoices[String(id)]);
      if (missing) return alert('You must choose Peace or War for every player.');
    } catch (e) {
      console.error('failed to verify choices before submit', e);
      return alert('Failed to verify choices before submitting turn');
    }
    try {
      await window.api.post(`/participants/${encodeURIComponent(myParticipantId)}/submit`, {});
      // clear local optimistic choices and reset button formatting
      activeChoices = {};
      const rows = Array.from(document.querySelectorAll('.player-row'));
      rows.forEach(r => applySelectedStyles(r, null));
      // force re-apply formatting when needed
      _prevButtonFormattingKey = null;
      disableTurnUI();
      _prevReadyFlag = 1;
    } catch (e) { console.error('submit failed', e); alert('Failed to submit turn'); }
  }

  async function renderTurnHistory(gameIdParam, participantIdParam) {
    if (!gameIdParam) return;
    if (!participantIdParam) { historyContainer.innerHTML = '(history available to participants only)'; return; }
    try {
      const entries = await fetchMyHistory(participantIdParam);
      if (!entries || !entries.length) { historyContainer.innerHTML = '(no history yet)'; return; }

      // collect turns and opponent ids
        const turnSet = new Set();
        const oppSet = new Set();
        entries.forEach(e => {
          if (e.turnNumber !== undefined && e.turnNumber !== null) turnSet.add(Number(e.turnNumber));
          if (e.opponentId !== undefined && e.opponentId !== null) oppSet.add(String(e.opponentId));
        });

        const turns = Array.from(turnSet).sort((a,b)=>a-b);
        if (!turns.length) { historyContainer.innerHTML = '(no history yet)'; return; }

        // fetch participant usernames for opponents
        const ids = Array.from(oppSet);
        const nameFetches = ids.map(id => window.api.get(`/participants/${encodeURIComponent(id)}`).catch(() => null));
        const nameResults = await Promise.all(nameFetches);
        const nameMap = {};
        ids.forEach((id, idx) => { const r = nameResults[idx]; nameMap[id] = (r && r.success && r.data && r.data.username) ? r.data.username : id; });

        // Build rows grouped by opponent
        const rowsByOpp = {};
        entries.forEach(e => {
          const oid = String(e.opponentId);
          if (!rowsByOpp[oid]) rowsByOpp[oid] = [];
          rowsByOpp[oid].push(e);
        });

        let html = '<table>';
        html += '<tr><th>Opponent</th>' + turns.map(t=>`<th>Turn ${t}</th>`).join('') + '</tr>';
        // iterate opponents in alphabetical username order
        const sortedOpp = ids.slice().sort((a,b)=> String(nameMap[a]).localeCompare(String(nameMap[b])));
        sortedOpp.forEach(oid => {
          html += `<tr><td>${nameMap[oid] || oid}</td>`;
          turns.forEach(t => {
            const entry = (rowsByOpp[oid] || []).find(r => Number(r.turnNumber) === Number(t));
            const myChoice = entry ? (entry.appliedChoice || '') : '';
            const oppChoice = entry ? (entry.opponentChoice || '') : '';
            const points = entry && (entry.pointsAwarded !== undefined && entry.pointsAwarded !== null) ? ` (${entry.pointsAwarded})` : '';
            const cellText = `${myChoice || ''}/${oppChoice || ''}${points}`;
            let cls = '';
            if (myChoice && oppChoice) {
              if (myChoice === 'war' && oppChoice === 'war') cls = 'cell-war-war';
              else if (myChoice === 'peace' && oppChoice === 'peace') cls = 'cell-peace-peace';
              else if (myChoice === 'war' && oppChoice === 'peace') cls = 'cell-war-peace';
              else if (myChoice === 'peace' && oppChoice === 'war') cls = 'cell-peace-war';
            }
            html += `<td class="${cls}">${cellText}</td>`;
          });
          html += '</tr>';
        });
      html += '</table>';
      if (html === _prevHistoryHtml) return; _prevHistoryHtml = html; historyContainer.innerHTML = html;
    } catch (e) { console.error('renderTurnHistory: fetch error', e); historyContainer.innerHTML = '(failed to load history)'; }
  }

  // Fetch authoritative choices for participant and apply formatting to rows
  async function reloadButtonFormatting(participantId) {
    if (!participantId) return;
    try {
      const serverChoices = await fetchActiveChoices(participantId);
      // authoritative server choices replace previous server values
      activeChoices = Object.assign({}, serverChoices || {});
      // apply to DOM rows
      const rows = Array.from(playerListEl.querySelectorAll('.player-row'));
      rows.forEach(r => {
        const pid = r.dataset.playerId;
        const choice = activeChoices[String(pid)] || null;
        applySelectedStyles(r, choice);
      });
    } catch (e) { console.error('reloadButtonFormatting error', e); }
  }

  // Pollers
  const infoKey = `gameState:${gameId}`;
  const historyKey = `gameHistory:${gameId}`;

  async function pollFetchGameInfo() { return await fetchGameInfo(); }

  const infoPoller = window.polling.startPolling(infoKey, pollFetchGameInfo, 1500, { immediate: true });
  infoPoller.subscribe(async (err, result) => {
    if (err) { console.error('info poller error', err); return; }
    if (!result) return;
    const game = result.game; const players = result.players || [];
    const stageNum = game && (game.stage !== undefined ? Number(game.stage) : (game.stageNum !== undefined ? Number(game.stageNum) : null));
    if (stageNum === null || stageNum !== 2) { window.location.href = `/gameInfo?gameId=${encodeURIComponent(gameId)}`; return; }

    currentTurn = game.currentTurn !== undefined ? game.currentTurn : game.current_turn;
    turnDisplay.textContent = currentTurn || 0;

    // refresh session each poll to detect login/logout
    await initSession();

    // determine myParticipantId
    if (sessionUser && sessionUser.id !== undefined && sessionUser.id !== null) {
      const me = players.find(p => (p.user_id !== undefined && p.user_id !== null && String(p.user_id) === String(sessionUser.id)) || p.username === sessionUser.username);
      myParticipantId = me ? me.id : null;
    } else { myParticipantId = null; }

    // Clear local optimistic choices when a new turn begins
    if (_prevTurn !== null && currentTurn !== null && _prevTurn !== currentTurn) {
      activeChoices = {};
      _prevButtonFormattingKey = null; // force re-apply formatting on new turn
    }

    // Fetch authoritative server choices once per poll (server is authoritative)
    if (myParticipantId) {
      try {
        const serverChoices = await fetchActiveChoices(myParticipantId);
        activeChoices = Object.assign({}, serverChoices || {}); // server choices are authoritative
      } catch (e) { console.error('fetchActiveChoices failed', e); activeChoices = {}; }
    } else { activeChoices = {}; }
    _prevTurn = currentTurn;

    // Build a compact players key to detect changes and avoid unnecessary redraws
    const playersKey = (players || []).map(p => `${p.id}:${p.username||''}:${p.total_score||p.totalScore||0}:${p.ready_for_next_turn||p.readyForNextTurn||0}`).join('|');
    const participantChanged = String(_prevParticipantId) !== String(myParticipantId);
    if (playersKey !== _prevPlayersKey || participantChanged) {
      await renderPlayers(players);
      _prevPlayersKey = playersKey;
      _prevParticipantId = myParticipantId;
    }

    // Apply button formatting only when choices or participant id change
    const buttonKey = JSON.stringify({ participantId: myParticipantId, choices: activeChoices || {}, turn: currentTurn });
    if (buttonKey !== _prevButtonFormattingKey) {
      await reloadButtonFormatting(myParticipantId);
      _prevButtonFormattingKey = buttonKey;
    }

    // fetch fresh participant row for ready state when available
    let meRow = null;
    if (myParticipantId) {
      try { const pr = await window.api.get(`/participants/${encodeURIComponent(myParticipantId)}`); if (pr && pr.success && pr.data) meRow = pr.data; } catch (e) { console.error('fetch participant detail failed', e); }
    }
    if (!meRow) meRow = players.find(p => p.id === myParticipantId);
    const rawReady = meRow ? (meRow.ready_for_next_turn !== undefined ? meRow.ready_for_next_turn : (meRow.readyForNextTurn !== undefined ? meRow.readyForNextTurn : null)) : null;
    const myReady = rawReady === null ? null : (Number(rawReady) === 1 ? 1 : 0);
    // If participant ready-state changed, update UI and header. Also show waiting header when this participant is ready
    if (_prevReadyFlag !== myReady) {
      if (myReady === 1) disableTurnUI(); else if (myReady === 0) enableTurnUI();
      _prevReadyFlag = myReady;
    }

    // When this participant is ready, fetch turnState to show waiting counts and allow server to resolve when all ready
    if (myReady === 1) {
      try {
        const ts = await window.api.get(`/games/${encodeURIComponent(gameId)}/turnState`);
        if (ts && ts.success && ts.data) {
          const total = Number(ts.data.totalParticipants || 0);
          const ready = Number(ts.data.readyParticipants || 0);
          actionHeader.textContent = `Waiting for others (${ready}/${total} ready)`;
        } else {
          actionHeader.textContent = 'Waiting for others';
        }
      } catch (e) {
        console.error('turnState fetch failed', e);
        actionHeader.textContent = 'Waiting for others';
      }
    } else {
      // not ready: show default prompt when participant
      if (myParticipantId) actionHeader.textContent = 'Choose Your Actions';
    }

    // leaderboard reflects scores and can update more often; update regardless
    renderLeaderboard(players);
  });

  const historyPoller = window.polling.startPolling(historyKey, async () => { return await fetchGameInfo(); }, 3000, { immediate: true });
  historyPoller.subscribe((err, info) => { if (err) { console.error(err); return; } if (!info) return; renderTurnHistory(gameId, myParticipantId); });

  // End turn button with confirmation
  if (endTurnBtn) endTurnBtn.addEventListener('click', async (e) => {
    const ok = window.confirm('Are you sure you want to end your turn?'); if (!ok) return; await endTurn();
  });

  // Back to info and logout
  document.getElementById('backToInfoBtn').addEventListener('click', async () => { window.location.href = `/gameInfo?gameId=${encodeURIComponent(gameId)}`; });
  document.getElementById('logoutBtn').addEventListener('click', async () => { await window.api.post('/auth/logout'); window.location.href = '/'; });

  // Initial
  (async function init() {
    await initSession();
    if (!gameId) { historyContainer.textContent = 'No gameId in URL'; return; }
    const info = await fetchGameInfo();
    if (info) {
      try { document.getElementById('gameId').textContent = info.game && info.game.name ? info.game.name : gameId; } catch (e) {}
      // set current turn, players, and session-aware participant id
      currentTurn = info.game && (info.game.currentTurn !== undefined ? info.game.currentTurn : info.game.current_turn);
      turnDisplay.textContent = currentTurn || 0;

      // determine myParticipantId from initial players
      if (info.players && info.players.length) {
        if (sessionUser && sessionUser.id) {
          const me = info.players.find(p => (p.user_id && sessionUser.id && p.user_id === sessionUser.id) || p.username === sessionUser.username);
          myParticipantId = me ? me.id : null;
        }
      }

      // fetch initial server choices so the first render is styled (active choices for current turn)
      if (myParticipantId) {
        try { activeChoices = await fetchActiveChoices(myParticipantId); } catch (e) { activeChoices = {}; }
      }

      // render leaderboard and players
      renderLeaderboard(info.players || []);
      await renderPlayers(info.players || []);

      // set initial change-tracking keys so the poller won't immediately re-render
      _prevTurn = currentTurn;
      _prevPlayersKey = (info.players || []).map(p => `${p.id}:${p.username||''}:${p.total_score||p.totalScore||0}:${p.ready_for_next_turn||p.readyForNextTurn||0}`).join('|');
      _prevParticipantId = myParticipantId;
      _prevButtonFormattingKey = JSON.stringify({ participantId: myParticipantId, choices: activeChoices || {}, turn: currentTurn });

      // determine initial ready-state from participant row if available
      try {
        if (myParticipantId) {
          const pr = await window.api.get(`/participants/${encodeURIComponent(myParticipantId)}`);
          const meRow = (pr && pr.success && pr.data) ? pr.data : (info.players || []).find(p => p.id === myParticipantId) || null;
          const rawReady = meRow ? (meRow.ready_for_next_turn !== undefined ? meRow.ready_for_next_turn : (meRow.readyForNextTurn !== undefined ? meRow.readyForNextTurn : null)) : null;
          const myReady = rawReady === null ? null : (Number(rawReady) === 1 ? 1 : 0);
          _prevReadyFlag = myReady;
          if (myReady === 1) disableTurnUI(); else if (myReady === 0) enableTurnUI();
        }
      } catch (e) { /* ignore */ }

      // fetch initial active choices so the first render is styled
      if (myParticipantId) {
        try { activeChoices = await fetchActiveChoices(myParticipantId); } catch (e) { activeChoices = {}; }
      }

      // render history for initial view (only if participant)
      try { await renderTurnHistory(gameId, myParticipantId); } catch (e) { /* ignore */ }
    }
  })();

})();
