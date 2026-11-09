/**
 * Shared helpers for the test scripts. Each test connects fake players to a
 * running server (TEST_URL, default http://localhost:3000) and checks results.
 */
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const URL = process.env.TEST_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const cheatKey = () => process.env.CHEAT_KEY || JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'secret.json'), 'utf8')).cheatKey;

/** A fake player: `c.view` always holds the latest state the server sent them. */
function client(name) {
  const s = io(URL, { forceNew: true });
  const c = { name, s, view: null, token: `${name}-${Math.random().toString(36).slice(2)}`, got: [] };
  s.on('state', (v) => { c.view = v; });
  s.on('v', (pid, buf) => c.got.push({ pid, len: buf.byteLength ?? buf.length }));
  c.emit = (ev, d) => new Promise((r) => s.emit(ev, d, (x) => r(x || {})));
  c.ready = new Promise((r) => (s.connected ? r() : s.once('connect', r)));
  return c;
}

/** Creates a room with `host` and lets the others join it. Returns the room code. */
async function makeRoom(host, others = []) {
  await host.ready;
  const r = await host.emit('join', { name: host.name, token: host.token, create: true });
  if (r.error) throw new Error('create: ' + r.error);
  await sleep(100);
  const code = host.view.code;
  for (const c of others) {
    await c.ready;
    const j = await c.emit('join', { name: c.name, token: c.token, code });
    if (j.error) throw new Error(`${c.name} join: ${j.error}`);
  }
  await sleep(100);
  return code;
}

let failures = 0;
const verbose = !!process.env.VERBOSE;
/** Records one check. */
function ok(cond, msg) {
  if (!cond) failures++;
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
}
const log = (...a) => { if (verbose) console.log('   ', ...a); };
/** Ends the test with an honest exit code. */
function done() {
  console.log(failures ? `  ${failures} check(s) FAILED` : '  all checks passed');
  process.exit(failures ? 1 : 0);
}
/** Wraps a test body so crashes count as failures. */
function run(fn) {
  fn().then(done, (e) => { console.error('  ✘ CRASH', e); process.exit(1); });
}

module.exports = { URL, sleep, pick, cheatKey, client, makeRoom, ok, log, run };
