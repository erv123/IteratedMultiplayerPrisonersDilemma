// CreateGame page script — uses window.api (public/api.js)
(function () {
  function genTempId() {
    return Math.random().toString(36).substring(2, 9);
  }

  const gameId = genTempId();
  const gameIdDisplay = document.getElementById('gameIdDisplay');
  if (gameIdDisplay) gameIdDisplay.innerText = gameId;

  const hostInfoEl = document.getElementById('hostInfo');
  async function loadSession() {
    try {
      const who = await window.api.get('/auth/whoami');
      if (who && who.success && who.data) {
        hostInfoEl.innerText = `Logged in as ${who.data.username}`;
      } else {
        hostInfoEl.innerHTML = 'Not logged in — please log in from the lobby before creating a game.';
      }
    } catch (err) {
      hostInfoEl.innerText = 'Error checking session';
    }
  }

  async function showValidation(details) {
    if (!details || !details.length) return await alertService.alert('Validation failed');
    const msgs = details.map(d => `${d.field}: ${d.message} (value=${d.value})`).join('\n');
    await alertService.alert('Validation failed:\n' + msgs);
  }

  // Initialize payoff matrix using TableRenderer if available
  function initPayoffMatrix() {
    const container = document.getElementById('payoffMatrixTable');
    if (!container || !window.TableRenderer) return;
    const schema = { columns: [ { key: 'label', title: '' , className: 'payoff-first-col' }, { key: 'peace', title: 'Opponent: Peace' }, { key: 'war', title: 'Opponent: War' } ] };
    const rows = [
      { label: 'Player: Peace', peace: { type: 'input', value: { value: 2, name: 'pp' } }, war: { type: 'input', value: { value: 0, name: 'pw' } } },
      { label: 'Player: War',  peace: { type: 'input', value: { value: 3, name: 'wp' } }, war: { type: 'input', value: { value: 1, name: 'ww' } } },
    ];
    window.TableRenderer.createTable(container, schema, rows, { compact: true, tableClass: 'payoff-table' });
  }

  async function registerGame() {
    // read payoff values from the TableRenderer inputs if present, otherwise fall back to old ids
    function getInputVal(name) {
      const sel = document.querySelector(`#payoffMatrixTable input[name="${name}"]`);
      if (sel) return Number(sel.value || 0);
      const el = document.getElementById(name);
      return el ? Number(el.value || 0) : 0;
    }

    const payoffMatrix = {
      peace_peace: getInputVal('pp'),
      peace_war: getInputVal('pw'),
      war_peace: getInputVal('wp'),
      war_war: getInputVal('ww'),
    };

    const errorChance = Number(document.getElementById('errorChance').value || 0);
    const endChanceVal = document.getElementById('endChance').value;
    if (endChanceVal === '') return await alertService.alert('End chance is required and must be between 1 and 99');
    const endChance = Number(endChanceVal);
    const maxPlayers = Number(document.getElementById('maxPlayers').value || 1);
    const historyLimit = Number(document.getElementById('historyLimit').value || 5);

    // client-side validation consistent with validators
    if (Number.isNaN(errorChance) || errorChance < 0 || errorChance > 100) return await alertService.alert('Error chance must be between 0 and 100');
    if (!Number.isInteger(endChance) || endChance < 1 || endChance > 99) return await alertService.alert('End chance must be an integer between 1 and 99');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 40) return await alertService.alert('Max players must be an integer between 2 and 40');
    if (!Number.isInteger(historyLimit) || historyLimit < -1) return await alertService.alert('History limit must be >= -1');

    const payload = {
        name: document.getElementById('gameName').value.trim(),
      payoffMatrix,
      errorChance,
      endChance,
      maxPlayers,
      historyLimit,
    };

      if (!payload.name) return await alertService.alert('Game name is required');

    try {
      const res = await window.api.post('/games', payload);
      if (res && res.success) {
        await alertService.alert('Game registered!');
        const gid = res.data && (res.data.gameId || res.data.id || res.data.game_id);
        // Prefer returned gameId, fallback to temp id
        const targetId = gid || gameId;
        window.location.href = `/gameInfo?gameId=${encodeURIComponent(targetId)}`;
        return;
      }

      if (res && res.error) {
        if (res.error.code === 'VALIDATION_ERROR') {
          await showValidation(res.error.details || []);
          return;
        }
        await alertService.alert('Error creating game: ' + (res.error.message || 'unknown'));
      } else {
        await alertService.alert('Unexpected response from server');
      }
    } catch (err) {
      await alertService.alert('Network or server error: ' + (err && err.message));
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('registerBtn');
    if (btn) btn.addEventListener('click', registerGame);
    loadSession();
    initPayoffMatrix();
  });

})();
