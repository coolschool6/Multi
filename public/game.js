// ============================================
// MULTIPLAYER GAME CLIENT
// This runs in your browser and handles the game logic
// ============================================

// ============================================
// CONNECTION & ROOM SETUP
// ============================================

// Create a connection to the server
const RENDER_SERVER_URL = 'https://multiplayer-shooter-game.onrender.com';
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const socket = isLocalDev ? io() : io(RENDER_SERVER_URL);

// Variables to track game state
let gameState = {
    roomName: '',
    playerId: '',
    playerCount: 0,
    gameStarted: false,
    myPlayer: null,
    opponent: null,
    myBullets: [],
    opponentBullets: []
};

// HTML Elements
const joinScreen = document.getElementById('joinScreen');
const gameScreen = document.getElementById('gameScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const statusDiv = document.getElementById('status');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playAgainBtn = document.getElementById('playAgainBtn');

// ============================================
// BUTTON CLICK HANDLERS
// ============================================

joinBtn.addEventListener('click', () => {
    const roomName = roomInput.value.trim();
    
    if (!roomName) {
        statusDiv.textContent = 'Please enter a room name!';
        statusDiv.style.color = '#ff6b6b';
        return;
    }

    gameState.roomName = roomName;
    statusDiv.textContent = 'Connecting to room...';
    statusDiv.style.color = '#ffff00';
    
    // Tell the server we want to join this room
    socket.emit('joinRoom', roomName);
});

playAgainBtn.addEventListener('click', () => {
    // Reset and go back to join screen
    location.reload();
});

// ============================================
// SOCKET EVENTS (Messages from the server)
// ============================================

// When we successfully get our player ID
socket.on('connect', () => {
    gameState.playerId = socket.id;
    console.log('Connected to server with ID:', gameState.playerId);
});

// When we get the list of players in our room
socket.on('playerList', (players) => {
    gameState.playerCount = players.length;
    statusDiv.textContent = `Waiting for opponent... (${gameState.playerCount}/2)`;
    console.log('Players in room:', players);
});

// When the game officially starts (2 players present)
socket.on('gameStart', () => {
    console.log('Game started!');
    gameState.gameStarted = true;
    
    // Hide join screen, show game screen
    joinScreen.classList.remove('active');
    gameScreen.classList.add('active');
    
    // Initialize players
    gameState.myPlayer = {
        id: gameState.playerId,
        x: 100,
        y: 300,
        angle: 0,
        velocityX: 0,
        velocityY: 0,
        radius: 15,
        health: 5,
        speed: 5
    };

    gameState.opponent = {
        id: '',
        x: 700,
        y: 300,
        angle: 0,
        radius: 15,
        health: 5
    };

    // Start the game loop
    gameLoop();
});

// When opponent moves
socket.on('opponentMove', (data) => {
    if (gameState.opponent) {
        gameState.opponent.x = data.x;
        gameState.opponent.y = data.y;
        gameState.opponent.angle = data.angle;
    }
});

// When opponent shoots
socket.on('opponentBullet', (data) => {
    gameState.opponentBullets.push({
        x: data.bullet.x,
        y: data.bullet.y,
        velocityX: data.bullet.velocityX,
        velocityY: data.bullet.velocityY,
        radius: 5,
        shooterId: data.id
    });
});

// When we or opponent gets hit
socket.on('playerHit', (data) => {
    if (data.targetId === gameState.playerId) {
        // We got hit
        gameState.myPlayer.health = data.health;
        console.log('You got hit! Health:', data.health);
    } else if (gameState.opponent && data.targetId === gameState.opponent.id) {
        // Opponent got hit
        gameState.opponent.health = data.health;
        console.log('Hit opponent! Health:', data.health);
    }

    // Update UI
    document.getElementById('yourHealth').textContent = gameState.myPlayer.health;
    document.getElementById('opponentHealth').textContent = gameState.opponent.health;
});

// When game is over
socket.on('gameOver', (data) => {
    gameState.gameStarted = false;
    const gameOverTitle = document.getElementById('gameOverTitle');
    const gameOverMessage = document.getElementById('gameOverMessage');

    if (data.winnerId === gameState.playerId) {
        gameOverTitle.textContent = 'YOU WON!';
        gameOverTitle.style.color = '#00ff00';
        gameOverMessage.textContent = 'Congratulations, you eliminated your opponent!';
    } else {
        gameOverTitle.textContent = 'GAME OVER';
        gameOverTitle.style.color = '#ff6b6b';
        gameOverMessage.textContent = 'You were eliminated. Better luck next time!';
    }

    // Show game over screen
    gameScreen.classList.remove('active');
    gameOverScreen.classList.add('active');
});

// When opponent disconnects
socket.on('opponentDisconnected', () => {
    alert('Opponent disconnected! Game over.');
    location.reload();
});

// ============================================
// KEYBOARD INPUT HANDLING
// ============================================

const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.key] = true;

    // Spacebar to shoot
    if (e.key === ' ') {
        e.preventDefault();
        shoot();
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

// ============================================
// GAME FUNCTIONS
// ============================================

function shoot() {
    if (!gameState.gameStarted || !gameState.myPlayer) return;

    const bullet = {
        x: gameState.myPlayer.x + Math.cos(gameState.myPlayer.angle) * 20,
        y: gameState.myPlayer.y + Math.sin(gameState.myPlayer.angle) * 20,
        velocityX: Math.cos(gameState.myPlayer.angle) * 7,
        velocityY: Math.sin(gameState.myPlayer.angle) * 7,
        radius: 5,
        shooterId: gameState.playerId
    };

    gameState.myBullets.push(bullet);

    // Tell server we shot
    socket.emit('shoot', bullet);
}

function updatePlayer() {
    if (!gameState.myPlayer) return;

    // Reset velocity each frame
    gameState.myPlayer.velocityX = 0;
    gameState.myPlayer.velocityY = 0;

    // Handle arrow key movement
    if (keys['ArrowUp']) gameState.myPlayer.velocityY -= gameState.myPlayer.speed;
    if (keys['ArrowDown']) gameState.myPlayer.velocityY += gameState.myPlayer.speed;
    if (keys['ArrowLeft']) gameState.myPlayer.velocityX -= gameState.myPlayer.speed;
    if (keys['ArrowRight']) gameState.myPlayer.velocityX += gameState.myPlayer.speed;

    // Update position
    gameState.myPlayer.x += gameState.myPlayer.velocityX;
    gameState.myPlayer.y += gameState.myPlayer.velocityY;

    // Keep player on screen
    gameState.myPlayer.x = Math.max(gameState.myPlayer.radius, Math.min(canvas.width - gameState.myPlayer.radius, gameState.myPlayer.x));
    gameState.myPlayer.y = Math.max(gameState.myPlayer.radius, Math.min(canvas.height - gameState.myPlayer.radius, gameState.myPlayer.y));

    // Calculate angle to face mouse (or movement direction)
    if (gameState.myPlayer.velocityX !== 0 || gameState.myPlayer.velocityY !== 0) {
        gameState.myPlayer.angle = Math.atan2(gameState.myPlayer.velocityY, gameState.myPlayer.velocityX);
    }

    // Send updated position to server
    socket.emit('playerMove', {
        x: gameState.myPlayer.x,
        y: gameState.myPlayer.y,
        angle: gameState.myPlayer.angle
    });
}

function updateBullets() {
    // Update my bullets
    gameState.myBullets = gameState.myBullets.filter(bullet => {
        bullet.x += bullet.velocityX;
        bullet.y += bullet.velocityY;

        // Remove if off screen
        return bullet.x > 0 && bullet.x < canvas.width && bullet.y > 0 && bullet.y < canvas.height;
    });

    // Update opponent bullets
    gameState.opponentBullets = gameState.opponentBullets.filter(bullet => {
        bullet.x += bullet.velocityX;
        bullet.y += bullet.velocityY;

        // Remove if off screen
        return bullet.x > 0 && bullet.x < canvas.width && bullet.y > 0 && bullet.y < canvas.height;
    });
}

function checkCollisions() {
    if (!gameState.myPlayer || !gameState.opponent) return;

    // Check if opponent bullets hit us
    gameState.opponentBullets.forEach((bullet, index) => {
        const dist = Math.sqrt(
            Math.pow(bullet.x - gameState.myPlayer.x, 2) +
            Math.pow(bullet.y - gameState.myPlayer.y, 2)
        );

        if (dist < bullet.radius + gameState.myPlayer.radius) {
            // We got hit!
            gameState.opponentBullets.splice(index, 1);
            socket.emit('hit', { targetId: gameState.playerId });
        }
    });

    // Check if our bullets hit opponent
    gameState.myBullets.forEach((bullet, index) => {
        const dist = Math.sqrt(
            Math.pow(bullet.x - gameState.opponent.x, 2) +
            Math.pow(bullet.y - gameState.opponent.y, 2)
        );

        if (dist < bullet.radius + gameState.opponent.radius) {
            // We hit opponent!
            gameState.myBullets.splice(index, 1);
            socket.emit('hit', { targetId: gameState.opponent.id });
        }
    });
}

// ============================================
// RENDERING (Drawing)
// ============================================

function drawPlayer(player, isMe = false) {
    if (!player) return;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    // Draw ship body (triangle)
    ctx.fillStyle = isMe ? '#00ff00' : '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();

    // Draw cockpit
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(5, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Draw health bar above player
    const healthBarWidth = 40;
    const healthBarHeight = 5;
    const healthPercent = player.health / 5;

    ctx.fillStyle = '#333';
    ctx.fillRect(player.x - healthBarWidth / 2, player.y - 30, healthBarWidth, healthBarHeight);

    ctx.fillStyle = healthPercent > 0.4 ? '#00ff00' : '#ff6b6b';
    ctx.fillRect(player.x - healthBarWidth / 2, player.y - 30, healthBarWidth * healthPercent, healthBarHeight);

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.strokeRect(player.x - healthBarWidth / 2, player.y - 30, healthBarWidth, healthBarHeight);
}

function drawBullets() {
    // Draw my bullets (green)
    ctx.fillStyle = '#00ff00';
    gameState.myBullets.forEach(bullet => {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw opponent bullets (red)
    ctx.fillStyle = '#ff6b6b';
    gameState.opponentBullets.forEach(bullet => {
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawUI() {
    ctx.fillStyle = '#00ff00';
    ctx.font = '14px Arial';
    ctx.fillText('Arrow Keys to Move | Space to Shoot', 10, 30);
}

function render() {
    // Clear canvas (black background)
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid background
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
    }

    // Draw players
    drawPlayer(gameState.myPlayer, true);
    drawPlayer(gameState.opponent, false);

    // Draw bullets
    drawBullets();

    // Draw UI text
    drawUI();
}

// ============================================
// MAIN GAME LOOP
// ============================================

function gameLoop() {
    if (!gameState.gameStarted) return;

    // Update
    updatePlayer();
    updateBullets();
    checkCollisions();

    // Render
    render();

    // Call this function again next frame (60 FPS)
    requestAnimationFrame(gameLoop);
}

// ============================================
// INITIALIZATION
// ============================================

console.log('Game loaded and ready!');
