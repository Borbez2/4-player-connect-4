const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = 4321;
const MAX_PLAYERS = 4;

const PLAYER_META = [
  { name: "Red",    color: "#ef4444" },
  { name: "Yellow", color: "#facc15" },
  { name: "Blue",   color: "#3b82f6" },
  { name: "Green",  color: "#22c55e" },
];

// Classic mode
const CLASSIC_ROWS = 7;
const CLASSIC_COLS = 9;

// 3D mode
const D3_SIZE = 4;

// ── Room management ──

const rooms = new Map();
let nextRoomId = 1;

function generateCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function createRoom(opts) {
  const id = String(nextRoomId++);
  const room = {
    id,
    name: opts.name || `Room ${id}`,
    isPublic: !!opts.isPublic,
    gameMode: opts.gameMode === "3d" ? "3d" : "classic",
    code: opts.isPublic ? null : generateCode(),
    slots: [null, null, null, null],
    customizations: [null, null, null, null],
    board: null,
    turn: 0,
    phase: "lobby",
    winResult: null,
    wins: [0, 0, 0, 0],
  };
  rooms.set(id, room);
  return room;
}

function getPublicRooms() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.isPublic) {
      list.push({
        id: room.id,
        name: room.name,
        gameMode: room.gameMode,
        playerCount: room.slots.filter(s => s !== null).length,
        maxPlayers: MAX_PLAYERS,
        phase: room.phase,
      });
    }
  }
  return list;
}

function findRoomByCode(code) {
  for (const room of rooms.values()) {
    if (!room.isPublic && room.code === code.toUpperCase()) return room;
  }
  return null;
}

// ── Board helpers ──

function createClassicBoard() {
  return Array.from({ length: CLASSIC_ROWS }, () => Array(CLASSIC_COLS).fill(null));
}

function create3DBoard() {
  return Array.from({ length: D3_SIZE }, () =>
    Array.from({ length: D3_SIZE }, () => Array(D3_SIZE).fill(null))
  );
}

function activeSlots(room) {
  return room.slots.map((id, i) => (id !== null ? i : -1)).filter(i => i !== -1);
}

function currentSlot(room) {
  const a = activeSlots(room);
  return a.length === 0 ? null : a[room.turn % a.length];
}

function hostSlot(room) {
  return room.slots.findIndex(s => s !== null);
}

// ── Win detection (classic) ──

const CLASSIC_DIRS = [[0,1],[1,0],[1,1],[1,-1]];

function checkClassicWin(board) {
  for (let r = 0; r < CLASSIC_ROWS; r++) {
    for (let c = 0; c < CLASSIC_COLS; c++) {
      const p = board[r][c];
      if (p === null) continue;
      for (const [dr, dc] of CLASSIC_DIRS) {
        const cells = [[r, c]];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i, nc = c + dc * i;
          if (nr < 0 || nr >= CLASSIC_ROWS || nc < 0 || nc >= CLASSIC_COLS) break;
          if (board[nr][nc] !== p) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) return { slotIndex: p, cells };
      }
    }
  }
  return null;
}

function isClassicBoardFull(board) {
  return board[0].every(c => c !== null);
}

// ── Win detection (3D) ──

const D3_DIRS = [
  [1,0,0],[0,1,0],[0,0,1],
  [1,1,0],[1,-1,0],[1,0,1],[1,0,-1],[0,1,1],[0,1,-1],
  [1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],
];

function check3DWin(board) {
  for (let y = 0; y < D3_SIZE; y++) {
    for (let x = 0; x < D3_SIZE; x++) {
      for (let z = 0; z < D3_SIZE; z++) {
        const p = board[y][x][z];
        if (p === null) continue;
        for (const [dy, dx, dz] of D3_DIRS) {
          const cells = [[y, x, z]];
          for (let i = 1; i < 4; i++) {
            const ny = y+dy*i, nx = x+dx*i, nz = z+dz*i;
            if (ny<0||ny>=D3_SIZE||nx<0||nx>=D3_SIZE||nz<0||nz>=D3_SIZE) break;
            if (board[ny][nx][nz] !== p) break;
            cells.push([ny, nx, nz]);
          }
          if (cells.length === 4) return { slotIndex: p, cells };
        }
      }
    }
  }
  return null;
}

function is3DBoardFull(board) {
  for (let x = 0; x < D3_SIZE; x++)
    for (let z = 0; z < D3_SIZE; z++)
      if (board[D3_SIZE-1][x][z] === null) return false;
  return true;
}

// ── State snapshot ──

function buildRoomState(room) {
  return {
    id: room.id,
    name: room.name,
    isPublic: room.isPublic,
    code: room.code,
    gameMode: room.gameMode,
    hostSlot: hostSlot(room),
    slots: room.slots.map((id, i) => ({
      occupied: id !== null,
      name: room.customizations[i]?.name || PLAYER_META[i].name,
      color: room.customizations[i]?.color || PLAYER_META[i].color,
    })),
    board: room.board,
    phase: room.phase,
    currentSlot: currentSlot(room),
    winResult: room.winResult,
    wins: room.wins,
  };
}

// ── Express + Socket.IO ──

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname)));

io.on("connection", (socket) => {
  socket.data.roomId = null;
  socket.data.slotIndex = null;

  // ── Create Room ──
  socket.on("createRoom", ({ name, isPublic, gameMode }, cb) => {
    if (socket.data.roomId) return;
    const sanitized = typeof name === "string" ? name.slice(0, 30).trim() : "";
    const room = createRoom({
      name: sanitized || undefined,
      isPublic: !!isPublic,
      gameMode: gameMode === "3d" ? "3d" : "classic",
    });
    room.slots[0] = socket.id;
    socket.data.roomId = room.id;
    socket.data.slotIndex = 0;
    socket.join(room.id);
    if (typeof cb === "function") cb({ roomId: room.id, code: room.code, slotIndex: 0 });
    io.to(room.id).emit("roomState", buildRoomState(room));
    io.emit("publicRooms", getPublicRooms());
  });

  // ── List Rooms ──
  socket.on("listRooms", (_, cb) => {
    if (typeof cb === "function") cb(getPublicRooms());
  });

  // ── Join Room by ID ──
  socket.on("joinRoom", ({ roomId }, cb) => {
    if (socket.data.roomId) return;
    const room = rooms.get(roomId);
    if (!room) return void (typeof cb === "function" && cb({ error: "Room not found." }));
    if (room.phase !== "lobby") return void (typeof cb === "function" && cb({ error: "Game already in progress." }));
    const si = room.slots.findIndex(s => s === null);
    if (si === -1) return void (typeof cb === "function" && cb({ error: "Room is full." }));
    room.slots[si] = socket.id;
    socket.data.roomId = room.id;
    socket.data.slotIndex = si;
    socket.join(room.id);
    if (typeof cb === "function") cb({ slotIndex: si });
    io.to(room.id).emit("roomState", buildRoomState(room));
    io.emit("publicRooms", getPublicRooms());
  });

  // ── Join by Code ──
  socket.on("joinByCode", ({ code }, cb) => {
    if (socket.data.roomId) return;
    if (typeof code !== "string") return void (typeof cb === "function" && cb({ error: "Invalid code." }));
    const room = findRoomByCode(code.trim());
    if (!room) return void (typeof cb === "function" && cb({ error: "Room not found." }));
    if (room.phase !== "lobby") return void (typeof cb === "function" && cb({ error: "Game in progress." }));
    const si = room.slots.findIndex(s => s === null);
    if (si === -1) return void (typeof cb === "function" && cb({ error: "Room is full." }));
    room.slots[si] = socket.id;
    socket.data.roomId = room.id;
    socket.data.slotIndex = si;
    socket.join(room.id);
    if (typeof cb === "function") cb({ slotIndex: si });
    io.to(room.id).emit("roomState", buildRoomState(room));
    io.emit("publicRooms", getPublicRooms());
  });

  // ── Leave Room ──
  socket.on("leaveRoom", () => leaveRoom(socket));

  // ── Start Game ──
  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    if (socket.data.slotIndex !== hostSlot(room)) return;
    if (room.phase !== "lobby") return;
    if (activeSlots(room).length < 2) return;
    room.phase = "playing";
    room.turn = 0;
    room.winResult = null;
    room.board = room.gameMode === "3d" ? create3DBoard() : createClassicBoard();
    io.to(room.id).emit("roomState", buildRoomState(room));
    io.emit("publicRooms", getPublicRooms());
  });

  // ── Drop Disc (classic) ──
  socket.on("dropDisc", ({ col }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.gameMode !== "classic" || room.phase !== "playing") return;
    if (!Number.isInteger(col) || col < 0 || col >= CLASSIC_COLS) return;
    if (socket.data.slotIndex !== currentSlot(room)) return;
    let row = -1;
    for (let r = CLASSIC_ROWS - 1; r >= 0; r--) {
      if (room.board[r][col] === null) { row = r; break; }
    }
    if (row === -1) return;
    room.board[row][col] = socket.data.slotIndex;
    const win = checkClassicWin(room.board);
    if (win) { room.winResult = win; room.phase = "ended"; room.wins[win.slotIndex]++; }
    else if (isClassicBoardFull(room.board)) { room.phase = "ended"; }
    else { room.turn = (room.turn + 1) % activeSlots(room).length; }
    io.to(room.id).emit("roomState", buildRoomState(room));
  });

  // ── Drop Disc (3D) ──
  socket.on("dropDisc3D", ({ x, z }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.gameMode !== "3d" || room.phase !== "playing") return;
    if (!Number.isInteger(x) || !Number.isInteger(z)) return;
    if (x < 0 || x >= D3_SIZE || z < 0 || z >= D3_SIZE) return;
    if (socket.data.slotIndex !== currentSlot(room)) return;
    let y = -1;
    for (let ly = 0; ly < D3_SIZE; ly++) {
      if (room.board[ly][x][z] === null) { y = ly; break; }
    }
    if (y === -1) return;
    room.board[y][x][z] = socket.data.slotIndex;
    const win = check3DWin(room.board);
    if (win) { room.winResult = win; room.phase = "ended"; room.wins[win.slotIndex]++; }
    else if (is3DBoardFull(room.board)) { room.phase = "ended"; }
    else { room.turn = (room.turn + 1) % activeSlots(room).length; }
    io.to(room.id).emit("roomState", buildRoomState(room));
  });

  // ── Rematch (after game end) ──
  socket.on("rematch", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== "ended") return;
    if (socket.data.slotIndex !== hostSlot(room)) return;
    room.phase = "playing";
    room.turn = 0;
    room.winResult = null;
    room.board = room.gameMode === "3d" ? create3DBoard() : createClassicBoard();
    io.to(room.id).emit("roomState", buildRoomState(room));
  });

  // ── Restart (mid-game, host only) ──
  socket.on("restart", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    if (socket.data.slotIndex !== hostSlot(room)) return;
    if (room.phase !== "playing" && room.phase !== "ended") return;
    room.phase = "playing";
    room.turn = 0;
    room.winResult = null;
    room.board = room.gameMode === "3d" ? create3DBoard() : createClassicBoard();
    io.to(room.id).emit("roomState", buildRoomState(room));
  });

  // ── Set Player Customization ──
  socket.on("setPlayerCustomization", ({ name, color }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== "lobby") return;
    const si = socket.data.slotIndex;
    if (si === null || si === undefined) return;
    const safeName = (typeof name === "string" ? name.slice(0, 20).trim() : "") || PLAYER_META[si].name;
    const colorStr = typeof color === "string" ? color.trim() : "";
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(colorStr) ? colorStr : PLAYER_META[si].color;
    room.customizations[si] = { name: safeName, color: safeColor };
    io.to(room.id).emit("roomState", buildRoomState(room));
  });

  // ── Disconnect ──
  socket.on("disconnect", () => leaveRoom(socket));

  function leaveRoom(sock) {
    const rid = sock.data.roomId;
    if (!rid) return;
    const room = rooms.get(rid);
    if (!room) return;
    const si = sock.data.slotIndex;
    if (si !== null && si !== undefined) {
      room.slots[si] = null;
      room.customizations[si] = null;
    }
    sock.data.roomId = null;
    sock.data.slotIndex = null;
    sock.leave(rid);

    const active = activeSlots(room);
    if (active.length === 0) {
      rooms.delete(rid);
      io.emit("publicRooms", getPublicRooms());
      return;
    }
    if (room.phase === "playing") {
      if (active.length < 2) room.phase = "ended";
      else room.turn = room.turn % active.length;
    }
    io.to(rid).emit("roomState", buildRoomState(room));
    io.emit("publicRooms", getPublicRooms());
  }

  socket.emit("publicRooms", getPublicRooms());
});

server.listen(PORT, "0.0.0.0", () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === "IPv4" && !n.internal) addrs.push(n.address);
    }
  }
  // Prefer a typical LAN address (192.168.x or 10.x), otherwise use the first available
  const networkAddr =
    addrs.find(a => a.startsWith("192.168.") || a.startsWith("10.")) ||
    addrs[0];
  console.log(`\n  Connect 4 server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  if (networkAddr) console.log(`  Network: http://${networkAddr}:${PORT}`);
  console.log(`\n  Share the Network URL with players on the same WiFi.\n`);
});
