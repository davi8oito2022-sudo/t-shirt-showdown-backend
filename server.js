// server.js - Backend para T-Shirt Showdown
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Armazenamento em memória
const rooms = new Map();
const players = new Map();

// Gerar código da sala
const generateRoomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

io.on('connection', (socket) => {
    console.log('🔌 Novo jogador conectado:', socket.id);

    // Criar sala
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        const player = {
            id: socket.id,
            name: data.playerName,
            isHost: true
        };

        const room = {
            code: roomCode,
            host: socket.id,
            players: [player],
            gameState: 'waiting',
            drawings: [],
            slogans: []
        };

        rooms.set(roomCode, room);
        players.set(socket.id, { ...player, roomCode });

        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, playerId: socket.id });
        
        console.log(`🚪 Sala ${roomCode} criada por ${data.playerName}`);
    });

    // Entrar em sala
    socket.on('joinRoom', (data) => {
        const room = rooms.get(data.roomCode);
        
        if (!room) {
            socket.emit('error', 'Sala não encontrada!');
            return;
        }

        if (room.players.length >= 8) {
            socket.emit('error', 'Sala cheia! Máximo 8 jogadores.');
            return;
        }

        const player = {
            id: socket.id,
            name: data.playerName,
            isHost: false
        };

        room.players.push(player);
        players.set(socket.id, { ...player, roomCode: data.roomCode });
        socket.join(data.roomCode);

        socket.emit('roomJoined', {
            roomCode: data.roomCode,
            players: room.players,
            playerId: socket.id
        });

        // Notificar todos
        io.to(data.roomCode).emit('playerJoined', player);
        console.log(`🎮 ${data.playerName} entrou na sala ${data.roomCode}`);
    });

    // Iniciar jogo
    socket.on('startGame', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room || room.host !== socket.id) return;

        if (room.players.length < 2) {
            socket.emit('error', 'Mínimo 2 jogadores!');
            return;
        }

        room.gameState = 'drawing';
        io.to(data.roomCode).emit('gameStarting', { countdown: 3 });
        
        let countdown = 3;
        const timer = setInterval(() => {
            countdown--;
            io.to(data.roomCode).emit('countdownUpdate', { countdown });
            
            if (countdown <= 0) {
                clearInterval(timer);
                io.to(data.roomCode).emit('phaseUpdate', { phase: 'drawing', timer: 90 });
            }
        }, 1000);
    });

    // Enviar desenho
    socket.on('submitDrawing', (data) => {
        const player = players.get(socket.id);
        if (!player) return;

        const room = rooms.get(player.roomCode);
        if (!room) return;

        room.drawings.push({
            playerId: socket.id,
            drawing: data.drawing,
            timestamp: Date.now()
        });

        io.to(room.code).emit('drawingReceived', {
            player: player.name,
            total: room.drawings.length
        });
    });

    // Enviar slogan
    socket.on('submitSlogan', (data) => {
        const player = players.get(socket.id);
        if (!player) return;

        const room = rooms.get(player.roomCode);
        if (!room) return;

        room.slogans.push({
            playerId: socket.id,
            slogan: data.slogan,
            timestamp: Date.now()
        });

        io.to(room.code).emit('sloganReceived', {
            player: player.name,
            total: room.slogans.length
        });
    });

    // Chat
    socket.on('chatMessage', (data) => {
        const player = players.get(socket.id);
        if (!player) return;

        io.to(player.roomCode).emit('chatMessage', {
            player: player.name,
            message: data.message,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        });
    });

    // Desconectar
    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (!player) return;

        const room = rooms.get(player.roomCode);
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.host === socket.id && room.players.length > 0) {
                room.host = room.players[0].id;
                room.players[0].isHost = true;
                io.to(room.code).emit('newHost', room.players[0]);
            }

            if (room.players.length === 0) {
                rooms.delete(room.code);
            } else {
                io.to(room.code).emit('playerLeft', socket.id);
            }
        }

        players.delete(socket.id);
        console.log(`❌ ${socket.id} desconectado`);
    });
});

// Rotas HTTP
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        rooms: rooms.size,
        players: players.size,
        uptime: process.uptime()
    });
});

app.get('/stats', (req, res) => {
    res.json({
        totalRooms: rooms.size,
        totalPlayers: players.size,
        activeRooms: Array.from(rooms.entries()).map(([code, room]) => ({
            code,
            players: room.players.length,
            state: room.gameState
        }))
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
