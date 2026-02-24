const express = require('express');
const router = express.Router();
const turnService = require('../services/turnService');
const resolveService = require('../services/resolveService');

router.get('/resolve-status', async (req, res) => {
  try {
    const { gameId, turnNumber } = req.query;
    const row = await require('../services/dbWrapper').getAsync('SELECT points_awarded FROM turns WHERE game_id = ? AND turn_number = ? LIMIT 1', [gameId, turnNumber]);
    const resolved = !!(row && row.points_awarded !== null);
    return res.json({ success: true, data: { resolved } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});



module.exports = router;
