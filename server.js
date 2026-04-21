const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.CORS_ORIGIN || '*';
const io = socketIo(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST']
  }
});

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PLAYER_RADIUS = 15;
const MAX_PLAYERS_PER_ROOM = 2;
const ROUND_START_HEALTH = 5;
const ROUNDS_TO_WIN = 3;

const WEAPONS = {
  blaster: { speed: 7, cooldownMs: 350, damage: 1 },
  rapid: { speed: 6.2, cooldownMs: 140, damage: 1 },
  sniper: { speed: 10, cooldownMs: 900, damage: 2 }
};

const OBSTACLES = [
  { x: 310, y: 180, w: 180, h: 24 },
  { x: 90, y: 300, w: 140, h: 24 },
  { x: 560, y: 300, w: 140, h: 24 },
  { x: 310, y: 420, w: 180, h: 24 }
];

const statsFilePath = path.join(__dirname, 'data', 'stats.json');

app.use(express.json());
app.use(express.static('public'));

const rateState = new Map();
app.use((req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const minute = Math.floor(now / 60000);
  const state = rateState.get(ip) || { minute, count: 0 };

  if (state.minute !== minute) {
    state.minute = minute;
    state.count = 0;
  }

  state.count += 1;
  rateState.set(ip, state);

  if (state.count > 200) {
    res.status(429).json({ error: 'Too many requests, slow down.' });
    return;
  }

  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/leaderboard', (_req, res) => {
  const stats = readStats();
  const list = Object.entries(stats.players)
    .map(([name, entry]) => ({ name, wins: entry.wins || 0, losses: entry.losses || 0, hits: entry.hits || 0 }))
    .sort((a, b) => b.wins - a.wins || b.hits - a.hits)
    .slice(0, 10);
  res.json({ leaderboard: list });
});

const rooms = {};

function ensureStatsFile() {
  const dir = path.dirname(statsFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(statsFilePath)) {
    fs.writeFileSync(statsFilePath, JSON.stringify({ players: {} }, null, 2));
  }
}

function readStats() {
  try {
    ensureStatsFile();
    const raw = fs.readFileSync(statsFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return { players: {} };
  }
}

function writeStats(next) {
  ensureStatsFile();
  fs.writeFileSync(statsFilePath, JSON.stringify(next, null, 2));
}

function updateStats(winnerName, loserName, winnerHits) {
  if (!winnerName || !loserName) return;
  const stats = readStats();

  if (!stats.players[winnerName]) stats.players[winnerName] = { wins: 0, losses: 0, hits: 0 };
  if (!stats.players[loserName]) stats.players[loserName] = { wins: 0, losses: 0, hits: 0 };

  stats.players[winnerName].wins += 1;
  stats.players[winnerName].hits += winnerHits || 0;
  stats.players[loserName].losses += 1;

  writeStats(stats);
}

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoomIfMissing(roomName) {
  if (!rooms[roomName]) {
    rooms[roomName] = {
      roomName,
      roomCode: roomName,
      players: {},
      bullets: [],
      rematchVotes: {},
      roundNumber: 0,
      roundActive: false,
      gameStarted: false,
      obstacles: OBSTACLES
    };
  }
  return rooms[roomName];
}

function getPlayerList(room) {
  return Object.values(room.players).map((p) => ({
    id: p.id,
    name: p.name,
    ready: p.ready,
    health: p.health,
    roundWins: p.roundWins,
    weapon: p.weapon
  }));
}

function emitRoomState(room) {
  io.to(room.roomName).emit('roomState', {
    roomName: room.roomName,
    roomCode: room.roomCode,
    map: { width: MAP_WIDTH, height: MAP_HEIGHT, obstacles: room.obstacles },
    players: getPlayerList(room),
    roundNumber: room.roundNumber,
    roundActive: room.roundActive,
    roundsToWin: ROUNDS_TO_WIN
  });
}

function playerSpawnPosition(side, obstacles) {
  const candidates = side === 0
    ? [
      { x: 110, y: 260 },
      { x: 110, y: 360 },
      { x: 160, y: 260 }
    ]
    : [
      { x: 690, y: 260 },
      { x: 690, y: 360 },
      { x: 640, y: 260 }
    ];

  const safe = candidates.find((point) => !obstacles.some((rect) => circleIntersectsRect(point.x, point.y, PLAYER_RADIUS, rect)));
  return safe || candidates[0];
}

function circleIntersectsRect(x, y, r, rect) {
  const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - closestX;
  const dy = y - closestY;
  return (dx * dx + dy * dy) <= r * r;
}

function updatePlayerPosition(room, player, requestedX, requestedY, angle) {
  let x = Math.max(PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, Number(requestedX) || player.x));
  let y = Math.max(PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, Number(requestedY) || player.y));

  const blocked = room.obstacles.some((rect) => circleIntersectsRect(x, y, PLAYER_RADIUS, rect));
  if (!blocked) {
    player.x = x;
    player.y = y;
  }
  player.angle = Number(angle) || player.angle;
}

function startRound(room) {
  room.roundNumber += 1;
  room.roundActive = false;
  room.bullets = [];

  const players = Object.values(room.players);
  players.forEach((player, idx) => {
    const spawn = playerSpawnPosition(idx, room.obstacles);
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = ROUND_START_HEALTH;
    player.ready = false;
    player.lastShotAt = 0;
    player.hitsLandedThisMatch = player.hitsLandedThisMatch || 0;
  });

  io.to(room.roomName).emit('roundCountdown', { seconds: 3, roundNumber: room.roundNumber });

  setTimeout(() => {
    if (!rooms[room.roomName]) return;
    room.roundActive = true;
    room.gameStarted = true;
    io.to(room.roomName).emit('roundStart', {
      roundNumber: room.roundNumber,
      players: players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        health: p.health,
        name: p.name,
        roundWins: p.roundWins,
        weapon: p.weapon
      })),
      map: { width: MAP_WIDTH, height: MAP_HEIGHT, obstacles: room.obstacles }
    });
    emitRoomState(room);
  }, 3000);
}

function finishRound(room, winnerId, loserId) {
  room.roundActive = false;

  const winner = room.players[winnerId];
  const loser = room.players[loserId];
  if (!winner || !loser) return;

  winner.roundWins += 1;

  io.to(room.roomName).emit('roundEnd', {
    winnerId,
    loserId,
    scores: getPlayerList(room)
  });

  if (winner.roundWins >= ROUNDS_TO_WIN) {
    io.to(room.roomName).emit('gameOver', {
      winnerId,
      loserId,
      scores: getPlayerList(room)
    });
    updateStats(winner.name, loser.name, winner.hitsLandedThisMatch || 0);
    room.rematchVotes = {};
    return;
  }

  setTimeout(() => {
    if (!rooms[room.roomName]) return;
    startRound(room);
  }, 1800);
}

function distance(aX, aY, bX, bY) {
  const dx = aX - bX;
  const dy = aY - bY;
  return Math.sqrt(dx * dx + dy * dy);
}

function handleBulletSimulation() {
  const now = Date.now();
  Object.values(rooms).forEach((room) => {
    if (!room.roundActive) return;
    const nextBullets = [];

    room.bullets.forEach((b) => {
      b.x += b.vx;
      b.y += b.vy;

      const outOfBounds = b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT;
      const hitObstacle = room.obstacles.some((rect) => circleIntersectsRect(b.x, b.y, b.radius, rect));
      const expired = b.expiresAt < now;
      if (outOfBounds || hitObstacle || expired) {
        return;
      }

      const potentialTargets = Object.values(room.players).filter((p) => p.id !== b.ownerId);
      const hit = potentialTargets.find((p) => distance(b.x, b.y, p.x, p.y) <= b.radius + PLAYER_RADIUS);

      if (hit) {
        hit.health -= b.damage;
        const shooter = room.players[b.ownerId];
        if (shooter) {
          shooter.hitsLandedThisMatch = (shooter.hitsLandedThisMatch || 0) + 1;
        }

        io.to(room.roomName).emit('playerHit', {
          targetId: hit.id,
          health: hit.health,
          hitX: hit.x,
          hitY: hit.y
        });

        if (hit.health <= 0 && shooter) {
          finishRound(room, shooter.id, hit.id);
        }
        return;
      }

      nextBullets.push(b);
    });

    room.bullets = nextBullets;
    io.to(room.roomName).emit('stateUpdate', {
      players: Object.values(room.players).map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        health: p.health,
        name: p.name,
        roundWins: p.roundWins,
        weapon: p.weapon
      })),
      bullets: room.bullets
    });
  });
}

setInterval(handleBulletSimulation, 33);

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName, weapon }) => {
    let roomCode = randomRoomCode();
    while (rooms[roomCode]) {
      roomCode = randomRoomCode();
    }

    socket.emit('roomCreated', { roomCode });
    socket.emit('status', { message: 'Room created. Share the code and join.', kind: 'ok' });
    socket.emit('preFill', { roomCode, playerName, weapon });
  });

  socket.on('joinRoom', ({ roomName, playerName, weapon }) => {
    const cleanRoom = String(roomName || '').trim().toUpperCase();
    const cleanName = String(playerName || '').trim().slice(0, 16) || 'Pilot';
    const pickedWeapon = WEAPONS[weapon] ? weapon : 'blaster';

    if (!cleanRoom) {
      socket.emit('status', { message: 'Enter a room code first.', kind: 'error' });
      return;
    }

    const room = createRoomIfMissing(cleanRoom);
    const existingPlayers = Object.keys(room.players);

    if (existingPlayers.length >= MAX_PLAYERS_PER_ROOM && !room.players[socket.id]) {
      socket.emit('status', { message: 'Room is full.', kind: 'error' });
      return;
    }

    const spawn = playerSpawnPosition(existingPlayers.length, room.obstacles);
    room.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      health: ROUND_START_HEALTH,
      ready: false,
      weapon: pickedWeapon,
      roundWins: room.players[socket.id]?.roundWins || 0,
      lastShotAt: 0,
      hitsLandedThisMatch: room.players[socket.id]?.hitsLandedThisMatch || 0
    };

    socket.join(cleanRoom);
    socket.roomName = cleanRoom;

    socket.emit('joinedRoom', {
      roomName: cleanRoom,
      playerId: socket.id,
      map: { width: MAP_WIDTH, height: MAP_HEIGHT, obstacles: room.obstacles },
      roundsToWin: ROUNDS_TO_WIN
    });

    emitRoomState(room);
  });

  socket.on('setReady', ({ ready }) => {
    const room = rooms[socket.roomName];
    if (!room || !room.players[socket.id]) return;

    room.players[socket.id].ready = Boolean(ready);
    emitRoomState(room);

    const players = Object.values(room.players);
    if (players.length === MAX_PLAYERS_PER_ROOM && players.every((p) => p.ready) && !room.roundActive) {
      startRound(room);
    }
  });

  socket.on('playerMove', (data) => {
    const room = rooms[socket.roomName];
    if (!room || !room.roundActive) return;
    const player = room.players[socket.id];
    if (!player) return;

    updatePlayerPosition(room, player, data.x, data.y, data.angle);
  });

  socket.on('switchWeapon', ({ weapon }) => {
    const room = rooms[socket.roomName];
    if (!room || !room.players[socket.id]) return;
    if (!WEAPONS[weapon]) return;

    room.players[socket.id].weapon = weapon;
    emitRoomState(room);
  });

  socket.on('shoot', ({ angle }) => {
    const room = rooms[socket.roomName];
    if (!room || !room.roundActive) return;
    const player = room.players[socket.id];
    if (!player) return;

    const weapon = WEAPONS[player.weapon] || WEAPONS.blaster;
    const now = Date.now();
    if (now - player.lastShotAt < weapon.cooldownMs) return;
    player.lastShotAt = now;

    const fireAngle = Number(angle) || 0;
    const bullet = {
      id: `${socket.id}-${now}`,
      ownerId: socket.id,
      x: player.x + Math.cos(fireAngle) * 22,
      y: player.y + Math.sin(fireAngle) * 22,
      vx: Math.cos(fireAngle) * weapon.speed,
      vy: Math.sin(fireAngle) * weapon.speed,
      radius: player.weapon === 'sniper' ? 4 : 5,
      damage: weapon.damage,
      expiresAt: now + 2000
    };

    room.bullets.push(bullet);
    io.to(room.roomName).emit('bulletFired', {
      ownerId: socket.id,
      x: bullet.x,
      y: bullet.y
    });
  });

  socket.on('rematchVote', () => {
    const room = rooms[socket.roomName];
    if (!room || !room.players[socket.id]) return;

    room.rematchVotes[socket.id] = true;
    io.to(room.roomName).emit('rematchState', {
      votes: Object.keys(room.rematchVotes).length,
      needed: Math.min(MAX_PLAYERS_PER_ROOM, Object.keys(room.players).length)
    });

    const neededVotes = Math.min(MAX_PLAYERS_PER_ROOM, Object.keys(room.players).length);
    if (Object.keys(room.rematchVotes).length === neededVotes && neededVotes === MAX_PLAYERS_PER_ROOM) {
      room.rematchVotes = {};
      Object.values(room.players).forEach((p) => {
        p.roundWins = 0;
        p.ready = true;
        p.hitsLandedThisMatch = 0;
      });
      emitRoomState(room);
      startRound(room);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomName];
    if (!room) return;

    delete room.players[socket.id];
    room.bullets = room.bullets.filter((b) => b.ownerId !== socket.id);
    delete room.rematchVotes[socket.id];

    io.to(room.roomName).emit('opponentDisconnected');

    if (Object.keys(room.players).length === 0) {
      delete rooms[room.roomName];
      return;
    }

    emitRoomState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game Server running on port ${PORT}`);
  console.log('Open this URL in your browser to play!');
});
