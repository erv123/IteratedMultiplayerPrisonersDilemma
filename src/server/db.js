const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// DB file sits at <repo-root>/database/game.db
const dbPath = path.join(__dirname, '..', '..', 'database', 'game.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err);
  } else {
    console.log('SQLite database opened at:', dbPath);
  }
});

// Ensure foreign keys and run migrations if any
// Expose a `migrationsReady` promise on the `db` object so callers can wait
// until migrations complete before performing schema-dependent operations.
db.migrationsReady = new Promise((resolve, reject) => {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");

    const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');

    db.get('PRAGMA user_version', (err, row) => {
      let currentVersion = 0;
      if (!err && row) {
        if (typeof row.user_version !== 'undefined') currentVersion = Number(row.user_version) || 0;
        else currentVersion = Number(Object.values(row)[0]) || 0;
      }

      if (!fs.existsSync(migrationsDir)) return resolve();

      const files = fs.readdirSync(migrationsDir)
        .filter(f => /^\d+.*\.sql$/.test(f))
        .map(f => ({ file: f, ver: Number(f.split('_')[0]) }))
        .filter(x => !isNaN(x.ver))
        .sort((a, b) => a.ver - b.ver);

      const pending = files.filter(f => f.ver > currentVersion);
      if (pending.length === 0) return resolve();

      const applyNext = (i) => {
        if (i >= pending.length) return resolve();
        const { file, ver } = pending[i];
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

        console.log(`Applying migration ${file} (target version ${ver})`);
        db.exec(sql, (execErr) => {
          if (execErr) {
            console.error(`Migration ${file} failed:`, execErr);
            return reject(execErr);
          }
          db.run(`PRAGMA user_version = ${ver}`, (uErr) => {
            if (uErr) {
              console.error('Failed to update user_version after', file, uErr);
              return reject(uErr);
            }
            console.log(`Migration ${file} applied, user_version=${ver}`);
            applyNext(i + 1);
          });
        });
      };

      applyNext(0);
    });
  });
});

module.exports = db;
