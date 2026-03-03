
const express = require('express');
const session = require('express-session');
const path = require('path');
// Use a production-ready session store (sqlite-backed) instead of the default MemoryStore
let SQLiteStore;
try {
	// `connect-sqlite3` exports a function that accepts the session module
	SQLiteStore = require('connect-sqlite3')(session);
} catch (e) {
	// If the dependency is not installed, fall back to memory store but log a clear warning
	console.warn('connect-sqlite3 not installed; using MemoryStore. Install connect-sqlite3 for production session storage.');
}

// Initialize DB and migrations
const db = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'e52a55d2-5c36-4bb7-9752-6b84e58a8d7b';
// If running in production, require an explicit SESSION_SECRET and prefer a persistent store
if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'e52a55d2-5c36-4bb7-9752-6b84e58a8d7b') {
	console.error('Running in production with default SESSION_SECRET; set SESSION_SECRET env var to a secure value.');
}
// Allow explicit control over whether cookies are marked `Secure` (useful when running behind
// a reverse proxy or when serving over HTTP during testing). Default: true in production.
const cookieSecure = (typeof process.env.SESSION_COOKIE_SECURE !== 'undefined')
	? String(process.env.SESSION_COOKIE_SECURE).toLowerCase() === 'true'
	: (process.env.NODE_ENV === 'production');
// If using secure cookies behind a proxy (e.g., nginx/Traefik), enable trust proxy
if (cookieSecure && process.env.TRUST_PROXY) {
	app.set('trust proxy', 1);
}

const sessionOptions = {
	secret: SESSION_SECRET,
	resave: false,
	saveUninitialized: false,
	cookie: { secure: cookieSecure, sameSite: 'lax', path: '/' },
};
if (SQLiteStore) {
	const sessionsDir = path.join(__dirname, '..', '..', 'database');
	// Ensure directory exists
	try { require('fs').mkdirSync(sessionsDir, { recursive: true }); } catch (e) {}
	sessionOptions.store = new SQLiteStore({ db: 'sessions.sqlite', dir: sessionsDir });
}
app.use(session(sessionOptions));

// Mount API routers
app.use('/api/auth', require('../routes/auth'));
app.use('/api/games', require('../routes/games'));
app.use('/api/participants', require('../routes/participants'));
app.use('/api/turns', require('../routes/turns'));
app.use('/api/scores', require('../routes/scores'));
app.use('/api/admin', require('../routes/admin'));
app.use('/api/presence', require('../routes/presence'));

// Serve public static assets
app.use(express.static(path.join(__dirname, '../../public')));

// Lightweight SVG favicon to avoid 404 noise when no favicon file present
app.get('/favicon.ico', (req, res) => {
	const svg = `<?xml version="1.0" encoding="UTF-8"?>
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" rx="8" ry="8" fill="#222" />
		<text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#fff" text-anchor="middle" dominant-baseline="central">IP</text>
	</svg>`;
	res.type('image/svg+xml');
	// Small cache for favicon
	res.setHeader('Cache-Control', 'public, max-age=86400');
	res.send(svg);
});

// Support extensionless routing for pages so URLs don't need .html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));
app.get('/createGame', (req, res) => {
	// require authenticated session to access create page
	if (!req.session || !req.session.user) return res.redirect('/');
	return res.sendFile(path.join(__dirname, '../../public/createGame.html'));
});
app.get('/gameInfo', (req, res) => res.sendFile(path.join(__dirname, '../../public/gameInfo.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, '../../public/game.html')));
// Profile page (extensionless routing)
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, '../../public/profile.html')));

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
