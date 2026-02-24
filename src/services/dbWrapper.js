const db = require('../server/db');
const util = require('util');

const getAsync = util.promisify(db.get.bind(db));
const allAsync = util.promisify(db.all.bind(db));
const runAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      // `this` is the statement context
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const execAsync = util.promisify(db.exec.bind(db));

async function transaction(fn) {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        await execAsync('BEGIN TRANSACTION');
        const result = await fn();
        await execAsync('COMMIT');
        resolve(result);
      } catch (err) {
        try { await execAsync('ROLLBACK'); } catch (e) { /* ignore */ }
        reject(err);
      }
    });
  });
}

module.exports = { getAsync, allAsync, runAsync, execAsync, transaction };
