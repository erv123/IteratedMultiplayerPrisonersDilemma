const { v4: uuidv4 } = require('uuid');
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
    rows = await db.allAsync(
      'SELECT * FROM turns WHERE game_id = ? AND player_id = ? AND points_awarded IS NOT NULL ORDER BY turn_number ASC',
      [gameId, playerId]
    );
  } else {
    rows = await db.allAsync(
      'SELECT * FROM turns WHERE game_id = ? AND player_id = ? AND points_awarded IS NOT NULL ORDER BY turn_number DESC LIMIT ?',
      [gameId, playerId, limit]
    );
    rows = (rows || []).reverse();
  }
  return rows.map(r => ({
    id: r.id,
    turnNumber: r.turn_number,
    targetId: r.target_id,
    choice: r.choice,
    pointsAwarded: r.points_awarded,
    createdAt: r.created_at,
  }));
}

module.exports = { saveChoice, getChoicesForTurn, getPlayerHistory };
