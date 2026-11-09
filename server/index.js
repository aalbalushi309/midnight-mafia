/**
 * Midnight Mafia: game server entry point.
 *
 *   npm start          → http://localhost:3000
 *
 * Serves the website (public/ + shared/) and runs the real-time game over Socket.IO.
 */
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const hub = require('./hub');
const { PORT, CHEAT_KEY } = require('./config');
const { serveMedia, dropRoomMedia } = require('./media');
const { rooms } = require('./rooms');
const { clearTimer } = require('./game');
require('./views'); // registers hub.broadcast
const { attachSockets } = require('./sockets');

const ROOT = path.join(__dirname, '..');
const app = express();

// ---------------------------------------------------------------------------
// Privacy & security rules sent with every page. Players come, play and go:
//  • no cookies, accounts, analytics, ads or trackers, and no request logging
//  • the browser may only talk to THIS server (no Google Fonts, CDNs or anything else)
//  • only the microphone may be used (after the player agrees); camera, location,
//    sensors, USB, Bluetooth, screen capture and ad-tracking APIs are switched off
// ---------------------------------------------------------------------------
app.disable('x-powered-by');
app.disable('etag');
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",           // blob: = the tiny built-in audio worklet for voice chat
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=(), bluetooth=(), serial=(), hid=(), payment=(), midi=(), browsing-topics=(), interest-cohort=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.get('/media/:id', serveMedia);

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 3e6, cookie: false }); // no cookies, ever
hub.io = io;
attachSockets(io);

// When everyone has left a room, wipe it completely (names, chat, pictures, voice messages)
// after a short grace period, so a refresh or a phone going to sleep doesn't end the game.
const EMPTY_ROOM_GRACE = +process.env.ROOM_GRACE_MS || 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if ([...room.players.values()].some((p) => p.connected)) { room.emptySince = null; continue; }
    room.emptySince = room.emptySince || now;
    if (now - room.emptySince >= EMPTY_ROOM_GRACE) { clearTimer(room); rooms.delete(code); dropRoomMedia(code); }
  }
}, Math.min(30 * 1000, EMPTY_ROOM_GRACE / 2));

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log('\n🌙  Midnight Mafia is running!');
  console.log(`    On this computer:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`    Friends on your Wi-Fi: http://${ip}:${PORT}`);
  console.log(`\n🤫  Your secret x-ray key: ${CHEAT_KEY}   (keep this to yourself)\n`);
});
