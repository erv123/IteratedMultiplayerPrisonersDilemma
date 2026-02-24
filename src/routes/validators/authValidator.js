const { body, validationResult } = require('express-validator');

const registerValidator = [
  body('username')
    .exists()
    .withMessage('username is required')
    .bail()
    .isLength({ min: 3, max: 64 })
    .withMessage('username must be between 3 and 64 characters')
    .trim(),

  body('password')
    .exists()
    .withMessage('password is required')
    .bail()
    .isLength({ min: 3 })
    .withMessage('password must be at least 3 characters'),

];

// allow optional isAdmin flag on register (server will enforce permissions)
registerValidator.push(
  body('isAdmin').optional().isBoolean().withMessage('isAdmin must be boolean').toBoolean()
);

const loginValidator = [
  body('username')
    .exists()
    .withMessage('username is required')
    .bail()
    .isLength({ min: 1 })
    .trim(),

  body('password')
    .exists()
    .withMessage('password is required'),

];

const resetPasswordValidator = [
  body('username')
    .exists()
    .withMessage('username is required')
    .bail()
    .isLength({ min: 1 })
    .trim(),

  body('newPassword')
    .exists()
    .withMessage('newPassword is required')
    .bail()
    .isLength({ min: 8 })
    .withMessage('newPassword must be at least 8 characters'),

];

module.exports = { registerValidator, loginValidator, resetPasswordValidator };
