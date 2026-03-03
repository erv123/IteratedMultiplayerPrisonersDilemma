const db = require('./dbWrapper');

async function createGame(payload, hostUser) {
  // Use dynamic import for uuid (ESM-only in recent versions)
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();
  const now = new Date().toISOString();
  const name = (payload.name || '').trim();
  if (!name) throw new Error('Game name required');
  const stage = 1;
  const current_turn = 0;
  const end_chance = Number(payload.endChance || 0);
  const history_limit = typeof payload.historyLimit === 'number' ? payload.historyLimit : 5;
  const payoff_matrix = JSON.stringify(payload.payoffMatrix || []);
  const error_chance = Number(payload.errorChance || 0);
  const max_players = Number(payload.maxPlayers || 1);

  return db.transaction(async () => {
    await db.runAsync(
      `INSERT INTO games (id, name, stage, current_turn, end_chance, history_limit, payoff_matrix, error_chance, max_players, current_players, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, stage, current_turn, end_chance, history_limit, payoff_matrix, error_chance, max_players, 1, now]
    );

    const participantId = uuidv4();
    const userId = hostUser && hostUser.userId ? hostUser.userId : null;
    const username = hostUser && hostUser.username ? hostUser.username : (userId ? 'user' : 'host');

    await db.runAsync(
      `INSERT INTO participants (id, game_id, user_id, username, total_score, ready_for_next_turn, is_host, score_history)
       VALUES (?, ?, ?, ?, 0, 0, 1, '[]')`,
      [participantId, id, userId, username]
    );

    return { success: true, gameId: id, participantId };
  });
}

async function getGame(gameId) {
  const row = await db.getAsync('SELECT * FROM games WHERE id = ?', [gameId]);
  if (!row) return { success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } };
  return { success: true, game: {
    id: row.id,
    name: row.name,
    stage: row.stage,
    currentTurn: row.current_turn,
    endChance: row.end_chance,
    historyLimit: row.history_limit,
    payoffMatrix: JSON.parse(row.payoff_matrix || '[]'),
    errorChance: row.error_chance,
    maxPlayers: row.max_players,
    currentPlayers: row.current_players,
    createdAt: row.created_at,
  } };
}

async function startGame(gameId, hostParticipantId) {
  // Validate host
  const host = await db.getAsync('SELECT * FROM participants WHERE id = ? AND game_id = ? AND is_host = 1', [hostParticipantId, gameId]);
  if (!host) return { success: false, error: { code: 'FORBIDDEN', message: 'Only host may start game' } };
  // Ensure minimum participants
  const countRow = await db.getAsync('SELECT COUNT(1) as cnt FROM participants WHERE game_id = ?', [gameId]);
  const cnt = countRow ? Number(countRow.cnt || 0) : 0;
  if (cnt < 2) return { success: false, error: { code: 'BAD_REQUEST', message: 'At least two participants required to start the game' } };
  // mark game started and initialize first turn
  await db.runAsync('UPDATE games SET stage = 2, current_turn = 1 WHERE id = ?', [gameId]);
  return { success: true };
}

async function updateSettings(gameId, hostParticipantId, payload) {
  // Validate host
  const host = await db.getAsync('SELECT * FROM participants WHERE id = ? AND game_id = ? AND is_host = 1', [hostParticipantId, gameId]);
  if (!host) return { success: false, error: { code: 'FORBIDDEN', message: 'Only host may update settings' } };
  const gameRow = await db.getAsync('SELECT stage FROM games WHERE id = ?', [gameId]);
  if (!gameRow) return { success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } };
  if (Number(gameRow.stage) !== 1) return { success: false, error: { code: 'BAD_REQUEST', message: 'Cannot update settings after game started' } };

  const fields = [];
  const params = [];
  if (payload.endChance != null) { fields.push('end_chance = ?'); params.push(Number(payload.endChance)); }
  if (payload.historyLimit != null) { fields.push('history_limit = ?'); params.push(Number(payload.historyLimit)); }
  if (payload.payoffMatrix != null) { fields.push('payoff_matrix = ?'); params.push(typeof payload.payoffMatrix === 'string' ? payload.payoffMatrix : JSON.stringify(payload.payoffMatrix)); }
  if (payload.errorChance != null) { fields.push('error_chance = ?'); params.push(Number(payload.errorChance)); }
  if (payload.maxPlayers != null) { fields.push('max_players = ?'); params.push(Number(payload.maxPlayers)); }

  if (fields.length === 0) return { success: false, error: { code: 'BAD_REQUEST', message: 'No settings provided' } };

  params.push(gameId);
  const sql = `UPDATE games SET ${fields.join(', ')} WHERE id = ?`;
  await db.runAsync(sql, params);
  return { success: true };
}

module.exports = { createGame, getGame, startGame, updateSettings };
