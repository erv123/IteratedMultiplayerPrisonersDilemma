const db = require('../server/db');

// Generic retry helper for SQLITE_BUSY
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function withRetry(fn, opts = {}) {
  const retries = typeof opts.retries === 'number' ? opts.retries : 6;
  const base = typeof opts.base === 'number' ? opts.base : 20; // ms
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isBusy = err && (err.code === 'SQLITE_BUSY' || (err.message && err.message.indexOf('SQLITE_BUSY') >= 0));
      if (!isBusy || attempt === retries) throw err;
      // exponential backoff with jitter
      const wait = Math.round(base * Math.pow(2, attempt) + Math.random() * base);
      await sleep(wait);
    }
  }
}

// Wrap common SQLite operations with retry logic to handle transient locks.
function getAsync(sql, params = []) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) return reject(err); resolve(row); });
  }));
}

function allAsync(sql, params = []) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) return reject(err); resolve(rows); });
  }));
}

function runAsync(sql, params = []) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  }));
}

function execAsync(sql) {
  return withRetry(() => new Promise((resolve, reject) => {
    db.exec(sql, (err) => { if (err) return reject(err); resolve(); });
  }));
}

let _inTransaction = false;
let _spCounter = 0;

async function transaction(fn) {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      // If already in a transaction, use SAVEPOINT to allow nested transactional work
      if (_inTransaction) {
        const sp = `sp_${++_spCounter}`;
        try {
          await execAsync(`SAVEPOINT ${sp}`);
          const result = await fn();
          await execAsync(`RELEASE ${sp}`);
          return resolve(result);
        } catch (err) {
          try { await execAsync(`ROLLBACK TO ${sp}`); await execAsync(`RELEASE ${sp}`); } catch (e) { /* ignore */ }
          return reject(err);
        }
      }

      // Outer transaction
      _inTransaction = true;
      try {
        await execAsync('BEGIN TRANSACTION');
        const result = await fn();
        await execAsync('COMMIT');
        _inTransaction = false;
        resolve(result);
      } catch (err) {
        try { await execAsync('ROLLBACK'); } catch (e) { /* ignore */ }
        _inTransaction = false;
        reject(err);
      }
    });
  });
}

module.exports = { getAsync, allAsync, runAsync, execAsync, transaction };
