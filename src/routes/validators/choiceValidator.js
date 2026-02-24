const { body, param, validationResult } = require('express-validator');

const choiceValidator = [
  param('participantId')
    .exists()
    .withMessage('participantId is required in path')
    .bail()
    .isString()
    .withMessage('participantId must be a string'),

  body('targetId')
    .exists()
    .withMessage('targetId is required')
    .bail()
    .isString()
    .withMessage('targetId must be a string'),

  body('choice')
    .exists()
    .withMessage('choice is required')
    .bail()
    .isIn(['peace', 'war'])
    .withMessage("choice must be one of ['peace','war']"),

];

module.exports = { choiceValidator };
