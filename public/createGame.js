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

  function showValidation(details) {
    if (!details || !details.length) return alert('Validation failed');
    const msgs = details.map(d => `${d.field}: ${d.message} (value=${d.value})`).join('\n');
    alert('Validation failed:\n' + msgs);
  }

  async function registerGame() {
    const payoffMatrix = {
      peace_peace: Number(document.getElementById('pp').value || 0),
      peace_war: Number(document.getElementById('pw').value || 0),
      war_peace: Number(document.getElementById('wp').value || 0),
      war_war: Number(document.getElementById('ww').value || 0),
    };

    const errorChance = Number(document.getElementById('errorChance').value || 0);
    const endChanceVal = document.getElementById('endChance').value;
    if (endChanceVal === '') return alert('End chance is required and must be between 1 and 99');
    const endChance = Number(endChanceVal);
    const maxPlayers = Number(document.getElementById('maxPlayers').value || 1);
    const historyLimit = Number(document.getElementById('historyLimit').value || 5);

    // client-side validation consistent with validators
    if (Number.isNaN(errorChance) || errorChance < 0 || errorChance > 100) return alert('Error chance must be between 0 and 100');
    if (!Number.isInteger(endChance) || endChance < 1 || endChance > 99) return alert('End chance must be an integer between 1 and 99');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 40) return alert('Max players must be an integer between 2 and 40');
    if (!Number.isInteger(historyLimit) || historyLimit < -1) return alert('History limit must be >= -1');

    const payload = {
        name: document.getElementById('gameName').value.trim(),
      payoffMatrix,
      errorChance,
      endChance,
      maxPlayers,
      historyLimit,
    };

      if (!payload.name) return alert('Game name is required');

    try {
      const res = await window.api.post('/games', payload);
      if (res && res.success) {
        alert('Game registered!');
        const gid = res.data && (res.data.gameId || res.data.id || res.data.game_id);
        // Prefer returned gameId, fallback to temp id
        const targetId = gid || gameId;
        window.location.href = `/gameInfo?gameId=${encodeURIComponent(targetId)}`;
        return;
      }

      if (res && res.error) {
        if (res.error.code === 'VALIDATION_ERROR') {
          showValidation(res.error.details || []);
          return;
        }
        alert('Error creating game: ' + (res.error.message || 'unknown'));
      } else {
        alert('Unexpected response from server');
      }
    } catch (err) {
      alert('Network or server error: ' + (err && err.message));
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('registerBtn');
    if (btn) btn.addEventListener('click', registerGame);
    loadSession();
  });

})();
