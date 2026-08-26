const socket = io();
const homeView = document.querySelector("#home-view");
const gameView = document.querySelector("#game-view");
const homeName = document.querySelector("#home-name");
const roomCodeInput = document.querySelector("#room-code");
const homeError = document.querySelector("#home-error");
const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#arena-overlay");
const overlayTitle = document.querySelector("#overlay-title");
const overlayCopy = document.querySelector("#overlay-copy");
const startButton = document.querySelector("#start-button");
const arenaTitle = document.querySelector("#arena-title");
const waveStateElement = document.querySelector("#wave-state");
const waveNumberElement = document.querySelector("#wave-number");
const waveTimerElement = document.querySelector("#wave-timer");
const scoreList = document.querySelector("#score-list");
const playerCount = document.querySelector("#player-count");
const roomCodeDisplay = document.querySelector("#room-code-display");
const scrapElement = document.querySelector("#scrap");
const baseHpElement = document.querySelector("#base-hp");
const baseBarFill = document.querySelector("#base-bar-fill");
const modeStatus = document.querySelector("#mode-status");
const loadout = document.querySelector("#loadout");
const demolishButton = document.querySelector("#demolish-button");
const toast = document.querySelector("#toast");

let state = null;
let myId = null;
let roomCode = "";
let buildMode = null;
let demolishMode = false;
let toastTimer = null;
let pointerWorld = { x: 800, y: 450 };
const input = { up: false, down: false, left: false, right: false, shooting: false, aimX: 800, aimY: 450 };
const keyMap = { w: "up", ArrowUp: "up", s: "down", ArrowDown: "down", a: "left", ArrowLeft: "left", d: "right", ArrowRight: "right" };
const weaponNames = { pistol: "手枪", shotgun: "霰弹枪", rifle: "突击步枪" };
const turretNames = { machine: "机枪塔", cannon: "重炮塔" };
const effects = [];

function playerName() { return homeName.value.trim() || "炮塔师傅"; }
function showError(message) { homeError.textContent = message; }
function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1900); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function enterGame(code) { roomCode = code; roomCodeDisplay.textContent = code; homeView.classList.remove("active"); gameView.classList.add("active"); resizeCanvas(); }
function leaveGame() { window.location.reload(); }
function myPlayer() { return state?.players.find((player) => player.id === myId); }
function setMode(message, active = false) { modeStatus.textContent = message; modeStatus.classList.toggle("active", active); }
function formatSeconds(milliseconds) { return String(Math.ceil(Math.max(0, milliseconds) / 1000)).padStart(2, "0"); }

function updateOverlay() {
  if (!state) return;
  const isHost = state.hostId === myId;
  overlay.classList.toggle("hidden", state.phase === "playing");
  if (state.phase === "lobby") {
    startButton.classList.toggle("hidden", !isHost); startButton.textContent = "开始防守  →";
    overlayTitle.textContent = state.players.length >= 2 ? "人齐了，准备守家" : "等另一位队友进场";
    overlayCopy.textContent = isHost ? "把房间号发给朋友，然后开始防守。" : "等房主开始游戏。"; arenaTitle.textContent = "准备出发"; waveStateElement.textContent = "准备阶段";
  } else if (state.phase === "playing") {
    arenaTitle.textContent = state.waveState === "prep" ? "修整与补给" : "怪物来了"; waveStateElement.textContent = state.waveState === "prep" ? "准备阶段" : "战斗阶段";
  } else {
    startButton.classList.toggle("hidden", !isHost); startButton.textContent = "再守一局  →";
    overlayTitle.textContent = state.result === "win" ? "基地守住了！" : "基地被攻破了";
    overlayCopy.textContent = state.result === "win" ? "十波怪物全部清完，废土暂时安全。" : "炮塔和枪还可以再升级，重新来一局。"; arenaTitle.textContent = state.result === "win" ? "防守成功" : "防守失败"; waveStateElement.textContent = "本局结算";
  }
}

function renderScores() {
  if (!state) return;
  const players = [...state.players].sort((a, b) => b.kills - a.kills || b.score - a.score); playerCount.textContent = `${players.length} / 2`;
  scoreList.innerHTML = players.map((player, index) => `<div class="score-row"><span class="score-rank">${String(index + 1).padStart(2, "0")}</span><div class="score-player"><span class="player-color" style="color:${player.color};background:${player.color}"></span><div><div class="score-name ${player.id === myId ? "you" : ""}">${escapeHtml(player.name)}</div><div class="score-meta">${weaponNames[player.weapon] || "手枪"} · Lv.${player.powerLevel || 1} · ${player.hp} HP</div></div></div><strong class="score-value">${player.kills} 击杀</strong></div>`).join("");
  const mine = myPlayer(); loadout.textContent = `当前装备：${weaponNames[mine?.weapon] || "手枪"} Lv.${mine?.powerLevel || 1} · 炮塔库存 ${mine?.builds?.machine || 0}/${mine?.builds?.cannon || 0}`;
}

function resizeCanvas() { const ratio = Math.min(window.devicePixelRatio || 1, 2); const rect = canvas.getBoundingClientRect(); canvas.width = Math.max(1, Math.floor(rect.width * ratio)); canvas.height = Math.max(1, Math.floor(rect.height * ratio)); ctx.setTransform(canvas.width / 1600, 0, 0, canvas.height / 900, 0, 0); }
function drawBackground() { ctx.fillStyle = "#17191d"; ctx.fillRect(0, 0, 1600, 900); ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.lineWidth = 1; for (let x = 0; x <= 1600; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 900); ctx.stroke(); } for (let y = 0; y <= 900; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1600, y); ctx.stroke(); } ctx.strokeStyle = "rgba(243,181,74,.27)"; ctx.strokeRect(24, 24, 1552, 852); }
function drawBase(base, now) { const pulse = 1 + Math.sin(now / 420) * .04; ctx.save(); ctx.translate(base.x, base.y); ctx.strokeStyle = "rgba(243,181,74,.28)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 85 * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = "rgba(169,239,193,.36)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#25282d"; ctx.fillRect(-30, -30, 60, 60); ctx.fillStyle = "#a9efc1"; ctx.fillRect(-15, -15, 30, 30); ctx.fillStyle = "#101113"; ctx.font = "700 20px Space Grotesk"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("⚡", 0, 1); ctx.restore(); }
function drawTurret(turret, now) { const color = turret.type === "cannon" ? "#c4b5fd" : "#a9efc1"; ctx.save(); ctx.translate(turret.x, turret.y); ctx.rotate(-Math.PI / 4); ctx.shadowBlur = 15; ctx.shadowColor = color; ctx.fillStyle = "#25282d"; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.fillRect(-22, -22, 44, 44); ctx.strokeRect(-22, -22, 44, 44); ctx.fillStyle = color; ctx.fillRect(-7, -30, 14, 35); ctx.restore(); ctx.fillStyle = "rgba(16,17,19,.8)"; ctx.fillRect(turret.x - 30, turret.y + 31, 60, 5); ctx.fillStyle = color; ctx.fillRect(turret.x - 30, turret.y + 31, 60 * Math.max(0, turret.hp / turret.maxHp), 5); if (turret.targetFlash && now - turret.targetFlash < 100) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(turret.x, turret.y, 38, 0, Math.PI * 2); ctx.stroke(); } }
function drawMonster(monster) { const color = monster.color; ctx.save(); ctx.translate(monster.x, monster.y); ctx.shadowBlur = 16; ctx.shadowColor = color; ctx.fillStyle = color; if (monster.type === "brute") { ctx.rotate(Math.PI / 4); ctx.fillRect(-22, -22, 44, 44); } else if (monster.type === "spitter") { ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#35284f"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); } else { ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-12, -16); ctx.lineTo(-12, 16); ctx.closePath(); ctx.fill(); } ctx.shadowBlur = 0; ctx.fillStyle = "#17191d"; ctx.font = "700 11px DM Mono"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(monster.type === "brute" ? "B" : monster.type === "spitter" ? "S" : "R", 0, 1); ctx.restore(); ctx.fillStyle = "rgba(16,17,19,.8)"; ctx.fillRect(monster.x - 24, monster.y - monster.radius - 13, 48, 4); ctx.fillStyle = color; ctx.fillRect(monster.x - 24, monster.y - monster.radius - 13, 48 * Math.max(0, monster.hp / monster.maxHp), 4); }
function drawPlayer(player) { const isMe = player.id === myId; const color = player.color; ctx.save(); if (player.hp <= 0) ctx.globalAlpha = .35; ctx.strokeStyle = color; ctx.lineWidth = isMe ? 3 : 2; ctx.shadowBlur = isMe ? 23 : 13; ctx.shadowColor = color; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(player.x, player.y, isMe ? 22 : 19, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke(); const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x); ctx.strokeStyle = "#17191d"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(player.x + Math.cos(angle) * 31, player.y + Math.sin(angle) * 31); ctx.stroke(); ctx.fillStyle = "#17191d"; ctx.font = "700 13px Space Grotesk"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(player.name.slice(0, 1), player.x, player.y + 1); ctx.restore(); ctx.fillStyle = "rgba(16,17,19,.82)"; ctx.fillRect(player.x - 36, player.y - 42, 72, 18); ctx.fillStyle = "#f6f2ea"; ctx.font = "500 11px Space Grotesk"; ctx.textAlign = "center"; ctx.fillText(player.name, player.x, player.y - 32); ctx.fillStyle = "#24262b"; ctx.fillRect(player.x - 24, player.y + 29, 48, 4); ctx.fillStyle = color; ctx.fillRect(player.x - 24, player.y + 29, 48 * Math.max(0, player.hp / player.maxHp), 4); }
function drawEffects(now) { for (let i = effects.length - 1; i >= 0; i -= 1) { const item = effects[i]; const progress = (now - item.startedAt) / 650; if (progress >= 1) { effects.splice(i, 1); continue; } ctx.save(); ctx.globalAlpha = 1 - progress; if (item.kind === "shot") { ctx.strokeStyle = item.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(item.x1, item.y1); ctx.lineTo(item.x2, item.y2); ctx.stroke(); } else { ctx.strokeStyle = item.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(item.x, item.y, 13 + progress * 35, 0, Math.PI * 2); ctx.stroke(); if (item.value) { ctx.font = "700 15px DM Mono"; ctx.textAlign = "center"; ctx.fillText(`+${item.value}`, item.x, item.y - progress * 30); } } ctx.restore(); } }
function drawBuildPreview() { if (!buildMode && !demolishMode) return; ctx.save(); ctx.globalAlpha = .45; ctx.strokeStyle = demolishMode ? "#f27f8d" : buildMode === "cannon" ? "#c4b5fd" : "#a9efc1"; ctx.setLineDash([8, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pointerWorld.x, pointerWorld.y, 34, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }

function render() { requestAnimationFrame(render); drawBackground(); const now = performance.now(); if (!state) return; drawBase(state.base, now); state.turrets.forEach((turret) => drawTurret(turret, now)); state.monsters.forEach(drawMonster); [...state.players].sort((a, b) => a.y - b.y).forEach(drawPlayer); drawEffects(now); drawBuildPreview(); scrapElement.textContent = state.scrap; baseHpElement.textContent = Math.ceil(state.base.hp); baseBarFill.style.width = `${Math.max(0, state.base.hp / state.base.maxHp) * 100}%`; baseBarFill.style.background = state.base.hp < 300 ? "#f27f8d" : "#a9efc1"; waveNumberElement.textContent = `WAVE ${String(state.wave).padStart(2, "0")} / ${state.maxWave}`; waveTimerElement.textContent = state.waveState === "prep" ? `下一波 00:${formatSeconds(state.waveRemaining - (Date.now() - state.receivedAt))}` : `${state.waveSpawned} / ${state.waveTarget} 已出现`; }

function pointerToWorld(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * 1600 / rect.width, y: (event.clientY - rect.top) * 900 / rect.height }; }
document.querySelector("#create-button").addEventListener("click", () => { homeError.textContent = ""; socket.emit("create-room", { name: playerName() }); });
document.querySelector("#join-button").addEventListener("click", () => { homeError.textContent = ""; socket.emit("join-room", { name: playerName(), code: roomCodeInput.value }); });
roomCodeInput.addEventListener("input", () => { roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }); roomCodeInput.addEventListener("keydown", (event) => { if (event.key === "Enter") document.querySelector("#join-button").click(); }); homeName.addEventListener("keydown", (event) => { if (event.key === "Enter") document.querySelector("#create-button").click(); });
startButton.addEventListener("click", () => socket.emit("start-game")); document.querySelector("#back-button").addEventListener("click", leaveGame);
document.querySelector("#copy-room").addEventListener("click", async () => { try { await navigator.clipboard.writeText(roomCode); showToast("房间号已复制"); } catch { showToast(`房间号：${roomCode}`); } });
document.querySelectorAll("[data-buy]").forEach((button) => button.addEventListener("click", () => socket.emit("buy-item", { item: button.dataset.buy })));
demolishButton.addEventListener("click", () => { demolishMode = !demolishMode; buildMode = null; demolishButton.classList.toggle("active", demolishMode); setMode(demolishMode ? "拆卸模式：点击一座炮塔" : "先买一座炮塔，再点击地图放置", demolishMode); });
canvas.addEventListener("pointermove", (event) => { pointerWorld = pointerToWorld(event); input.aimX = pointerWorld.x; input.aimY = pointerWorld.y; });
canvas.addEventListener("pointerdown", (event) => { pointerWorld = pointerToWorld(event); input.aimX = pointerWorld.x; input.aimY = pointerWorld.y; if (event.button === 2) { socket.emit("remove-turret", pointerWorld); return; } if (buildMode) { socket.emit("place-turret", { type: buildMode, ...pointerWorld }); buildMode = null; setMode("先买一座炮塔，再点击地图放置"); return; } if (demolishMode) { socket.emit("remove-turret", pointerWorld); demolishMode = false; demolishButton.classList.remove("active"); setMode("先买一座炮塔，再点击地图放置"); return; } input.shooting = true; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener("pointerup", (event) => { if (event.button === 0) input.shooting = false; }); canvas.addEventListener("pointercancel", () => { input.shooting = false; }); canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => { const direction = keyMap[event.key]; if (direction) { event.preventDefault(); input[direction] = true; } if (event.code === "Space") { event.preventDefault(); input.shooting = true; } }); window.addEventListener("keyup", (event) => { const direction = keyMap[event.key]; if (direction) input[direction] = false; if (event.code === "Space") input.shooting = false; }); window.addEventListener("blur", () => { ["up", "down", "left", "right", "shooting"].forEach((key) => { input[key] = false; }); });
setInterval(() => { if (state?.phase === "playing") socket.emit("player-input", input); }, 50);
socket.on("joined-room", ({ code, playerId }) => { myId = playerId; enterGame(code); });
socket.on("state", (nextState) => { state = { ...nextState, receivedAt: Date.now() }; updateOverlay(); renderScores(); if (nextState.effects?.length) nextState.effects.forEach((item) => effects.push({ ...item, startedAt: performance.now() })); });
socket.on("purchase-success", ({ item, message }) => { showToast(message); if (turretNames[item]) { buildMode = item; demolishMode = false; demolishButton.classList.remove("active"); setMode(`${turretNames[item]} 已购买：点击地图放置`, true); } });
socket.on("error-message", (message) => { if (gameView.classList.contains("active")) showToast(message); else showError(message); }); socket.on("connect_error", () => showError("连接服务器失败，请确认 Render 服务正在运行")); window.addEventListener("resize", resizeCanvas); resizeCanvas(); render();
