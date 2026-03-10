const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const os = require("os");

// constants

const PORT = 3000;
const ROWS = 7;
const COLS = 9;
const MAX_PLAYERS = 4;

const PLAYER_META = [
  { name: "Red",    color: "#ef4444" },
  { name: "Yellow", color: "#facc15" },
  { name: "Blue",   color: "#3b82f6" },
  { name: "Green",  color: "#22c55e" },
];

// game state
// slots[0..3]: socket.id | null, phase: "lobby" | "playing" | "ended"
let slots = [null, null, null, null];
let board = createEmptyBoard();
let turn = 0;          // index into active slot list
let phase = "lobby";
let winResult = null;  // { slotIndex, cells } | null

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// returns filled slot indices in order
function activeSlots() {
  return slots.map((id, i) => (id !== null ? i : -1)).filter(i => i !== -1);
}

// returns the slot index of whoever's turn it is
function currentSlot() {
  const active = activeSlots();
  if (active.length === 0) return null;
  return active[turn % active.length];
}

// win detection

const DIRECTIONS = [
  [0, 1],  // horizontal
  [1, 0],  // vertical
  [1, 1],  // diagonal ↘
  [1, -1], // diagonal ↙
];

function checkWin(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const player = board[r][c];
      if (player === null) continue;
      for (const [dr, dc] of DIRECTIONS) {
        const cells = [[r, c]];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[nr][nc] !== player) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) return { slotIndex: player, cells };
      }
    }
  }
  return null;
}

function isBoardFull(board) {
  return board[0].every((cell) => cell !== null);
}

// state snapshot sent to all clients

function buildState() {
  return {
    slots: slots.map((id, i) => ({
      occupied: id !== null,
      name: PLAYER_META[i].name,
      color: PLAYER_META[i].color,
    })),
    board,
    phase,
    currentSlot: currentSlot(),
    winResult,
  };
}

// express + socket.io setup

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname)));

// socket handlers

io.on("connection", (socket) => {
  // Assign a slot
  const slotIndex = slots.findIndex((id) => id === null);

  if (phase !== "lobby" || slotIndex === -1) {
    // Game in progress or lobby full
    socket.emit("rejected", {
      reason:
        phase !== "lobby"
          ? "Game already in progress."
          : "Lobby is full (max 4 players).",
    });
    socket.disconnect(true);
    return;
  }

  slots[slotIndex] = socket.id;
  socket.data.slotIndex = slotIndex;

  // Tell the joining player their slot
  socket.emit("assigned", { slotIndex });

  // Broadcast updated lobby state to everyone
  io.emit("stateUpdate", buildState());

  // start game (host = slot 0 only)
  socket.on("startGame", () => {
    if (socket.data.slotIndex !== 0) return; // only host can start
    if (phase !== "lobby") return;
    const count = activeSlots().length;
    if (count < 2) return; // need at least 2

    phase = "playing";
    turn = 0;
    board = createEmptyBoard();
    winResult = null;
    io.emit("stateUpdate", buildState());
  });

  // drop a disc into a column
  socket.on("dropDisc", ({ col }) => {
    if (phase !== "playing") return;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return;

    // Must be the active player
    if (socket.data.slotIndex !== currentSlot()) return;

    // Find lowest empty row
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === null) {
        row = r;
        break;
      }
    }
    if (row === -1) return; // column full

    board[row][col] = socket.data.slotIndex;

    const win = checkWin(board);
    if (win) {
      winResult = win;
      phase = "ended";
    } else if (isBoardFull(board)) {
      phase = "ended";
    } else {
      // Advance turn, skipping empty slots
      const active = activeSlots();
      turn = (turn + 1) % active.length;
    }

    io.emit("stateUpdate", buildState());
  });

  // rematch (host only)
  socket.on("rematch", () => {
    if (socket.data.slotIndex !== 0) return;
    if (phase !== "ended") return;

    board = createEmptyBoard();
    turn = 0;
    phase = "playing";
    winResult = null;
    io.emit("stateUpdate", buildState());
  });

  // handle disconnect
  socket.on("disconnect", () => {
    const si = socket.data.slotIndex;
    if (si === undefined) return;
    slots[si] = null;

    if (phase === "playing") {
      const active = activeSlots();
      if (active.length < 2) {
        // Not enough players to continue
        phase = "ended";
        io.emit("stateUpdate", buildState());
      } else {
        // Keep turn pointer valid
        turn = turn % active.length;
        io.emit("stateUpdate", buildState());
      }
    } else {
      io.emit("stateUpdate", buildState());
    }
  });
});

// start server

server.listen(PORT, "0.0.0.0", () => {
  // Print local network addresses
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  console.log(`\n  Connect 4 server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  addresses.forEach((a) => console.log(`  Network: http://${a}:${PORT}`));
  console.log(`\n  Share the Network URL with players on the same WiFi.\n`);
});
