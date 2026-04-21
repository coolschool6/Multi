# Blaster Arena

A real-time multiplayer 2D shooter built with Node.js, Express, Socket.IO, and vanilla HTML/CSS/JS.

## Features implemented

1. Lobby with pilot names and ready-up flow
2. Private room codes (create and join)
3. Server-authoritative bullet simulation and hit validation
4. Round system with countdown and best-of match win condition
5. Weapon classes with server-enforced cooldowns
6. Arena obstacles with collision handling
7. Visual and audio feedback (hit particles and simple sound cues)
8. Persistent player stats and leaderboard endpoint
9. Mobile touch controls (virtual joystick + fire button)
10. Production hardening (health endpoint, basic API rate limiting, configurable CORS)

## Run locally

1. Install dependencies
	npm install
2. Start server
	npm start
3. Open
	http://localhost:3000

If your shell does not resolve Node commands, use absolute paths:

- C:\Program Files\nodejs\npm.cmd install
- C:\Program Files\nodejs\npm.cmd start

## Deploy on Render

Create a Web Service with these settings:

- Runtime: Node
- Build Command: npm install
- Start Command: npm start
- Optional Environment Variable: CORS_ORIGIN=https://your-render-domain.onrender.com

## API

- GET /health -> server status
- GET /api/leaderboard -> top pilots by wins/hits