const express = require('express');
const router = express.Router();
const { choiceValidator } = require('./validators/choiceValidator');
const { handleValidation } = require('./validators/handleValidation');
const turnService = require('../services/turnService');
const participantService = require('../services/participantService');

async function verifyOwnership(req, participantId) {
  if (!req.session || !req.session.user) return { ok: false, status: 401, error: { code: 'AUTH_REQUIRED', message: 'Login required' } };
  const userId = req.session.user.id;
  const p = await require('../services/dbWrapper').getAsync('SELECT * FROM participants WHERE id = ?', [participantId]);
  if (!p) return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Participant not found' } };
  if (p.user_id === null || String(p.user_id) !== String(userId)) return { ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'Not owner of participant' } };
  return { ok: true, participant: p };
}

router.get('/me', async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED' } });
  const userId = req.session.user.id;
  try {
    const p = await participantService.findParticipantForUser(null, userId);
    return res.json({ success: true, data: p });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Return recent resolved history for this participant (owner-only). Renamed from myChoices -> myHistory
router.get('/:participantId/myHistory', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const v = await verifyOwnership(req, participantId);
    if (!v.ok) return res.status(v.status).json({ success: false, error: v.error });
    const p = v.participant;
    const gameRow = await require('../services/dbWrapper').getAsync('SELECT history_limit FROM games WHERE id = ?', [p.game_id]);
    const limit = gameRow ? gameRow.history_limit : 5;
    const participantHistory = await require('../services/turnService').getPlayerHistory(p.game_id, participantId, limit);
    // For each entry, gather the opponent's applied choice by using the opponent's history
    // This loads each opponent's recent history once and looks up the matching turn.
    const results = [];
    const opponentIds = Array.from(new Set((participantHistory || []).map(e => String(e.targetId))));
    const opponentHistMap = {};
    for (const oid of opponentIds) {
      // use turnService to fetch opponent history (same limit)
      const oppHist = await turnService.getPlayerHistory(p.game_id, oid, limit).catch(() => []);
      // map by turnNumber for quick lookup
      const byTurn = {};
      (oppHist || []).forEach(r => { byTurn[String(r.turnNumber)] = r; });
      opponentHistMap[String(oid)] = byTurn;
    }
    for (const entry of (participantHistory || [])) {
      const opponentId = entry.targetId;
      const turnNumber = entry.turnNumber;
      const oppByTurn = opponentHistMap[String(opponentId)] || {};
      const oppRow = oppByTurn[String(turnNumber)] || null;
      results.push({
        participantId: participantId,
        opponentId: opponentId,
        turnNumber: turnNumber,
        appliedChoice: entry.choice,
        opponentChoice: oppRow ? oppRow.choice : null,
        pointsAwarded: entry.pointsAwarded,
      });
    }
    return res.json({ success: true, data: results });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/:participantId/choice', choiceValidator, handleValidation, async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const v = await verifyOwnership(req, participantId);
    if (!v.ok) return res.status(v.status).json({ success: false, error: v.error });
    const { targetId, choice } = req.body;
    const p = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    const gameId = p.game_id;
    const g = await require('../services/dbWrapper').getAsync('SELECT current_turn FROM games WHERE id = ?', [gameId]);
    const turnNumber = g ? g.current_turn : 0;
    const out = await turnService.saveChoice(gameId, turnNumber, participantId, targetId, choice);
    return res.json({ success: true, data: out });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.post('/:participantId/submit', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const v = await verifyOwnership(req, participantId);
    if (!v.ok) return res.status(v.status).json({ success: false, error: v.error });
    // ensure participant exists and determine game/turn context
    const part = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    if (!part) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const gameId = part.game_id;
    const gameRow = await require('../services/dbWrapper').getAsync('SELECT current_turn, current_players FROM games WHERE id = ?', [gameId]);
    const turnNumber = gameRow ? gameRow.current_turn : 0;

    // Determine how many choice entries we expect for this player this turn
    let expectedCount = null;
    if (gameRow && typeof gameRow.current_players === 'number' && gameRow.current_players > 0) {
      expectedCount = gameRow.current_players - 1; // one entry per other participant
    } else {
      const totalPlayersRow = await require('../services/dbWrapper').getAsync('SELECT COUNT(*) as totalPlayers FROM participants WHERE game_id = ?', [gameId]);
      expectedCount = (totalPlayersRow && totalPlayersRow.totalPlayers) ? (totalPlayersRow.totalPlayers - 1) : 0;
    }

    const entryCountRow = await require('../services/dbWrapper').getAsync('SELECT COUNT(*) as cnt FROM turns WHERE game_id = ? AND player_id = ? AND turn_number = ?', [gameId, participantId, turnNumber]);
    const entryCount = entryCountRow ? entryCountRow.cnt : 0;

    // If the participant hasn't submitted all choices, return an error and don't mark ready
    if (entryCount < expectedCount) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_CHOICES', message: 'Not all choices submitted', expected: expectedCount, found: entryCount } });
    }

    // Mark all of this participant's turn entries as ready for resolution (stage 1)
    await require('../services/dbWrapper').runAsync('UPDATE turns SET resolution_stage = 1 WHERE game_id = ? AND player_id = ? AND turn_number = ?', [gameId, participantId, turnNumber]);

    // Mark participant ready for next turn and possibly trigger resolution if everyone is ready
    await participantService.markReady(participantId);
    const readyCountRow = await require('../services/dbWrapper').getAsync('SELECT SUM(ready_for_next_turn) as readyCount, count(*) as total FROM participants WHERE game_id = ?', [gameId]);
    if (readyCountRow && readyCountRow.readyCount === readyCountRow.total) {
      const resolveService = require('../services/resolveService');
      try {
        await resolveService.resolveTurn(gameId);
      } catch (e) {
        console.error('[participants.submit] resolveTurn failed', e);
        throw e;
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[participants.submit] handler error', err && (err.stack || err));
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err && err.message ? err.message : String(err) } });
  }
});

router.get('/:participantId/opponentHistory', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    // must be logged in and owner of this participant
    const v = await verifyOwnership(req, participantId);
    if (!v.ok) return res.status(v.status).json({ success: false, error: v.error });
    // get game and history limit
    const p = v.participant; // already loaded
    const gameRow = await require('../services/dbWrapper').getAsync('SELECT history_limit FROM games WHERE id = ?', [p.game_id]);
    const limit = gameRow ? gameRow.history_limit : 5;
    // fetch limited history entries for this participant (where resolved/applied)
    const participantHistory = await require('../services/turnService').getPlayerHistory(p.game_id, participantId, limit);
    // For each participant history entry, gather the opponent's applied choice by using the opponent's history
    const results = [];
    const opponentIds2 = Array.from(new Set((participantHistory || []).map(e => String(e.targetId))));
    const opponentHistMap2 = {};
    for (const oid of opponentIds2) {
      const oppHist = await turnService.getPlayerHistory(p.game_id, oid, limit).catch(() => []);
      const byTurn = {};
      (oppHist || []).forEach(r => { byTurn[String(r.turnNumber)] = r; });
      opponentHistMap2[String(oid)] = byTurn;
    }

    // fetch usernames for opponents in bulk so we can return names with the history
    const nameMap = {};
    if (opponentIds2.length) {
      const placeholders = opponentIds2.map(() => '?').join(',');
      const params = [p.game_id].concat(opponentIds2);
      const rows = await require('../services/dbWrapper').allAsync(
        `SELECT id, username FROM participants WHERE game_id = ? AND id IN (${placeholders})`,
        params
      ).catch(() => []);
      (rows || []).forEach(r => { nameMap[String(r.id)] = r.username || String(r.id); });
    }

    for (const entry of (participantHistory || [])) {
      const opponentId = entry.targetId;
      const turnNumber = entry.turnNumber;
      const oppByTurn = opponentHistMap2[String(opponentId)] || {};
      const oppRow = oppByTurn[String(turnNumber)] || null;
      // Prefer the stored opponent_choice on the participant's own row if present,
      // otherwise fall back to the opponent's applied choice lookup.
      const opponentChoiceValue = (typeof entry.opponentChoice !== 'undefined' && entry.opponentChoice !== null) ? entry.opponentChoice : (oppRow ? oppRow.choice : null);
      results.push({
        participantId: participantId,
        opponentUsername: nameMap[String(opponentId)] || String(opponentId),
        turnNumber: turnNumber,
        appliedChoice: entry.choice,
        opponentChoice: opponentChoiceValue,
        pointsAwarded: entry.pointsAwarded,
      });
    }

    return res.json({ success: true, data: results });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Return active choices for the current turn for this participant (owner-only)
router.get('/:participantId/activeChoices', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const v = await verifyOwnership(req, participantId);
    if (!v.ok) return res.status(v.status).json({ success: false, error: v.error });
    const p = v.participant;
    const g = await require('../services/dbWrapper').getAsync('SELECT current_turn FROM games WHERE id = ?', [p.game_id]);
    const turnNumber = g ? g.current_turn : 0;
    const rows = await require('../services/dbWrapper').allAsync('SELECT target_id, choice FROM turns WHERE game_id = ? AND player_id = ? AND turn_number = ?', [p.game_id, participantId, turnNumber]);
    // normalize keys to targetId/choice
    const mapped = (rows || []).map(r => ({ targetId: r.target_id || r.targetId, choice: r.choice }));
    return res.json({ success: true, data: mapped });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Return participant row for a given participant id
router.get('/:participantId', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const row = await require('../services/dbWrapper').getAsync('SELECT id, game_id, user_id, username, is_host, total_score, ready_for_next_turn FROM participants WHERE id = ?', [participantId]);
    if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Participant not found' } });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Return opponent participant ids for a given participant id (all participants in same game except this one)
router.get('/:participantId/opponents', async (req, res) => {
  try {
    const participantId = req.params.participantId;
    const p = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    if (!p) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Participant not found' } });
    const rows = await require('../services/dbWrapper').allAsync('SELECT id FROM participants WHERE game_id = ? AND id != ?', [p.game_id, participantId]);
    const ids = rows.map(r => r.id);
    return res.json({ success: true, data: ids });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// Return list of currently logged-in users (sessions that have `user` set)
router.get('/online', async (req, res) => {
  try {
    const presence = require('../services/presenceService');
    const rows = await presence.getOnline(120);
    return res.json({ success: true, data: rows.map(r => ({ id: r.id, username: r.username, last_action: r.last_action, is_online: !!r.is_online })) });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
