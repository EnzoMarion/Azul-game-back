import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();

const io = new Server(httpServer, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST']
    }
});

let gameState = {
    players: [],
    board: null,
    currentTurn: null,
};

io.on('connection', (socket) => {
    socket.emit('game_state', gameState);

    socket.on('join_game', (playerName) => {
        if (gameState.players.length < 2) {
            gameState.players.push({ id: socket.id, name: playerName });
            io.emit('game_state', gameState);
        }
    });

    socket.on('play_turn', (data) => {
        gameState.currentTurn = data;
        io.emit('game_state', gameState);
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        io.emit('game_state', gameState);
    });
});

httpServer.listen(3001, () => {
    console.log('Serveur Azul sur http://localhost:3001');
});