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
    id, patternLines: Array(5).fill(null).map((_, i) => Array(i+1).fill(null)),
    wall: Array(5).fill(null).map(() => Array(5).fill(null)),
    floorLine: [], score: 0,
});

const calculatePoints = (wall, row, col) => {
    let h = 0, v = 0;
    for (let i = col+1; i < 5 && wall[row][i]; i++) h++;
    for (let i = col-1; i >= 0 && wall[row][i]; i--) h++;
    for (let i = row+1; i < 5 && wall[i][col]; i++) v++;
    for (let i = row-1; i >= 0 && wall[i][col]; i--) v++;
    return 1 + (h > 0 ? h : 0) + (v > 0 ? v : 0);
};

const sortCenter = (gs) => {
    if (gs && gs.center) gs.center = [...gs.center].sort();
    return gs;
};

const endRound = (gs) => {
    gs.players.forEach(pl => {
        pl.patternLines.forEach((l, row) => {
            if (l.every(s => s !== null)) {
                const stone = l[0];
                const col = WALL_ORDER[row].indexOf(stone);
                pl.wall[row][col] = stone;
                pl.score += calculatePoints(pl.wall, row, col);
                gs.discard.push(...l.slice(1));
                pl.patternLines[row] = Array(row + 1).fill(null);
            }
        });
        const penalties = [-1,-1,-2,-2,-2,-3,-3];
        pl.floorLine.forEach((item, i) => {
            pl.score = Math.max(0, pl.score + (penalties[i] || -3));
            if (item !== 'FIRST_PLAYER') gs.discard.push(item);
        });
        pl.floorLine = [];
    });

    if (gs.players.some(pl => pl.wall.some(row => row.every(c => c !== null)))) {
        gs.players.forEach(pl => {
            pl.wall.forEach(row => { if (row.every(c => c !== null)) pl.score += 2; });
            for (let c = 0; c < 5; c++) { if (pl.wall.every(r => r[c] !== null)) pl.score += 7; }
            Object.values(STONE_TYPES).forEach(t => { if (pl.wall.every(row => row.includes(t))) pl.score += 10; });
        });
        gs.gameState = 'GAME_OVER';
    } else {
        if (gs.bag.length < 20) {
            gs.bag = [...gs.bag, ...gs.discard].sort(() => Math.random() - 0.5);
            gs.discard = [];
        }
        gs.factories = Array(5).fill(null).map(() => gs.bag.splice(0, 4));
        gs.firstStonePicked = false;
        gs.currentPlayerId = gs.nextFirstPlayerId;
    }
};

const rooms = new Map();
let roomCounter = 1;

const broadcastRoomList = () => {
    const list = Array.from(rooms.values()).map(r => ({
        id: r.id, name: r.name,
        playerCount: r.players.length,
        status: r.gameState ? r.gameState.gameState : 'WAITING',
    }));
    io.emit('room_list', list);
};

const initGameState = () => {
    let bag = [];
    Object.values(STONE_TYPES).forEach(t => { for(let i=0;i<20;i++) bag.push(t); });
    bag = bag.sort(() => Math.random() - 0.5);
    return {
        factories: Array(5).fill(null).map(() => bag.splice(0, 4)),
        center: [], players: [createEmptyPlayer(1), createEmptyPlayer(2)],
        currentPlayerId: 1, nextFirstPlayerId: 1,
        heldStones: null, firstStonePicked: false,
        gameState: 'PLAYING', bag, discard: [],
    };
};

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('request_rooms', () => {
        const list = Array.from(rooms.values()).map(r => ({
            id: r.id, name: r.name,
            playerCount: r.players.length,
            status: r.gameState ? r.gameState.gameState : 'WAITING',
        }));
        socket.emit('room_list', list);
    });

    socket.on('create_room', ({ pseudo }) => {
        const roomId = `room_${roomCounter++}`;
        const room = {
            id: roomId,
            name: `Partie de ${pseudo}`,
            players: [{ socketId: socket.id, pseudo, index: 1 }],
            gameState: null,
        };
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('your_index', 1);
        socket.emit('joined_room', roomId);
        broadcastRoomList();
    });

    socket.on('join_room', ({ roomId, pseudo }) => {
        const room = rooms.get(roomId);
        if (!room || room.players.length >= 2) return;
        room.players.push({ socketId: socket.id, pseudo, index: 2 });
        socket.join(roomId);
        socket.emit('your_index', 2);
        socket.emit('joined_room', roomId);
        room.gameState = initGameState();
        io.to(roomId).emit('game_update', sortCenter(room.gameState));
        broadcastRoomList();
    });

    socket.on('request_state', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room?.gameState) socket.emit('game_update', sortCenter(room.gameState));
    });

    socket.on('leave_room', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        room.players = room.players.filter(p => p.socketId !== socket.id);
        socket.leave(roomId);
        if (room.players.length === 0) rooms.delete(roomId);
        broadcastRoomList();
    });

    const getRoomBySocket = (socketId) =>
        Array.from(rooms.values()).find(r => r.players.some(p => p.socketId === socketId));

    const getPlayerInRoom = (room, socketId) =>
        room.players.find(p => p.socketId === socketId);

    socket.on('pick_from_factory', ({ factoryIndex, stoneType }) => {
        const room = getRoomBySocket(socket.id);
        if (!room?.gameState || room.gameState.gameState !== 'PLAYING') return;
        const player = getPlayerInRoom(room, socket.id);
        if (!player || player.index !== room.gameState.currentPlayerId) return;

        const gs = room.gameState;
        gs.center.push(...gs.factories[factoryIndex].filter(s => s !== stoneType));
        const count = gs.factories[factoryIndex].filter(s => s === stoneType).length;
        gs.factories[factoryIndex] = [];
        gs.heldStones = { type: stoneType, count };
        io.to(room.id).emit('game_update', sortCenter(gs));
    });

    socket.on('pick_from_center', ({ stoneType }) => {
        const room = getRoomBySocket(socket.id);
        if (!room?.gameState || room.gameState.gameState !== 'PLAYING') return;
        const player = getPlayerInRoom(room, socket.id);
        if (!player || player.index !== room.gameState.currentPlayerId) return;

        const gs = room.gameState;
        const p = gs.players.find(p => p.id === gs.currentPlayerId);
        if (!gs.firstStonePicked) {
            if (p.floorLine.length < 7) p.floorLine.push('FIRST_PLAYER');
            gs.firstStonePicked = true;
            gs.nextFirstPlayerId = gs.currentPlayerId;
        }
        const count = gs.center.filter(s => s === stoneType).length;
        gs.center = gs.center.filter(s => s !== stoneType);
        gs.heldStones = { type: stoneType, count };
        io.to(room.id).emit('game_update', sortCenter(gs));
    });

    socket.on('discard_to_floor', () => {
        const room = getRoomBySocket(socket.id);
        if (!room?.gameState || room.gameState.gameState !== 'PLAYING') return;
        const player = getPlayerInRoom(room, socket.id);
        if (!player || player.index !== room.gameState.currentPlayerId) return;

        const gs = room.gameState;
        if (!gs.heldStones) return;

        const p = gs.players.find(p => p.id === gs.currentPlayerId);
        const { type, count } = gs.heldStones;
        let remaining = count;

        while (remaining > 0 && p.floorLine.length < 7) {
            p.floorLine.push(type);
            remaining--;
        }
        if (remaining > 0) gs.discard.push(...Array(remaining).fill(type));
        gs.heldStones = null;

        const factoriesEmpty = gs.factories.every(f => f.length === 0) && gs.center.length === 0;
        if (factoriesEmpty) {
            endRound(gs);
        } else {
            gs.currentPlayerId = gs.currentPlayerId === 1 ? 2 : 1;
        }

        io.to(room.id).emit('game_update', sortCenter(gs));
    });

    socket.on('place_stones', ({ lineIndex }) => {
        const room = getRoomBySocket(socket.id);
        if (!room?.gameState || room.gameState.gameState !== 'PLAYING') return;
        const player = getPlayerInRoom(room, socket.id);
        if (!player || player.index !== room.gameState.currentPlayerId) return;

        const gs = room.gameState;
        if (!gs.heldStones) return;

        const p = gs.players.find(p => p.id === gs.currentPlayerId);
        const { type, count } = gs.heldStones;
        const line = p.patternLines[lineIndex];
        const colInWall = WALL_ORDER[lineIndex].indexOf(type);
        const hasDiff = line.some(s => s !== null && s !== type);
        const inWall = p.wall[lineIndex][colInWall] !== null;
        let remaining = count;

        if (hasDiff || inWall) {
            while (remaining > 0 && p.floorLine.length < 7) { p.floorLine.push(type); remaining--; }
            if (remaining > 0) gs.discard.push(...Array(remaining).fill(type));
        } else {
            for (let i = line.length - 1; i >= 0 && remaining > 0; i--) {
                if (line[i] === null) { line[i] = type; remaining--; }
            }
            while (remaining > 0 && p.floorLine.length < 7) { p.floorLine.push(type); remaining--; }
            if (remaining > 0) gs.discard.push(...Array(remaining).fill(type));
        }
        gs.heldStones = null;

        const factoriesEmpty = gs.factories.every(f => f.length === 0) && gs.center.length === 0;
        if (factoriesEmpty) {
            endRound(gs);
        } else {
            gs.currentPlayerId = gs.currentPlayerId === 1 ? 2 : 1;
        }

        io.to(room.id).emit('game_update', sortCenter(gs));
    });

    socket.on('disconnect', () => {
        const room = getRoomBySocket(socket.id);
        if (!room) return;
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) {
            rooms.delete(room.id);
        } else {
            room.gameState = null;
            io.to(room.id).emit('game_update', null);
        }
        broadcastRoomList();
    });
});

httpServer.listen(3001, () => console.log('Serveur Azul sur http://localhost:3001'));