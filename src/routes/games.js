const express = require('express');
const router = express.Router();
const { gameCreateValidator } = require('./validators/gameCreateValidator');
const { handleValidation } = require('./validators/handleValidation');
const gameService = require('../services/gameService');
const participantService = require('../services/participantService');

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

router.post('/:gameId/start', async (req, res) => {
  try {
    const participantId = req.session && req.session.participantId ? req.session.participantId : null;
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

module.exports = router;
