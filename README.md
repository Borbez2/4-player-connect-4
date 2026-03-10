# 4-Player Connect 4

A web-based connect 4 game for 2-4 players over a local network. One person runs the server on their machine and everyone else joins through a browser, as long as you're all on the same WiFi.

## Setup

Clone the repository and install dependencies in your prefered IDE:

```bash
git clone https://github.com/Borbez2/4-player-connect-4.git
cd 4-player-connect-4
npm install
```

## Starting the server

```bash
npm start
```

You should see something like:

```
  Connect 4 server running!

  Local:   http://localhost:3000
  Network: http://XXX.XXX.X.XX:3000

  Share the Network URL with players on the same WiFi.
```

Copy the Network URL and share it with other players on the same WiFi.

To stop the server, press `Ctrl+C` in the same terminal window where it's running. If it doesn't respond, run:

```bash
kill $(lsof -t -i:3000)
```

## How it works

- Anyone can create a room, either public (visible in the lobby) or private (join by code)
- Up to 4 players per room, each assigned a colour slot (Red, Yellow, Blue, Green)
- The host can start the game once at least 2 players have joined
- Players take turns dropping discs by clicking a column
- First to get 4 in a row horizontally, vertically, or diagonally wins
- After the game ends, the host can start a rematch

## Requirements

- **Node.js**, which is the runtime that actually executes the server code. Download it from [nodejs.org](https://nodejs.org) (just grab the LTS version). Running `npm install` after cloning will automatically install everything else.

## Stack

- **Express** — is the `index.html` and any other static files to players' browsers when they visit the URL.
- **Socket.io** — It is used to keep all players in sync in real-time