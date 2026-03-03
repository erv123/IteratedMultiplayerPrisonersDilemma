#!/usr/bin/env node
(async () => {
  try {
    const db = require('../src/services/dbWrapper');
    const gameService = require('../src/services/gameService');
    const participantService = require('../src/services/participantService');
    const turnService = require('../src/services/turnService');
    const resolveService = require('../src/services/resolveService');

    // Create a simple 2-player game with a deterministic payoff matrix
    const payload = {
      name: 'test-resolve-game',
      payoffMatrix: {
        'peace_peace': 3,
        'peace_war': 0,
        'war_peace': 5,
        'war_war': 1,
      },
      maxPlayers: 2,
      errorChance: 0,
    };
    const hostUser = { userId: null, username: 'host' };
    const created = await gameService.createGame(payload, hostUser);
    const gameId = created.gameId;
    const hostPid = created.participantId;

    // Add second participant
    const p2 = await participantService.createParticipant(gameId, null, 'p2');
    const p2id = p2.participantId;

    // Start the game (sets current_turn = 1)
    await gameService.startGame(gameId, hostPid);
    const g = await db.getAsync('SELECT current_turn FROM games WHERE id = ?', [gameId]);
    const turnNumber = g.current_turn;

    // Submit choices for both participants
    await turnService.saveChoice(gameId, turnNumber, hostPid, p2id, 'peace');
    await turnService.saveChoice(gameId, turnNumber, p2id, hostPid, 'war');

    // Mark all turn entries as ready (resolution_stage = 1) to simulate submit endpoint
    await db.runAsync('UPDATE turns SET resolution_stage = 1 WHERE game_id = ? AND turn_number = ?', [gameId, turnNumber]);

    // Run resolver
    await resolveService.resolveTurn(gameId);

    // Verify participant scores
    const hostRow = await db.getAsync('SELECT total_score FROM participants WHERE id = ?', [hostPid]);
    const p2Row = await db.getAsync('SELECT total_score FROM participants WHERE id = ?', [p2id]);

    if (Number(hostRow.total_score) !== 0) {
      console.error('FAIL: host score expected 0, got', hostRow.total_score);
      process.exit(2);
    }
    if (Number(p2Row.total_score) !== 5) {
      console.error('FAIL: p2 score expected 5, got', p2Row.total_score);
      process.exit(2);
    }

    // Verify turns points_awarded
    const turns = await db.allAsync('SELECT player_id, points_awarded FROM turns WHERE game_id = ? AND turn_number = ?', [gameId, turnNumber]);
    const map = {};
    for (const r of turns) map[r.player_id] = Number(r.points_awarded || 0);
    if (map[hostPid] !== 0 || map[p2id] !== 5) {
      console.error('FAIL: unexpected points_awarded values', map);
      process.exit(2);
    }

    console.log('PASS: turn resolution produced expected scores');
    process.exit(0);
  } catch (err) {
    console.error('ERROR running test:', err);
    process.exit(1);
  }
})();
