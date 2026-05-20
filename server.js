import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();

const io = new Server(httpServer, {
    cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] }
});

const STONE_TYPES = { SPACE: 'SPACE', MIND: 'MIND', REALITY: 'REALITY', POWER: 'POWER', TIME: 'TIME' };
const WALL_ORDER = [
    ['SPACE','MIND','REALITY','POWER','TIME'],
    ['TIME','SPACE','MIND','REALITY','POWER'],
    ['POWER','TIME','SPACE','MIND','REALITY'],
    ['REALITY','POWER','TIME','SPACE','MIND'],
    ['MIND','REALITY','POWER','TIME','SPACE'],
];

const createEmptyPlayer = (id) => ({
    id,
    patternLines: Array(5).fill(null).map((_, i) => Array(i + 1).fill(null)),
    wall: Array(5).fill(null).map(() => Array(5).fill(null)),
    floorLine: [],
    score: 0,
});

const calculatePoints = (wall, row, col) => {
    let h = 0, v = 0;
    for (let i = col+1; i < 5 && wall[row][i]; i++) h++;
    for (let i = col-1; i >= 0 && wall[row][i]; i--) h++;
    for (let i = row+1; i < 5 && wall[i][col]; i++) v++;
    for (let i = row-1; i >= 0 && wall[i][col]; i--) v++;
    return 1 + (h > 0 ? h : 0) + (v > 0 ? v : 0);
};

let lobby = { players: [], status: 'waiting' };
let gameState = null;

const initGame = () => {
    let bag = [];
    Object.values(STONE_TYPES).forEach(t => { for(let i=0;i<20;i++) bag.push(t); });
    bag = bag.sort(() => Math.random() - 0.5);
    return {
        factories: Array(5).fill(null).map(() => bag.splice(0, 4)),
        center: [],
        players: [createEmptyPlayer(1), createEmptyPlayer(2)],
        currentPlayerId: 1,
        nextFirstPlayerId: 1,
        heldStones: null,
        firstStonePicked: false,
        gameState: 'PLAYING',
        bag,
        discard: [],
    };
};

io.on('connection', (socket) => {
    socket.emit('lobby_state', lobby);
    if (gameState) socket.emit('game_update', gameState);

    socket.on('request_state', () => {
        if (gameState) socket.emit('game_update', gameState);
    });

    socket.on('join_game', () => {
        if (lobby.players.length >= 2) return;
        const playerIndex = lobby.players.length + 1;
        lobby.players.push({ id: socket.id, index: playerIndex });
        socket.emit('your_index', playerIndex);

        if (lobby.players.length === 2) {
            lobby.status = 'playing';
            gameState = initGame();
            io.emit('lobby_state', lobby);
            io.emit('game_update', gameState);
        } else {
            io.emit('lobby_state', lobby);
        }
    });

    socket.on('pick_from_factory', ({ factoryIndex, stoneType }) => {
        if (!gameState || gameState.gameState !== 'PLAYING') return;
        const player = lobby.players.find(p => p.id === socket.id);
        if (!player || player.index !== gameState.currentPlayerId) return;

        gameState.center.push(...gameState.factories[factoryIndex].filter(s => s !== stoneType));
        const picked = gameState.factories[factoryIndex].filter(s => s === stoneType);
        gameState.factories[factoryIndex] = [];
        gameState.heldStones = { type: stoneType, count: picked.length };
        io.emit('game_update', gameState);
    });

    socket.on('pick_from_center', ({ stoneType }) => {
        if (!gameState || gameState.gameState !== 'PLAYING') return;
        const player = lobby.players.find(p => p.id === socket.id);
        if (!player || player.index !== gameState.currentPlayerId) return;

        const p = gameState.players.find(p => p.id === gameState.currentPlayerId);
        if (!gameState.firstStonePicked) {
            if (p.floorLine.length < 7) p.floorLine.push('FIRST_PLAYER');
            gameState.firstStonePicked = true;
            gameState.nextFirstPlayerId = gameState.currentPlayerId;
        }
        gameState.center = gameState.center.filter(s => s !== stoneType);
        const picked = gameState.center.filter(s => s === stoneType);
        gameState.heldStones = { type: stoneType, count: picked.length === 0 ? gameState.center.filter(s => s === stoneType).length || 1 : picked.length };

        // recalcul propre
        const allCenter = [...gameState.center, stoneType]; // on repart du centre avant suppression
        const countPicked = allCenter.filter(s => s === stoneType).length;
        gameState.center = allCenter.filter(s => s !== stoneType);
        gameState.heldStones = { type: stoneType, count: countPicked };

        io.emit('game_update', gameState);
    });

    socket.on('place_stones', ({ lineIndex }) => {
        if (!gameState || gameState.gameState !== 'PLAYING') return;
        const player = lobby.players.find(p => p.id === socket.id);
        if (!player || player.index !== gameState.currentPlayerId) return;
        if (!gameState.heldStones) return;

        const p = gameState.players.find(p => p.id === gameState.currentPlayerId);
        const { type, count } = gameState.heldStones;
        const line = p.patternLines[lineIndex];
        const colInWall = WALL_ORDER[lineIndex].indexOf(type);
        const hasDiff = line.some(s => s !== null && s !== type);
        const inWall = p.wall[lineIndex][colInWall] !== null;
        let remaining = count;

        if (hasDiff || inWall) {
            while (remaining > 0 && p.floorLine.length < 7) { p.floorLine.push(type); remaining--; }
            if (remaining > 0) gameState.discard.push(...Array(remaining).fill(type));
        } else {
            for (let i = line.length - 1; i >= 0 && remaining > 0; i--) {
                if (line[i] === null) { line[i] = type; remaining--; }
            }
            while (remaining > 0 && p.floorLine.length < 7) { p.floorLine.push(type); remaining--; }
            if (remaining > 0) gameState.discard.push(...Array(remaining).fill(type));
        }
        gameState.heldStones = null;

        const factoriesEmpty = gameState.factories.every(f => f.length === 0) && gameState.center.length === 0;
        if (factoriesEmpty) {
            gameState.players.forEach(pl => {
                pl.patternLines.forEach((l, row) => {
                    if (l.every(s => s !== null)) {
                        const stone = l[0];
                        const col = WALL_ORDER[row].indexOf(stone);
                        pl.wall[row][col] = stone;
                        pl.score += calculatePoints(pl.wall, row, col);
                        gameState.discard.push(...l.slice(1));
                        pl.patternLines[row] = Array(row + 1).fill(null);
                    }
                });
                const penalties = [-1,-1,-2,-2,-2,-3,-3];
                pl.floorLine.forEach((item, i) => {
                    pl.score = Math.max(0, pl.score + (penalties[i] || -3));
                    if (item !== 'FIRST_PLAYER') gameState.discard.push(item);
                });
                pl.floorLine = [];
            });

            if (gameState.players.some(pl => pl.wall.some(row => row.every(c => c !== null)))) {
                gameState.players.forEach(pl => {
                    pl.wall.forEach(row => { if (row.every(c => c !== null)) pl.score += 2; });
                    for (let c = 0; c < 5; c++) { if (pl.wall.every(r => r[c] !== null)) pl.score += 7; }
                    Object.values(STONE_TYPES).forEach(t => { if (pl.wall.every(row => row.includes(t))) pl.score += 10; });
                });
                gameState.gameState = 'GAME_OVER';
            } else {
                if (gameState.bag.length < 20) {
                    gameState.bag = [...gameState.bag, ...gameState.discard].sort(() => Math.random() - 0.5);
                    gameState.discard = [];
                }
                gameState.factories = Array(5).fill(null).map(() => gameState.bag.splice(0, 4));
                gameState.firstStonePicked = false;
                gameState.currentPlayerId = gameState.nextFirstPlayerId;
            }
        } else {
            gameState.currentPlayerId = gameState.currentPlayerId === 1 ? 2 : 1;
        }

        io.emit('game_update', gameState);
    });

    socket.on('disconnect', () => {
        lobby.players = lobby.players.filter(p => p.id !== socket.id);
        lobby.status = 'waiting';
        gameState = null;
        io.emit('lobby_state', lobby);
    });
});

httpServer.listen(3001, () => console.log('Serveur Azul sur http://localhost:3001'));