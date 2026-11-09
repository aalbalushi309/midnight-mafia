/**
 * Pictures and voice messages sent in the chat. Kept in memory only, until the room closes.
 */
const crypto = require('crypto');

// Their ids are long and random and only ever sent to people who can read that chat.
const MEDIA_TYPES = { 'image/jpeg': 'img', 'image/png': 'img', 'image/webp': 'img', 'image/gif': 'img', 'audio/wav': 'audio' };
const media = new Map(); // id -> { room, buf, mime, t }
let mediaBytes = 0;
const MEDIA_MAX_TOTAL = 300 * 1024 * 1024;
function dropMedia(id) { const m = media.get(id); if (m) { mediaBytes -= m.buf.length; media.delete(id); } }
function dropRoomMedia(code) { for (const [id, m] of media) if (m.room === code) dropMedia(id); }
function storeMedia(room, buf, mime) {
  const mine = [...media.entries()].filter(([, m]) => m.room === room.code);
  if (mine.length >= 120) dropMedia(mine[0][0]);
  while (mediaBytes + buf.length > MEDIA_MAX_TOTAL && media.size) dropMedia(media.keys().next().value);
  const id = crypto.randomBytes(16).toString('hex');
  media.set(id, { room: room.code, buf, mime, t: Date.now() }); mediaBytes += buf.length;
  return id;
}

// Serves one picture or voice message, locked down so a file can never run as a web page.
function serveMedia(req, res) {
  const m = media.get(String(req.params.id));
  if (!m) return res.status(404).send('This picture or voice message has expired.');
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Cache-Control', 'no-store'); // never saved in the browser's cache
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.send(m.buf);
}

module.exports = { MEDIA_TYPES, storeMedia, dropRoomMedia, serveMedia };
