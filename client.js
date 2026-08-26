const socket = io();
const homeView = document.querySelector("#home-view");
const gameView = document.querySelector("#game-view");
const homeName = document.querySelector("#home-name");
const roomCodeInput = document.querySelector("#room-code");
const homeError = document.querySelector("#home-error");
const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");
const arenaOverlay = document.querySelector("#arena-overlay");
const overlayTitle = document.querySelector("#overlay-title");
const overlayCopy = document.querySelector("#overlay-copy");
const startButton = document.querySelector("#start-button");
const timerElement = document.querySelector("#timer");
const arenaTitle = document.querySelector("#arena-title");
const scoreList = document.querySelector("#score-list");
const playerCount = document.querySelector("#player-count");
const roomCodeDisplay = document.querySelector("#room-code-display");
const toast = document.querySelector("#toast");

let state = null;
let myId = null;
let roomCode = "";
let toastTimer = null;
const input = { up: false, down: false, left: false, right: false };
const keyMap = { w: "up", ArrowUp: "up", s: "down", ArrowDown: "down", a: "left", ArrowLeft: "left", d: "right", ArrowRight: "right" };
const effects = [];

function playerName() {
  return homeName.value.trim() || "薯条大王";
}

function showError(message) {
  homeError.textContent = message;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function enterGame(code) {
  roomCode = code;
  roomCodeDisplay.textContent = code;
  homeView.classList.remove("active");
  gameView.classList.add("active");
  resizeCanvas();
}

function leaveGame() {
  window.location.reload();
}

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function updateOverlay() {
  if (!state) return;
  const isHost = state.hostId === myId;
  arenaOverlay.classList.toggle("hidden", state.phase === "playing");
  startButton.classList.toggle("hidden", state.phase !== "lobby" || !isHost);

  if (state.phase === "lobby") {
    startButton.textContent = "开始这一局  →";
    overlayTitle.textContent = state.players.length > 1 ? "人齐了，开抢" : "等朋友进场";
    overlayCopy.textContent = isHost ? "房间号已经准备好，发给朋友吧。" : "等房主开始游戏。";
    arenaTitle.textContent = "准备开抢";
  } else if (state.phase === "playing") {
    arenaTitle.textContent = "正在抢金币";
  } else if (state.phase === "results") {
    const winner = state.players.find((player) => player.id === state.winner);
    overlayTitle.textContent = winner ? `${winner.name} 赢了！` : "这一局结束";
    overlayCopy.textContent = isHost ? "再来一局？金币已经重新准备好了。" : "等房主开启下一局。";
    startButton.classList.toggle("hidden", !isHost);
    startButton.textContent = "再来一局  →";
    arenaTitle.textContent = "本局结算";
  }
}

function renderScores() {
  if (!state) return;
  const players = [...state.players].sort((a, b) => b.score - a.score);
  playerCount.textContent = `${players.length} / 6`;
  scoreList.innerHTML = players.map((player, index) => `
    <div class="score-row">
      <span class="score-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="score-player"><span class="player-color" style="color:${player.color};background:${player.color}"></span><span class="score-name ${player.id === myId ? "you" : ""}">${escapeHtml(player.name)}</span></div>
      <strong class="score-value">${player.score}</strong>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(canvas.width / 1600, 0, 0, canvas.height / 900, 0, 0);
}

function drawBackground() {
  ctx.fillStyle = "#17191d";
  ctx.fillRect(0, 0, 1600, 900);
  ctx.strokeStyle = "rgba(255,255,255,.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1600; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 900); ctx.stroke(); }
  for (let y = 0; y <= 900; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1600, y); ctx.stroke(); }
  ctx.strokeStyle = "rgba(243,181,74,.25)";
  ctx.strokeRect(24, 24, 1552, 852);
}

function drawCoin(coin, now) {
  const pulse = 1 + Math.sin(now / 260 + coin.x) * .08;
  const radius = (coin.value === 3 ? 17 : 11) * pulse;
  ctx.save();
  ctx.shadowBlur = coin.value === 3 ? 28 : 16;
  ctx.shadowColor = coin.value === 3 ? "#ffce6a" : "#d79b32";
  ctx.fillStyle = coin.value === 3 ? "#ffce6a" : "#efb347";
  ctx.beginPath(); ctx.arc(coin.x, coin.y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#6e4b1b";
  ctx.font = `700 ${coin.value === 3 ? 16 : 11}px Space Grotesk`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", coin.x, coin.y + 1);
  ctx.restore();
}

function drawPlayer(player) {
  const isMe = player.id === myId;
  ctx.save();
  ctx.shadowBlur = isMe ? 24 : 14;
  ctx.shadowColor = player.color;
  ctx.fillStyle = player.color;
  ctx.beginPath(); ctx.arc(player.x, player.y, isMe ? 23 : 20, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(16,17,19,.65)"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(player.x, player.y, isMe ? 23 : 20, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#17191d";
  ctx.font = "700 14px Space Grotesk"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(player.name.slice(0, 1).toUpperCase(), player.x, player.y + 1);
  ctx.font = "500 13px Space Grotesk"; ctx.fillStyle = "#f6f2ea";
  const labelWidth = ctx.measureText(player.name).width + 16;
  ctx.fillStyle = "rgba(16,17,19,.82)";
  ctx.fillRect(player.x - labelWidth / 2, player.y - 43, labelWidth, 20);
  ctx.fillStyle = "#f6f2ea"; ctx.fillText(player.name, player.x, player.y - 33);
  ctx.restore();
}

function drawEffects(now) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    const progress = (now - effect.startedAt) / 650;
    if (progress >= 1) { effects.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(effect.x, effect.y, 16 + progress * 32, 0, Math.PI * 2); ctx.stroke();
    ctx.font = "700 17px DM Mono"; ctx.textAlign = "center"; ctx.fillText(`+${effect.value}`, effect.x, effect.y - progress * 30);
    ctx.restore();
  }
}

function render() {
  requestAnimationFrame(render);
  drawBackground();
  const now = performance.now();
  if (state) {
    state.coins.forEach((coin) => drawCoin(coin, now));
    [...state.players].sort((a, b) => a.y - b.y).forEach(drawPlayer);
    drawEffects(now);
    timerElement.textContent = state.phase === "playing" ? formatTime(state.remaining - (Date.now() - (state.receivedAt || Date.now()))) : state.phase === "results" ? "00:00" : "03:00";
  }
}

document.querySelector("#create-button").addEventListener("click", () => {
  homeError.textContent = "";
  socket.emit("create-room", { name: playerName() });
});

document.querySelector("#join-button").addEventListener("click", () => {
  homeError.textContent = "";
  socket.emit("join-room", { name: playerName(), code: roomCodeInput.value });
});

roomCodeInput.addEventListener("input", () => { roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
roomCodeInput.addEventListener("keydown", (event) => { if (event.key === "Enter") document.querySelector("#join-button").click(); });
homeName.addEventListener("keydown", (event) => { if (event.key === "Enter") document.querySelector("#create-button").click(); });

startButton.addEventListener("click", () => socket.emit("start-game"));
document.querySelector("#back-button").addEventListener("click", leaveGame);
document.querySelector("#copy-room").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(roomCode); showToast("房间号已复制"); }
  catch { showToast(`房间号：${roomCode}`); }
});

window.addEventListener("keydown", (event) => {
  const direction = keyMap[event.key];
  if (!direction) return;
  event.preventDefault();
  input[direction] = true;
});
window.addEventListener("keyup", (event) => {
  const direction = keyMap[event.key];
  if (direction) input[direction] = false;
});
window.addEventListener("blur", () => Object.keys(input).forEach((key) => { input[key] = false; }));

document.querySelectorAll(".touch-controls button").forEach((button) => {
  const direction = button.dataset.key;
  const set = (value) => { input[direction] = value; };
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); set(true); });
  button.addEventListener("pointerup", () => set(false));
  button.addEventListener("pointerleave", () => set(false));
});

setInterval(() => {
  if (state?.phase === "playing") socket.emit("player-input", input);
}, 50);

socket.on("joined-room", ({ code, playerId }) => {
  myId = playerId;
  enterGame(code);
});

socket.on("state", (nextState) => {
  const previousCoins = state?.coins || [];
  state = nextState;
  state.receivedAt = Date.now();
  if (previousCoins.length > state.coins.length) {
    const changed = state.players.find((player) => player.id === myId);
    if (changed) effects.push({ x: changed.x, y: changed.y, value: 1, color: changed.color, startedAt: performance.now() });
  }
  updateOverlay();
  renderScores();
});

socket.on("coin-collected", ({ playerId, value }) => {
  const player = state?.players.find((item) => item.id === playerId);
  if (player) effects.push({ x: player.x, y: player.y, value, color: player.color, startedAt: performance.now() });
});

socket.on("error-message", (message) => {
  if (gameView.classList.contains("active")) showToast(message);
  else showError(message);
});

socket.on("connect_error", () => showError("连接服务器失败，请确认你是通过 npm start 启动的"));
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
render();
