const { v4: uuidv4 } = require('uuid');
const db = require('./dbWrapper');

async function createParticipant(gameId, userId, username, isHost = false) {
  return db.transaction(async () => {
    const game = await db.getAsync('SELECT current_players, max_players FROM games WHERE id = ?', [gameId]);
    if (!game) throw { code: 'NOT_FOUND', message: 'Game not found' };
    if (game.current_players >= game.max_players) throw { code: 'CONFLICT', message: 'Game is full' };

    const participantId = uuidv4();
    await db.runAsync(
      `INSERT INTO participants (id, game_id, user_id, username, total_score, ready_for_next_turn, is_host, score_history)
       VALUES (?, ?, ?, ?, 0, 0, ?, '[]')`,
      [participantId, gameId, userId, username, isHost ? 1 : 0]
    );

    await db.runAsync('UPDATE games SET current_players = current_players + 1 WHERE id = ?', [gameId]);
    return { success: true, participantId };
  });
}

async function findParticipantForUser(gameId, userId) {
  const row = await db.getAsync('SELECT * FROM participants WHERE game_id = ? AND user_id = ?', [gameId, userId]);
  return row || null;
}

async function markReady(participantId) {
  const res = await db.runAsync('UPDATE participants SET ready_for_next_turn = 1 WHERE id = ?', [participantId]);
  if (res.changes === 0) throw { code: 'NOT_FOUND', message: 'Participant not found' };
  return { success: true };
}

async function updateTotalScore(participantId, delta) {
  await db.runAsync('UPDATE participants SET total_score = total_score + ? WHERE id = ?', [delta, participantId]);
  const row = await db.getAsync('SELECT total_score FROM participants WHERE id = ?', [participantId]);
  if (!row) throw { code: 'NOT_FOUND', message: 'Participant not found' };
  return row.total_score;
}

async function appendScoreHistory(participantId, totalScore) {
  const row = await db.getAsync('SELECT score_history FROM participants WHERE id = ?', [participantId]);
  if (!row) throw { code: 'NOT_FOUND', message: 'Participant not found' };
  let hist = [];
  try { hist = JSON.parse(row.score_history || '[]'); } catch (e) { hist = []; }
  hist.push(totalScore);
  await db.runAsync('UPDATE participants SET score_history = ? WHERE id = ?', [JSON.stringify(hist), participantId]);
  return hist;
}

module.exports = {
  createParticipant,
  findParticipantForUser,
  markReady,
  updateTotalScore,
  appendScoreHistory,
};
