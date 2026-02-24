const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./dbWrapper');

async function createUser(username, password, opts = {}) {
  const existing = await db.getAsync('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return { success: false, error: { code: 'CONFLICT', message: 'Username taken' } };
  const id = uuidv4();
  const hashed = await bcrypt.hash(password, 10);
  const isAdmin = opts.isAdmin ? 1 : 0;
  const resetBypass = opts.resetBypass ? 1 : 0;
  // set last_reset_at to now so newly created users cannot immediately reset unless bypassed
  await db.runAsync(
    'INSERT INTO users (id, username, password, is_admin, reset_bypass, last_reset_at, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))',
    [id, username, hashed, isAdmin, resetBypass]
  );
  return { success: true, userId: id };
}

async function verifyPassword(username, password) {
  const row = await db.getAsync('SELECT id, password, is_admin FROM users WHERE username = ?', [username]);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password);
  if (!ok) return null;
  return { id: row.id, username, isAdmin: !!row.is_admin };
}

async function canResetPassword(username) {
  const row = await db.getAsync('SELECT id, last_reset_at, reset_bypass FROM users WHERE username = ?', [username]);
  if (!row) return false;
  if (row.reset_bypass) return true;
  if (!row.last_reset_at) return true;
  // naive 24h check
  const last = new Date(row.last_reset_at).getTime();
  if (Number.isNaN(last)) return true;
  return (Date.now() - last) > 24 * 3600 * 1000;
}

async function setPassword(userId, newPassword) {
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.runAsync('UPDATE users SET password = ?, last_reset_at = datetime(\'now\') WHERE id = ?', [hashed, userId]);
  return { success: true };
}

async function findUserByUsername(username) {
  const row = await db.getAsync('SELECT * FROM users WHERE username = ?', [username]);
  return row || null;
}

module.exports = { createUser, verifyPassword, canResetPassword, setPassword, findUserByUsername };
