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

const ROOM_CLEANUP_DELAY = 5 * 60 * 1000;
const DISCONNECT_FORFEIT_DELAY = 60_000;
const DISCONNECT_VOTE_DELAY = 30_000;

const factoryCountForPlayers = (n) => n * 2 + 1;

const createEmptyPlayer = (id, pseudo) => ({
    id, pseudo,
    patternLines: Array(5).fill(null).map((_, i) => Array(i + 1).fill(null)),
    wall: Array(5).fill(null).map(() => Array(5).fill(null)),
    floorLine: [], score: 0,
});

const calculatePoints = (wall, row, col) => {
    let h = 0, v = 0;
    for (let i = col + 1; i < 5 && wall[row][i]; i++) h++;
    for (let i = col - 1; i >= 0 && wall[row][i]; i--) h++;
    for (let i = row + 1; i < 5 && wall[i][col]; i++) v++;
    for (let i = row - 1; i >= 0 && wall[i][col]; i--) v++;
    return 1 + (h > 0 ? h : 0) + (v > 0 ? v : 0);
};

const sortCenter = (gs) => {
    if (gs && gs.center) gs.center = [...gs.center].sort();
    return gs;
};

const nextPlayerIndex = (gs) => {
    const currentIndex = gs.players.findIndex(p => p.id === gs.currentPlayerId);
    return gs.players[(currentIndex + 1) % gs.players.length].id;
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
        const penalties = [-1, -1, -2, -2, -2, -3, -3];
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
        const factoryCount = factoryCountForPlayers(gs.players.length);
        if (gs.bag.length < factoryCount * 4) {
            gs.bag = [...gs.bag, ...gs.discard].sort(() => Math.random() - 0.5);
            gs.discard = [];
        }
        gs.factories = Array(factoryCount).fill(null).map(() => gs.bag.splice(0, 4));
        gs.firstStonePicked = false;
        gs.currentPlayerId = gs.nextFirstPlayerId;
    }
};

const initGameState = (pseudos) => {
    const playerCount = pseudos.length;
    const factoryCount = factoryCountForPlayers(playerCount);
    let bag = [];
    Object.values(STONE_TYPES).forEach(t => { for (let i = 0; i < 20; i++) bag.push(t); });
    bag = bag.sort(() => Math.random() - 0.5);
    return {
        factories: Array(factoryCount).fill(null).map(() => bag.splice(0, 4)),
        center: [],
        players: pseudos.map((pseudo, i) => createEmptyPlayer(i + 1, pseudo)),
        currentPlayerId: 1,
        nextFirstPlayerId: 1,
        heldStones: null,
        firstStonePicked: false,
        gameState: 'PLAYING',
        bag,
        discard: [],
        rematchVotes: [],
    };
};

const rooms = new Map();
let roomCounter = 1;

const buildRoomList = () =>
    Array.from(rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        spectatorCount: r.spectators ? r.spectators.length : 0,
        status: r.gameState ? r.gameState.gameState : 'WAITING',
        hasDisconnected: r.players.some(p => p.socketId === null),
    }));

const broadcastRoomList = () => io.emit('room_list', buildRoomList());

const scheduleRoomCleanup = (room) => {
    if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
    room._cleanupTimer = setTimeout(() => {
        rooms.delete(room.id);
        broadcastRoomList();
    }, ROOM_CLEANUP_DELAY);
};

const cancelRoomCleanup = (room) => {
    if (room._cleanupTimer) {
        clearTimeout(room._cleanupTimer);
        room._cleanupTimer = null;
    }
};

const allPlayersGone = (room) =>
    room.players.every(p => p.socketId === null) &&
    (!room.spectators || room.spectators.length === 0);


function handlePlayerDisconnect(room, disconnectedPlayer) {
    const connectedPlayers = room.players.filter(p => p.socketId !== null);

    io.to(room.id).emit('opponent_disconnected', disconnectedPlayer.pseudo);

    if (connectedPlayers.length === 1) {
        io.to(room.id).emit('disconnect_countdown', {
            seconds: 60,
            disconnectedPseudo: disconnectedPlayer.pseudo,
        });

        room._disconnectTimer = setTimeout(() => {
            const winner = connectedPlayers[0];
            if (room.gameState) room.gameState.gameState = 'GAME_OVER';
            io.to(room.id).emit('force_game_over', {
                winnerPseudo: winner.pseudo,
                reason: 'disconnect',
            });
            scheduleRoomCleanup(room);
            broadcastRoomList();
        }, DISCONNECT_FORFEIT_DELAY);

    } else {
        room._disconnectVotes = {
            disconnectedPseudo: disconnectedPlayer.pseudo,
            votes: {},
            timer: setTimeout(() => resolveDisconnectionVote(room), DISCONNECT_VOTE_DELAY),
        };

        io.to(room.id).emit('disconnection_vote_request', {
            disconnectedPseudo: disconnectedPlayer.pseudo,
            remainingPlayers: connectedPlayers.map(p => p.pseudo),
            timeoutSeconds: 30,
        });
    }
}

function resolveDisconnectionVote(room) {
    if (!room._disconnectVotes) return;

    const { disconnectedPseudo, votes } = room._disconnectVotes;
    clearTimeout(room._disconnectVotes.timer);
    room._disconnectVotes = null;

    const connectedPlayers = room.players.filter(p => p.socketId !== null);
    const cancelCount = Object.values(votes).filter(v => v === 'cancel').length;
    const totalVoters = connectedPlayers.length;

    if (cancelCount > totalVoters / 2) {
        if (room.gameState) room.gameState.gameState = 'GAME_OVER';
        io.to(room.id).emit('force_game_over', { winnerPseudo: null, reason: 'cancelled' });
        scheduleRoomCleanup(room);
        broadcastRoomList();
        return;
    }

    room.players = room.players.filter(p => p.pseudo !== disconnectedPseudo);
    room.players.forEach((p, i) => { p.index = i + 1; });
    room.maxPlayers = room.players.length;

    const gs = room.gameState;
    if (gs) {
        gs.players = gs.players.filter(p => p.pseudo !== disconnectedPseudo);
        gs.players.forEach((p, i) => { p.id = i + 1; });

        const newFactoryCount = factoryCountForPlayers(room.players.length);
        if (gs.bag.length < newFactoryCount * 4) {
            gs.bag = [...gs.bag, ...gs.discard].sort(() => Math.random() - 0.5);
            gs.discard = [];
        }
        gs.factories = Array(newFactoryCount).fill(null).map(() => gs.bag.splice(0, 4));
        gs.center = [];
        gs.heldStones = null;
        gs.currentPlayerId = 1;
        gs.nextFirstPlayerId = 1;
        gs.firstStonePicked = false;
    }

    io.to(room.id).emit('game_continued', {
        removedPseudo: disconnectedPseudo,
        newPlayerCount: room.players.length,
    });
    io.to(room.id).emit('game_update', sortCenter(gs));
    broadcastRoomList();
}

io.on('connection', (socket) => {
    broadcastRoomList();

    socket.on('request_rooms', () => {
        socket.emit('room_list', buildRoomList());
    });

    socket.on('create_room', ({ pseudo, maxPlayers = 2 }) => {
        const clampedMax = Math.min(4, Math.max(2, maxPlayers));
        const roomId = `room_${roomCounter++}`;
        const room = {
            id: roomId,
            name: `Partie de ${pseudo}`,
            maxPlayers: clampedMax,
            players: [{ socketId: socket.id, pseudo: pseudo.trim(), index: 1 }],
            spectators: [],
            gameState: null,
            _cleanupTimer: null,
            _disconnectTimer: null,
            _disconnectVotes: null,
        };
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('your_index', 1);
        socket.emit('joined_room', roomId);
        broadcastRoomList();
    });

    socket.on('join_room', ({ roomId, pseudo }) => {
        const room = rooms.get(roomId);
        if (!room || room.players.length >= room.maxPlayers) return;

        const trimmedPseudo = pseudo.trim();
        const pseudoTaken = room.players.some(
            p => p.pseudo.toLowerCase() === trimmedPseudo.toLowerCase()
        );
        if (pseudoTaken) {
            socket.emit('join_error', `Le pseudo "${trimmedPseudo}" est déjà utilisé dans cette partie.`);
            return;
        }

        const newIndex = room.players.length + 1;
        room.players.push({ socketId: socket.id, pseudo: trimmedPseudo, index: newIndex });
        socket.join(roomId);
        socket.emit('your_index', newIndex);
        socket.emit('joined_room', roomId);

        if (room.players.length === room.maxPlayers) {
            room.gameState = initGameState(room.players.map(p => p.pseudo));
            io.to(roomId).emit('game_update', sortCenter(room.gameState));
        } else {
            io.to(roomId).emit('room_players_update', {
                players: room.players.map(p => p.pseudo),
                maxPlayers: room.maxPlayers,
            });
        }
        broadcastRoomList();
    });

    socket.on('join_as_spectator', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room?.gameState) return;
        if (!room.spectators) room.spectators = [];
        room.spectators.push(socket.id);
        socket.join(roomId);
        socket.emit('your_index', 0);
        socket.emit('joined_room', roomId);
        socket.emit('game_update', sortCenter(room.gameState));
        broadcastRoomList();
    });

    socket.on('rejoin_room', ({ roomId, pseudo }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('join_error', 'La partie n\'existe plus.');
            return;
        }

        const trimmedPseudo = pseudo.trim();
        const disconnectedSlot = room.players.find(
            p => p.socketId === null && p.pseudo.toLowerCase() === trimmedPseudo.toLowerCase()
        );

        if (!disconnectedSlot) {
            socket.emit('join_error', `Impossible de rejoindre : "${trimmedPseudo}" n'est pas déconnecté dans cette partie.`);
            return;
        }

        if (room._disconnectTimer) {
            clearTimeout(room._disconnectTimer);
            room._disconnectTimer = null;
            io.to(roomId).emit('disconnect_countdown_cancelled');
        }
        if (room._disconnectVotes) {
            clearTimeout(room._disconnectVotes.timer);
            room._disconnectVotes = null;
            io.to(roomId).emit('disconnection_vote_cancelled');
        }

        cancelRoomCleanup(room);

        disconnectedSlot.socketId = socket.id;
        socket.join(roomId);
        socket.emit('your_index', disconnectedSlot.index);
        socket.emit('joined_room', roomId);
        if (room.gameState) socket.emit('game_update', sortCenter(room.gameState));
        socket.to(roomId).emit('opponent_reconnected', trimmedPseudo);
        broadcastRoomList();
    });

    socket.on('request_state', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room?.gameState) socket.emit('game_update', sortCenter(room.gameState));
    });

    socket.on('leave_room', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const isInGame = room.gameState?.gameState === 'PLAYING';
        const player = room.players.find(p => p.socketId === socket.id);

        if (isInGame && player) {
            player.socketId = null;
            socket.leave(roomId);
            if (allPlayersGone(room)) {
                scheduleRoomCleanup(room);
            } else {
                handlePlayerDisconnect(room, player);
            }
        } else {
            room.players = room.players.filter(p => p.socketId !== socket.id);
            if (room.spectators) room.spectators = room.spectators.filter(id => id !== socket.id);
            socket.leave(roomId);
            if (allPlayersGone(room)) {
                rooms.delete(roomId);
            } else {
                io.to(roomId).emit('room_players_update', {
                    players: room.players.map(p => p.pseudo),
                    maxPlayers: room.maxPlayers,
                });
            }
        }
        broadcastRoomList();
    });
    socket.on('disconnection_vote', ({ roomId, choice }) => {
        const room = rooms.get(roomId);
        if (!room || !room._disconnectVotes) return;
        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;
        room._disconnectVotes.votes[player.pseudo] = choice;

        const connectedPlayers = room.players.filter(p => p.socketId !== null);
        const allVoted = connectedPlayers.every(p => room._disconnectVotes.votes[p.pseudo] !== undefined);
        if (allVoted) resolveDisconnectionVote(room);
    });

    socket.on('request_rematch', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room?.gameState || room.gameState.gameState !== 'GAME_OVER') return;
        if (!room.gameState.rematchVotes) room.gameState.rematchVotes = [];
        if (!room.gameState.rematchVotes.includes(socket.id)) {
            room.gameState.rematchVotes.push(socket.id);
        }
        io.to(roomId).emit('rematch_votes', room.gameState.rematchVotes.length);
        if (room.gameState.rematchVotes.length >= room.maxPlayers) {
            room.gameState = initGameState(room.players.map(p => p.pseudo));
            io.to(roomId).emit('game_update', sortCenter(room.gameState));
        }
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
        while (remaining > 0 && p.floorLine.length < 7) { p.floorLine.push(type); remaining--; }
        if (remaining > 0) gs.discard.push(...Array(remaining).fill(type));
        gs.heldStones = null;
        const factoriesEmpty = gs.factories.every(f => f.length === 0) && gs.center.length === 0;
        if (factoriesEmpty) endRound(gs);
        else gs.currentPlayerId = nextPlayerIndex(gs);
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
        if (factoriesEmpty) endRound(gs);
        else gs.currentPlayerId = nextPlayerIndex(gs);
        io.to(room.id).emit('game_update', sortCenter(gs));
    });

    socket.on('disconnect', () => {
        const room = getRoomBySocket(socket.id);
        if (room) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                player.socketId = null;
                if (allPlayersGone(room)) {
                    scheduleRoomCleanup(room);
                } else if (room.gameState?.gameState === 'PLAYING') {
                    handlePlayerDisconnect(room, player);
                } else {
                    io.to(room.id).emit('opponent_disconnected', player.pseudo);
                }
            }
        }
        rooms.forEach(r => {
            if (r.spectators) r.spectators = r.spectators.filter(id => id !== socket.id);
            if (allPlayersGone(r) && !r._cleanupTimer) scheduleRoomCleanup(r);
        });
        broadcastRoomList();
    });
});

httpServer.listen(3001, () => console.log('Serveur Azul sur http://localhost:3001'));