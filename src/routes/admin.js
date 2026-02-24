const express = require('express');
const router = express.Router();
const db = require('../services/dbWrapper');

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin required' } });
  }
  return next();
}

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const rows = await db.allAsync('SELECT id, username, is_admin FROM users');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/setResetBypass', requireAdmin, async (req, res) => {
  try {
    const { userId, bypass } = req.body;
    await db.runAsync('UPDATE users SET reset_bypass = ? WHERE id = ?', [bypass ? 1 : 0, userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
