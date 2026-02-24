
const express = require('express');
const session = require('express-session');
const path = require('path');

// Initialize DB and migrations
const db = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
app.use(
	session({
		secret: SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
	})
);

// Mount API routers
app.use('/api/auth', require('../routes/auth'));
app.use('/api/games', require('../routes/games'));
app.use('/api/participants', require('../routes/participants'));
app.use('/api/turns', require('../routes/turns'));
app.use('/api/scores', require('../routes/scores'));
app.use('/api/admin', require('../routes/admin'));

// Serve public static assets
app.use(express.static(path.join(__dirname, '../../public')));

const PORT = process.env.PORT || 3000;

module.exports = app;

// Wait for migrations to complete before starting server and creating default admin
db.migrationsReady
	.then(async () => {
		app.listen(PORT, () => {
			// eslint-disable-next-line no-console
			console.log(`Server listening on port ${PORT}`);
		});

		// Ensure default admin account exists
		const authService = require('../services/authService');
		try {
			const adminUser = await authService.findUserByUsername('admin');
			if (!adminUser) {
				const r = await authService.createUser('admin', 'madman', { isAdmin: true });
				if (r && r.success) console.log('Created default admin user: admin');
				else console.log('Failed to create default admin user:', r && r.error);
			}
		} catch (e) {
			console.error('Error ensuring admin user exists', e);
		}
	})
	.catch((err) => {
		console.error('Failed to apply migrations, aborting startup', err);
		process.exit(1);
	});
