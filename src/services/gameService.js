const { v4: uuidv4 } = require('uuid');
const db = require('./dbWrapper');

async function createGame(payload, hostUser) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const stage = 1;
  const current_turn = 0;
  const max_turns = payload.maxTurns || null;
  const history_limit = typeof payload.historyLimit === 'number' ? payload.historyLimit : 5;
  const payoff_matrix = JSON.stringify(payload.payoffMatrix || []);
  const error_chance = Number(payload.errorChance || 0);
  const max_players = Number(payload.maxPlayers || 1);

  return db.transaction(async () => {
    await db.runAsync(
      `INSERT INTO games (id, stage, current_turn, max_turns, history_limit, payoff_matrix, error_chance, max_players, current_players, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, stage, current_turn, max_turns, history_limit, payoff_matrix, error_chance, max_players, 1, now]
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
    stage: row.stage,
    currentTurn: row.current_turn,
    maxTurns: row.max_turns,
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
  await db.runAsync('UPDATE games SET stage = 2 WHERE id = ?', [gameId]);
  return { success: true };
}

module.exports = { createGame, getGame, startGame };
