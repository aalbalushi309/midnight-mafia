/**
 * Runs every test against a fresh server on a spare port:   npm test
 * (Set VERBOSE=1 to also print game logs.)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.TEST_PORT || 3999;
const URL = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const only = process.argv[2];
const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && (!only || f.includes(only))).sort();

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, ['server'], { cwd: ROOT, env: { ...process.env, PORT, ROOM_GRACE_MS: 4000 } });
    let out = '';
    const t = setTimeout(() => reject(new Error('server did not start:\n' + out)), 30000);
    srv.stdout.on('data', (d) => { out += d; if (out.includes('is running')) { clearTimeout(t); srv.ready = true; resolve(srv); } else if (srv.ready) srv.logged += d; });
    srv.logged = '';
    srv.stderr.on('data', (d) => { out += d; if (srv.ready) srv.logged += d; });
    srv.on('exit', (code) => { clearTimeout(t); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
}

function runTest(file) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${file}`);
    const p = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: { ...process.env, TEST_URL: URL } });
    const kill = setTimeout(() => { console.log('  ✘ timed out'); p.kill(); }, 5 * 60 * 1000);
    p.on('exit', (code) => { clearTimeout(kill); resolve(code === 0); });
  });
}

(async () => {
  const srv = await startServer();
  const results = [];
  for (const f of tests) results.push([f, await runTest(f)]);
  srv.removeAllListeners('exit'); srv.kill();
  // Privacy: while dozens of fake players joined, chatted and played, the server must not have
  // written anything about them (no names, no messages, no addresses).
  const extra = srv.logged.trim();
  // anything at all beyond a bare "Error: <message>" line counts as logging about players
  const quiet = extra.split('\n').filter(Boolean).every((line) => /^Error: /.test(line) && !/P\d|Host|Spec|Bot|joined|room [A-Z]{4}|\d+\.\d+\.\d+\.\d+/.test(line));
  console.log('\n▶ server log check');
  console.log(`  ${quiet ? '✔' : '✘ FAIL'} the server logged nothing about any player${extra ? ` (it printed: ${extra.slice(0, 300)})` : ''}`);
  results.push(['server log check', quiet]);
  console.log('\n──────── Summary ────────');
  for (const [f, pass] of results) console.log(`${pass ? '✔' : '✘'} ${f}`);
  const failed = results.filter(([, p]) => !p).length;
  console.log(failed ? `\n${failed} of ${results.length} test files failed.` : `\nAll ${results.length} test files passed.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
