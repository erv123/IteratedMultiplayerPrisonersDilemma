## WebSocket Migration: overview, tradeoffs, and plan

This document explains what WebSockets provide, the complexity they introduce, and a practical migration plan from the current polling approach to a WebSocket-based architecture for real-time updates.

Summary
- What WebSockets give you: bidirectional, low-latency server push (no repeated polling), reduced bandwidth for frequent updates, and a natural event-driven API for real-time features (score updates, live chat, participant events, settings changes).
- What they cost: additional server and operational complexity (connection lifecycle, scaling across instances, reconnection/backoff, authentication-on-handshake, monitoring), and code changes on both client and server.

When to migrate
- Good fit: you need near-instant updates, polling rate is high, or you want fewer wasted HTTP requests.
- Not necessary: if data updates are rare or polling interval is low and system load is acceptable.

High-level tradeoffs
- Benefits
  - Lower latency and immediate updates from server to clients.
  - Less bandwidth wastage vs frequent polling (no repeated full-response payloads).
  - Enables richer interactions (push notifications, per-client events, server-initiated control).
  - Easier to implement event-driven UX (subscribe/unsubscribe to topics, push deltas).
- Costs / Complexity
  - Connection management: keep-alive, heartbeats, detecting and recovering broken connections.
  - Scaling: when running multiple server instances you need a message broker (Redis pub/sub, NATS, Kafka) or sticky session layer to broadcast events across instances.
  - Load-balancer and proxy config: ensure TCP/WS upgrade support and health checks; configure sticky sessions or external pub/sub.
  - Security: handshake authentication, origin checks, TLS termination, and rate-limiting per connection.
  - Debugging & monitoring: require connection metrics, open-socket counts, and additional runtime instrumentation.
  - Browser compatibility: modern browsers support WebSockets; fallback may be needed for legacy clients.

Server-side design considerations
- Choose a library: `ws` (lightweight), `socket.io` (feature-rich, reconnection+rooms), or integrate through a separate real-time service.
- Message broker: to scale horizontally, publish events to Redis (pub/sub) or a message bus; all instances subscribe and forward relevant messages to connected clients.
- Authentication: require a short-lived token or session handshake during the WebSocket upgrade (e.g., pass bearer token in query or use a cookie with secure session). Validate on connect.
- Event model: design clear event schemas (JSON message type and payload). Use namespaced event types: `score.update`, `player.join`, `player.leave`, `settings.update`, `turn.created`.
- Reconnection & resync: clients should reconnect with exponential backoff, then request a delta or full state snapshot to resynchronize. Always design idempotent update handling.

Client-side design considerations
- Replace polling subscriptions with WebSocket subscriptions. Instead of calling `startPolling(key, fn, ...)`, create a `realtime` module that: connects, authenticates, subscribes to topics, and dispatches events to UI handlers.
- Keep existing rendering code but move away from wholesale `innerHTML` replacements to targeted updates when possible (reduces DOM churn and prevents scroll/focus jumps).
- Fallback: keep polling as a fallback option during rollout or for environments where WebSockets are unsupported.

Migration plan (incremental)
1. Add a lightweight `realtime` client wrapper on the frontend that opens a WebSocket, handles reconnect, and dispatches events to listeners (subscribe/emit API). Keep existing `polling` code unchanged for now.
2. Implement server-side WebSocket endpoint that performs authentication at handshake and accepts subscriptions (or tracks connections by gameId).
3. Introduce a message broker (Redis pub/sub recommended) so multiple server instances can publish events centrally. Update server code to publish important events (turns, score updates, participant changes) to the broker.
4. Implement event emission on server: when a turn is processed, publish `turn.created` and `score.update` events. The WebSocket layer subscribes to broker and forwards to connected clients.
5. Start migrating clients incrementally:
   - Phase A: Scores. Make score updates delivered over WebSocket while keeping polling for other data.
   - Phase B: Participants & lobby lists.
   - Phase C: Game settings and other admin/host updates.
6. After each phase, monitor behavior and perform load tests. Remove polling subscriptions only when the corresponding WebSocket paths are stable.

Message schema examples
- Score update
```json
{ "type": "score.update", "gameId": "<id>", "payload": { "playerId": "u1", "scores": [0,1,2], "lastTurn": 3 } }
```
- Participant list change
```json
{ "type": "participants.changed", "gameId": "<id>", "payload": { "participants": [ {"id":"u1","username":"foo","is_host":true}, ... ] } }
```
- Settings change
```json
{ "type": "settings.update", "gameId": "<id>", "payload": { "maxPlayers": 8, "endChance": 5 } }
```

Operational concerns
- Monitoring: track `open_sockets`, `connect_rate`, `disconnect_rate`, `avg_messages_per_minute`, and per-connection message throughput. Alert on memory leaks or increases in open sockets.
- Limits: enforce per-connection rate limits and maximum number of sockets per user to avoid abuse.
- Load balancing: either enable sticky sessions or use an external pub/sub to route events to all instances. Sticky sessions remove the need for cross-instance pub/sub for connection state, but still require pub/sub to broadcast server-side events originated elsewhere.
- TLS: terminate TLS at the edge (NGINX, cloud LB) with support for WebSocket upgrade (wss://). Ensure the server accepts upgraded connections.

Testing & rollout
- Smoke tests: open many concurrent WebSocket connections locally and ensure reconnect/resync works.
- Integration tests: verify clients that reconnect obtain a consistent state snapshot.
- Staged rollout: enable WebSocket-based score updates for a subset of servers or routes, keep polling as fallback, then increase usage as confidence grows.

Effort estimate and complexity
- Small project (single server, low concurrency): low-to-moderate effort (a few days) to add WebSocket endpoint and client wrapper.
- Multi-instance production (multiple servers behind LB): moderate-to-high effort (1–2 weeks) to add broker, update deployment, harden auth/monitoring, and tune LB.

Conclusion and recommendation
- If you need real-time responsiveness and want to reduce polling overhead, migrate to WebSockets. Start incrementally, begin with critical high-frequency updates (scores), and keep polling as a fallback until stable.
- Use `socket.io` for faster development (built-in reconnection, rooms) or `ws` plus Redis pub/sub for a lightweight, explicit solution.

Appendix: checklist for migration
- [ ] Implement `realtime` client wrapper
- [ ] Add WebSocket endpoint to server with auth on handshake
- [ ] Wire server events to Redis (or chosen broker)
- [ ] Replace polling subscriptions phase-by-phase
- [ ] Add monitoring and connection limits
- [ ] Run load tests and roll out gradually
