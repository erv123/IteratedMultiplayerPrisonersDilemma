const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const resolveTurn = require("../utils/turnResolver");
const router = express.Router();
const { TESTING } = require("../config");


// administration
router.get("/listGames", (req, res) => {
  db.all(`SELECT id FROM games`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const gameIds = rows.map(r => r.id);
    res.json({ gameIds });
  });
});
router.post("/register", (req, res) => {
  const { gameId, payoffMatrix, errorChance, maxTurns, maxPlayers } = req.body;

  db.run(
    `INSERT INTO games (id, payoff_matrix, error_chance, max_turns, max_players)
     VALUES (?, ?, ?, ?, ?)`,
    [
      gameId,
      JSON.stringify(payoffMatrix),
      errorChance,
      maxTurns,
      maxPlayers
    ],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });

      res.json({ success: true });
    }
  );
});
router.post("/joinGame", (req, res) => {
  const { gameId, username, password } = req.body;

  db.get("SELECT * FROM games WHERE id = ?", [gameId], (err, game) => {
    if (!game) return res.json({ success: false, message: "Game does not exist." });

    db.get(
      "SELECT * FROM players WHERE game_id = ? AND username = ?",
      [gameId, username],
      (err2, player) => {

        // Player exists → check password
        if (player) {
          if (player.password === password) {
            req.session.user = {
              gameId,
              username,
              playerId: player.id,
            };

            if (TESTING) {
              const testUrl = `/game?sid=${player.id}`;
              return res.json({ success: true, testUrl });
            }
            return res.json({ success: true });
          } else {
            return res.json({ success: false, message: "Incorrect password." });
          }
        }

        // Player does not exist → check capacity
        if (game.current_players >= game.max_players) {
          return res.json({ success: false, message: "Game is full." });
        }

        // Register new player
        const playerId = uuidv4();
        db.run(
          `INSERT INTO players (id, game_id, username, password) VALUES (?, ?, ?, ?)`,
          [playerId, gameId, username, password],
          function (err3) {
            if (err3) return res.json({ success: false, message: "Error creating player." });

            db.run(
              "UPDATE games SET current_players = current_players + 1 WHERE id = ?",
              [gameId],
              () => {
                req.session.user = {
                  gameId,
                  username,
                  playerId,
                };

                if (TESTING) {
                  const testUrl = `/game?sid=${playerId}`;
                  return res.json({ success: true, testUrl });
                }
                return res.json({ success: true });
              }
            );
          }
        );
      }
    );
  });
});
router.get("/session", (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  res.json({
    loggedIn: true,
    user: req.session.user
  });
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
    "SELECT id, username, total_score FROM players WHERE game_id = ?",
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
    "SELECT COUNT(*) as count FROM players WHERE game_id = ?",
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
        "SELECT id, username, total_score, ready_for_next_turn FROM players WHERE game_id = ?",
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

  db.all(
    `SELECT turn_number, target_id, player_name, target_name,
            choice, opponent_choice, points_awarded
     FROM turns
     WHERE game_id = ?
     AND player_id = ?
     ORDER BY turn_number ASC`,
    [gameId, playerId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false });

      res.json({ success: true, history: rows });
    }
  );
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
            "UPDATE players SET ready_for_next_turn = 1 WHERE id = ?",
            [playerId],
            function(err3) {
              if (err3) {
                return res.status(500).json({ error: "Failed to mark ready" });
              }

              // 4️⃣ Check if everyone ready
              db.get(
                `SELECT COUNT(*) AS notReady
                 FROM players
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