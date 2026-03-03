BEGIN TRANSACTION;

-- Add a helper column on turns to indicate per-turn resolution stage:
-- 0 = unsubmitted, 1 = unprocessed, 2 = applied choices written, 3 = opponent choice lookup, 4 = payoff applied
ALTER TABLE turns ADD COLUMN resolution_stage INTEGER DEFAULT 0;

-- Ensure any existing rows have a defined stage
UPDATE turns SET resolution_stage = 1 WHERE resolution_stage IS NULL;

COMMIT;
