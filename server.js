const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 1000 / 30;
const MAX_PLAYERS = 2;
const MAX_WAVE = 10;
const WORLD = { width: 1600, height: 900 };
const COLORS = ["#ffbd59", "#7dd3fc"];

const WEAPONS = {
  pistol: { name: "手枪", cost: 0, damage: 24, cooldown: 320, range: 480 },
  shotgun: { name: "霰弹枪", cost: 90, damage: 62, cooldown: 720, range: 300 },
  rifle: { name: "突击步枪", cost: 170, damage: 18, cooldown: 120, range: 600 },
};
const TURRETS = {
  machine: { name: "机枪塔", cost: 120, damage: 12, cooldown: 260, range: 360, color: "#a9efc1" },
  cannon: { name: "重炮塔", cost: 220, damage: 42, cooldown: 900, range: 520, color: "#c4b5fd" },
};
const MONSTERS = {
  runner: { hp: 42, speed: 110, damage: 10, radius: 17, range: 36, reward: 20, color: "#ef788e", cooldown: 760 },
  brute: { hp: 150, speed: 52, damage: 25, radius: 29, range: 48, reward: 55, color: "#c84c5e", cooldown: 900 },
  spitter: { hp: 70, speed: 68, damage: 14, radius: 21, range: 235, reward: 38, color: "#b39afc", cooldown: 1100 },
};
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function cleanName(value) {
  const name = String(value || "玩家").trim().replace(/[<>]/g, "").slice(0, 12);
  return name || "玩家";
}
function cleanCode(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); }
function numberOr(value, fallback) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do { code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); } while (rooms.has(code));
  return code;
}
function randomEdgePoint() {
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return { x: 45, y: 70 + Math.random() * 760 };
  if (edge === 1) return { x: 1555, y: 70 + Math.random() * 760 };
  if (edge === 2) return { x: 70 + Math.random() * 1460, y: 45 };
  return { x: 70 + Math.random() * 1460, y: 855 };
}
function playerStart(index) { return { x: 700 + index * 200, y: 700 }; }

function makePlayer(id, name, index) {
  const point = playerStart(index);
  return { id, name: cleanName(name), color: COLORS[index % COLORS.length], x: point.x, y: point.y, aimX: 800, aimY: 450, hp: 100, maxHp: 100, weapon: "pistol", powerLevel: 1, score: 0, kills: 0, builds: { machine: 0, cannon: 0 }, input: { up: false, down: false, left: false, right: false, shooting: false }, lastShotAt: 0, respawnAt: 0 };
}
function makeRoom() {
  return { code: makeRoomCode(), hostId: null, phase: "lobby", result: null, players: new Map(), monsters: [], turrets: [], effects: [], scrap: 320, base: { x: 800, y: 450, hp: 1000, maxHp: 1000 }, wave: 1, waveState: "prep", waveTarget: 0, waveSpawned: 0, nextWaveAt: 0, lastSpawnAt: 0 };
}
function waveTarget(wave) { return 5 + wave * 3; }

function publicState(room) {
  const now = Date.now();
  return {
    roomCode: room.code, hostId: room.hostId, phase: room.phase, result: room.result, scrap: room.scrap, base: room.base,
    wave: room.wave, maxWave: MAX_WAVE, waveState: room.waveState, waveRemaining: room.waveState === "prep" ? Math.max(0, room.nextWaveAt - now) : 0,
    waveTarget: room.waveTarget, waveSpawned: room.waveSpawned, world: WORLD,
    players: [...room.players.values()].map(({ input, lastShotAt, respawnAt, ...player }) => player),
    monsters: room.monsters.filter((monster) => !monster.dead).map(({ lastAttackAt, ...monster }) => monster),
    turrets: room.turrets.map(({ nextShotAt, ...turret }) => turret), effects: room.effects,
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }
function addEffect(room, data) { room.effects.push({ ...data, at: Date.now() }); }
function finishRound(room, result) { if (room.phase !== "playing") return; room.phase = "results"; room.result = result; broadcast(room); }

function resetRound(room) {
  room.phase = "playing"; room.result = null; room.scrap = 320; room.base.hp = room.base.maxHp; room.monsters = []; room.turrets = []; room.effects = [];
  room.wave = 1; room.waveState = "prep"; room.waveTarget = waveTarget(1); room.waveSpawned = 0; room.nextWaveAt = Date.now() + 5000; room.lastSpawnAt = 0;
  for (const [index, player] of [...room.players.values()].entries()) {
    const point = playerStart(index); player.x = point.x; player.y = point.y; player.hp = player.maxHp; player.weapon = "pistol"; player.powerLevel = 1; player.score = 0; player.kills = 0; player.builds = { machine: 0, cannon: 0 }; player.respawnAt = 0; player.input = { up: false, down: false, left: false, right: false, shooting: false };
  }
}
function beginWave(room) { room.waveState = "combat"; room.waveTarget = waveTarget(room.wave); room.waveSpawned = 0; room.lastSpawnAt = 0; }
function monsterTypeForWave(wave) { const roll = Math.random(); if (wave >= 4 && roll < 0.18) return "spitter"; if (wave >= 2 && roll < 0.45) return "brute"; return "runner"; }
function spawnMonster(room) {
  const type = monsterTypeForWave(room.wave); const template = MONSTERS[type]; const point = randomEdgePoint(); const scale = 1 + Math.max(0, room.wave - 1) * 0.1;
  room.monsters.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, x: point.x, y: point.y, hp: Math.round(template.hp * scale), maxHp: Math.round(template.hp * scale), speed: template.speed * (1 + Math.max(0, room.wave - 5) * 0.025), damage: Math.round(template.damage * scale), radius: template.radius, range: template.range, reward: Math.round(template.reward * scale), color: template.color, cooldown: template.cooldown, lastAttackAt: 0 });
}

function findNearestMonster(room, origin, maxRange, aimX = origin.x, aimY = origin.y) {
  const aimAngle = Math.atan2(aimY - origin.y, aimX - origin.x);
  const candidates = room.monsters.filter((monster) => {
    if (monster.dead || distance(origin, monster) > maxRange) return false;
    const angle = Math.atan2(monster.y - origin.y, monster.x - origin.x); let delta = Math.abs(angle - aimAngle); if (delta > Math.PI) delta = Math.PI * 2 - delta;
    return delta < 0.42;
  });
  candidates.sort((a, b) => Math.hypot(a.x - aimX, a.y - aimY) - Math.hypot(b.x - aimX, b.y - aimY));
  return candidates[0] || null;
}
function damageMonster(room, monster, amount, playerId = null) {
  if (!monster || monster.dead) return; monster.hp -= amount; if (monster.hp > 0) return;
  monster.dead = true; room.scrap += monster.reward; const player = playerId ? room.players.get(playerId) : null;
  if (player) { player.kills += 1; player.score += monster.reward; }
  addEffect(room, { kind: "burst", x: monster.x, y: monster.y, color: monster.color, value: monster.reward });
}
function shootPlayer(room, player, now) {
  const weapon = WEAPONS[player.weapon] || WEAPONS.pistol; if (!player.input.shooting || now - player.lastShotAt < weapon.cooldown || player.hp <= 0) return;
  player.lastShotAt = now; const target = findNearestMonster(room, player, weapon.range, player.aimX, player.aimY); const end = target || { x: player.aimX, y: player.aimY };
  addEffect(room, { kind: "shot", x1: player.x, y1: player.y, x2: end.x, y2: end.y, color: player.color }); if (!target) return;
  const damage = Math.round(weapon.damage * (1 + (player.powerLevel - 1) * 0.15)); damageMonster(room, target, damage, player.id);
  if (player.weapon === "shotgun") for (const nearby of room.monsters) if (nearby !== target && !nearby.dead && distance(target, nearby) < 78) damageMonster(room, nearby, Math.round(damage * 0.45), player.id);
}
function shootTurrets(room, now) {
  for (const turret of room.turrets) {
    const config = TURRETS[turret.type]; if (!config || now < turret.nextShotAt) continue;
    const target = [...room.monsters].filter((monster) => !monster.dead && distance(turret, monster) <= config.range).sort((a, b) => distance(turret, a) - distance(turret, b))[0];
    if (!target) continue; turret.nextShotAt = now + config.cooldown; turret.targetFlash = now; addEffect(room, { kind: "shot", x1: turret.x, y1: turret.y, x2: target.x, y2: target.y, color: config.color }); damageMonster(room, target, config.damage);
  }
}

function movePlayers(room, dt, now) {
  for (const player of room.players.values()) {
    if (player.hp <= 0) {
      if (player.respawnAt && now >= player.respawnAt) { const point = playerStart([...room.players.keys()].indexOf(player.id)); player.x = point.x; player.y = point.y; player.hp = player.maxHp; player.respawnAt = 0; addEffect(room, { kind: "respawn", x: player.x, y: player.y, color: player.color }); }
      continue;
    }
    const dx = Number(player.input.right) - Number(player.input.left); const dy = Number(player.input.down) - Number(player.input.up); const length = Math.hypot(dx, dy) || 1;
    player.x = clamp(player.x + (dx / length) * 300 * dt, 30, WORLD.width - 30); player.y = clamp(player.y + (dy / length) * 300 * dt, 30, WORLD.height - 30);
    player.aimX = clamp(numberOr(player.aimX, 800), 0, WORLD.width); player.aimY = clamp(numberOr(player.aimY, 450), 0, WORLD.height); shootPlayer(room, player, now);
  }
}
function nearestAlivePlayer(room, monster) { return [...room.players.values()].filter((player) => player.hp > 0).sort((a, b) => distance(monster, a) - distance(monster, b))[0] || null; }
function hurtPlayer(player, damage, now) { if (player.hp <= 0) return; player.hp = Math.max(0, player.hp - damage); if (player.hp === 0) player.respawnAt = now + 3000; }
function moveMonsters(room, dt, now) {
  for (const monster of room.monsters) {
    if (monster.dead) continue; const player = nearestAlivePlayer(room, monster); const playerDistance = player ? distance(monster, player) : Infinity; const target = player && playerDistance < 480 ? player : room.base; const targetDistance = distance(monster, target);
    if (targetDistance <= monster.range + (target === room.base ? 48 : 22)) {
      if (now - monster.lastAttackAt >= monster.cooldown) { monster.lastAttackAt = now; if (target === room.base) room.base.hp = Math.max(0, room.base.hp - monster.damage); else hurtPlayer(target, monster.damage, now); addEffect(room, { kind: "hit", x: target.x, y: target.y, color: monster.color }); }
      continue;
    }
    const dx = (target.x - monster.x) / (targetDistance || 1); const dy = (target.y - monster.y) / (targetDistance || 1); monster.x += dx * monster.speed * dt; monster.y += dy * monster.speed * dt;
  }
}
function advanceWaves(room, now) {
  if (room.waveState === "prep") { if (now >= room.nextWaveAt) beginWave(room); return; }
  const spawnInterval = Math.max(300, 1000 - room.wave * 45); if (room.waveSpawned < room.waveTarget && now - room.lastSpawnAt >= spawnInterval) { spawnMonster(room); room.waveSpawned += 1; room.lastSpawnAt = now; }
  if (room.waveSpawned >= room.waveTarget && !room.monsters.some((monster) => !monster.dead)) {
    if (room.wave >= MAX_WAVE) { finishRound(room, "win"); return; }
    room.scrap += 80 + room.wave * 20; room.wave += 1; room.waveState = "prep"; room.waveTarget = waveTarget(room.wave); room.nextWaveAt = now + 5000; room.waveSpawned = 0;
  }
}
function tickRoom(room) {
  if (room.phase !== "playing") return; const now = Date.now(); advanceWaves(room, now); if (room.phase !== "playing") return; movePlayers(room, TICK_MS / 1000, now); moveMonsters(room, TICK_MS / 1000, now); shootTurrets(room, now); room.monsters = room.monsters.filter((monster) => !monster.dead); if (room.base.hp <= 0) finishRound(room, "lose"); broadcast(room); room.effects = [];
}

function addPlayer(room, socket, name) {
  if (room.players.size >= MAX_PLAYERS) { socket.emit("error-message", "这个房间只支持 2 名玩家"); return false; }
  const player = makePlayer(socket.id, name, room.players.size); room.players.set(socket.id, player); socket.join(room.code); socket.data.roomCode = room.code; if (!room.hostId) room.hostId = socket.id; socket.emit("joined-room", { code: room.code, playerId: socket.id }); broadcast(room); return true;
}
function roomFor(socket) { return rooms.get(socket.data.roomCode); }

io.on("connection", (socket) => {
  socket.on("create-room", ({ name } = {}) => { const room = makeRoom(); rooms.set(room.code, room); addPlayer(room, socket, name); });
  socket.on("join-room", ({ code, name } = {}) => { const room = rooms.get(cleanCode(code)); if (!room) return socket.emit("error-message", "找不到这个房间，检查一下房间号"); if (room.phase !== "lobby") return socket.emit("error-message", "这局已经开始了，等下一局再加入"); addPlayer(room, socket, name); });
  socket.on("start-game", () => { const room = roomFor(socket); if (!room || room.hostId !== socket.id) return; resetRound(room); broadcast(room); });
  socket.on("player-input", (nextInput = {}) => { const room = roomFor(socket); const player = room?.players.get(socket.id); if (!player) return; player.input = { up: Boolean(nextInput.up), down: Boolean(nextInput.down), left: Boolean(nextInput.left), right: Boolean(nextInput.right), shooting: Boolean(nextInput.shooting) }; player.aimX = clamp(numberOr(nextInput.aimX, player.aimX), 0, WORLD.width); player.aimY = clamp(numberOr(nextInput.aimY, player.aimY), 0, WORLD.height); });
  socket.on("buy-item", ({ item } = {}) => {
    const room = roomFor(socket); const player = room?.players.get(socket.id); if (!room || !player || room.phase !== "playing") return; const config = WEAPONS[item] || TURRETS[item] || (item === "upgrade" ? { name: "火力升级", cost: 80 + Math.max(0, player.powerLevel - 1) * 50 } : item === "heal" ? { name: "维修包", cost: 30 } : null); if (!config) return socket.emit("error-message", "这个商品不存在"); if (item === "upgrade" && player.powerLevel >= 5) return socket.emit("error-message", "火力已经满级了"); if (room.scrap < config.cost) return socket.emit("error-message", `废料不够，还差 ${config.cost - room.scrap}`); if (item === "heal" && player.hp >= player.maxHp) return socket.emit("error-message", "你的生命值已经满了"); if (WEAPONS[item] && player.weapon === item) return socket.emit("error-message", "你已经装备这把枪了");
    room.scrap -= config.cost; if (WEAPONS[item]) player.weapon = item; else if (TURRETS[item]) player.builds[item] += 1; else if (item === "upgrade") player.powerLevel += 1; else player.hp = Math.min(player.maxHp, player.hp + 45); socket.emit("purchase-success", { item, message: item === "heal" ? "维修完成" : item === "upgrade" ? `火力升级到 Lv.${player.powerLevel}` : `已购买 ${config.name}` }); broadcast(room);
  });
  socket.on("place-turret", ({ type, x, y } = {}) => { const room = roomFor(socket); const player = room?.players.get(socket.id); const config = TURRETS[type]; if (!room || !player || !config || room.phase !== "playing") return; if (!player.builds[type]) return socket.emit("error-message", "你还没有这种炮塔"); const point = { x: clamp(numberOr(x, 800), 60, WORLD.width - 60), y: clamp(numberOr(y, 450), 60, WORLD.height - 60) }; if (distance(point, room.base) < 115) return socket.emit("error-message", "离基地太近，换个位置"); if (room.turrets.some((turret) => distance(point, turret) < 70)) return socket.emit("error-message", "这里已经有炮塔了"); player.builds[type] -= 1; room.turrets.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, x: point.x, y: point.y, hp: 260, maxHp: 260, nextShotAt: 0, targetFlash: 0 }); socket.emit("purchase-success", { item: "placed", message: `${config.name} 已部署` }); broadcast(room); });
  socket.on("remove-turret", ({ x, y } = {}) => { const room = roomFor(socket); if (!room || room.phase !== "playing") return; const point = { x: numberOr(x, -999), y: numberOr(y, -999) }; let index = -1; let nearest = Infinity; for (let i = 0; i < room.turrets.length; i += 1) { const current = distance(point, room.turrets[i]); if (current < nearest) { nearest = current; index = i; } } if (index < 0 || nearest > 60) return socket.emit("error-message", "没有选中炮塔"); const turret = room.turrets[index]; room.turrets.splice(index, 1); room.scrap += Math.floor(TURRETS[turret.type].cost * 0.55); socket.emit("purchase-success", { item: "removed", message: "炮塔已拆卸，返还部分废料" }); broadcast(room); });
  socket.on("disconnect", () => { const room = roomFor(socket); if (!room) return; room.players.delete(socket.id); if (room.hostId === socket.id) room.hostId = room.players.keys().next().value || null; if (room.players.size === 0) rooms.delete(room.code); else broadcast(room); });
});

setInterval(() => { for (const room of rooms.values()) tickRoom(room); }, TICK_MS);
server.listen(PORT, () => console.log(`Coin Battle running at http://localhost:${PORT}`));
