const db = require('./dbWrapper');
const turnService = require('./turnService');
const participantService = require('./participantService');

function flipChoice(choice) {
  if (choice === 'peace') return 'war';
  if (choice === 'war') return 'peace';
  return choice;
}

async function resolveTurn(gameId, turnNumber) {
  return db.transaction(async () => {
    const turns = await turnService.getChoicesForTurn(gameId, turnNumber);
    if (!turns || turns.length === 0) {
      throw { code: 'NO_DATA', message: 'No choices for turn' };
    }

    // Load game payoff matrix, error chance and end_chance
    const gameRow = await db.getAsync('SELECT payoff_matrix, error_chance, end_chance FROM games WHERE id = ?', [gameId]);
    const errorChance = gameRow ? Number(gameRow.error_chance || 0) : 0;
    let payoffMatrix = null;
    try { payoffMatrix = gameRow && gameRow.payoff_matrix ? JSON.parse(gameRow.payoff_matrix) : null; } catch (e) { payoffMatrix = null; }
    const defaultMatrix = { peace: { peace: 3, war: 0 }, war: { peace: 5, war: 1 } };
    // payoff_matrix historically stored as either a nested object { peace: { peace: 2, war: 0 }, ... }
    // or as a flat map { "peace_peace": 2, "peace_war": 0, ... } per docs. Normalize both to nested form.
    let matrix = defaultMatrix;
    if (payoffMatrix && typeof payoffMatrix === 'object') {
      // detect flat map form
      const keys = Object.keys(payoffMatrix);
      const hasFlatKeys = keys.some(k => typeof k === 'string' && k.indexOf('_') >= 0);
      if (hasFlatKeys) {
        matrix = { peace: { peace: 0, war: 0 }, war: { peace: 0, war: 0 } };
        for (const k of keys) {
          const v = Number(payoffMatrix[k]) || 0;
          const parts = String(k).split('_');
          if (parts.length === 2) {
            const a = parts[0]; const b = parts[1];
            matrix[a] = matrix[a] || {};
            matrix[a][b] = v;
          }
        }
      } else {
        matrix = payoffMatrix;
      }
    }

    // log raw and intermediate matrices for debugging
    try {
      console.log('[resolveTurn] raw payoffMatrix:', payoffMatrix);
      console.log('[resolveTurn] intermediate matrix before normalization:', matrix);
    } catch (e) { /* ignore */ }

    // Normalize and determine applied_choice for every turn (apply error chance)
    const appliedMap = new Map();
    for (const t of turns) {
      const baseRaw = t.choice !== undefined && t.choice !== null ? String(t.choice) : '';
      const base = baseRaw.toLowerCase();
      let applied = base;
      if (errorChance > 0) {
        const r = Math.random() * 100;
        if (r < errorChance) applied = flipChoice(base);
      }
      appliedMap.set(t.id, applied);
    }

    // Log turns and applied choices to stdout so they appear in the Node terminal
    try {
      console.log('[resolveTurn] turns:', turns.map(t => ({ id: t.id, player_id: t.player_id, target_id: t.target_id, choice: t.choice })));
      console.log('[resolveTurn] appliedMap:', Array.from(appliedMap.entries()));
    } catch (e) { /* ignore logging errors */ }

    // Normalize matrix keys to lower-case and numeric values, then compute opponent applied choices and points, update turn rows
    const deltas = new Map();
    const normMatrix = { peace: { peace: 0, war: 0 }, war: { peace: 0, war: 0 } };
    try {
      for (const a of Object.keys(matrix || {})) {
        const aLow = String(a).toLowerCase();
        normMatrix[aLow] = normMatrix[aLow] || {};
        const row = matrix[a] || matrix[aLow] || {};
        for (const b of Object.keys(row || {})) {
          const bLow = String(b).toLowerCase();
          normMatrix[aLow][bLow] = Number(row[b]) || Number(row[bLow]) || 0;
        }
      }
      // log normalized matrix to stdout so it is visible in the Node terminal
      console.log('[resolveTurn] normalized payoff matrix:', JSON.stringify(normMatrix));
    } catch (e) { /* fall back to default */ }
    for (const t of turns) {
      const applied = appliedMap.get(t.id);
      const counterpart = turns.find(o => String(o.player_id) === String(t.target_id) && String(o.target_id) === String(t.player_id));
      const opponentApplied = counterpart ? appliedMap.get(counterpart.id) : null;

      let pointsAwarded = 0;
      if (applied != null && opponentApplied != null) {
        const aKey = String(applied).toLowerCase();
        const bKey = String(opponentApplied).toLowerCase();
        const row = normMatrix[aKey] || null;
        if (row && Object.prototype.hasOwnProperty.call(row, bKey)) pointsAwarded = Number(row[bKey]) || 0;
        else {
          console.log('[resolveTurn] lookup miss', { gameId, turnNumber, turnId: t.id, playerId: t.player_id, applied, opponentApplied, aKey, bKey, row });
        }
      }

      // always log per-turn resolution details to stdout for debugging
      try {
        console.log('[resolveTurn] turn result', {
          turnId: t.id,
          playerId: t.player_id,
          targetId: t.target_id,
          applied,
          opponentApplied,
          pointsAwarded,
          lookupRow: normMatrix[String(applied).toLowerCase()] || null
        });
      } catch (e) { /* ignore logging errors */ }

      // If no points were found in the normalized matrix but the default matrix
      // has a non-zero value for the same keys, fall back to the default and log it.
      try {
        if (pointsAwarded === 0 && applied != null && opponentApplied != null) {
          const aKey = String(applied).toLowerCase();
          const bKey = String(opponentApplied).toLowerCase();
          const defRow = defaultMatrix[aKey] || null;
          if (defRow && Object.prototype.hasOwnProperty.call(defRow, bKey) && Number(defRow[bKey]) > 0) {
            console.log('[resolveTurn] falling back to default matrix for points', { turnId: t.id, aKey, bKey, defaultPoints: defRow[bKey] });
            pointsAwarded = Number(defRow[bKey]);
            // persist the fallback points into the DB update as well
            await db.runAsync('UPDATE turns SET points_awarded = ? WHERE id = ?', [pointsAwarded, t.id]);
            // update delta map accordingly (replace previous added value)
            deltas.set(t.player_id, (deltas.get(t.player_id) || 0) + pointsAwarded);
          }
        }
      } catch (e) { /* ignore fallback errors */ }

      await db.runAsync('UPDATE turns SET applied_choice = ?, opponent_choice = ?, points_awarded = ? WHERE id = ?', [applied, opponentApplied, pointsAwarded, t.id]);

      deltas.set(t.player_id, (deltas.get(t.player_id) || 0) + pointsAwarded);
    }

    // Apply participant score deltas and append to score_history
    for (const [participantId, delta] of deltas.entries()) {
      await participantService.updateTotalScore(participantId, delta);
      const row = await db.getAsync('SELECT total_score FROM participants WHERE id = ?', [participantId]);
      const total = row ? row.total_score : 0;
      await participantService.appendScoreHistory(participantId, total);
    }

    // Reset ready flags and advance turn
    await db.runAsync('UPDATE participants SET ready_for_next_turn = 0 WHERE game_id = ?', [gameId]);
    await db.runAsync('UPDATE games SET current_turn = current_turn + 1 WHERE id = ?', [gameId]);

    // Per-turn end chance: each resolved turn has a percent probability to end the game.
    const endChance = gameRow ? Number(gameRow.end_chance || 0) : 0;
    if (endChance > 0) {
      const roll = Math.random() * 100; // 0 <= roll < 100
      if (roll < endChance) {
        await db.runAsync('UPDATE games SET stage = ? WHERE id = ?', [3, gameId]);
      }
    }

    return { success: true };
  });
}

module.exports = { resolveTurn };
