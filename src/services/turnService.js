const db = require('./dbWrapper');

async function saveChoice(gameId, turnNumber, playerId, targetId, choice) {
  const existing = await db.getAsync(
    'SELECT id FROM turns WHERE game_id = ? AND turn_number = ? AND player_id = ? AND target_id = ?',
    [gameId, turnNumber, playerId, targetId]
  );
  if (existing) {
    await db.runAsync('UPDATE turns SET choice = ? WHERE id = ?', [choice, existing.id]);
    return { success: true, id: existing.id };
  }
  // dynamic import for uuid to support ESM-only package versions
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();
  await db.runAsync(
    `INSERT INTO turns (id, game_id, turn_number, player_id, target_id, choice, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, gameId, turnNumber, playerId, targetId, choice]
  );
  return { success: true, id };
}

async function getChoicesForTurn(gameId, turnNumber) {
  const rows = await db.allAsync('SELECT * FROM turns WHERE game_id = ? AND turn_number = ?', [gameId, turnNumber]);
  return rows || [];
}

async function getPlayerHistory(gameId, playerId, limit = -1) {
  let rows;
  if (limit === -1) {
    // return all resolved turns for this player
    rows = await db.allAsync(
      'SELECT * FROM turns WHERE game_id = ? AND player_id = ? AND points_awarded IS NOT NULL ORDER BY turn_number ASC',
      [gameId, playerId]
    );
  } else {
    // Apply limit as number of previous game turns (relative to current_turn)
    // Fetch current turn for game and compute the resolved turn window: (current_turn - 1) down to (current_turn - limit)
    const g = await db.getAsync('SELECT current_turn FROM games WHERE id = ?', [gameId]);
    const currentTurn = g && g.current_turn !== undefined && g.current_turn !== null ? Number(g.current_turn) : null;
    if (currentTurn === null) {
      // fallback to previous behavior: latest resolved rows up to limit
      rows = await db.allAsync(
        'SELECT * FROM turns WHERE game_id = ? AND player_id = ? AND points_awarded IS NOT NULL ORDER BY turn_number DESC LIMIT ?',
        [gameId, playerId, limit]
      );
      rows = (rows || []).reverse();
    } else {
      const maxTurn = currentTurn - 1;
      const minTurn = Math.max(0, currentTurn - limit);
      rows = await db.allAsync(
        'SELECT * FROM turns WHERE game_id = ? AND player_id = ? AND points_awarded IS NOT NULL AND turn_number >= ? AND turn_number <= ? ORDER BY turn_number ASC',
        [gameId, playerId, minTurn, maxTurn]
      );
    }
  }
  return rows.map(r => ({
    id: r.id,
    turnNumber: r.turn_number,
    targetId: r.target_id,
    choice: r.applied_choice,
    pointsAwarded: r.points_awarded,
    createdAt: r.created_at,
  }));
}

module.exports = { saveChoice, getChoicesForTurn, getPlayerHistory };
