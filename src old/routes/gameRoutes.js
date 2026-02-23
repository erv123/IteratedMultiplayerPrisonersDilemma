const express = require("express");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcryptjs');
const db = require("../server/db");
const resolveTurn = require("../utils/turnResolver");
const router = express.Router();


// administration
router.get("/listGames", (req, res) => {
  db.all(`SELECT id FROM games`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const gameIds = rows.map(r => r.id);
    res.json({ gameIds });
  });
});

// utility endpoints for debugging/admin UI
router.get('/_whoami', (req, res) => {
  if (!req.session || !req.session.user) return res.json({ success: false });

  const userId = req.session.user.userId;

  db.get('SELECT id, username, is_admin, reset_bypass, last_reset_at FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!row) return res.json({ success: false });

    res.json({
      success: true,
      user: {
        id: row.id,
        username: row.username,
        is_admin: row.is_admin,
        reset_bypass: row.reset_bypass,
        last_reset_at: row.last_reset_at
      }
    });
  });
});

router.get('/_listUsers', (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
  const callerId = req.session.user.userId;

  db.get('SELECT is_admin FROM users WHERE id = ?', [callerId], (err, callerRow) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!callerRow || !(callerRow.is_admin === 1 || callerRow.is_admin === '1')) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    db.all('SELECT id, username, reset_bypass FROM users', [], (e2, rows) => {
      if (e2) return res.status(500).json({ success: false, message: e2.message });
      res.json({ success: true, users: rows });
    });
  });
});
router.post("/register", (req, res) => {
  const { gameId, payoffMatrix, errorChance, maxTurns, maxPlayers, historyLimit } = req.body;

  const resolvedHistoryLimit = typeof historyLimit !== 'undefined' ? Number(historyLimit) : 5;

  // If user is logged in via session, use session identity as host
  if (req.session && req.session.user && req.session.user.userId) {
    const userId = req.session.user.userId;
    const username = req.session.user.username;

    db.run(
      `INSERT INTO games (id, stage, payoff_matrix, error_chance, max_turns, history_limit, max_players)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
      [
        gameId,
        JSON.stringify(payoffMatrix),
        errorChance,
        maxTurns,
        resolvedHistoryLimit,
        maxPlayers
      ],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });

        // create participant (host)
        const participantId = uuidv4();
        db.run(
          `INSERT INTO participants (id, game_id, user_id, username, is_host, total_score, ready_for_next_turn, score_history)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
          [participantId, gameId, userId, username, 1, JSON.stringify([])],
          (err3) => {
            if (err3) return res.status(500).json({ error: err3.message });

            // increment current_players for the game
            db.run(
              `UPDATE games SET current_players = current_players + 1 WHERE id = ?`,
              [gameId],
              (err4) => {
                if (err4) return res.status(500).json({ error: err4.message });

                // set session game context
                req.session.user.gameId = gameId;
                req.session.user.playerId = participantId;
                res.json({ success: true, playerId: participantId });
              }
            );
          }
        );
      }
    );
    return;
  }

  // Fallback: require host credentials in body (backwards-compatible)
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Host username and password are required.' });
  }

  // Ensure user exists (create if needed), then create game and participant
    db.get("SELECT id, password FROM users WHERE username = ?", [username], (err, existingUser) => {
    if (err) return res.status(500).json({ error: err.message });

    const createGameAndParticipant = (userId) => {
      db.run(
        `INSERT INTO games (id, stage, payoff_matrix, error_chance, max_turns, history_limit, max_players)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [
          gameId,
          JSON.stringify(payoffMatrix),
          errorChance,
          maxTurns,
          resolvedHistoryLimit,
          maxPlayers
        ],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          // create participant (host)
          const participantId = uuidv4();
          db.run(
            `INSERT INTO participants (id, game_id, user_id, username, is_host, total_score, ready_for_next_turn, score_history)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
            [participantId, gameId, userId, username, 1, JSON.stringify([])],
            (err3) => {
              if (err3) return res.status(500).json({ error: err3.message });

              // increment current_players for the game
              db.run(
                `UPDATE games SET current_players = current_players + 1 WHERE id = ?`,
                [gameId],
                (err4) => {
                  if (err4) return res.status(500).json({ error: err4.message });

                  // set session: keep backward-compatible fields
                  req.session.user = { userId, username, gameId, playerId: participantId };
                  res.json({ success: true, playerId: participantId });
                }
              );
            }
          );
        }
      );
    };

    if (existingUser) {
      // compare hashed password
      if (!bcrypt.compareSync(password, existingUser.password)) {
        return res.status(400).json({ success: false, message: 'Username already exists with different password.' });
      }
      createGameAndParticipant(existingUser.id);
    } else {
      const userId = uuidv4();
      const hashed = bcrypt.hashSync(password, 10);
      db.run(`INSERT INTO users (id, username, password) VALUES (?, ?, ?)`, [userId, username, hashed], (err3) => {
        if (err3) return res.status(500).json({ error: err3.message });
        createGameAndParticipant(userId);
      });
    }
  });
});
router.post("/joinGame", (req, res) => {
  const { gameId, username, password } = req.body;

  db.get("SELECT * FROM games WHERE id = ?", [gameId], (err, game) => {
    if (!game) return res.json({ success: false, message: "Game does not exist." });

    // Authenticate or create global user first
    db.get("SELECT id, password, reset_bypass, last_reset_at, is_admin FROM users WHERE username = ?", [username], (err2, userRow) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const proceedWithUser = (userId) => {
        // check if participant already exists for this game and user
        db.get(
          "SELECT * FROM participants WHERE game_id = ? AND user_id = ?",
          [gameId, userId],
          (err3, participant) => {
            if (err3) return res.status(500).json({ error: err3.message });

            if (participant) {
              // already registered in this game
              req.session.user = { userId, username, gameId, playerId: participant.id };
              return res.json({ success: true });
            }

            // not in game yet → check capacity
            if (game.current_players >= game.max_players) {
              return res.json({ success: false, message: "Game is full." });
            }

            const participantId = uuidv4();
            db.run(
              `INSERT INTO participants (id, game_id, user_id, username, is_host) VALUES (?, ?, ?, ?, 0)`,
              [participantId, gameId, userId, username],
              function (err4) {
                if (err4) return res.json({ success: false, message: "Error creating participant." });

                db.run(
                  "UPDATE games SET current_players = current_players + 1 WHERE id = ?",
                  [gameId],
                  () => {
                    req.session.user = { userId, username, gameId, playerId: participantId };
                    return res.json({ success: true });
                  }
                );
              }
            );
          }
        );
      };

      if (userRow) {
        if (!bcrypt.compareSync(password, userRow.password)) {
          // determine if reset should be offered
          const isAdmin = userRow.is_admin === 1 || userRow.is_admin === '1';
          let resetAllowed = false;
          if (!isAdmin) {
            if (userRow.reset_bypass === 1 || userRow.reset_bypass === '1') resetAllowed = true;
            else if (!userRow.last_reset_at) resetAllowed = true;
            else {
              const last = new Date(userRow.last_reset_at + 'Z');
              const diff = Date.now() - last.getTime();
              if (diff > 24 * 60 * 60 * 1000) resetAllowed = true;
            }
          }
          return res.json({ success: false, message: 'Incorrect password.', resetAllowed });
        }
        proceedWithUser(userRow.id);
      } else {
        // create user (hashed)
        const newUserId = uuidv4();
        const hashed = bcrypt.hashSync(password, 10);
        db.run("INSERT INTO users (id, username, password) VALUES (?, ?, ?)", [newUserId, username, hashed], (err4) => {
          if (err4) return res.status(500).json({ error: err4.message });
          proceedWithUser(newUserId);
        });
      }
    });
  });
});

router.get("/session", (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  res.json({ loggedIn: true, user: req.session.user });
});
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

//retreive data
router.get("/gameScores", (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  const { gameId } = req.session.user;

  db.all(
    "SELECT id, username, total_score FROM participants WHERE game_id = ?",
    [gameId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ players: rows });
    }
  );
});
router.get("/playerCount", (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  const { gameId } = req.session.user;

  db.get(
    "SELECT COUNT(*) as count FROM participants WHERE game_id = ?",
    [gameId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ count: row.count });
    }
  );
});
router.get("/gameState", (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  const { gameId, playerId } = req.session.user;

  db.get(
    "SELECT current_turn FROM games WHERE id = ?",
    [gameId],
    (err, game) => {

      db.all(
        "SELECT id, username, total_score, ready_for_next_turn FROM participants WHERE game_id = ?",
        [gameId],
        (err2, players) => {

          const me = players.find(p => p.id === playerId);

          res.json({
            loggedIn: true,
            currentTurn: game.current_turn,
            players,
            myReadyState: me.ready_for_next_turn,
            myPlayerId: playerId
          });
        }
      );
    }
  );
});
router.get("/turnHistory", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false });
  }

  const { gameId, playerId } = req.session.user;

  // Fetch game's history_limit first
  db.get(`SELECT history_limit FROM games WHERE id = ?`, [gameId], (gErr, gRow) => {
    if (gErr) return res.status(500).json({ success: false });
    if (!gRow) return res.status(404).json({ success: false, message: 'Game not found' });

    const historyLimit = typeof gRow.history_limit !== 'undefined' && gRow.history_limit !== null ? Number(gRow.history_limit) : 5;

    // Only return finished turns — resolved turns have opponent_choice set
    if (historyLimit === -1) {
      db.all(
        `SELECT turn_number, target_id, player_name, target_name,
                choice, opponent_choice, points_awarded
         FROM turns
         WHERE game_id = ?
         AND player_id = ?
         AND opponent_choice IS NOT NULL
         ORDER BY turn_number ASC`,
        [gameId, playerId],
        (err, rows) => {
          if (err) return res.status(500).json({ success: false });
          res.json({ success: true, history: rows });
        }
      );
    } else {
      // Query most recent `historyLimit` finished turns, then return ascending
      db.all(
        `SELECT turn_number, target_id, player_name, target_name,
                choice, opponent_choice, points_awarded
         FROM turns
         WHERE game_id = ?
         AND player_id = ?
         AND opponent_choice IS NOT NULL
         ORDER BY turn_number DESC
         LIMIT ?`,
        [gameId, playerId, historyLimit],
        (err, rows) => {
          if (err) return res.status(500).json({ success: false });

          // rows are DESC by turn_number — reverse to ASC for client
          const ordered = Array.isArray(rows) ? rows.reverse() : [];
          res.json({ success: true, history: ordered });
        }
      );
    }
  });
});
router.get('/publicGame/:gameId', (req, res) => {
  const { gameId } = req.params;

  db.get(
    `SELECT id, stage, current_players, max_players FROM games WHERE id = ?`,
    [gameId],
    (err, game) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!game) return res.status(404).json({ error: 'Game not found' });

      db.all(
        `SELECT id, user_id, username, is_host FROM participants WHERE game_id = ?`,
        [gameId],
        (err2, players) => {
          if (err2) return res.status(500).json({ error: err2.message });

          res.json({
            success: true,
            game: {
              id: game.id,
              stage: game.stage,
              current_players: game.current_players,
              max_players: game.max_players
            },
            players: players.map(p => ({ id: p.id, user_id: p.user_id, username: p.username, is_host: p.is_host }))
          });
        }
      );
    }
  );
});

// Provide participants' score history for a game (array of totals per turn)
router.get('/scoreHistory/:gameId', (req, res) => {
  const { gameId } = req.params;

  db.all(
    `SELECT id, username, score_history FROM participants WHERE game_id = ?`,
    [gameId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: err.message });

      const participants = (rows || []).map(r => {
        let hist = [];
        try { hist = r.score_history ? JSON.parse(r.score_history) : []; } catch (e) { hist = []; }
        return { id: r.id, username: r.username, score_history: hist };
      });

      res.json({ success: true, participants });
    }
  );
});

// Auth endpoints for global user accounts
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

  db.get('SELECT id, password, reset_bypass, last_reset_at, is_admin FROM users WHERE username = ?', [username], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });

    if (!row) return res.status(401).json({ success: false, message: 'Invalid credentials', resetAllowed: false });

    if (!bcrypt.compareSync(password, row.password)) {
      // compute resetAllowed for non-admins
      const isAdmin = row.is_admin === 1 || row.is_admin === '1';
      let resetAllowed = false;
      if (!isAdmin) {
        if (row.reset_bypass === 1 || row.reset_bypass === '1') resetAllowed = true;
        else if (!row.last_reset_at) resetAllowed = true;
        else {
          const last = new Date(row.last_reset_at + 'Z');
          const diff = Date.now() - last.getTime();
          if (diff > 24 * 60 * 60 * 1000) resetAllowed = true;
        }
      }

      return res.status(401).json({ success: false, message: 'Invalid credentials', resetAllowed });
    }

    req.session.user = { userId: row.id, username };
    res.json({ success: true });
  });
});

router.post('/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (row) return res.status(400).json({ success: false, message: 'Username already exists' });

    const userId = uuidv4();
    const hashed = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (id, username, password) VALUES (?, ?, ?)', [userId, username, hashed], (err2) => {
      if (err2) return res.status(500).json({ success: false, message: err2.message });
      req.session.user = { userId, username };
      res.json({ success: true });
    });
  });
});

// Password reset endpoint. Allows:
// - logged-in user to reset own password
// - admin to reset any user's password
// - unauthenticated reset only if resetAllowed (last reset >24h or reset_bypass)
router.post('/auth/resetPassword', (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) return res.status(400).json({ success: false, message: 'Missing parameters' });

  db.get('SELECT id, reset_bypass, last_reset_at FROM users WHERE username = ?', [username], (err, target) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    const attemptReset = (allowed) => {
      if (!allowed) return res.status(403).json({ success: false, message: 'Password reset not allowed at this time' });

      const hashed = bcrypt.hashSync(newPassword, 10);
      db.run('UPDATE users SET password = ?, last_reset_at = datetime(\'now\') WHERE id = ?', [hashed, target.id], (uErr) => {
        if (uErr) return res.status(500).json({ success: false, message: uErr.message });
        res.json({ success: true });
      });
    };

    // If logged in
    if (req.session && req.session.user && req.session.user.userId) {
      const callerId = req.session.user.userId;
      if (callerId === target.id) {
        return attemptReset(true);
      }

      // check if caller is admin
      db.get('SELECT is_admin FROM users WHERE id = ?', [callerId], (e2, callerRow) => {
        if (e2) return res.status(500).json({ success: false, message: e2.message });
        if (callerRow && (callerRow.is_admin === 1 || callerRow.is_admin === '1')) {
          return attemptReset(true);
        }

        // caller is someone else — not allowed unless resetAllowed
        let resetAllowed = false;
        if (target.reset_bypass === 1 || target.reset_bypass === '1') resetAllowed = true;
        else if (!target.last_reset_at) resetAllowed = true;
        else {
          const last = new Date(target.last_reset_at + 'Z');
          if (Date.now() - last.getTime() > 24 * 60 * 60 * 1000) resetAllowed = true;
        }
        return attemptReset(resetAllowed);
      });
    } else {
      // not logged in — allow only if resetAllowed
      let resetAllowed = false;
      if (target.reset_bypass === 1 || target.reset_bypass === '1') resetAllowed = true;
      else if (!target.last_reset_at) resetAllowed = true;
      else {
        const last = new Date(target.last_reset_at + 'Z');
        if (Date.now() - last.getTime() > 24 * 60 * 60 * 1000) resetAllowed = true;
      }
      return attemptReset(resetAllowed);
    }
  });
});

// Admin: set/reset the bypass flag for a user
router.post('/admin/setResetBypass', (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
  const callerId = req.session.user.userId;
  const { username, bypass } = req.body;
  if (!username || typeof bypass === 'undefined') return res.status(400).json({ success: false, message: 'Missing parameters' });

  db.get('SELECT is_admin FROM users WHERE id = ?', [callerId], (err, callerRow) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!callerRow || !(callerRow.is_admin === 1 || callerRow.is_admin === '1')) return res.status(403).json({ success: false, message: 'Not authorized' });

    db.run('UPDATE users SET reset_bypass = ? WHERE username = ?', [bypass ? 1 : 0, username], (uErr) => {
      if (uErr) return res.status(500).json({ success: false, message: uErr.message });
      res.json({ success: true });
    });
  });
});

// Start game (host only)
router.post('/startGame', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });

  const { gameId } = req.session.user;

  // verify caller is host
  db.get(
    'SELECT is_host FROM participants WHERE id = ? AND game_id = ?',
    [req.session.user.playerId, gameId],
    (err, player) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (!player || player.is_host !== 1) return res.status(403).json({ success: false, message: 'Only host can start the game' });

      // set stage to started (use 2 as started)
      db.run('UPDATE games SET stage = 2 WHERE id = ?', [gameId], function (err2) {
        if (err2) return res.status(500).json({ success: false, message: err2.message });
        res.json({ success: true });
      });
    }
  );
});

// Join current game as the logged-in user (no credentials required)
router.post('/joinGameAsUser', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
  const { userId, username } = req.session.user;
  const { gameId } = req.body;
  if (!gameId) return res.status(400).json({ success: false, message: 'Missing gameId' });
  // Use BEGIN/COMMIT transaction style to ensure join checks + insert are atomic
  db.run('BEGIN IMMEDIATE', (beginErr) => {
    if (beginErr) return res.status(500).json({ success: false, message: beginErr.message });

    db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
      if (err) {
        db.run('ROLLBACK', () => {});
        return res.status(500).json({ success: false, message: err.message });
      }
      if (!game) {
        db.run('ROLLBACK', () => {});
        return res.status(404).json({ success: false, message: 'Game not found' });
      }

      // Check if already participant
      db.get('SELECT * FROM participants WHERE game_id = ? AND user_id = ?', [gameId, userId], (err2, part) => {
        if (err2) {
          db.run('ROLLBACK', () => {});
          return res.status(500).json({ success: false, message: err2.message });
        }
        if (part) {
          // already participant — commit and return
          db.run('COMMIT', () => {
            req.session.user.gameId = gameId;
            req.session.user.playerId = part.id;
            return res.json({ success: true });
          });
          return;
        }

        if (game.current_players >= game.max_players) {
          db.run('ROLLBACK', () => {});
          return res.status(400).json({ success: false, message: 'Game is full' });
        }

        const participantId = uuidv4();
        db.run(`INSERT INTO participants (id, game_id, user_id, username, is_host) VALUES (?, ?, ?, ?, 0)`, [participantId, gameId, userId, username], (err3) => {
          if (err3) {
            db.run('ROLLBACK', () => {});
            return res.status(500).json({ success: false, message: err3.message });
          }

          db.run('UPDATE games SET current_players = current_players + 1 WHERE id = ?', [gameId], (err4) => {
            if (err4) {
              db.run('ROLLBACK', () => {});
              return res.status(500).json({ success: false, message: err4.message });
            }

            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                db.run('ROLLBACK', () => {});
                return res.status(500).json({ success: false, message: commitErr.message });
              }

              req.session.user.gameId = gameId;
              req.session.user.playerId = participantId;
              res.json({ success: true });
            });
          });
        });
      });
    });
  });
});

// Return current player's minimal info (requires session)
router.get('/myPlayer', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
  const { playerId } = req.session.user;
  db.get('SELECT id, username, is_host FROM participants WHERE id = ?', [playerId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!row) return res.status(404).json({ success: false, message: 'Player not found' });
    res.json({ success: true, player: row });
  });
});

//turn logic
router.post("/submitChoices", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const { gameId, playerId } = req.session.user;

  db.get(
    "SELECT current_turn, error_chance FROM games WHERE id = ?",
    [gameId],
    (err, game) => {
      if (err || !game) {
        return res.status(500).json({ error: "Game not found" });
      }

      const turn = game.current_turn;
      const errorChance = game.error_chance;

      // 1️⃣ Get all this player's saved choices
      db.all(
        `SELECT * FROM turns
         WHERE game_id = ?
         AND turn_number = ?
         AND player_id = ?`,
        [gameId, turn, playerId],
        (err2, rows) => {

          if (err2) {
            return res.status(500).json({ error: "Failed to load choices" });
          }

          if (rows.length === 0) {
            return res.status(400).json({ error: "No choices submitted" });
          }

          // 2️⃣ Apply error chance + fill applied_choice
          rows.forEach(row => {

            let appliedChoice = row.choice;

            if (Math.random() < errorChance / 100) {
              appliedChoice = row.choice === "peace" ? "war" : "peace";
            }

            db.run(
              "UPDATE turns SET applied_choice = ? WHERE id = ?",
              [appliedChoice, row.id]
            );
          });

          // 3️⃣ Mark player ready
          db.run(
            "UPDATE participants SET ready_for_next_turn = 1 WHERE id = ?",
            [playerId],
            function(err3) {
              if (err3) {
                return res.status(500).json({ error: "Failed to mark ready" });
              }

              // 4️⃣ Check if everyone ready
              db.get(
                `SELECT COUNT(*) AS notReady
                 FROM participants
                 WHERE game_id = ?
                 AND ready_for_next_turn = 0`,
                [gameId],
                (err4, result) => {

                  if (err4) {
                    return res.status(500).json({ error: "Ready check failed" });
                  }

                  if (result.notReady === 0) {
                    resolveTurn(gameId, turn); // single resolution entry point
                  }

                  res.json({ success: true });
                }
              );
            }
          );
        }
      );
    }
  );
});
router.get("/myChoices", (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });

  const { gameId, playerId } = req.session.user;

  db.get(
    "SELECT current_turn FROM games WHERE id = ?",
    [gameId],
    (err, game) => {
      if (err || !game) return res.status(500).json({ error: "Game not found" });

      db.all(
        "SELECT target_id, choice FROM turns WHERE game_id = ? AND turn_number = ? AND player_id = ?",
        [gameId, game.current_turn, playerId],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: "Error fetching choices" });

          const myChoices = {};
          rows.forEach(r => { myChoices[r.target_id] = r.choice; });

          res.json({ success: true, myChoices });
        }
      );
    }
  );
});
router.post("/saveChoice", (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });

  const { targetId, choice } = req.body;
  const { gameId, playerId } = req.session.user;

  db.get(
    "SELECT current_turn FROM games WHERE id = ?",
    [gameId],
    (err, game) => {
      if (err || !game) {
        return res.status(500).json({ success: false });
      }

      const turnNumber = game.current_turn;

      db.get(
        `SELECT id FROM turns
         WHERE game_id = ?
         AND turn_number = ?
         AND player_id = ?
         AND target_id = ?`,
        [gameId, turnNumber, playerId, targetId],
        (err2, row) => {

          if (row) {
            db.run(
              "UPDATE turns SET choice = ? WHERE id = ?",
              [choice, row.id],
              err3 => {
                if (err3) return res.status(500).json({ success: false });
                res.json({ success: true });
              }
            );
          } else {
            const id = uuidv4();

            db.run(
              `INSERT INTO turns
               (id, game_id, turn_number, player_id, target_id, choice)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [id, gameId, turnNumber, playerId, targetId, choice],
              err3 => {
                if (err3) return res.status(500).json({ success: false });
                res.json({ success: true });
              }
            );
          }
        }
      );
    }
  );
});

module.exports = router;