// GameInfo page — uses window.api and window.polling
(function () {
  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  const gameIdRaw = getQueryParam('gameId');
  const gameId = gameIdRaw ? gameIdRaw.trim() : '';
  document.getElementById('gameIdDisplay').textContent = gameId || '—';

  const loggedUserEl = document.getElementById('loggedUserDisplay');
  const logoutBtn = document.getElementById('logoutBtn');
  const enterGameBtn = document.getElementById('enterGameBtn');
  const downloadGameBtn = document.getElementById('downloadGameBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const loggedInActions = document.getElementById('loggedInActions');
  const playersList = document.getElementById('playersList');
  const statusEl = document.getElementById('status');
  const gameSettingsEl = document.getElementById('gameSettings');
  const loginNotice = document.getElementById('loginNotice');

  let lastEnterState = { text: null, disabled: null };
  let prevStage = null;
  // snapshots to avoid unnecessary re-renders on each poll
  let lastRenderedStatus = null;
  let lastPlayersSnapshot = null;
  let lastSettingsSnapshot = null;
  let lastScoreHistorySnapshot = null;
  let currentAmHost = false;
  let lastPayoffEditable = null;
  let lastAmHostFlag = null;

  async function fetchPublicInfo() {
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
    } catch (e) { console.error('fetchPublicInfo error', e); return null; }
  }

  async function fetchScoreHistory() {
    if (!gameId) return null;
    try {
      const res = await window.api.get(`/scores/${encodeURIComponent(gameId)}/score-history`);
      if (!res || !res.success) return null;
      return res.data;
    } catch (e) { console.error('fetchScoreHistory error', e); return null; }
  }

  function renderPlayers(players) {
    // debug: inspect players payload
    try { console.debug('renderPlayers: players.length=', (players && players.length) || 0, 'lastPlayersSnapshot=', !!lastPlayersSnapshot); } catch (e) {}
    // Avoid re-render when players list hasn't changed
    const snap = (!players || players.length === 0) ? '[]' : JSON.stringify((players || []).map(p => ({ id: p.id, user_id: p.user_id, username: p.username, is_host: p.is_host })));
    if (snap === lastPlayersSnapshot) return;
    lastPlayersSnapshot = snap;
    if (!players || players.length === 0) {
      playersList.textContent = '(no players yet)';
      return;
    }
    playersList.innerHTML = '';
    players.forEach(p => {
      const div = document.createElement('div');
      const isHostBool = (p.is_host === 1 || p.is_host === '1' || p.is_host === true || p.is_host === 'true');
      const hostLabel = isHostBool ? ' (host)' : '';
      try { console.debug('renderPlayers: player=', p.username || p.user_id || p.id, 'is_host=', p.is_host, 'detectedHost=', isHostBool); } catch (e) {}
      div.textContent = `${p.username || p.user_id || p.id}${hostLabel}`;
      playersList.appendChild(div);
    });
  }

  function renderGameSettings(game, editable) {
    if (!game || !gameSettingsEl) return;
    try { console.debug('renderGameSettings: editable=', !!editable, 'payoff_present=', game && (game.payoff_matrix || game.payoffMatrix) != null); } catch (e) {}
    const get = (o, a, b) => (o && (o[a] != null ? o[a] : (o[b] != null ? o[b] : undefined)));
    const historyLimit = get(game, 'history_limit', 'historyLimit');
    const payoff = get(game, 'payoff_matrix', 'payoffMatrix');
    const maxPlayers = get(game, 'maxPlayers', 'max_players');
    const endChance = get(game, 'end_chance', 'endChance');
    const errorChance = get(game, 'error_chance', 'errorChance');
    const created = get(game, 'created_at', 'createdAt');

    // Build a small snapshot of settings we care about and avoid re-render if unchanged
    try {
      const snapObj = { historyLimit: historyLimit == null ? null : historyLimit, payoff: payoff == null ? null : payoff, maxPlayers: maxPlayers == null ? null : maxPlayers, endChance: endChance == null ? null : endChance, errorChance: errorChance == null ? null : errorChance, created: created == null ? null : created, editable: !!editable };
      const snap = JSON.stringify(snapObj);
      if (snap === lastSettingsSnapshot) return;
      // keep previous table editable state for comparison
      const prevSettingsSnapshot = lastSettingsSnapshot;
      lastSettingsSnapshot = snap;
    } catch (e) {
      // if snapshotting fails, fall back to re-rendering
    }

    // Build settings DOM without wholesale innerHTML replacements to avoid DOM churn/flicker
    // Keep a stable container for payoff so TableRenderer can update rows in-place
    gameSettingsEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    function pushRow(labelText, valueText, isInput, key, isPercent) {
      const row = document.createElement('div'); row.className = 'game-setting-row';
      const label = document.createElement('label'); label.textContent = labelText; row.appendChild(label);
      if (isInput) {
        const wrapper = document.createElement('div'); wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center';
        const input = document.createElement('input'); input.className = 'game-setting-input'; input.disabled = !editable; input.value = String(valueText);
        if (key) input.dataset.key = key;
        const span = document.createElement('span'); span.className = 'percent-suffix'; span.textContent = '%';
        wrapper.appendChild(input); wrapper.appendChild(span); row.appendChild(wrapper);
      } else {
        const input = document.createElement('input'); input.className = 'game-setting-input'; input.disabled = !editable; input.value = String(valueText);
        if (key) input.dataset.key = key;
        row.appendChild(input);
      }
      frag.appendChild(row);
    }

    if (maxPlayers != null) pushRow('Max players:', String(maxPlayers), false, 'maxPlayers');
    if (historyLimit != null) pushRow('History limit:', String(historyLimit), false, 'historyLimit');

    // Payoff handling: create or update a stable payoff container
    const payoffWrapper = document.createElement('div');
    const title = document.createElement('div'); title.innerHTML = '<strong>Payoff:</strong>'; payoffWrapper.appendChild(title);

    if (payoff != null) {
      function normalizeMatrixWithLabels(p) {
        const titleize = s => (typeof s === 'string') ? String(s).replace(/_/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase()) : s;
        if (!p && p !== 0) return null;
        if (Array.isArray(p)) return { matrix: p.map(r => Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.values(r) : [r])), rowLabels: null, colLabels: null };
        if (typeof p === 'string') {
          try { const parsed = JSON.parse(p); return normalizeMatrixWithLabels(parsed); } catch (e) {}
          const rowsStr = p.split(/\s*;\s*/).map(r => r.trim()).filter(Boolean);
          if (rowsStr.length > 1) return { matrix: rowsStr.map(r => r.split(/\s*,\s*/).map(v => (v === '' ? '' : (isFinite(v) ? Number(v) : v)))), rowLabels: null, colLabels: null };
          return null;
        }
        if (typeof p === 'object') {
          const keys = Object.keys(p);
          const flat = keys.length && keys.every(k => typeof k === 'string' && k.indexOf('_') > -1 && (typeof p[k] === 'number' || typeof p[k] === 'string'));
          if (flat) {
            const rowsSet = new Set(); const colsSet = new Set();
            keys.forEach(k => { const [r,c] = k.split('_'); rowsSet.add(r); colsSet.add(c); });
            const rowKeys = Array.from(rowsSet).sort();
            const colKeys = Array.from(colsSet).sort();
            const matrix = rowKeys.map(r => colKeys.map(c => p[`${r}_${c}`] != null ? p[`${r}_${c}`] : ''));
            return { matrix, rowLabels: rowKeys.map(titleize), colLabels: colKeys.map(titleize) };
          }
          const rowKeys = Object.keys(p).sort();
          const rowLabels = rowKeys.map(k => titleize(k));
          let colKeysUnion = new Set();
          rowKeys.forEach(rk => { const row = p[rk]; if (row && typeof row === 'object') Object.keys(row).forEach(c => colKeysUnion.add(c)); });
          const colKeys = Array.from(colKeysUnion).sort();
          const matrix = rowKeys.map(rk => {
            const row = p[rk];
            if (row && typeof row === 'object') return colKeys.map(ck => row[ck] != null ? row[ck] : '');
            return colKeys.map(_ => '');
          });
          return { matrix, rowLabels, colLabels: colKeys.map(titleize) };
        }
        return null;
      }

      const norm = normalizeMatrixWithLabels(payoff);
      if (norm && norm.matrix && Array.isArray(norm.matrix) && norm.matrix.length && norm.matrix.every(r => Array.isArray(r))) {
        const matrix = norm.matrix;
        const cols = Math.max(...matrix.map(r => (r||[]).length));
        const colLabels = norm.colLabels || new Array(cols).fill(0).map((_,i)=>`Choice ${i}`);
        const rowLabels = norm.rowLabels || matrix.map((_,i)=>`Choice ${i}`);

        const container = document.createElement('div'); container.style.overflow = 'auto'; container.style.marginTop = '6px';
        const tableContainer = document.createElement('div'); tableContainer.id = 'payoffMatrixDisplay'; container.appendChild(tableContainer);
        payoffWrapper.appendChild(container);

        // attach to fragment now so DOM node is stable; we'll render table into it
        frag.appendChild(payoffWrapper);

        // Use TableRenderer to create or update the table without replacing nodes
        setTimeout(() => {
          try {
            const c = document.getElementById('payoffMatrixDisplay'); if (!c) return;
            const schema = { columns: [ { key: 'label', title: '', className: 'payoff-first-col' } ].concat(colLabels.map((c,ci)=>({ key: `c${ci}`, title: `Opponent: ${c}` }))) };
            const rowsData = matrix.map((r,ri) => {
              const obj = { label: `Player: ${rowLabels[ri] || ''}` };
              for (let ci = 0; ci < cols; ci++) {
                obj[`c${ci}`] = { type: (editable ? 'input' : 'readonlyInput'), value: (r && r[ci] != null) ? r[ci] : '' };
              }
              return obj;
            });
            const existingTable = c.querySelector('table.tbl');
            if (window.TableRenderer) {
              // if editability changed since last render, recreate table to ensure cell types update
              if (existingTable && lastPayoffEditable !== !!editable) {
                c.innerHTML = '';
                lastPayoffEditable = null;
              }
              if (existingTable && lastPayoffEditable === !!editable) {
                window.TableRenderer.updateRows(c, rowsData);
              } else {
                window.TableRenderer.createTable(c, schema, rowsData, { compact: true });
                lastPayoffEditable = !!editable;
              }
            } else {
              // fallback: create a simple table only if needed
              if (!existingTable) {
                const table = document.createElement('table'); table.className = 'payoff-table';
                const thead = document.createElement('thead'); const thr = document.createElement('tr'); thr.appendChild(document.createElement('td'));
                colLabels.forEach(h => { const td = document.createElement('td'); td.className = 'muted'; td.textContent = h; thr.appendChild(td); }); thead.appendChild(thr); table.appendChild(thead);
                const tbody = document.createElement('tbody');
                matrix.forEach((r,ri) => {
                  const tr = document.createElement('tr'); const tdLabel = document.createElement('td'); tdLabel.className = 'muted'; tdLabel.textContent = rowLabels[ri] || '';
                  tr.appendChild(tdLabel);
                  for (let ci=0; ci<cols; ci++) { const td = document.createElement('td'); const input = document.createElement('input'); input.className = 'payoff-input'; input.disabled = true; input.value = String((r||[])[ci] != null ? (r||[])[ci] : ''); td.appendChild(input); tr.appendChild(td); }
                  tbody.appendChild(tr);
                }); table.appendChild(tbody); tableContainer.appendChild(table);
              } else {
                // update fallback inputs in-place
                const inputs = c.querySelectorAll('tbody tr');
                matrix.forEach((r,ri) => {
                  const tr = inputs[ri]; if (!tr) return;
                  const tds = tr.querySelectorAll('td');
                  for (let ci=0; ci<cols; ci++) { const inp = tds[ci+1] && tds[ci+1].querySelector('input'); if (inp) { inp.disabled = !editable; inp.value = String((r||[])[ci] != null ? (r||[])[ci] : ''); } }
                });
              }
            }
          } catch (e) { console.error('payoff render error', e); }
        }, 0);
        // we've appended payoffWrapper already; skip the generic addition below
        // continue building other settings
      } else {
        const small = document.createElement('small'); small.textContent = typeof payoff === 'object' ? JSON.stringify(payoff) : String(payoff);
        payoffWrapper.appendChild(small); frag.appendChild(payoffWrapper);
      }
    }

    if (endChance != null) {
      const row = document.createElement('div'); row.className = 'game-setting-row';
      const label = document.createElement('label'); label.textContent = 'End chance (%):'; row.appendChild(label);
      const wrapper = document.createElement('div'); wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center';
      const input = document.createElement('input'); input.className = 'game-setting-input'; input.disabled = !editable; input.value = String(endChance);
      input.dataset.key = 'endChance';
      const span = document.createElement('span'); span.className = 'percent-suffix'; span.textContent = '%'; wrapper.appendChild(input); wrapper.appendChild(span); row.appendChild(wrapper);
      frag.appendChild(row);
    }
    if (errorChance != null) {
      const row = document.createElement('div'); row.className = 'game-setting-row';
      const label = document.createElement('label'); label.textContent = 'Error chance (%):'; row.appendChild(label);
      const wrapper = document.createElement('div'); wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center';
      const input = document.createElement('input'); input.className = 'game-setting-input'; input.disabled = !editable; input.value = String(errorChance);
      input.dataset.key = 'errorChance';
      const span = document.createElement('span'); span.className = 'percent-suffix'; span.textContent = '%'; wrapper.appendChild(input); wrapper.appendChild(span); row.appendChild(wrapper);
      frag.appendChild(row);
    }
    if (created) { const d = document.createElement('div'); d.className = 'muted'; d.style.marginTop = '6px'; d.style.fontSize = '0.85rem'; d.textContent = `Created: ${String(created)}`; frag.appendChild(d); }

    gameSettingsEl.appendChild(frag);

    // If editable by host, add Update Settings button
    if (editable) {
      try {
        const upd = document.createElement('div'); upd.style.marginTop = '8px';
        const btn = document.createElement('button'); btn.textContent = 'Update Settings'; btn.className = 'btn'; btn.id = 'updateSettingsBtn';
        upd.appendChild(btn);
        gameSettingsEl.appendChild(upd);
        btn.addEventListener('click', async () => {
          try {
            btn.disabled = true;
            // collect inputs by data-key
            const payload = {};
            const inputs = gameSettingsEl.querySelectorAll('.game-setting-input');
            inputs.forEach(i => {
              const k = i.dataset && i.dataset.key;
              if (!k) return;
              const v = i.value;
              if (k === 'historyLimit' || k === 'maxPlayers') payload[k] = Number(v || 0);
              else if (k === 'endChance' || k === 'errorChance') payload[k] = Number(v || 0);
              else payload[k] = v;
            });

            // collect payoff matrix if present
            const pm = document.getElementById('payoffMatrixDisplay');
            if (pm) {
              const table = pm.querySelector('table');
              const matrix = [];
              if (table) {
                const trs = table.querySelectorAll('tbody tr');
                trs.forEach(tr => {
                  const cells = tr.querySelectorAll('td');
                  // skip first label cell
                  const row = [];
                  for (let ci = 1; ci < cells.length; ci++) {
                    const inp = cells[ci].querySelector('input');
                    row.push(inp ? (inp.value === '' ? '' : (isFinite(inp.value) ? Number(inp.value) : inp.value)) : cells[ci].textContent);
                  }
                  matrix.push(row);
                });
              } else {
                // fallback: TableRenderer might render custom structure; try inputs under pm
                const rows = pm.querySelectorAll('div.tr, tr');
                if (rows && rows.length) {
                  rows.forEach(r => {
                    const ins = r.querySelectorAll('input');
                    const row = [];
                    // skip first input if it's the label
                    ins.forEach((ii, idx) => { if (idx > 0) row.push(ii.value === '' ? '' : (isFinite(ii.value) ? Number(ii.value) : ii.value)); });
                    if (row.length) matrix.push(row);
                  });
                }
              }
              if (matrix.length) payload.payoffMatrix = matrix;
            }

            const res = await window.api.post(`/games/${encodeURIComponent(gameId)}/updateSettings`, payload);
            if (!res || !res.success) {
              await alertService.alert((res && res.error && res.error.message) || 'Failed to update settings');
            } else {
              // refresh info quickly
              try { await fetchPublicInfo(); } catch (e) {}
              await alertService.alert('Settings updated');
            }
          } catch (e) { console.error('update settings error', e); await alertService.alert('Update failed'); }
          finally { btn.disabled = false; }
        });
      } catch (e) { console.error('attach update button error', e); }
    }
  }

  function renderStatus(game) {
    if (!game) { if (lastRenderedStatus !== 'no-game') { statusEl.textContent = 'No game info'; lastRenderedStatus = 'no-game'; } return; }
    const displayStage = game.stage === 1 ? 'Not Started' : game.stage === 2 ? 'Started' : game.stage === 3 ? 'Completed' : String(game.stage);
    const playersStr = `${game.currentPlayers || game.current_players || 0}/${game.maxPlayers || game.max_players || 0}`;
    const statusStr = `Stage:${displayStage}|Players:${playersStr}`;
    if (statusStr === lastRenderedStatus) return;
    lastRenderedStatus = statusStr;
    statusEl.textContent = `Stage: ${displayStage} — Players: ${playersStr}`;
  }

  // draw score chart similar to legacy implementation
  function drawScoreChart(participants) {
    const canvas = document.getElementById('scoreChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    ctx.clearRect(0,0,w,h);
    const lb = document.getElementById('leaderboardDisplay');
    // read theme-aware chart colors from CSS variables
    const cs = getComputedStyle(document.documentElement);
    const chartAxis = (cs.getPropertyValue('--chart-axis') || '#ccc').trim();
    const chartMuted = (cs.getPropertyValue('--chart-muted') || '#666').trim();
    const chartLabel = (cs.getPropertyValue('--chart-label') || '#999').trim();
    const chartLabelStroke = (cs.getPropertyValue('--chart-label-stroke') || '#ffffff').trim();
    const chartLabelFill = (cs.getPropertyValue('--chart-label-fill') || '#000000').trim();
    // build a palette large enough for many players (up to 40)
    const colors = [];
    // first, take any explicitly defined CSS vars --chart-col-0..N
    for (let i = 0; i < 40; i++) {
      const v = (cs.getPropertyValue(`--chart-col-${i}`) || '').trim();
      if (v) colors.push(v);
      else break;
    }
    // If CSS didn't define enough, generate the rest algorithmically using HSL
    const ensure = (count) => {
      const start = colors.length;
      for (let i = start; i < count; i++) {
        // spread hues evenly; offset slightly for variety
        const hue = Math.round(((i * 360) / count + 17) % 360);
        const sat = 62; const light = 50;
        colors.push(`hsl(${hue}, ${sat}%, ${light}%)`);
      }
    };
    // ensure at least 8 for legacy, and at least number of participants (capped at 40)
    const needed = Math.min(40, Math.max(8, participants ? participants.length : 8));
    ensure(needed);

    if (!participants || participants.length === 0) {
      ctx.fillStyle = chartMuted; ctx.fillText('No score history yet', 10, 20);
      if (lb) lb.textContent = '(no history)';
      return;
    }
    // Determine plotting bounds. We include an initial turn 0 at score 0,
    // then plot each history point at turn indices 1..N.
    let maxLen = 0; let minFound = Infinity; let maxFound = -Infinity;
    participants.forEach(p => {
      const hist = p.scoreHistory || p.score_history || [];
      maxLen = Math.max(maxLen, hist.length);
      hist.forEach(v => { if (typeof v === 'number') { minFound = Math.min(minFound, v); maxFound = Math.max(maxFound, v); } });
    });
    if (!isFinite(minFound)) minFound = 0; if (!isFinite(maxFound)) maxFound = 0;
    const minScore = Math.min(0, minFound); const maxScore = Math.max(0, maxFound);
    const range = Math.max(1, maxScore - minScore);
    const margin = 40; const plotW = w - margin * 2; const plotH = h - margin * 2;
    ctx.strokeStyle = chartAxis; ctx.beginPath(); ctx.moveTo(margin, margin); ctx.lineTo(margin, margin + plotH); ctx.lineTo(margin + plotW, margin + plotH); ctx.stroke();
    // turns = include initial 0 plus each recorded turn -> N+1 tick marks
    const turns = Math.max(1, maxLen + 1);
    for (let i = 0; i < turns; i++) { const x = margin + (i / Math.max(1, turns - 1)) * plotW; ctx.fillStyle = chartLabel; ctx.fillText(String(i), x - 6, margin + plotH + 14); }

    // choose thinner lines when many players to avoid visual clutter
    const manyPlayers = participants && participants.length > 12;
    // draw player lines and capture last points for labeling and leaderboard
    const lastPoints = {};
    participants.forEach((p, idx) => {
      const hist = p.scoreHistory || p.score_history || [];
      const color = colors[idx % colors.length];
      ctx.strokeStyle = color; ctx.lineWidth = manyPlayers ? 1 : 2; ctx.beginPath();
      // start at turn 0,0
      const x0 = margin + (0 / Math.max(1, turns - 1)) * plotW;
      const y0 = margin + plotH - ((0 - minScore) / range) * plotH;
      ctx.moveTo(x0, y0);
      let last = { x: x0, y: y0, value: 0 };
      hist.forEach((val, j) => {
        const idxX = j + 1;
        const x = margin + (idxX / Math.max(1, turns - 1)) * plotW;
        const y = margin + plotH - ((val - minScore) / range) * plotH;
        ctx.lineTo(x, y);
        last = { x, y, value: val };
      });
      ctx.stroke();
      const key = (p.id != null) ? String(p.id) : (p.username || String(idx));
      lastPoints[key] = { x: last.x, y: last.y, value: last.value, name: p.username || p.name || key, color };
    });

    // draw name labels at each player's last plotted point — only when not too many players
    const names = Object.values(lastPoints);
    const drawLabels = !manyPlayers && (names.length <= 12);
    if (drawLabels) {
      names.forEach((pt, i) => {
        const offX = 6;
        const offY = -6 - (i % 3) * 10; // small stagger to reduce overlap
        ctx.font = '12px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = chartLabelStroke;
        ctx.strokeText(pt.name, pt.x + offX, pt.y + offY);
        ctx.fillStyle = chartLabelFill;
        ctx.fillText(pt.name, pt.x + offX, pt.y + offY);
      });
    }

    // render leaderboard in sidebar (sorted by last score)
    if (lb) {
      const arr = participants.map((p, idx) => {
        const key = (p.id != null) ? String(p.id) : (p.username || String(idx));
        const lp = lastPoints[key] || { value: (p.total_score != null ? p.total_score : (p.scoreHistory && p.scoreHistory.length ? p.scoreHistory[p.scoreHistory.length - 1] : 0)) };
        return { id: key, name: p.username || p.name || key, score: lp.value || 0, color: (lastPoints[key] && lastPoints[key].color) || colors[idx % colors.length] };
      });
      arr.sort((a,b) => (b.score - a.score));

      // Build TableRenderer schema and rows
      try {
        const schema = { columns: [ { key: 'rank', title: '#' }, { key: 'player', title: 'Player' }, { key: 'score', title: 'Score' } ] };
        const rows = (arr || []).map((a, i) => {
          const topClass = i === 0 ? 'leader-top1' : i === 1 ? 'leader-top2' : i === 2 ? 'leader-top3' : null;
          return {
            rank: { type: 'text', value: String(i+1), className: topClass },
            player: { type: 'dot', value: a.name, color: a.color, className: topClass },
            score: { type: 'number', value: a.score, className: topClass }
          };
        });
        if (window.TableRenderer) {
          const container = lb;
          const existingTable = container.querySelector('table.tbl');
          if (existingTable) {
            window.TableRenderer.updateRows(container, rows);
          } else {
            window.TableRenderer.createTable(container, schema, rows, { compact: true });
          }
        } else {
          // fallback: simple HTML list
          const rowsHtml = arr.map((a,i) => `<div class="leaderboard-item"><div class="leaderboard-name"><span class="leaderboard-dot" style="background:${a.color}"></span><span class="leaderboard-rank">${i+1}</span><div style="margin-left:8px">${a.name}</div></div><div>${a.score}</div></div>`).join('');
          lb.innerHTML = `<div class="leaderboard-list ${arr.length >= 3 ? 'leaderboard-top3' : ''}">${rowsHtml}</div>`;
        }
      } catch (e) {
        console.error('leaderboard render error', e);
      }
    }
  }

  

  async function joinAsUser() {
    try {
      const res = await window.api.post(`/games/${encodeURIComponent(gameId)}/join`, {});
      if (!res || !res.success) {
        await alertService.alert((res && res.error && res.error.message) || 'Failed to join game');
        return false;
      }
      return true;
    } catch (e) {
      console.error('joinAsUser error', e);
      await alertService.alert('Failed to join game');
      return false;
    }
  }

  async function startGame() {
    const info = await fetchPublicInfo();
    if (!info || !info.game) return;
    const g = info.game;
    const isFull = (g.currentPlayers || g.current_players || 0) >= (g.maxPlayers || g.max_players || 0);
    if (!isFull) {
      const ok = await alertService.confirm('Game is not full. Start anyway?'); if (!ok) return;
    }
    try {
      const res = await window.api.post(`/games/${encodeURIComponent(gameId)}/start`, {});
      if (res && res.success) {
          window.location.href = `/game?gameId=${encodeURIComponent(gameId)}`;
      } else {
        await alertService.alert((res && res.error && res.error.message) || 'Failed to start game');
      }
    } catch (e) { await alertService.alert('Failed to start game'); }
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
          // fallback: case-insensitive username match after trimming
          if (p.username && sessionUser.username && String(p.username).trim().toLowerCase() === String(sessionUser.username).trim().toLowerCase()) return true;
          return false;
        });
        if (me) {
          amParticipant = true;
          // handle various DB representations: 1, '1', true, 'true'
          amHost = (me.is_host === 1 || me.is_host === '1' || me.is_host === true || me.is_host === 'true');
        }
      }

        // set global host flag used by renderGameSettings
        currentAmHost = !!amHost;
        console.debug('gameInfo: sessionUser=', sessionUser && sessionUser.username, 'amParticipant=', amParticipant, 'amHost=', amHost, 'currentAmHost=', currentAmHost);
        // if host membership changed, force players re-render so host label updates
        if (lastAmHostFlag !== currentAmHost) {
          lastPlayersSnapshot = null;
          lastAmHostFlag = currentAmHost;
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
              const ok = await alertService.confirm('Download game as CSV?'); if (!ok) return;
              const url = `/api/games/${encodeURIComponent(gameId)}/download`;
              const resp = await fetch(url, { credentials: 'same-origin' });
              if (!resp.ok) { const body = await resp.json().catch(() => null); const msg = body && body.error && body.error.message ? body.error.message : 'Failed to fetch game data'; await alertService.alert(msg); return; }
                const payload = await resp.json();
                if (!payload || !payload.success || !payload.data) { await alertService.alert('Invalid game data'); return; }
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
            } catch (e) { console.error('download error', e); await alertService.alert('Download failed'); }
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
              const ok = await alertService.confirm('Download game as ZIP?'); if (!ok) return;
              const url = `/api/games/${encodeURIComponent(gameId)}/download`;
              const resp = await fetch(url, { credentials: 'same-origin' });
              if (!resp.ok) { const body = await resp.json().catch(() => null); const msg = body && body.error && body.error.message ? body.error.message : 'Failed to fetch game data'; await alertService.alert(msg); return; }
              const payload = await resp.json();
              if (!payload || !payload.success || !payload.data) { await alertService.alert('Invalid game data'); return; }
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
              if (!JSZip) { await alertService.alert('Failed to load zip library'); return; }
              const zip = new JSZip();
              zip.file('games.csv', gamesCsv);
              zip.file('participants.csv', participantsCsv);
              zip.file('turns.csv', turnsCsv);
              const content = await zip.generateAsync({ type: 'blob' });
              // use sanitized game name if available, fallback to gameId
              const safeNameZip = (game && game.name) ? String(game.name).replace(/[^a-z0-9-_]/gi, '_') : gameId;
              const filename = `game_${safeNameZip}_export.zip`;
              const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
            } catch (e) { console.error('zip download error', e); await alertService.alert('ZIP download failed'); }
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
      // Now that session and host info is known, render settings with edit enabled for host when stage==1
      try {
        const numericStage = Number(stageNum);
        const editableFlag = !!(currentAmHost && numericStage === 1);
        console.debug('render invoke: stageNum=', stageNum, 'numericStage=', numericStage, 'currentAmHost=', currentAmHost, 'editableFlag=', editableFlag);
        renderGameSettings(info.game, editableFlag);
        // Ensure host UI elements are enabled and update button present when editable
        try {
          const gs = document.getElementById('gameSettings');
          if (gs) {
            const inputs = gs.querySelectorAll('.game-setting-input');
            inputs.forEach(i => { i.disabled = !editableFlag; });
            // ensure update button exists and is wired when editable
            const existingBtn = document.getElementById('updateSettingsBtn');
            if (editableFlag && !existingBtn) {
              const upd = document.createElement('div'); upd.style.marginTop = '8px';
              const btn = document.createElement('button'); btn.textContent = 'Update Settings'; btn.className = 'btn'; btn.id = 'updateSettingsBtn';
              upd.appendChild(btn);
              gs.appendChild(upd);
              btn.addEventListener('click', async () => {
                try {
                  btn.disabled = true;
                  const payload = {};
                  const inputs = gs.querySelectorAll('.game-setting-input');
                  inputs.forEach(i => {
                    const k = i.dataset && i.dataset.key;
                    if (!k) return;
                    const v = i.value;
                    if (k === 'historyLimit' || k === 'maxPlayers') payload[k] = Number(v || 0);
                    else if (k === 'endChance' || k === 'errorChance') payload[k] = Number(v || 0);
                    else payload[k] = v;
                  });
                  const pm = document.getElementById('payoffMatrixDisplay');
                  if (pm) {
                    const table = pm.querySelector('table');
                    const matrix = [];
                    if (table) {
                      const trs = table.querySelectorAll('tbody tr');
                      trs.forEach(tr => {
                        const cells = tr.querySelectorAll('td');
                        const row = [];
                        for (let ci = 1; ci < cells.length; ci++) {
                          const inp = cells[ci].querySelector('input');
                          row.push(inp ? (inp.value === '' ? '' : (isFinite(inp.value) ? Number(inp.value) : inp.value)) : cells[ci].textContent);
                        }
                        matrix.push(row);
                      });
                    } else {
                      const rows = pm.querySelectorAll('div.tr, tr');
                      if (rows && rows.length) {
                        rows.forEach(r => {
                          const ins = r.querySelectorAll('input');
                          const row = [];
                          ins.forEach((ii, idx) => { if (idx > 0) row.push(ii.value === '' ? '' : (isFinite(ii.value) ? Number(ii.value) : ii.value)); });
                          if (row.length) matrix.push(row);
                        });
                      }
                    }
                    if (matrix.length) payload.payoffMatrix = matrix;
                  }
                  const res = await window.api.post(`/games/${encodeURIComponent(gameId)}/updateSettings`, payload);
                  if (!res || !res.success) {
                    await alertService.alert((res && res.error && res.error.message) || 'Failed to update settings');
                  } else {
                    try { await fetchPublicInfo(); } catch (e) {}
                    await alertService.alert('Settings updated');
                  }
                } catch (e) { console.error('update settings error', e); await alertService.alert('Update failed'); }
                finally { btn.disabled = false; }
              });
            }
          }
        } catch (e) { console.error('ensure host UI error', e); }
      } catch (e) { console.error('renderGameSettings error after session check', e); }
    } catch (e) { console.error('session check error', e); }
  });

  const historyPoller = window.polling.startPolling(historyPollerKey, async () => {
    return await fetchScoreHistory();
  }, 3000, { immediate: true });

  historyPoller.subscribe((err, result) => {
    if (err) { console.error('history poller error', err); return; }
    if (!result) return;
    // Avoid redrawing chart if history unchanged
    try {
      const snap = JSON.stringify((result || []).map(p => ({ id: p.id, username: p.username, score_history: p.score_history || p.scoreHistory || [], total_score: p.total_score }))); 
      if (snap === lastScoreHistorySnapshot) return;
      lastScoreHistorySnapshot = snap;
    } catch (e) {
      // on snapshot error fall back to redrawing
    }
    // result is array of participants { id, username, scoreHistory }
    drawScoreChart(result);
  });

  // initial load for UI elements
  (async function init() {
    if (!gameId) { statusEl.textContent = 'No gameId in URL'; playersList.textContent = ''; return; }
    const info = await fetchPublicInfo(); if (info) { renderStatus(info.game); renderPlayers(info.players || []); renderGameSettings(info.game, false); }
    const hist = await fetchScoreHistory(); if (hist) drawScoreChart(hist);
  })();

  // Back to lobby
  const backLobbyBtn = document.getElementById('backLobbyBtn'); if (backLobbyBtn) backLobbyBtn.addEventListener('click', () => { window.location.href = '/'; });

})();
