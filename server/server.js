const express = require("express");
const path = require("path");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");

const gameRoutes = require("../routes/gameRoutes");

const app = express();
app.use(express.json());



/* ===============================
   SESSION SETUP
   =============================== */

  app.use(
    session({
      secret: "09c732c9-2dc9-4ba7-a58e-cff338a68f06",
      resave: false,
      saveUninitialized: false,
      // only set secure cookies in production (requires HTTPS). For local dev over HTTP keep false.
      cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    })
  );

/* ===============================
   ROUTES
   =============================== */
app.use(express.static("public"));
app.use("/api", gameRoutes);

app.get("/game", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "..", "public", "game.html"));
});

// Serve game info page without requiring a session so users can view and log in from there
app.get("/gameInfo", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "gameInfo.html"));
});
/* ===============================
   SERVER START
   =============================== */
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

// Ensure admin account exists on startup
const bcrypt = require('bcryptjs');
const db = require('./db');
const adminUsername = 'admin';
const adminPassword = 'madman';

// Ensure `is_admin` column exists (for older DBs)
db.all("PRAGMA table_info(users)", (pragmaErr, cols) => {
  if (pragmaErr) {
    console.error('Failed to read users table info:', pragmaErr);
    return;
  }

  const hasIsAdmin = Array.isArray(cols) && cols.some(c => c && c.name === 'is_admin');
  const hasResetBypass = Array.isArray(cols) && cols.some(c => c && c.name === 'reset_bypass');
  const hasLastResetAt = Array.isArray(cols) && cols.some(c => c && c.name === 'last_reset_at');
  const proceedAdminCheck = () => {
    db.get('SELECT id FROM users WHERE username = ?', [adminUsername], (err, row) => {
      if (err) {
        console.error('Failed to check admin user:', err);
        return;
      }

      if (row) {
        // Make sure admin flag is set and others are not
        db.run('UPDATE users SET is_admin = 0 WHERE username != ?', [adminUsername], (uErr) => {
          if (uErr) console.error('Failed to clear admin flags:', uErr);
          db.run('UPDATE users SET is_admin = 1 WHERE username = ?', [adminUsername], (uErr2) => {
            if (uErr2) console.error('Failed to set admin flag:', uErr2);
          });
        });
      } else {
        const userId = require('uuid').v4();
        const hashed = bcrypt.hashSync(adminPassword, 10);
        db.run('INSERT INTO users (id, username, password, is_admin) VALUES (?, ?, ?, 1)', [userId, adminUsername, hashed], (insErr) => {
          if (insErr) console.error('Failed to create admin user:', insErr);
          else console.log('Admin user created:', adminUsername);
        });
      }
    });
  };

  if (!hasIsAdmin) {
    db.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0", (alterErr) => {
      if (alterErr) console.error('Failed to add is_admin column:', alterErr);
      // ensure other columns after is_admin exists
      if (!hasResetBypass) {
        db.run("ALTER TABLE users ADD COLUMN reset_bypass INTEGER DEFAULT 0", () => {
          if (!hasLastResetAt) {
            db.run("ALTER TABLE users ADD COLUMN last_reset_at TEXT", () => proceedAdminCheck());
          } else proceedAdminCheck();
        });

        // Ensure `history_limit` column exists on games (for older DBs)
        db.all("PRAGMA table_info(games)", (gErr, gcols) => {
          if (gErr) {
            console.error('Failed to read games table info:', gErr);
            return;
          }

          const hasHistoryLimit = Array.isArray(gcols) && gcols.some(c => c && c.name === 'history_limit');
          if (!hasHistoryLimit) {
            db.run("ALTER TABLE games ADD COLUMN history_limit INTEGER DEFAULT 5", (alterErr) => {
              if (alterErr) console.error('Failed to add history_limit column to games:', alterErr);
              else console.log('Added history_limit column to games with default 5');
            });
          }
        });
      } else if (!hasLastResetAt) {
        db.run("ALTER TABLE users ADD COLUMN last_reset_at TEXT", () => proceedAdminCheck());
      } else proceedAdminCheck();
    });
  } else {
    // ensure reset columns exist
    if (!hasResetBypass) {
      db.run("ALTER TABLE users ADD COLUMN reset_bypass INTEGER DEFAULT 0", () => {
        if (!hasLastResetAt) {
          db.run("ALTER TABLE users ADD COLUMN last_reset_at TEXT", () => proceedAdminCheck());
        } else proceedAdminCheck();
      });
    } else if (!hasLastResetAt) {
      db.run("ALTER TABLE users ADD COLUMN last_reset_at TEXT", () => proceedAdminCheck());
    } else proceedAdminCheck();
  }
});