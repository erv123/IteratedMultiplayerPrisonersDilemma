const express = require('express');
const router = express.Router();
const { choiceValidator } = require('./validators/choiceValidator');
const { handleValidation } = require('./validators/handleValidation');
const turnService = require('../services/turnService');
const participantService = require('../services/participantService');

router.get('/me', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED' } });
  const userId = req.session.user.id;
  try {
    const p = await participantService.findParticipantForUser(null, userId);
    return res.json({ success: true, data: p });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/:participantId/myChoices', async (req, res) => {
  try {
    const pId = req.params.participantId;
    const rows = await require('../services/dbWrapper').allAsync('SELECT * FROM turns WHERE player_id = ? ORDER BY turn_number DESC', [pId]);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/:participantId/choice', choiceValidator, handleValidation, async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const { targetId, choice } = req.body;
    const p = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    if (!p) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Participant not found' } });
    const gameId = p.game_id;
    const g = await require('../services/dbWrapper').getAsync('SELECT current_turn FROM games WHERE id = ?', [gameId]);
    const turnNumber = g ? g.current_turn : 0;
    const out = await turnService.saveChoice(gameId, turnNumber, participantId, targetId, choice);
    return res.json({ success: true, data: out });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/:participantId/submit', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    await participantService.markReady(participantId);
    const part = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    if (!part) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const gameId = part.game_id;
    const readyCountRow = await require('../services/dbWrapper').getAsync('SELECT SUM(ready_for_next_turn) as readyCount, count(*) as total FROM participants WHERE game_id = ?', [gameId]);
    if (readyCountRow && readyCountRow.readyCount === readyCountRow.total) {
      const resolveService = require('../services/resolveService');
      await resolveService.resolveTurn(gameId, (await require('../services/dbWrapper').getAsync('SELECT current_turn FROM games WHERE id = ?', [gameId])).current_turn);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/:participantId/history', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const p = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    if (!p) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const game = await require('../services/dbWrapper').getAsync('SELECT history_limit FROM games WHERE id = ?', [p.game_id]);
    const limit = game ? game.history_limit : 5;
    const history = await require('../services/turnService').getPlayerHistory(p.game_id, participantId, limit);
    return res.json({ success: true, data: history });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
