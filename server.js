// ============================================
// MULTIPLAYER GAME SERVER
// This file runs on your computer and controls the game
// ============================================

// Import the libraries we installed
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// Create the web server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Tell the server to serve files from the 'public' folder
// This means when you open http://localhost:3000, it shows index.html
app.use(express.static('public'));

// Store game rooms and players
const rooms = {};

// When a player connects
io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  // Listen for when a player wants to join a room
  socket.on('joinRoom', (roomName) => {
    // Create room if it doesn't exist
    if (!rooms[roomName]) {
      rooms[roomName] = {
        players: {},
        gameStarted: false
      };
    }

    // Add player to room
    rooms[roomName].players[socket.id] = {
      id: socket.id,
      x: Math.random() * 600,
      y: Math.random() * 400,
      angle: 0,
      health: 5,
      bullets: []
    };

    // Join the socket to this room
    socket.join(roomName);
    socket.roomName = roomName;

    console.log(`Player ${socket.id} joined room: ${roomName}`);
    console.log(`Players in room: ${Object.keys(rooms[roomName].players).length}`);

    // Tell all players in this room who's in the game
    io.to(roomName).emit('playerList', Object.keys(rooms[roomName].players));

    // If 2 players, start the game
    if (Object.keys(rooms[roomName].players).length === 2) {
      rooms[roomName].gameStarted = true;
      io.to(roomName).emit('gameStart');
    }
  });

  // Listen for player movement
  socket.on('playerMove', (data) => {
    if (rooms[socket.roomName] && rooms[socket.roomName].players[socket.id]) {
      rooms[socket.roomName].players[socket.id].x = data.x;
      rooms[socket.roomName].players[socket.id].y = data.y;
      rooms[socket.roomName].players[socket.id].angle = data.angle;

      // Send updated position to other players in the room
      socket.broadcast.to(socket.roomName).emit('opponentMove', {
        id: socket.id,
        x: data.x,
        y: data.y,
        angle: data.angle
      });
    }
  });

  // Listen for bullets being fired
  socket.on('shoot', (bullet) => {
    if (rooms[socket.roomName]) {
      // Send bullet to other players
      socket.broadcast.to(socket.roomName).emit('opponentBullet', {
        id: socket.id,
        bullet: bullet
      });
    }
  });

  // Listen for hit detection (when a bullet hits a player)
  socket.on('hit', (data) => {
    if (rooms[socket.roomName] && rooms[socket.roomName].players[data.targetId]) {
      // Reduce health of hit player
      rooms[socket.roomName].players[data.targetId].health -= 1;

      // Tell the hit player they got hit
      io.to(socket.roomName).emit('playerHit', {
        targetId: data.targetId,
        health: rooms[socket.roomName].players[data.targetId].health
      });

      // Check if someone won
      if (rooms[socket.roomName].players[data.targetId].health <= 0) {
        io.to(socket.roomName).emit('gameOver', {
          winnerId: socket.id,
          loserId: data.targetId
        });
      }
    }
  });

  // Listen for when a player disconnects
  socket.on('disconnect', () => {
    console.log('A player disconnected:', socket.id);

    if (socket.roomName && rooms[socket.roomName]) {
      delete rooms[socket.roomName].players[socket.id];

      // Tell remaining player that opponent left
      io.to(socket.roomName).emit('opponentDisconnected');

      // Clean up empty rooms
      if (Object.keys(rooms[socket.roomName].players).length === 0) {
        delete rooms[socket.roomName];
      }
    }
  });
});

// Start the server on a hosting-compatible port and interface
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game Server running on port ${PORT}`);
  console.log('Open this URL in your browser to play!');
});
