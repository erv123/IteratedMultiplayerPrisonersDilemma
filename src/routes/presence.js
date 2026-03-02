const express = require('express');
const router = express.Router();
const presence = require('../services/presenceService');

router.post('/heartbeat', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED' } });
  try {
    await presence.touch(req.session.user.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/online', async (req, res) => {
  try {
    const rows = await presence.getOnline(120);
    return res.json({ success: true, data: rows.map(r => ({ id: r.id, username: r.username, last_action: r.last_action, is_online: !!r.is_online })) });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/offline', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED' } });
  try {
    await presence.markOffline(req.session.user.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
