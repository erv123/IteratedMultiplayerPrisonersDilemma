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

    // also include participants list for convenience in public views
    try {
      const players = await require('../services/dbWrapper').allAsync('SELECT id, user_id, username, is_host, total_score FROM participants WHERE game_id = ?', [req.params.gameId]);
      return res.json({ success: true, data: { game: g.game, players } });
    } catch (e) {
      // if fetching players fails, still return game metadata
      return res.json({ success: true, data: { game: g.game, players: [] } });
    }
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
    const { username } = req.body;
    const userId = req.session && req.session.user ? req.session.user.id : null;
    const result = await participantService.createParticipant(req.params.gameId, userId, username || 'guest', false);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err && err.code === 'CONFLICT') return res.status(409).json({ success: false, error: err });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
