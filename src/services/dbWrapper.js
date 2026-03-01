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
