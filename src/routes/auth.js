const express = require('express');
const router = express.Router();
const { registerValidator, loginValidator, resetPasswordValidator } = require('./validators/authValidator');
const { handleValidation } = require('./validators/handleValidation');
const authService = require('../services/authService');

router.post('/register', registerValidator, handleValidation, async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;
    // only allow creating admin users if the requester is admin
    if (isAdmin && !(req.session && req.session.user && req.session.user.isAdmin)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin creation requires admin privileges' } });
    }
    const result = await authService.createUser(username, password, { isAdmin: !!isAdmin });
    if (!result.success) return res.status(409).json({ success: false, error: result.error });
    req.session.user = { id: result.userId, username, isAdmin: !!isAdmin };
    return res.status(201).json({ success: true, data: { userId: result.userId } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Server error' } });
  }
});

router.post('/login', loginValidator, handleValidation, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await authService.verifyPassword(username, password);
    if (!user) return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials' } });
    req.session.user = { id: user.id, username: username, isAdmin: user.isAdmin };
    return res.json({ success: true, data: { id: user.id, username } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Server error' } });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to destroy session' } });
    return res.json({ success: true });
  });
});

router.post('/resetPassword', resetPasswordValidator, handleValidation, async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    const user = await authService.findUserByUsername(username);
    if (!user) return res.status(400).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'username not found' } });
    const ok = await authService.canResetPassword(username);
    if (!ok) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Reset not allowed' } });
    await authService.setPassword(user.id, newPassword);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.get('/whoami', (req, res) => {
  if (!req.session || !req.session.user) return res.json({ success: true, data: null });
  return res.json({ success: true, data: req.session.user });
});

module.exports = router;
