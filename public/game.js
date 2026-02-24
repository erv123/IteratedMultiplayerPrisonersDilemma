// Game page script — uses window.api and window.polling
(function () {
  function getQueryParam(name) { const params = new URLSearchParams(window.location.search); return params.get(name); }

  const gameIdRaw = getQueryParam('gameId');
  const gameId = gameIdRaw ? gameIdRaw.trim() : '';
  document.getElementById('gameId').textContent = gameId || '—';

  const usernameEl = document.getElementById('username');
  const turnDisplay = document.getElementById('turnDisplay');
  const playerListEl = document.getElementById('playerList');
  const leaderboardEl = document.getElementById('leaderboard');
  const historyContainer = document.getElementById('historyContainer');
  const actionHeader = document.getElementById('actionHeader');
  const endTurnBtn = document.getElementById('endTurnBtn');

  let sessionUser = null;
  let myParticipantId = null;
  let currentTurn = null;
  let myChoices = {};

  async function initSession() {
    try {
      const who = await window.api.get('/auth/whoami');
      sessionUser = who && who.success ? who.data : null;
      usernameEl.textContent = sessionUser ? sessionUser.username : '(guest)';
    } catch (e) { console.error('whoami failed', e); sessionUser = null; }
  }

  async function fetchGameInfo() {
    if (!gameId) return null;
    try {
      const r = await window.api.get(`/games/${encodeURIComponent(gameId)}`);
      if (!r || !r.success) return null;
      // r.data => { game, players }
      return r.data;
    } catch (e) { console.error('fetchGameInfo', e); return null; }
  }

  async function fetchMyChoices(participantId) {
    if (!participantId) return {};
    try {
      const r = await window.api.get(`/participants/${encodeURIComponent(participantId)}/myChoices`);
      if (!r || !r.success) return {};
      // rows are raw turns; map target_id -> choice for current turn
      const rows = r.data || [];
      const choices = {};
      rows.forEach(row => { if (row.turn_number === currentTurn) choices[row.target_id] = row.choice; });
      return choices;
    } catch (e) { console.error('fetchMyChoices', e); return {}; }
  }

  function renderLeaderboard(players) {
    leaderboardEl.innerHTML = '';
    if (!players) return;
    players.slice().sort((a,b) => (b.total_score || 0) - (a.total_score || 0)).forEach(p => {
      const div = document.createElement('div'); div.textContent = `${p.username}: ${p.total_score || 0}`; leaderboardEl.appendChild(div);
    });
  }

  function renderPlayers(players) {
    playerListEl.innerHTML = '';
    if (!myParticipantId) { playerListEl.textContent = 'You are not a participant. Join from the Game Info page.'; return; }
    players.forEach(player => {
      if (player.id === myParticipantId) return; // skip self
      const row = document.createElement('div'); row.className = 'player-row'; row.dataset.playerId = player.id;
      const name = document.createElement('span'); name.className = 'player-name'; name.textContent = player.username;
      const peaceBtn = document.createElement('button'); peaceBtn.textContent = 'Peace'; peaceBtn.className = 'choice-btn peace-btn';
      const warBtn = document.createElement('button'); warBtn.textContent = 'War'; warBtn.className = 'choice-btn war-btn';

      const existing = myChoices[player.id];
      if (existing === 'peace') peaceBtn.classList.add('selected-peace');
      if (existing === 'war') warBtn.classList.add('selected-war');

      peaceBtn.addEventListener('click', () => selectChoice(player.id, 'peace'));
      warBtn.addEventListener('click', () => selectChoice(player.id, 'war'));

      row.appendChild(name); row.appendChild(peaceBtn); row.appendChild(warBtn);
      playerListEl.appendChild(row);
    });
  }

  async function selectChoice(targetId, choice) {
    if (!myParticipantId) return alert('Not a participant');
    myChoices[targetId] = choice;
    // update UI
    const row = document.querySelector(`.player-row[data-player-id="${targetId}"]`);
    if (row) {
      const p = row.querySelector('.peace-btn'); const w = row.querySelector('.war-btn');
      p.classList.remove('selected-peace'); w.classList.remove('selected-war');
      if (choice === 'peace') p.classList.add('selected-peace'); else w.classList.add('selected-war');
    }

    // persist
    try {
      await window.api.post(`/participants/${encodeURIComponent(myParticipantId)}/choice`, { targetId, choice });
    } catch (e) { console.error('save choice failed', e); }
  }

  async function endTurn() {
    if (!myParticipantId) return alert('Not a participant');
    // ensure we have choices for visible opponents
    const opponentIds = Array.from(document.querySelectorAll('.player-row')).map(r => r.dataset.playerId);
    const missing = opponentIds.find(id => !myChoices[id]);
    if (missing) return alert('You must choose Peace or War for every player.');

    // mark ready (server will resolve when all ready)
    try {
      await window.api.post(`/participants/${encodeURIComponent(myParticipantId)}/submit`, {});
      disableTurnUI();
    } catch (e) { console.error('submit failed', e); alert('Failed to submit turn'); }
  }

  function disableTurnUI() { document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true); if (endTurnBtn) endTurnBtn.disabled = true; }
  function enableTurnUI() { document.querySelectorAll('.choice-btn').forEach(b => b.disabled = false); if (endTurnBtn) endTurnBtn.disabled = false; }

  async function renderTurnHistory(players) {
    historyContainer.innerHTML = '';
    if (!players || players.length === 0) return;

    // fetch history for each participant concurrently
    const histPromises = players.map(p => window.api.get(`/participants/${encodeURIComponent(p.id)}/history`).then(r => ({ p, r })).catch(e => ({ p, r: null })));
    const resolved = await Promise.all(histPromises);

    // build combined table using opponent names
    const allEntries = [];
    resolved.forEach(({ p, r }) => {
      if (!r || !r.success) return;
      const rows = r.data || [];
      rows.forEach(row => {
        allEntries.push(Object.assign({ player_username: p.username }, row));
      });
    });

    if (allEntries.length === 0) return;

    // opponents and turns
    const opponents = [...new Set(allEntries.map(e => e.targetId))];
    const turns = [...new Set(allEntries.map(e => e.turnNumber))].sort((a,b)=>a-b);

    const table = document.createElement('table');
    const header = document.createElement('tr'); header.innerHTML = '<th>Player</th>' + turns.map(t => `<th>Turn ${t}</th>`).join(''); table.appendChild(header);

    // for each player (row), show their history vs opponents aggregated by target
    const playersById = players.reduce((acc, p) => (acc[p.id] = p.username, acc), {});
    const grouped = {};
    allEntries.forEach(e => {
      const key = e.player_username;
      grouped[key] = grouped[key] || [];
      grouped[key].push(e);
    });

    Object.keys(grouped).forEach(playerName => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${playerName}</td>`;
      turns.forEach(turn => {
        const entry = grouped[playerName].find(x => x.turnNumber === turn);
        const cell = document.createElement('td');
        if (entry) cell.textContent = `${entry.choice}/${entry.opponentChoice || entry.opponent_choice || ''}`;
        row.appendChild(cell);
      });
      table.appendChild(row);
    });

    historyContainer.appendChild(table);
  }

  // Pollers
  const infoKey = `gameState:${gameId}`;
  const historyKey = `gameHistory:${gameId}`;

  async function infoFn() {
    return await fetchGameInfo();
  }

  const infoPoller = window.polling.startPolling(infoKey, infoFn, 1500, { immediate: true });
  infoPoller.subscribe(async (err, result) => {
    if (err) { console.error('info poller error', err); return; }
    if (!result) return;
    const game = result.game; const players = result.players || [];
    // map to camelCase friendly fields if needed
    currentTurn = game.currentTurn !== undefined ? game.currentTurn : game.current_turn;
    turnDisplay.textContent = currentTurn || 0;

    // find participant id for this user
    if (!myParticipantId && sessionUser) {
      const me = players.find(p => (p.user_id && sessionUser.id && p.user_id === sessionUser.id) || p.username === sessionUser.username);
      if (me) myParticipantId = me.id;
    }

    // fetch my choices for current turn
    if (myParticipantId) {
      myChoices = await fetchMyChoices(myParticipantId);
    }

    renderPlayers(players);
    renderLeaderboard(players);

    // determine ready-state
    const meRow = players.find(p => p.id === myParticipantId);
    const myReady = meRow ? (meRow.ready_for_next_turn === 1 || meRow.readyForNextTurn === 1) : 0;
    if (myReady === 1) { disableTurnUI(); actionHeader.textContent = 'Waiting for others'; } else { enableTurnUI(); actionHeader.textContent = 'Choose Your Actions'; }
  });

  const historyPoller = window.polling.startPolling(historyKey, async () => {
    const info = await fetchGameInfo(); return info ? (info.players || []) : [];
  }, 3000, { immediate: true });
  historyPoller.subscribe((err, players) => { if (err) { console.error(err); return; } renderTurnHistory(players); });

  // End turn button
  endTurnBtn.addEventListener('click', endTurn);

  // Back to info and logout
  document.getElementById('backToInfoBtn').addEventListener('click', async () => { window.location.href = `/gameInfo?gameId=${encodeURIComponent(gameId)}`; });
  document.getElementById('logoutBtn').addEventListener('click', async () => { await window.api.post('/auth/logout'); window.location.href = '/'; });

  // Initial
  (async function init() {
    await initSession();
    // If user is not participant, prompt to join via gameInfo page; we keep join action on gameInfo
    // initial info fetch
    const info = await fetchGameInfo();
    if (info) { renderLeaderboard(info.players || []); }
  })();

})();
