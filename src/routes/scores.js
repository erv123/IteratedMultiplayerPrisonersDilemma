const express = require('express');
const router = express.Router();

router.get('/:gameId', async (req, res) => {
  try {
    const rows = await require('../services/dbWrapper').allAsync('SELECT id, username, total_score FROM participants WHERE game_id = ?', [req.params.gameId]);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/:gameId/score-history', async (req, res) => {
  try {
    const rows = await require('../services/dbWrapper').allAsync('SELECT id, username, score_history FROM participants WHERE game_id = ?', [req.params.gameId]);
    const parsed = rows.map(r => ({ id: r.id, username: r.username, scoreHistory: JSON.parse(r.score_history || '[]') }));
    return res.json({ success: true, data: parsed });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
