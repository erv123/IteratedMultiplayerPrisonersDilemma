const { validationResult } = require('express-validator');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array().map(e => ({ field: e.param, message: e.msg, value: e.value })),
      },
    });
  }
  return next();
}

module.exports = { handleValidation };
