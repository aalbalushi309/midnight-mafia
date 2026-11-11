/**
 * Settings: the port and the secret x-ray key (the "cheat"), which never leaves the server.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Secret x-ray key (the "cheat"). Only someone who knows this key can unlock it. Where it comes from,
// in order:
//   1. the CHEAT_KEY environment variable (e.g. set on a cloud host)
//   2. secret.json on your own computer (never uploaded)
//   3. server/cheat-key.sha256: only a fingerprint (SHA-256) of the key, which IS uploaded with the code,
//      so a cloud host works without any settings. The key itself cannot be read back from it.
// None of these are ever sent to browsers.
const SECRET_FILE = path.join(__dirname, '..', 'secret.json');
const HASH_FILE = path.join(__dirname, 'cheat-key.sha256');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

let CHEAT_KEY = (process.env.CHEAT_KEY || '').trim();
let CHEAT_HASH = '';
if (!CHEAT_KEY) {
  try { CHEAT_KEY = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).cheatKey; } catch (_) { /* try the fingerprint */ }
}
if (!CHEAT_KEY) {
  try { CHEAT_HASH = fs.readFileSync(HASH_FILE, 'utf8').trim().toLowerCase(); } catch (_) { /* make a new key below */ }
  if (!/^[0-9a-f]{64}$/.test(CHEAT_HASH)) {
    CHEAT_HASH = '';
    CHEAT_KEY = crypto.randomBytes(4).toString('hex');
    try { fs.writeFileSync(SECRET_FILE, JSON.stringify({ cheatKey: CHEAT_KEY }, null, 2)); } catch (_) { /* read-only disk: key only lives until restart */ }
  }
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
/** true if `key` is the right x-ray key */
const checkCheatKey = (key) => (CHEAT_KEY ? safeEqual(key, CHEAT_KEY) : safeEqual(sha256(key), CHEAT_HASH));
/** what the startup message shows about the key */
const CHEAT_KEY_HINT = CHEAT_KEY || '(the key matching server/cheat-key.sha256)';

module.exports = { checkCheatKey, CHEAT_KEY_HINT, PORT };
