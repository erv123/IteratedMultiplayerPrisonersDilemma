const { body, validationResult } = require('express-validator');

const gameCreateValidator = [
  body('payoffMatrix')
    .exists({ checkNull: true })
    .withMessage('payoffMatrix is required')
    .bail()
    .custom(v => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('payoffMatrix must be an object');
      const requiredKeys = ['peace_peace','peace_war','war_peace','war_war'];
      for (const k of requiredKeys) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) throw new Error(`payoffMatrix missing key ${k}`);
        const val = v[k];
        // accept numeric values or numeric strings
        if (typeof val === 'number') {
          if (!Number.isFinite(val)) throw new Error(`payoffMatrix.${k} must be a finite number`);
        } else if (typeof val === 'string') {
          if (val.trim() === '' || Number.isNaN(Number(val))) throw new Error(`payoffMatrix.${k} must be a number`);
        } else {
          throw new Error(`payoffMatrix.${k} must be a number`);
        }
      }
      return true;
    })
    .withMessage('payoffMatrix must be an object with numeric keys: peace_peace, peace_war, war_peace, war_war'),

  body('name')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('name is required')
    .bail()
    .isString()
    .withMessage('name must be a string')
    .bail()
    .isLength({ max: 40 })
    .withMessage('name must be at most 40 characters')
    .trim(),

  body('errorChance')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('errorChance must be a number between 0 and 100')
    .toFloat(),

  body('endChance')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('endChance is required')
    .bail()
    .isInt({ min: 1, max: 99 })
    .withMessage('endChance must be an integer between 1 and 99')
    .toInt(),

  body('maxPlayers')
    .exists()
    .withMessage('maxPlayers is required')
    .bail()
    .isInt({ min: 2, max: 40 })
    .withMessage('maxPlayers must be an integer between 2 and 40')
    .toInt(),

  body('historyLimit')
    .optional()
    .isInt({ min: -1 })
    .withMessage('historyLimit must be an integer >= -1')
    .toInt(),

];

module.exports = { gameCreateValidator };
