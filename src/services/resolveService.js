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

    // Load game payoff matrix, error chance and max_turns
    const gameRow = await db.getAsync('SELECT payoff_matrix, error_chance, max_turns FROM games WHERE id = ?', [gameId]);
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

    // Determine applied_choice for every turn (apply error chance)
    const appliedMap = new Map();
    for (const t of turns) {
      const base = t.choice;
      let applied = base;
      if (errorChance > 0) {
        const r = Math.random() * 100;
        if (r < errorChance) applied = flipChoice(base);
      }
      appliedMap.set(t.id, applied);
    }

    // Compute opponent applied choices and points, update turn rows
    const deltas = new Map();
    for (const t of turns) {
      const applied = appliedMap.get(t.id);
      const counterpart = turns.find(o => o.player_id === t.target_id && o.target_id === t.player_id);
      const opponentApplied = counterpart ? appliedMap.get(counterpart.id) : null;

      let pointsAwarded = 0;
      if (applied != null && opponentApplied != null) {
        const row = matrix[applied];
        if (row && Object.prototype.hasOwnProperty.call(row, opponentApplied)) pointsAwarded = Number(row[opponentApplied]) || 0;
      }

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

    // If this resolved turn was the last allowed turn, mark game as completed.
    // gameRow.max_turns is expected to be an integer > 0.
    const maxTurns = gameRow ? Number(gameRow.max_turns || 0) : 0;
    if (maxTurns > 0 && Number(turnNumber) >= maxTurns) {
      await db.runAsync('UPDATE games SET stage = ? WHERE id = ?', [3, gameId]);
    }

    return { success: true };
  });
}

module.exports = { resolveTurn };
