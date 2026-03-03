# Docker deployment (Quickstart)

This document explains quick steps to run the Iterated Multiplayer Prisoners Dilemma app in Docker (and on TrueNAS SCALE). It assumes you already have Docker (or Docker Compose) installed.

1) Copy the example environment file and set a strong secret

```bash
cp .env.example .env
# edit .env and set SESSION_SECRET to a long random value
```

Generate a secret:
```bash
openssl rand -hex 32
# or with Node:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2) Start with Docker Compose (recommended)

```bash
docker compose build
docker compose up -d
```

This uses `docker-compose.yml` in the repo. The `./database` folder is mounted into the container to persist the SQLite database and sessions (sessions.sqlite).

3) Or run a single container

```bash
docker build -t prisonersdilemma:latest .
docker run -d \
  -p 3000:3000 \
  -e SESSION_SECRET='your-secret' \
  -e SESSION_COOKIE_SECURE='true' \
  -e TRUST_PROXY='1' \
  -e NODE_ENV='production' \
  -v $(pwd)/database:/app/database \
  --name ipd prisonersdilemma:latest
```

4) TrueNAS SCALE notes
- Use the Apps UI or import the `docker-compose.yml` as a compose app.
- Make sure you set the `SESSION_SECRET` and mount a persistent dataset to the container path that maps to `./database` in the repo (container: `/app/database`).
- If TrueNAS provides an ingress/ingress-controller that terminates TLS, set `TRUST_PROXY=1` and keep `SESSION_COOKIE_SECURE=true`.

5) Debugging & verification
- Logs: `docker compose logs -f ipd` or `docker logs -f ipd`.
- Health check: the compose file includes a basic HTTP healthcheck hitting `/api/auth/whoami`.
- Migrations: the server runs migrations at startup; check logs for `Applying migration` messages.

6) Security & persistence recommendations
- Do not commit `.env` to source control.
- Persist `./database` (host-mounted volume) so the DB and session store survive restarts.
- For multi-instance production, replace the sqlite session store with a shared solution (Redis) and update `src/server/server.js` accordingly.

7) Example env vars (minimum)

```
SESSION_SECRET=<long-random-hex>
SESSION_COOKIE_SECURE=true
TRUST_PROXY=1
NODE_ENV=production
PORT=3000
```

If you want, I can also add a `README_DOCKER.md` section that shows how to switch to Redis for sessions, or produce a sample `systemd` service that runs the container. Which would you prefer next?
