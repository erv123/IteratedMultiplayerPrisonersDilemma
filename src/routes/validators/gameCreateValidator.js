const { body, validationResult } = require('express-validator');

const gameCreateValidator = [
  body('payoffMatrix')
    .exists({ checkNull: true })
    .withMessage('payoffMatrix is required')
    .bail()
    .custom(v => typeof v === 'object' && v !== null && !Array.isArray(v))
    .withMessage('payoffMatrix must be an object'),

  body('name')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('name is required')
    .bail()
    .isString()
    .withMessage('name must be a string')
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
