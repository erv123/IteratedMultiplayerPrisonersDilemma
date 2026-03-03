const db = require('./dbWrapper');

async function markOnline(userId) {
  if (!userId) return;
  const sql = `INSERT INTO user_presence (user_id, last_action, is_online, updated_at)
    VALUES (?, datetime('now'), 1, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_action = datetime('now'), is_online = 1, updated_at = datetime('now')`;
  await db.runAsync(sql, [userId]);
}

async function markOffline(userId) {
  if (!userId) return;
  const sql = `INSERT INTO user_presence (user_id, last_action, is_online, updated_at)
    VALUES (?, datetime('now'), 0, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_action = datetime('now'), is_online = 0, updated_at = datetime('now')`;
  await db.runAsync(sql, [userId]);
}

async function touch(userId) {
  if (!userId) return;
  const sql = `INSERT INTO user_presence (user_id, last_action, is_online, updated_at)
    VALUES (?, datetime('now'), 1, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_action = datetime('now'), is_online = 1, updated_at = datetime('now')`;
  await db.runAsync(sql, [userId]);
}

// thresholdSeconds: consider users active if last_action within this many seconds
async function getOnline(thresholdSeconds = 120) {
  // select users joined with presence table where last_action >= now - threshold or is_online=1
  const sql = `SELECT u.id as id, u.username as username, up.last_action as last_action, up.is_online as is_online
    FROM users u
    JOIN user_presence up ON up.user_id = u.id
    WHERE (strftime('%s', up.last_action) >= (strftime('%s','now') - ?)) OR up.is_online = 1`;
  const rows = await db.allAsync(sql, [Number(thresholdSeconds)]);
  return rows || [];
}

// mark users who are still flagged online but whose last_action is older
// than the given threshold (seconds) as offline
async function enforceStale(thresholdSeconds = 300) {
  const sql = `UPDATE user_presence SET is_online = 0, updated_at = datetime('now')
    WHERE is_online = 1 AND (strftime('%s','now') - strftime('%s', last_action)) >= ?`;
  await db.runAsync(sql, [Number(thresholdSeconds)]);
}

module.exports = { markOnline, markOffline, touch, getOnline, enforceStale };
