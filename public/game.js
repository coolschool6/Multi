const socket = io();

const state = {
    connected: false,
    roomName: '',
    roomCode: '',
    playerId: '',
    roundsToWin: 3,
    roundNumber: 0,
    gameStarted: false,
    matchEnded: false,
    players: [],
    bullets: [],
    bulletRenderCache: {},
    map: { width: 800, height: 600, obstacles: [] },
    touchVector: { x: 0, y: 0 },
    particles: [],
    overlayTimer: 0,
    joystickActive: false,
    joystickPointerId: null,
    joystickCenter: { x: 0, y: 0 },
    localAim: 0,
    ready: false
};

const keys = {};
let audioContext;
let fireHoldTimer = null;

const joinScreen = document.getElementById('joinScreen');
const gameScreen = document.getElementById('gameScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const weaponSelect = document.getElementById('weaponSelect');
const joinBtn = document.getElementById('joinBtn');
const createRoomBtn = document.getElementById('createRoomBtn');
const readyBtn = document.getElementById('readyBtn');
const rematchBtn = document.getElementById('rematchBtn');
const playAgainBtn = document.getElementById('playAgainBtn');
const statusDiv = document.getElementById('status');
const leaderboardList = document.getElementById('leaderboardList');
const overlayMessage = document.getElementById('overlayMessage');

const yourName = document.getElementById('yourName');
const yourHealth = document.getElementById('yourHealth');
const yourRounds = document.getElementById('yourRounds');
const opponentName = document.getElementById('opponentName');
const opponentHealth = document.getElementById('opponentHealth');
const opponentRounds = document.getElementById('opponentRounds');
const roomLabel = document.getElementById('roomLabel');
const roundLabel = document.getElementById('roundLabel');
const weaponLabel = document.getElementById('weaponLabel');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverMessage = document.getElementById('gameOverMessage');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const joystickBase = document.getElementById('joystickBase');
const joystickStick = document.getElementById('joystickStick');
const fireBtn = document.getElementById('fireBtn');

function getMe() {
    return state.players.find((p) => p.id === state.playerId) || null;
}

function getOpponent() {
    return state.players.find((p) => p.id !== state.playerId) || null;
}

function setStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.style.color = type === 'error' ? '#ff667d' : type === 'ok' ? '#49f6b7' : '#ffcc66';
}

function showOverlay(message, ms = 1200) {
    overlayMessage.textContent = message;
    overlayMessage.style.opacity = '1';
    state.overlayTimer = Date.now() + ms;
}

function hideOverlayIfExpired() {
    if (state.overlayTimer && Date.now() > state.overlayTimer) {
        overlayMessage.style.opacity = '0';
        state.overlayTimer = 0;
    }
}

function playTone(freq, duration, gain = 0.05) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const osc = audioContext.createOscillator();
        const amp = audioContext.createGain();
        osc.frequency.value = freq;
        osc.connect(amp);
        amp.connect(audioContext.destination);
        amp.gain.value = gain;
        osc.start();
        osc.stop(audioContext.currentTime + duration);
    } catch (_err) {
        // Audio is optional.
    }
}

function spawnHitParticles(x, y) {
    for (let i = 0; i < 12; i += 1) {
        const angle = (Math.PI * 2 * i) / 12;
        state.particles.push({
            x,
            y,
            vx: Math.cos(angle) * (1 + Math.random() * 3),
            vy: Math.sin(angle) * (1 + Math.random() * 3),
            life: 24,
            color: '#ffb86c'
        });
    }
}

function updateParticles() {
    state.particles = state.particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        return p.life > 0;
    });
}

function drawParticles() {
    state.particles.forEach((p) => {
        ctx.globalAlpha = Math.max(0.1, p.life / 24);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function updateHud() {
    const me = getMe();
    const opp = getOpponent();
    yourName.textContent = me ? me.name : '-';
    yourHealth.textContent = me ? me.health : '-';
    yourRounds.textContent = me ? me.roundWins : '-';
    opponentName.textContent = opp ? opp.name : 'Waiting...';
    opponentHealth.textContent = opp ? opp.health : '-';
    opponentRounds.textContent = opp ? opp.roundWins : '-';
    roomLabel.textContent = state.roomCode || '-';
    roundLabel.textContent = state.roundNumber;
    weaponLabel.textContent = me ? me.weapon : weaponSelect.value;
}

function drawObstacles() {
    ctx.fillStyle = '#2d3658';
    ctx.strokeStyle = '#4a5a8f';
    state.map.obstacles.forEach((r) => {
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
    });
}

function drawPlayer(player, me = false) {
    if (!player) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle || 0);
    ctx.fillStyle = me ? '#49f6b7' : '#ff667d';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const hp = Math.max(0, player.health) / 5;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(player.x - 24, player.y - 28, 48, 6);
    ctx.fillStyle = hp > 0.4 ? '#49f6b7' : '#ff667d';
    ctx.fillRect(player.x - 24, player.y - 28, 48 * hp, 6);

    ctx.fillStyle = '#eaf2ff';
    ctx.font = '12px sans-serif';
    ctx.fillText(player.name || 'Pilot', player.x - 20, player.y - 34);
}

function drawBullets() {
    Object.values(state.bulletRenderCache).forEach((b) => {
        const mine = b.ownerId === state.playerId;
        ctx.fillStyle = mine ? '#5de0ff' : '#ff8da0';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius || 5, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawArena() {
    ctx.fillStyle = '#090f23';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(93, 224, 255, 0.08)';
    for (let i = 0; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
    }

    drawObstacles();
    drawBullets();
    drawPlayer(getOpponent(), false);
    drawPlayer(getMe(), true);
    drawParticles();
}

function updateBulletInterpolation() {
    const activeIds = new Set();

    state.bullets.forEach((target) => {
        activeIds.add(target.id);
        const cached = state.bulletRenderCache[target.id];
        if (!cached) {
            state.bulletRenderCache[target.id] = {
                ...target
            };
            return;
        }

        cached.x += (target.x - cached.x) * 0.5;
        cached.y += (target.y - cached.y) * 0.5;
        cached.radius = target.radius;
        cached.ownerId = target.ownerId;
    });

    Object.keys(state.bulletRenderCache).forEach((id) => {
        if (!activeIds.has(id)) {
            delete state.bulletRenderCache[id];
        }
    });
}

function isBlocked(x, y, radius) {
    return state.map.obstacles.some((r) => {
        const cx = Math.max(r.x, Math.min(x, r.x + r.w));
        const cy = Math.max(r.y, Math.min(y, r.y + r.h));
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= radius * radius;
    });
}

function desiredMovement() {
    let dx = 0;
    let dy = 0;
    if (keys.ArrowUp || keys.w || keys.W) dy -= 1;
    if (keys.ArrowDown || keys.s || keys.S) dy += 1;
    if (keys.ArrowLeft || keys.a || keys.A) dx -= 1;
    if (keys.ArrowRight || keys.d || keys.D) dx += 1;

    dx += state.touchVector.x;
    dy += state.touchVector.y;

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { dx: dx / len, dy: dy / len, active: Math.abs(dx) + Math.abs(dy) > 0.01 };
}

function sendMovement() {
    if (!state.gameStarted || state.matchEnded) return;
    const me = getMe();
    if (!me) return;

    const move = desiredMovement();
    const speed = 4.8;

    let x = me.x;
    let y = me.y;

    if (move.active) {
        x = Math.max(15, Math.min(state.map.width - 15, me.x + move.dx * speed));
        y = Math.max(15, Math.min(state.map.height - 15, me.y + move.dy * speed));
        if (isBlocked(x, y, 15)) {
            x = me.x;
            y = me.y;
        }
        state.localAim = Math.atan2(move.dy, move.dx);
    }

    // Client-side prediction keeps controls responsive while waiting for server updates.
    me.x = x;
    me.y = y;
    me.angle = state.localAim || me.angle || 0;

    socket.emit('playerMove', { x, y, angle: state.localAim || me.angle || 0 });
}

function shoot() {
    if (!state.gameStarted || state.matchEnded) return;
    const me = getMe();
    if (!me) return;
    socket.emit('shoot', { angle: state.localAim || me.angle || 0 });
    playTone(440, 0.04, 0.03);
}

function loop() {
    sendMovement();
    updateBulletInterpolation();
    updateParticles();
    drawArena();
    hideOverlayIfExpired();
    requestAnimationFrame(loop);
}

function syncPlayers(players) {
    const incoming = players || [];
    state.players = incoming.map((nextPlayer) => {
        const prev = state.players.find((p) => p.id === nextPlayer.id);
        if (!prev) return nextPlayer;

        const isMe = nextPlayer.id === state.playerId;
        const blend = isMe ? 0.55 : 0.28;

        return {
            ...nextPlayer,
            x: prev.x + (nextPlayer.x - prev.x) * blend,
            y: prev.y + (nextPlayer.y - prev.y) * blend,
            angle: prev.angle + (nextPlayer.angle - prev.angle) * 0.35
        };
    });
    updateHud();
}

function applyMap(map) {
    if (!map) return;
    state.map.width = map.width || state.map.width;
    state.map.height = map.height || state.map.height;
    state.map.obstacles = map.obstacles || state.map.obstacles;
}

function updateReadyButton(players) {
    const me = players.find((p) => p.id === state.playerId);
    if (!me) return;
    state.ready = Boolean(me.ready);
    readyBtn.textContent = me.ready ? 'Ready: Yes' : 'Ready Up';
    readyBtn.disabled = players.length < 2;
}

function connectAndJoin(roomName) {
    const playerName = nameInput.value.trim() || 'Pilot';
    const weapon = weaponSelect.value;
    const roomCode = roomName.trim().toUpperCase();
    roomInput.value = roomCode;
    socket.emit('joinRoom', { roomName: roomCode, playerName, weapon });
}

createRoomBtn.addEventListener('click', () => {
    setStatus('Creating room...', 'info');
    socket.emit('createRoom', {
        playerName: nameInput.value.trim() || 'Pilot',
        weapon: weaponSelect.value
    });
});

joinBtn.addEventListener('click', () => {
    const roomCode = roomInput.value.trim();
    if (!roomCode) {
        setStatus('Enter a room code first.', 'error');
        return;
    }
    connectAndJoin(roomCode);
});

readyBtn.addEventListener('click', () => {
    state.ready = !state.ready;
    socket.emit('setReady', { ready: state.ready });
});

rematchBtn.addEventListener('click', () => {
    socket.emit('rematchVote');
    rematchBtn.disabled = true;
    rematchBtn.textContent = 'Vote Sent';
});

playAgainBtn.addEventListener('click', () => {
    location.reload();
});

weaponSelect.addEventListener('change', () => {
    socket.emit('switchWeapon', { weapon: weaponSelect.value });
});

window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.key === ' ') {
        e.preventDefault();
        shoot();
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const my = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const me = getMe();
    if (!me) return;
    state.localAim = Math.atan2(my - me.y, mx - me.x);
});

function handleJoystickMove(clientX, clientY) {
    const dx = clientX - state.joystickCenter.x;
    const dy = clientY - state.joystickCenter.y;
    const radius = 40;
    const distance = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
    const angle = Math.atan2(dy, dx);

    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    joystickStick.style.transform = `translate(${x}px, ${y}px)`;
    state.touchVector.x = x / radius;
    state.touchVector.y = y / radius;
}

joystickBase.addEventListener('pointerdown', (e) => {
    state.joystickActive = true;
    state.joystickPointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    const rect = joystickBase.getBoundingClientRect();
    state.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
    handleJoystickMove(e.clientX, e.clientY);
});

window.addEventListener('pointermove', (e) => {
    if (!state.joystickActive) return;
    if (e.pointerId !== state.joystickPointerId) return;
    handleJoystickMove(e.clientX, e.clientY);
});

function releaseJoystick(pointerId) {
    if (!state.joystickActive) return;
    if (pointerId !== state.joystickPointerId) return;
    state.joystickActive = false;
    state.joystickPointerId = null;
    joystickStick.style.transform = 'translate(0, 0)';
    state.touchVector.x = 0;
    state.touchVector.y = 0;
}

window.addEventListener('pointerup', (e) => {
    releaseJoystick(e.pointerId);
});

window.addEventListener('pointercancel', (e) => {
    releaseJoystick(e.pointerId);
});

fireBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    shoot();
    if (fireHoldTimer) clearInterval(fireHoldTimer);
    fireHoldTimer = setInterval(shoot, 180);
});

fireBtn.addEventListener('pointerup', () => {
    if (fireHoldTimer) {
        clearInterval(fireHoldTimer);
        fireHoldTimer = null;
    }
});

fireBtn.addEventListener('pointercancel', () => {
    if (fireHoldTimer) {
        clearInterval(fireHoldTimer);
        fireHoldTimer = null;
    }
});

document.addEventListener('touchmove', (e) => {
    if (!gameScreen.classList.contains('active')) return;
    e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', () => {
    if (fireHoldTimer) {
        clearInterval(fireHoldTimer);
        fireHoldTimer = null;
    }
});

socket.on('connect', () => {
    state.connected = true;
    state.playerId = socket.id;
    setStatus('Connected. Create a room or join one.', 'ok');
});

socket.on('status', ({ message, kind }) => setStatus(message, kind));

socket.on('roomCreated', ({ roomCode }) => {
    roomInput.value = roomCode;
    showOverlay(`Room ${roomCode} created`);
    setStatus(`Room ${roomCode} created. Joining now...`, 'ok');
    connectAndJoin(roomCode);
});

socket.on('preFill', ({ roomCode, playerName, weapon }) => {
    roomInput.value = roomCode;
    if (playerName) nameInput.value = playerName;
    if (weapon) weaponSelect.value = weapon;
});

socket.on('joinedRoom', (payload) => {
    state.roomName = payload.roomName;
    state.roomCode = payload.roomName;
    state.roundsToWin = payload.roundsToWin || 3;
    applyMap(payload.map);
    readyBtn.disabled = false;
    setStatus(`Joined ${state.roomCode}. Waiting for ready players...`, 'ok');
});

socket.on('roomState', (payload) => {
    state.roomName = payload.roomName;
    state.roomCode = payload.roomCode;
    state.roundNumber = payload.roundNumber || 0;
    applyMap(payload.map);
    syncPlayers(payload.players || []);
    updateReadyButton(payload.players || []);

    const me = getMe();
    if (me) {
        weaponSelect.value = me.weapon || weaponSelect.value;
    }
});

socket.on('roundCountdown', ({ seconds, roundNumber }) => {
    state.roundNumber = roundNumber;
    state.matchEnded = false;
    joinScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    gameScreen.classList.add('active');
    showOverlay(`Round ${roundNumber} starts in ${seconds}...`, 2900);
    playTone(520, 0.08, 0.04);
});

socket.on('roundStart', ({ roundNumber, players, map }) => {
    state.gameStarted = true;
    state.roundNumber = roundNumber;
    applyMap(map);
    syncPlayers(players || []);
    showOverlay(`Round ${roundNumber} live`, 1000);
});

socket.on('stateUpdate', ({ players, bullets }) => {
    syncPlayers(players || []);
    state.bullets = bullets || [];
});

socket.on('bulletFired', () => {
    playTone(380, 0.03, 0.02);
});

socket.on('playerHit', ({ targetId, health, hitX, hitY }) => {
    const target = state.players.find((p) => p.id === targetId);
    if (target) target.health = health;
    if (typeof hitX === 'number' && typeof hitY === 'number') {
        spawnHitParticles(hitX, hitY);
    }
    playTone(140, 0.06, 0.05);
    updateHud();
});

socket.on('roundEnd', ({ winnerId, scores }) => {
    state.gameStarted = false;
    syncPlayers(scores || state.players);
    showOverlay(winnerId === state.playerId ? 'Round won' : 'Round lost', 1300);
});

socket.on('gameOver', ({ winnerId, scores }) => {
    state.gameStarted = false;
    state.matchEnded = true;
    syncPlayers(scores || state.players);

    gameOverTitle.textContent = winnerId === state.playerId ? 'MATCH WON' : 'MATCH LOST';
    gameOverMessage.textContent = `First to ${state.roundsToWin} rounds wins. Vote rematch to play again.`;

    rematchBtn.disabled = false;
    rematchBtn.textContent = 'Vote Rematch';
    gameOverScreen.classList.add('active');
});

socket.on('rematchState', ({ votes, needed }) => {
    gameOverMessage.textContent = `Rematch votes: ${votes}/${needed}`;
});

socket.on('opponentDisconnected', () => {
    showOverlay('Opponent disconnected');
    setStatus('Opponent disconnected. You can wait for another player.', 'error');
    state.gameStarted = false;
});

fetch('/api/leaderboard')
    .then((res) => res.json())
    .then((data) => {
        leaderboardList.innerHTML = '';
        const items = data.leaderboard || [];
        if (items.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No matches yet';
            leaderboardList.appendChild(li);
            return;
        }

        items.forEach((row) => {
            const li = document.createElement('li');
            li.textContent = `${row.name} - ${row.wins}W/${row.losses}L, ${row.hits} hits`;
            leaderboardList.appendChild(li);
        });
    })
    .catch(() => {
        leaderboardList.innerHTML = '<li>Leaderboard unavailable</li>';
    });

loop();
