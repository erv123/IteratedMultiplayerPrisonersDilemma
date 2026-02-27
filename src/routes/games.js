const express = require('express');
const router = express.Router();
const { gameCreateValidator } = require('./validators/gameCreateValidator');
const { handleValidation } = require('./validators/handleValidation');
const gameService = require('../services/gameService');
const participantService = require('../services/participantService');
const resolveService = require('../services/resolveService');

router.post('/', gameCreateValidator, handleValidation, async (req, res) => {
  try {
    const hostUser = req.session && req.session.user ? { userId: req.session.user.id, username: req.session.user.username } : null;
    const result = await gameService.createGame(req.body, hostUser);
    // if a participantId was created for the host, remember it in session so host actions (start) work
    if (result && result.participantId && req.session) {
      req.session.participantId = result.participantId;
    }
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/', async (req, res) => {
  // lightweight listing (debug/admin)
  try {
    const rows = await require('../services/dbWrapper').allAsync('SELECT id, stage, current_turn, max_players, current_players FROM games');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/:gameId/playerCount', async (req, res) => {
  try {
    const g = await gameService.getGame(req.params.gameId);
    if (!g.success) return res.status(404).json({ success: false, error: g.error });
    return res.json({ success: true, data: { playerCount: g.game.currentPlayers } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/:gameId', async (req, res) => {
  try {
    const g = await gameService.getGame(req.params.gameId);
    if (!g.success) return res.status(404).json({ success: false, error: g.error });
    // return only game metadata (data is the game object); participants are provided by a dedicated endpoint
    return res.json({ success: true, data: g.game });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Dedicated participants endpoint for a game
router.get('/:gameId/participants', async (req, res) => {
  try {
    const rows = await require('../services/dbWrapper').allAsync('SELECT id, user_id, username, is_host, total_score, ready_for_next_turn FROM participants WHERE game_id = ?', [req.params.gameId]);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Return turn state: total participants and how many are ready. If all ready, trigger resolution for current turn.
router.get('/:gameId/turnState', async (req, res) => {
  try {
    const db = require('../services/dbWrapper');
    const gameRow = await db.getAsync('SELECT current_turn FROM games WHERE id = ?', [req.params.gameId]);
    if (!gameRow) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
    const totalRow = await db.getAsync('SELECT COUNT(1) as total FROM participants WHERE game_id = ?', [req.params.gameId]);
    const readyRow = await db.getAsync('SELECT COUNT(1) as ready FROM participants WHERE game_id = ? AND ready_for_next_turn = 1', [req.params.gameId]);
    const total = totalRow ? Number(totalRow.total || 0) : 0;
    const ready = readyRow ? Number(readyRow.ready || 0) : 0;

    // If all participants are ready, trigger resolution asynchronously so we always return a JSON response quickly.
    if (total > 0 && ready >= total) {
      const turnToResolve = Number(gameRow.current_turn || 0);
      // fire-and-forget - log any errors
      resolveService.resolveTurn(req.params.gameId, turnToResolve).catch((e) => {
        console.error('async resolveTurn error in turnState endpoint', e);
      });
    }

    return res.json({ success: true, data: { totalParticipants: total, readyParticipants: ready } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/:gameId/start', async (req, res) => {
  try {
    // Prefer explicit participantId stored in session. If missing but user is logged in,
    // attempt to resolve the participant id for this user in the game (host row).
    let participantId = req.session && req.session.participantId ? req.session.participantId : null;
    if (!participantId && req.session && req.session.user) {
      try {
        const userId = req.session.user.id;
        const username = req.session.user.username;
        const db = require('../services/dbWrapper');
        // First, try resolve by user_id
        let row = await db.getAsync('SELECT id, user_id, username FROM participants WHERE game_id = ? AND user_id = ? AND is_host = 1', [req.params.gameId, userId]);
        if (!row) {
          // Fallback: maybe host participant was created without user_id (anonymous host). Try match by username.
          row = await db.getAsync('SELECT id, user_id, username FROM participants WHERE game_id = ? AND username = ? AND is_host = 1', [req.params.gameId, username]);
        }
        if (row && row.id) {
          participantId = row.id;
          // store for convenience in session
          req.session.participantId = participantId;
        } else {
          console.debug('start: could not resolve host participant for user', { gameId: req.params.gameId, userId, username });
        }
      } catch (e) {
        console.error('error resolving participantId for start', e);
      }
    }
    const out = await gameService.startGame(req.params.gameId, participantId);
    if (!out.success) return res.status(403).json({ success: false, error: out.error });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/:gameId/join', async (req, res) => {
  try {
    // Joining a game requires an authenticated user - do not allow anonymous/guest joins
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Login required to join a game' } });
    }
    const userId = req.session.user.id;
    const username = req.session.user.username;
    const result = await participantService.createParticipant(req.params.gameId, userId, username, false);
    // store participant id in session for convenience
    if (result && result.participantId && req.session) req.session.participantId = result.participantId;
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err && err.code === 'CONFLICT') return res.status(409).json({ success: false, error: err });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Export game data as CSV (three sections: games, participants, turns). Public access.
router.get('/:gameId/download', async (req, res) => {
  try {
    const db = require('../services/dbWrapper');
    const gameId = req.params.gameId;
    const gameRow = await db.getAsync('SELECT id, name, stage, current_turn, end_chance, history_limit, payoff_matrix, error_chance, max_players, current_players, created_at FROM games WHERE id = ?', [gameId]);
    if (!gameRow) return res.status(404).send('Game not found');
    // Only allow export when game is completed (stage === 3)
    if (Number(gameRow.stage) !== 3) return res.status(403).json({ success: false, error: { code: 'GAME_NOT_COMPLETED', message: 'Game is not completed' } });

    const participants = await db.allAsync('SELECT id, user_id, username, total_score, ready_for_next_turn, is_host, score_history FROM participants WHERE game_id = ?', [gameId]);
    const turns = await db.allAsync('SELECT id, turn_number, player_id, target_id, choice, applied_choice, opponent_choice, points_awarded, created_at FROM turns WHERE game_id = ? ORDER BY turn_number ASC', [gameId]);

    // Build participant id -> username map
    const nameMap = {};
    (participants || []).forEach(p => { nameMap[String(p.id)] =p .username || String(p.user_id || p.id); });

    // Prepare public-safe game object (omit id)
    const gamePublic = Object.assign({}, gameRow);
    if (gamePublic.id) delete gamePublic.id;
    // stringify complex fields to avoid objects in CSV consumer
    gamePublic.payoff_matrix = gamePublic.payoff_matrix ? String(gamePublic.payoff_matrix) : '';

    // Prepare participants list for export (omit id and user_id)
    const participantsPublic = (participants || []).map(p => ({
      username: p.username,
      total_score: p.total_score,
      ready_for_next_turn: p.ready_for_next_turn,
      is_host: p.is_host,
      score_history: p.score_history ? String(p.score_history) : '',
    }));

    // Prepare turns for export: replace player_id/target_id with usernames and omit ids
    const turnsPublic = (turns || []).map(t => ({
      turn_number: t.turn_number,
      player: nameMap[String(t.player_id)] || t.player_id,
      target: nameMap[String(t.target_id)] || t.target_id,
      choice: t.choice,
      applied_choice: t.applied_choice,
      opponent_choice: t.opponent_choice,
      points_awarded: t.points_awarded,
      created_at: t.created_at,
    }));

    return res.json({ success: true, data: { game: gamePublic, participants: participantsPublic, turns: turnsPublic } });
  } catch (err) {
    console.error('download export error', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
