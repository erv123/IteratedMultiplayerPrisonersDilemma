const db = require('./dbWrapper');
const turnService = require('./turnService');
const participantService = require('./participantService');

function flipChoice(choice) {
  if (choice === 'peace') return 'war';
  if (choice === 'war') return 'peace';
  return choice;
}

async function resolveTurn(gameId) {
  return db.transaction(async () => {
    // Determine current turn from games table
    const gameRow = await db.getAsync('SELECT current_turn, payoff_matrix, error_chance, end_chance FROM games WHERE id = ?', [gameId]);
    if (!gameRow) throw { code: 'NOT_FOUND', message: 'Game not found' };
    const turnNumber = Number(gameRow.current_turn || 0);
    const errorChance = gameRow ? Number(gameRow.error_chance || 0) : 0;
    // Read and parse the game's payoff matrix later (after ensuring readiness)
    let payoffMatrix = null;

    // log raw payoff matrix for debugging
    try { console.log('[resolveTurn] raw payoffMatrix:', payoffMatrix); } catch (e) { /* ignore */ }

    // Helper: writeAppliedChoice computes the applied choice for the given
    // turn id and writes only the `applied_choice` column. It does NOT set
    // `opponent_choice` or advance the resolution_stage — that is done in the
    // subsequent opponent-population step.
    async function writeAppliedChoice(turnId) {
      const t = await db.getAsync('SELECT id, game_id, turn_number, player_id, target_id, choice, resolution_stage FROM turns WHERE id = ?', [turnId]);
      if (!t) return false;
      const currentStage = typeof t.resolution_stage !== 'undefined' ? Number(t.resolution_stage) : 1;
      if (currentStage !== 1) return false;

      const baseRaw = t.choice !== undefined && t.choice !== null ? String(t.choice) : '';
      const base = baseRaw.toLowerCase();
      let applied = base;
      if (errorChance > 0) {
        const r = Math.random() * 100;
        if (r < errorChance) applied = flipChoice(base);
      }

      await db.runAsync('UPDATE turns SET applied_choice = ?, resolution_stage = 2 WHERE id = ?', [applied, turnId]);
      return true;
    }

    // Helper: populateOpponentChoice looks up the counterpart's applied
    // choice (which should already have been written by `writeAppliedChoice`) and
    // writes `opponent_choice` for this turn. After writing opponent_choice
    // it advances `resolution_stage` to 2 to signal readiness for payoff.
    async function populateOpponentChoice(turnId) {
      const t = await db.getAsync('SELECT id, game_id, turn_number, player_id, target_id, resolution_stage FROM turns WHERE id = ?', [turnId]);
      if (!t) return false;
      const currentStage = typeof t.resolution_stage !== 'undefined' ? Number(t.resolution_stage) : 1;
      if (currentStage !== 2) return false;

      // Look for the counterpart's applied_choice
      const counterpart = await db.getAsync('SELECT id, applied_choice, choice, resolution_stage FROM turns WHERE game_id = ? AND turn_number = ? AND player_id = ? AND target_id = ?', [t.game_id, t.turn_number, t.target_id, t.player_id]);
      if (!counterpart) {
        throw { code: 'CORRUPTED_TURN', message: `Missing counterpart for turn ${turnId}` };
      }
      if (counterpart.applied_choice == null) {
        throw { code: 'CORRUPTED_TURN', message: `Counterpart applied_choice missing for turn ${turnId}` };
      }
      const opponentApplied = String(counterpart.applied_choice).toLowerCase();

      await db.runAsync('UPDATE turns SET opponent_choice = ? WHERE id = ?', [opponentApplied, turnId]);

      return true;
    }

    // Ensure all players have submitted: count participants and compare to number of submitted entries
    const totalPlayersRow = await db.getAsync('SELECT COUNT(*) as totalPlayers FROM participants WHERE game_id = ?', [gameId]);
    const totalPlayers = totalPlayersRow ? Number(totalPlayersRow.totalPlayers || 0) : 0;
    const expectedEntries = totalPlayers * Math.max(0, totalPlayers - 1);
    const readyEntriesRow = await db.getAsync('SELECT COUNT(*) as cnt FROM turns WHERE game_id = ? AND turn_number = ? AND resolution_stage = 1', [gameId, turnNumber]);
    const readyEntries = readyEntriesRow ? Number(readyEntriesRow.cnt || 0) : 0;
    if (readyEntries !== expectedEntries) {
      throw { code: 'NOT_READY', message: 'Not all participants have submitted for this turn', expected: expectedEntries, found: readyEntries };
    }

    // Load and parse payoff matrix now that we're certain resolution should proceed
    try {
      if (!gameRow || !gameRow.payoff_matrix) throw new Error('Missing payoff_matrix');
      payoffMatrix = JSON.parse(gameRow.payoff_matrix);
      if (!payoffMatrix || typeof payoffMatrix !== 'object') throw new Error('Invalid payoff_matrix format');
    } catch (e) {
      console.error('[resolveTurn] Failed to read payoff_matrix:', e && e.message);
      throw { code: 'CORRUPTED_GAME', message: 'Failed to read payoff matrix for game' };
    }

    // Fetch all turns that are flagged for resolution (stage=1)
    let turns = await db.allAsync('SELECT id, player_id, target_id, choice FROM turns WHERE game_id = ? AND turn_number = ? AND resolution_stage = 1 ORDER BY id', [gameId, turnNumber]);
    if (!turns || turns.length === 0) throw { code: 'NO_DATA', message: 'No choices for turn' };

    // Prepare deltas accumulator
    const deltas = new Map();

    // Helper: compute payoff for a single turn, update points_awarded and mark stage=3
    async function applyPayoffToTurn(turnId, payoffMatrixLocal) {
      const r = await db.getAsync('SELECT applied_choice, opponent_choice, resolution_stage, player_id FROM turns WHERE id = ?', [turnId]);
      if (!r) return { skipped: true };
      const currentStage = typeof r.resolution_stage !== 'undefined' ? Number(r.resolution_stage) : 1;
      if (currentStage !== 2) return { skipped: true };
      const applied = r.applied_choice; const opponentApplied = r.opponent_choice;
      if (applied == null || opponentApplied == null) {
        throw { code: 'CORRUPTED_TURN', message: `Missing applied/opponent choices for turn ${turnId}` };
      }
      const key = `${String(applied)}_${String(opponentApplied)}`;
      if (!Object.prototype.hasOwnProperty.call(payoffMatrixLocal, key)) {
        throw { code: 'CORRUPTED_GAME', message: `Missing payoff for key ${key}` };
      }
      const pts = Number(payoffMatrixLocal[key]);
      if (!Number.isFinite(pts)) throw { code: 'CORRUPTED_GAME', message: `Invalid payoff value for key ${key}` };
      await db.runAsync('UPDATE turns SET points_awarded = ?, resolution_stage = 3 WHERE id = ?', [pts, turnId]);
      return { participantId: r.player_id, pointsAwarded: pts };
    }
    // Phase 1: write each player's applied_choice (serial)
    const appliedWritten = [];
    for (const t of turns) {
      const ok = await writeAppliedChoice(t.id);
      if (ok) appliedWritten.push(t.id);
    }

    // Phase 2: populate opponent_choice for each turn and mark stage=2 (serial)
    const populated = [];
    for (const t of turns) {
      const ok = await populateOpponentChoice(t.id);
      if (ok) populated.push(t.id);
    }

    // Phase 3: apply payoff for each populated turn (requires stage=2) serially and accumulate deltas
    for (const tid of populated) {
      const res = await applyPayoffToTurn(tid, payoffMatrix);
      if (res && !res.skipped) {
        deltas.set(res.participantId, (deltas.get(res.participantId) || 0) + (res.pointsAwarded || 0));
      }
    }

    // Apply participant score deltas and append to score_history
    // Apply participant score deltas and append to score_history serially
    for (const [participantId, delta] of deltas.entries()) {
      await participantService.updateTotalScore(participantId, delta);
      const row = await db.getAsync('SELECT total_score FROM participants WHERE id = ?', [participantId]);
      const total = row ? row.total_score : 0;
      await participantService.appendScoreHistory(participantId, total);
    }

    // Reset ready flags and advance turn
    await db.runAsync('UPDATE participants SET ready_for_next_turn = 0 WHERE game_id = ?', [gameId]);
    await db.runAsync('UPDATE games SET current_turn = current_turn + 1 WHERE id = ?', [gameId]);

    // Per-turn end chance: each resolved turn has a percent probability to end the game.
    const endChance = gameRow ? Number(gameRow.end_chance || 0) : 0;
    if (endChance > 0) {
      const roll = Math.random() * 100; // 0 <= roll < 100
      if (roll < endChance) {
        await db.runAsync('UPDATE games SET stage = ? WHERE id = ?', [3, gameId]);
      }
    }

    return { success: true };
  });
}

module.exports = { resolveTurn };
