/**
 * Settings: the port and the secret x-ray key (the "cheat"), which never leaves the server.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Secret x-ray key (the "cheat"). Only someone who knows this key can unlock it.
// On a cloud host, set it as the CHEAT_KEY environment variable (secret.json is never uploaded).
// On your own computer it lives in secret.json. Neither is ever sent to browsers.
const SECRET_FILE = path.join(__dirname, '..', 'secret.json');
let CHEAT_KEY = (process.env.CHEAT_KEY || '').trim();
if (!CHEAT_KEY) {
  try { CHEAT_KEY = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).cheatKey; } catch (_) { /* create below */ }
  if (!CHEAT_KEY) {
    CHEAT_KEY = crypto.randomBytes(4).toString('hex');
    try { fs.writeFileSync(SECRET_FILE, JSON.stringify({ cheatKey: CHEAT_KEY }, null, 2)); } catch (_) { /* read-only disk: key only lives until restart */ }
  }
}
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { CHEAT_KEY, safeEqual, PORT };
