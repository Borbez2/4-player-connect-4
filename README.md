# 4-Player Connect 4

A browser-based Connect 4 game for 2 to 4 players over a local network. One person runs the server and everyone else on the same wifi joins from their browser.

## Setup

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser. You are automatically the host (slot 1). The terminal will also print your local network address - share that with up to 3 other players on the same wifi.

## How it works

- First 4 people to connect each get a color slot (Red, Yellow, Blue, Green)
- The host (first to join) can start the game once at least 2 players are in
- Players take turns dropping discs by clicking a column
- First to get 4 in a row horizontally, vertically, or diagonally wins
- After the game ends, the host can start a rematch

## Requirements

- Node.js

## Stack

- Express (static file serving)
- Socket.io (real-time game state sync)
