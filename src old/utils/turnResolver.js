const db = require("../server/db");

const resolveTurn = (gameId, turnNumber) => {

  // 1️⃣ Load payoff matrix
  db.get(
    "SELECT payoff_matrix FROM games WHERE id = ?",
    [gameId],
    (err, game) => {
      if (err || !game) return;

      const matrix = JSON.parse(game.payoff_matrix);
      // example:
      // {
      //   peace_peace: 3,
      //   peace_war: 0,
      //   war_peace: 5,
      //   war_war: 1
      // }

      // 2️⃣ Load all turn entries for this turn
      db.all(
        `SELECT * FROM turns
         WHERE game_id = ?
         AND turn_number = ?`,
        [gameId, turnNumber],
        (err2, turnEntries) => {
          if (err2) return;

          // Build lookup map
          // choicesMap[playerId][targetId] = entry
          const choicesMap = {};

          turnEntries.forEach(entry => {
            if (!choicesMap[entry.player_id]) {
              choicesMap[entry.player_id] = {};
            }
            choicesMap[entry.player_id][entry.target_id] = entry;
          });

          // Track score accumulation per player
          const scoreTotals = {};

          turnEntries.forEach(entry => {

            const playerId = entry.player_id;
            const targetId = entry.target_id;

            const myChoice = entry.applied_choice;

            // Find opponent's entry against me
            const opponentEntry =
              choicesMap[targetId] &&
              choicesMap[targetId][playerId];

            if (!opponentEntry) return; // safety

            const opponentChoice = opponentEntry.applied_choice;

            // Build payoff key
            const key = `${myChoice}_${opponentChoice}`;
            const points = matrix[key] || 0;

            // Save opponent choice + points in THIS row
            db.run(
              `UPDATE turns
               SET opponent_choice = ?, points_awarded = ?
               WHERE id = ?`,
              [opponentChoice, points, entry.id]
            );

            // Accumulate per player
            if (!scoreTotals[playerId]) {
              scoreTotals[playerId] = 0;
            }

            scoreTotals[playerId] += points;
          });

          // 3️⃣ Update total scores once per player
          Object.entries(scoreTotals).forEach(([playerId, totalPoints]) => {
            // Increment total score
            db.run(
              `UPDATE participants
               SET total_score = total_score + ?
               WHERE id = ?`,
              [totalPoints, playerId],
              (uErr) => {
                if (uErr) return;

                // After updating total_score, read the new total and append it to score_history
                db.get(
                  `SELECT total_score, score_history FROM participants WHERE id = ?`,
                  [playerId],
                  (gErr, prow) => {
                    if (gErr || !prow) return;

                    let history = [];
                    try {
                      history = prow.score_history ? JSON.parse(prow.score_history) : [];
                    } catch (e) { history = []; }

                    // Append the new total score for this turn
                    history.push(prow.total_score);

                    db.run(
                      `UPDATE participants SET score_history = ? WHERE id = ?`,
                      [JSON.stringify(history), playerId]
                    );
                  }
                );
              }
            );
          });

          // 4️⃣ Reset ready flags
          db.run(
            `UPDATE participants
             SET ready_for_next_turn = 0
             WHERE game_id = ?`,
            [gameId]
          );

          // 5️⃣ Advance turn
          db.run(
            `UPDATE games
             SET current_turn = current_turn + 1
             WHERE id = ?`,
            [gameId]
          );
        }
      );
    }
  );
};

module.exports = resolveTurn;