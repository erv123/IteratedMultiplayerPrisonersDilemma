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
    // For each entry, fetch the opponent's applied choice against this participant for the same turn
    const db = require('../services/dbWrapper');
    const results = [];
    for (const entry of (participantHistory || [])) {
      const opponentId = entry.targetId;
      const turnNumber = entry.turnNumber;
      const oppRow = await db.getAsync('SELECT applied_choice, points_awarded FROM turns WHERE game_id = ? AND player_id = ? AND target_id = ? AND turn_number = ?', [p.game_id, opponentId, participantId, turnNumber]);
      results.push({
        participantId: participantId,
        opponentId: opponentId,
        turnNumber: turnNumber,
        appliedChoice: entry.choice,
        opponentChoice: oppRow ? oppRow.applied_choice : null,
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
    await participantService.markReady(participantId);
    const part = await require('../services/dbWrapper').getAsync('SELECT game_id FROM participants WHERE id = ?', [participantId]);
    if (!part) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const gameId = part.game_id;
    const readyCountRow = await require('../services/dbWrapper').getAsync('SELECT SUM(ready_for_next_turn) as readyCount, count(*) as total FROM participants WHERE game_id = ?', [gameId]);
    if (readyCountRow && readyCountRow.readyCount === readyCountRow.total) {
      const resolveService = require('../services/resolveService');
      await resolveService.resolveTurn(gameId, (await require('../services/dbWrapper').getAsync('SELECT current_turn FROM games WHERE id = ?', [gameId])).current_turn);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
    // For each participant history entry, fetch the opponent's applied choice against this participant for the same turn
    const db = require('../services/dbWrapper');
    const results = [];
    for (const entry of (participantHistory || [])) {
      const opponentId = entry.targetId;
      const turnNumber = entry.turnNumber;
      // fetch opponent's turn row where they targeted this participant on the same turn
      const oppRow = await db.getAsync('SELECT applied_choice, points_awarded FROM turns WHERE game_id = ? AND player_id = ? AND target_id = ? AND turn_number = ?', [p.game_id, opponentId, participantId, turnNumber]);
      results.push({
        participantId: participantId,
        opponentId: opponentId,
        turnNumber: turnNumber,
        appliedChoice: entry.choice,
        opponentChoice: oppRow ? oppRow.applied_choice : null,
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

module.exports = router;
