const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const WORLD = { width: 1600, height: 900 };
const ROUND_MS = 3 * 60 * 1000;
const TICK_MS = 1000 / 30;
const MAX_COINS = 28;
const COLORS = ["#ffbd59", "#7dd3fc", "#fda4af", "#c4b5fd", "#86efac", "#f9a8d4"];
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function cleanName(value) {
  const name = String(value || "玩家").trim().replace(/[<>]/g, "").slice(0, 12);
  return name || "玩家";
}

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function randomPoint() {
  return {
    x: 80 + Math.random() * (WORLD.width - 160),
    y: 80 + Math.random() * (WORLD.height - 160),
  };
}

function spawnCoin(room) {
  if (room.coins.length >= MAX_COINS) return;
  const point = randomPoint();
  room.coins.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    x: point.x,
    y: point.y,
    value: Math.random() < 0.12 ? 3 : 1,
  });
}

function makePlayer(id, name, index) {
  const point = randomPoint();
  return {
    id,
    name: cleanName(name),
    color: COLORS[index % COLORS.length],
    x: point.x,
    y: point.y,
    score: 0,
    input: { up: false, down: false, left: false, right: false },
  };
}

function makeRoom() {
  return {
    code: makeRoomCode(),
    hostId: null,
    phase: "lobby",
    startedAt: null,
    endsAt: null,
    players: new Map(),
    coins: [],
    lastCoinAt: 0,
    winner: null,
    timer: null,
  };
}

function publicState(room) {
  const now = Date.now();
  const remaining = room.phase === "playing" ? Math.max(0, room.endsAt - now) : 0;
  return {
    roomCode: room.code,
    hostId: room.hostId,
    phase: room.phase,
    remaining,
    winner: room.winner,
    world: WORLD,
    coins: room.coins,
    players: [...room.players.values()].map(({ input, ...player }) => player),
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", publicState(room));
}

function finishRound(room) {
  if (room.phase !== "playing") return;
  room.phase = "results";
  room.winner = [...room.players.values()].sort((a, b) => b.score - a.score)[0]?.id || null;
  broadcast(room);
}

function resetRound(room) {
  room.phase = "playing";
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + ROUND_MS;
  room.winner = null;
  room.coins = [];
  room.lastCoinAt = 0;
  for (const player of room.players.values()) {
    const point = randomPoint();
    player.x = point.x;
    player.y = point.y;
    player.score = 0;
    player.input = { up: false, down: false, left: false, right: false };
  }
  for (let i = 0; i < 18; i += 1) spawnCoin(room);
}

function tickRoom(room) {
  if (room.phase !== "playing") return;
  const now = Date.now();
  if (now >= room.endsAt) {
    finishRound(room);
    return;
  }

  if (now - room.lastCoinAt > 1400) {
    spawnCoin(room);
    room.lastCoinAt = now;
  }

  const dt = TICK_MS / 1000;
  for (const player of room.players.values()) {
    const dx = Number(player.input.right) - Number(player.input.left);
    const dy = Number(player.input.down) - Number(player.input.up);
    const length = Math.hypot(dx, dy) || 1;
    const speed = 320;
    player.x = Math.max(28, Math.min(WORLD.width - 28, player.x + (dx / length) * speed * dt));
    player.y = Math.max(28, Math.min(WORLD.height - 28, player.y + (dy / length) * speed * dt));

    for (let i = room.coins.length - 1; i >= 0; i -= 1) {
      const coin = room.coins[i];
      if (Math.hypot(player.x - coin.x, player.y - coin.y) < 36) {
        player.score += coin.value;
        room.coins.splice(i, 1);
        io.to(room.code).emit("coin-collected", { playerId: player.id, value: coin.value });
      }
    }
  }
  broadcast(room);
}

function addPlayer(room, socket, name) {
  if (room.players.size >= 6) {
    socket.emit("error-message", "这个房间已经坐满 6 个人了");
    return false;
  }
  const player = makePlayer(socket.id, name, room.players.size);
  room.players.set(socket.id, player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  if (!room.hostId) room.hostId = socket.id;
  socket.emit("joined-room", { code: room.code, playerId: socket.id });
  broadcast(room);
  return true;
}

function getPlayerRoom(socket) {
  return rooms.get(socket.data.roomCode);
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name } = {}) => {
    const room = makeRoom();
    rooms.set(room.code, room);
    addPlayer(room, socket, name);
  });

  socket.on("join-room", ({ code, name } = {}) => {
    const room = rooms.get(cleanCode(code));
    if (!room) {
      socket.emit("error-message", "找不到这个房间，检查一下房间号");
      return;
    }
    if (room.phase !== "lobby") {
      socket.emit("error-message", "这局已经开始了，等下一局再加入");
      return;
    }
    addPlayer(room, socket, name);
  });

  socket.on("start-game", () => {
    const room = getPlayerRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    resetRound(room);
    broadcast(room);
  });

  socket.on("player-input", (input = {}) => {
    const room = getPlayerRoom(socket);
    const player = room?.players.get(socket.id);
    if (!player) return;
    player.input = {
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right),
    };
  });

  socket.on("disconnect", () => {
    const room = getPlayerRoom(socket);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value || null;
    if (room.players.size === 0) {
      clearInterval(room.timer);
      rooms.delete(room.code);
    } else {
      broadcast(room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) tickRoom(room);
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Coin Battle running at http://localhost:${PORT}`);
});
