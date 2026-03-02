// Game page script — uses window.api and window.polling
(function () {
  function getQueryParam(name) { const params = new URLSearchParams(window.location.search); return params.get(name); }

  const gameIdRaw = getQueryParam('gameId');
  const gameId = gameIdRaw ? gameIdRaw.trim() : '';
  // show a brief placeholder until we fetch the game's metadata (name)
  document.getElementById('gameId').textContent = 'Loading...';

  const usernameEl = document.getElementById('username');
  const turnDisplay = document.getElementById('turnDisplay');
  const actionHeader = document.getElementById('actionHeader');
  const playerListEl = document.getElementById('playerList');
  const leaderboardEl = document.getElementById('leaderboard');
  const historyContainer = document.getElementById('historyContainer');
  const endTurnBtn = document.getElementById('endTurnBtn');
  const orderToggleEl = document.getElementById('orderToggle');

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
  let latestPlayers = [];
  // ordering preference: 'score' (default) or 'alpha'
  let orderBy = (localStorage.getItem('orderBy') || 'score');
  if (orderToggleEl) { orderToggleEl.value = orderBy; }

  function setOrderPreference(val) {
    orderBy = val === 'alpha' ? 'alpha' : 'score';
    try { localStorage.setItem('orderBy', orderBy); } catch (e) {}
    // refresh both tables
    try { if (latestPlayers && latestPlayers.length) renderPlayers(latestPlayers); } catch (e) {}
    try { renderTurnHistory(gameId, myParticipantId); } catch (e) {}
  }
  if (orderToggleEl) orderToggleEl.addEventListener('change', (e) => setOrderPreference(e.target.value));

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

  // Fetch opponent-aware history for this participant (owner-only)
  async function fetchOpponentHistory(participantId) {
    if (!participantId) return [];
    try {
      const r = await window.api.get(`/participants/${encodeURIComponent(participantId)}/opponentHistory`);
      if (!r) return { success: false, error: 'no response' };
      if (!r.success) return { success: false, error: r.error || 'api error' };
      return { success: true, data: Array.isArray(r.data) ? r.data : [] };
    } catch (e) { console.error('fetchOpponentHistory failed', e); return []; }
  }

  function renderLeaderboard(players) {
    if (!Array.isArray(players) || players.length === 0) { leaderboardEl.textContent = '(no players yet)'; return; }
    // Build sorted array and render with TableRenderer (no fallback)
    const arr = (players || []).slice().map(p => ({ id: p.id, name: p.username || p.user_id || p.id, score: Number(p.total_score != null ? p.total_score : (p.totalScore != null ? p.totalScore : 0)) })).sort((a,b)=> b.score - a.score);
    const schema = { columns: [ { key: 'rank', title: '#' }, { key: 'player', title: 'Player' }, { key: 'score', title: 'Score' } ] };
    const rows = (arr || []).map((a, i) => {
      const topClass = i === 0 ? 'leader-top1' : i === 1 ? 'leader-top2' : i === 2 ? 'leader-top3' : null;
      return {
        rank: { type: 'text', value: String(i+1), className: topClass },
        player: { type: 'text', value: a.name, className: topClass },
        score: { type: 'number', value: a.score, className: topClass }
      };
    });
    try {
      if (!window.TableRenderer) throw new Error('TableRenderer not available');
      const container = leaderboardEl;
      const existingTable = container.querySelector('table.tbl');
      if (existingTable) window.TableRenderer.updateRows(container, rows);
      else window.TableRenderer.createTable(container, schema, rows, { compact: true });
    } catch (e) {
      console.error('renderLeaderboard error', e);
      leaderboardEl.textContent = '(leaderboard unavailable)';
    }
  }

  function clearPlayerList() { playerListEl.innerHTML = ''; }

  // Returns true when the current session participant can make choices
  function _canAct() {
    if (!myParticipantId) return false;
    // participant cannot act when already marked ready for next turn
    if (_prevReadyFlag === 1) return false;
    return true;
  }

  function disableTurnUI() {
    document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
    if (endTurnBtn) endTurnBtn.disabled = true;
    try {
      const table = playerListEl && playerListEl.querySelector ? playerListEl.querySelector('table.tbl') : null;
      if (table) table.querySelectorAll('button').forEach(b => b.disabled = true);
    } catch (e) { /* ignore */ }
  }
  function enableTurnUI() {
    document.querySelectorAll('.choice-btn').forEach(b => b.disabled = false);
    if (endTurnBtn) endTurnBtn.disabled = false;
    try {
      const table = playerListEl && playerListEl.querySelector ? playerListEl.querySelector('table.tbl') : null;
      if (table) table.querySelectorAll('button').forEach(b => b.disabled = false);
    } catch (e) { /* ignore */ }
  }

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
      const me = players.find(p => (p.user_id !== undefined && p.user_id !== null && String(p.user_id) === String(sessionUser.id)) || (p.username && sessionUser.username && String(p.username).trim().toLowerCase() === String(sessionUser.username).trim().toLowerCase()));
      myParticipantId = me ? me.id : null;
    } else {
      myParticipantId = null;
    }

    // update ready header text
    const readyCount = players.reduce((c,p)=> c + (Number(p.ready_for_next_turn||p.readyForNextTurn||0)===1 ? 1 : 0), 0);
    const totalPlayers = players.length;

    // Build opponents ordered by preference
    let opponents = (players || []).filter(p => String(p.id) !== String(myParticipantId)).slice();
    if (orderBy === 'alpha') {
      opponents.sort((a,b) => String(a.username||a.user_id||a.id).localeCompare(String(b.username||b.user_id||b.id)));
    } else {
      opponents.sort((a,b) => {
        const sa = Number(a.total_score != null ? a.total_score : (a.totalScore != null ? a.totalScore : 0));
        const sb = Number(b.total_score != null ? b.total_score : (b.totalScore != null ? b.totalScore : 0));
        return sb - sa;
      });
    }

    // Build TableRenderer schema and rows: columns -> Player | Peace | War
    const schema = { columns: [ { key: 'player', title: 'Player' }, { key: 'peace', title: 'Peace' }, { key: 'war', title: 'War' } ] };
    const rows = opponents.map(p => ({ playerId: p.id, player: p.username || p.user_id || p.id, peace: { type: 'button', value: { label: 'Peace' }, onClick: (e, ctx) => { selectChoice(ctx.row.playerId, 'peace'); } }, war: { type: 'button', value: { label: 'War' }, onClick: (e, ctx) => { selectChoice(ctx.row.playerId, 'war'); } } }));

    try {
      if (!window.TableRenderer) throw new Error('TableRenderer unavailable');
      const existing = playerListEl.querySelector('table.tbl');
      if (existing) window.TableRenderer.updateRows(playerListEl, rows);
      else window.TableRenderer.createTable(playerListEl, schema, rows, { compact: true, tableClass: 'player-action-table' });

      // after render, assign data-player-id to each tr and wire up button states
      const table = playerListEl.querySelector('table.tbl');
      if (table) {
        const trs = Array.from(table.querySelectorAll('tbody tr'));
        trs.forEach((tr, idx) => {
          const rowData = rows[idx];
          if (rowData && rowData.playerId) tr.dataset.playerId = String(rowData.playerId);
          // find peace/war buttons (assume 2nd and 3rd td)
          const tds = tr.querySelectorAll('td');
          const peaceBtn = tds[1] && tds[1].querySelector('button');
          const warBtn = tds[2] && tds[2].querySelector('button');
          // apply selected state
          const sel = activeChoices[String(rowData.playerId)];
          if (peaceBtn) {
            peaceBtn.classList.toggle('selected-peace', sel === 'peace');
            peaceBtn.disabled = !_canAct();
          }
          if (warBtn) {
            warBtn.classList.toggle('selected-war', sel === 'war');
            warBtn.disabled = !_canAct();
          }
        });
      }
    } catch (e) {
      console.error('renderPlayers table error', e);
      playerListEl.textContent = '(failed to render players)';
    }

    // Update header and enable/disable UI
    if (!myParticipantId) {
      actionHeader.textContent = '(You are not a participant)';
      disableTurnUI();
    } else {
      actionHeader.textContent = 'Choose Your Actions';
      if (_prevReadyFlag === 1) disableTurnUI(); else enableTurnUI();
    }
  }

  async function selectChoice(targetId, choice) {
    if (!myParticipantId) { await alertService.alert('Not a participant'); return; }
    // optimistic UI (apply immediately; will be reconciled with server authoritative data)
    activeChoices[String(targetId)] = choice;
    // update table-based row buttons
    try {
      const table = playerListEl.querySelector('table.tbl');
      if (table) {
        const tr = table.querySelector(`tbody tr[data-player-id="${targetId}"]`);
        if (tr) {
          const tds = tr.querySelectorAll('td');
          const peaceBtn = tds[1] && tds[1].querySelector('button');
          const warBtn = tds[2] && tds[2].querySelector('button');
          if (peaceBtn) { peaceBtn.classList.toggle('selected-peace', choice === 'peace'); }
          if (warBtn) { warBtn.classList.toggle('selected-war', choice === 'war'); }
        }
      }
    } catch (e) { /* ignore */ }
    try {
      await window.api.post(`/participants/${encodeURIComponent(myParticipantId)}/choice`, { targetId, choice });
      // after successful save, reload formatting from server to ensure authoritative state
      await reloadButtonFormatting(myParticipantId);
    } catch (e) { console.error('save choice failed', e); }
  }

  async function endTurn() {
    if (!myParticipantId) { await alertService.alert('Not a participant'); return; }
    // verify against authoritative server choices that player has made a choice for every opponent
    try {
      const table = playerListEl.querySelector('table.tbl');
      const opponentIds = table ? Array.from(table.querySelectorAll('tbody tr')).map(r => r.dataset.playerId) : [];
      const serverChoices = await fetchActiveChoices(myParticipantId);
      const missing = opponentIds.find(id => !serverChoices[String(id)]);
      if (missing) { await alertService.alert('You must choose Peace or War for every player.'); return; }
    } catch (e) {
      console.error('failed to verify choices before submit', e);
      await alertService.alert('Failed to verify choices before submitting turn');
      return;
    }
    try {
      await window.api.post(`/participants/${encodeURIComponent(myParticipantId)}/submit`, {});
      // clear local optimistic choices and reset button formatting
      activeChoices = {};
      // clear selected classes on table buttons
      try {
        const table = playerListEl.querySelector('table.tbl');
        if (table) {
          Array.from(table.querySelectorAll('tbody tr')).forEach(tr => {
            const tds = tr.querySelectorAll('td');
            const peaceBtn = tds[1] && tds[1].querySelector('button');
            const warBtn = tds[2] && tds[2].querySelector('button');
            if (peaceBtn) { peaceBtn.classList.remove('selected-peace'); }
            if (warBtn) { warBtn.classList.remove('selected-war'); }
          });
        }
      } catch (e) { /* ignore */ }
      // force re-apply formatting when needed
      _prevButtonFormattingKey = null;
      disableTurnUI();
      _prevReadyFlag = 1;
    } catch (e) { console.error('submit failed', e); await alertService.alert('Failed to submit turn'); }
  }

  async function renderTurnHistory(gameIdParam, participantIdParam) {
    if (!gameIdParam) return;
    // If participantId not provided (poller may fire before init completes), show a loading placeholder
    // and try to resolve the current user's participant. Only display the "available to participants"
    // message after resolution fails so we don't flash the message briefly while initializing.
    if (!participantIdParam) {
      historyContainer.innerHTML = '(loading history...)';
      try {
        const me = await window.api.get('/participants/me');
        if (me && me.success && me.data && me.data.id) participantIdParam = me.data.id;
      } catch (e) { /* ignore */ }
    }
    if (!participantIdParam) { return; }
    try {
      const fh = await fetchOpponentHistory(participantIdParam);
      if (!fh || fh.success === false) {
        // API returned an error (ownership or server) — skip rendering
        return;
      }
      const entries = fh.data || [];
      if (!entries || !entries.length) { historyContainer.innerHTML = '(no history yet)'; return; }

      // collect turns and opponent ids
        const turnSet = new Set();
        const oppSet = new Set();
        entries.forEach(e => {
          const tn = e.turnNumber !== undefined && e.turnNumber !== null ? e.turnNumber : (e.turn_number !== undefined ? e.turn_number : null);
          const oid = e.opponentId !== undefined && e.opponentId !== null ? e.opponentId : (e.targetId !== undefined && e.targetId !== null ? e.targetId : (e.target_id !== undefined ? e.target_id : null));
          if (tn !== null) turnSet.add(Number(tn));
          if (oid !== null) oppSet.add(String(oid));
        });

        const turns = Array.from(turnSet).sort((a,b)=>a-b);
        if (!turns.length) { historyContainer.innerHTML = '(no history yet)'; return; }
        // Display most recent turn on the left: create a descending-ordered turns array
        const turnsDesc = turns.slice().reverse();

        // fetch participant usernames for opponents
        const ids = Array.from(oppSet);
        const nameFetches = ids.map(id => window.api.get(`/participants/${encodeURIComponent(id)}`).catch(() => null));
        const nameResults = await Promise.all(nameFetches);
        const nameMap = {};
        ids.forEach((id, idx) => { const r = nameResults[idx]; nameMap[id] = (r && r.success && r.data && r.data.username) ? r.data.username : id; });

        // Build rows grouped by opponent
        const rowsByOpp = {};
        entries.forEach(e => {
          const oid = String(e.opponentId !== undefined && e.opponentId !== null ? e.opponentId : (e.targetId !== undefined && e.targetId !== null ? e.targetId : (e.target_id !== undefined ? e.target_id : '')));
          if (!rowsByOpp[oid]) rowsByOpp[oid] = [];
          rowsByOpp[oid].push(e);
        });

        // Build TableRenderer schema/rows for turn history (most recent left)
        // First column is opponent (flexible), subsequent turn columns use the turn number as the column title
        const cols = [{ key: 'opponent', title: 'Opponent' }].concat(turnsDesc.map((t, i) => ({ key: `t${i}`, title: `Turn: ${String(t)}` })));
        let sortedOpp = ids.slice();
        if (orderBy === 'score') {
          // fetch participant scores for this game and sort by score desc
          try {
            const pr = await window.api.get(`/games/${encodeURIComponent(gameId)}/participants`);
            const parts = (pr && pr.success && Array.isArray(pr.data)) ? pr.data : [];
            const scoreMap = {};
            parts.forEach(p => { scoreMap[String(p.id)] = Number(p.total_score != null ? p.total_score : (p.totalScore != null ? p.totalScore : 0)); });
            sortedOpp.sort((a,b) => (scoreMap[String(b)] || 0) - (scoreMap[String(a)] || 0));
          } catch (e) {
            // fallback to alphabetical if participants fetch fails
            sortedOpp.sort((a,b)=> String(nameMap[a]).localeCompare(String(nameMap[b])));
          }
        } else {
          sortedOpp.sort((a,b)=> String(nameMap[a]).localeCompare(String(nameMap[b])));
        }
        const rowsData = sortedOpp.map(oid => {
          const base = { opponent: nameMap[oid] || oid };
          // iterate turnsDesc so the left-most column is the most recent turn
          turnsDesc.forEach((t, i) => {
            const entry = (rowsByOpp[oid] || []).find(r => {
              const rn = r.turnNumber !== undefined && r.turnNumber !== null ? r.turnNumber : (r.turn_number !== undefined ? r.turn_number : null);
              return rn !== null && Number(rn) === Number(t);
            });
            const myChoice = entry ? (entry.appliedChoice || entry.choice || entry.applied_choice || '') : '';
            const oppChoice = entry ? (entry.opponentChoice || entry.opponent_choice || '') : '';
            const points = entry && (entry.pointsAwarded !== undefined && entry.pointsAwarded !== null) ? ` (${entry.pointsAwarded})` : '';
            const cellText = `${myChoice || ''}/${oppChoice || ''}${points}`;
            let cls = null;
            if (myChoice && oppChoice) {
              if (myChoice === 'war' && oppChoice === 'war') cls = 'cell-war-war';
              else if (myChoice === 'peace' && oppChoice === 'peace') cls = 'cell-peace-peace';
              else if (myChoice === 'war' && oppChoice === 'peace') cls = 'cell-war-peace';
              else if (myChoice === 'peace' && oppChoice === 'war') cls = 'cell-peace-war';
            }
            const cellSpec = { type: 'text', value: cellText };
            if (cls) cellSpec.className = cls;
            base[`t${i}`] = cellSpec;
          });
          return base;
        });

        try {
            const snap = JSON.stringify({ turns: turnsDesc, rowsData });
            if (snap === _prevHistoryHtml) return; _prevHistoryHtml = snap;
            if (!window.TableRenderer) throw new Error('TableRenderer not available');
            const schema = { columns: cols };
            const existingTable = historyContainer.querySelector('table.tbl');
            // If an existing table has a different number of columns, recreate it so colgroup/widths match
            let recreate = false;
            if (existingTable) {
              const ths = existingTable.querySelectorAll('thead th');
              if (ths.length !== cols.length) recreate = true;
            }
            if (existingTable && !recreate) {
              window.TableRenderer.updateRows(historyContainer, rowsData);
            } else {
              // create fresh table when none exists or column count changed
              historyContainer.innerHTML = '';
              window.TableRenderer.createTable(historyContainer, schema, rowsData, { compact: true, tableClass: 'history-table', autoSizeColumns: true, maxHeight: '360px' });
            }
        } catch (e) { console.error('turn history render error', e); historyContainer.innerHTML = '(failed to load history)'; }
    } catch (e) { console.error('renderTurnHistory: fetch error', e); historyContainer.innerHTML = '(failed to load history)'; }
  }

  // Fetch authoritative choices for participant and apply formatting to rows
  async function reloadButtonFormatting(participantId) {
    if (!participantId) return;
    try {
      const serverChoices = await fetchActiveChoices(participantId);
      // authoritative server choices replace previous server values
      activeChoices = Object.assign({}, serverChoices || {});
      // apply to table-based rows if present
      const table = playerListEl.querySelector('table.tbl');
      if (table) {
        const trs = Array.from(table.querySelectorAll('tbody tr'));
        trs.forEach(tr => {
          const pid = tr.dataset.playerId;
          const choice = activeChoices[String(pid)] || null;
          const tds = tr.querySelectorAll('td');
          const peaceBtn = tds[1] && tds[1].querySelector('button');
          const warBtn = tds[2] && tds[2].querySelector('button');
          if (peaceBtn) {
            peaceBtn.classList.toggle('selected-peace', choice === 'peace');
            peaceBtn.disabled = !_canAct();
          }
          if (warBtn) {
            warBtn.classList.toggle('selected-war', choice === 'war');
            warBtn.disabled = !_canAct();
          }
        });
      }
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
    latestPlayers = players || [];
    try { document.getElementById('gameId').textContent = game && game.name ? game.name : gameId; } catch (e) {}
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
      try { await renderTurnHistory(gameId, myParticipantId); } catch (e) { /* ignore */ }
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
    const ok = await alertService.confirm('Are you sure you want to end your turn?'); if (!ok) return; await endTurn();
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
      await renderLeaderboard(info.players || []);
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
