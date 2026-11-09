// Privacy: no outside connections, no cookies, no tracking, strict browser rules,
// nothing cached, and rooms are wiped after everyone leaves.
const fs = require('fs');
const path = require('path');
const { URL, sleep, client, makeRoom, ok, run } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const SHARED = path.join(__dirname, '..', 'shared');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));

run(async () => {
  // 1. The website never loads anything from another server
  const outside = [];
  for (const f of [...files(PUBLIC), ...files(SHARED)].filter((f) => /\.(html|js|css|webmanifest|svg)$/.test(f))) {
    const text = fs.readFileSync(f, 'utf8').replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    for (const m of text.matchAll(/https?:\/\/(?!localhost)[\w.-]+/g)) outside.push(`${path.relative(PUBLIC, f)}: ${m[0]}`);
  }
  ok(outside.length === 0, 'the website contains no links to outside servers' + (outside.length ? ': ' + outside.join(', ') : ''));
  const js = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');
  ok(!/sendBeacon|analytics|gtag|fbq|document\.cookie|navigator\.geolocation|getCurrentPosition|enumerateDevices/.test(js), 'no tracking, cookies, location or device scanning in the game code');
  ok(!/video:\s*true/.test(js) && /video:\s*false/.test(js), 'the microphone request explicitly says: no camera');
  ok(!/localStorage\.setItem\(k/.test(js.replace("LONG_TERM.has(k) ? localStorage", '')), 'player data is kept only for the open tab (sessionStorage)');

  // 2. Strict rules on every page
  const res = await fetch(URL + '/');
  const h = (k) => res.headers.get(k) || '';
  ok(!h('set-cookie'), 'no cookies are set');
  ok(/default-src 'self'/.test(h('content-security-policy')) && /connect-src 'self'/.test(h('content-security-policy')), 'browser is told to only ever talk to this server (Content-Security-Policy)');
  ok(/camera=\(\)/.test(h('permissions-policy')) && /geolocation=\(\)/.test(h('permissions-policy')) && /browsing-topics=\(\)/.test(h('permissions-policy')), 'camera, location and ad-tracking APIs are switched off');
  ok(h('referrer-policy') === 'no-referrer', 'no referrer is ever sent');
  ok(!h('x-powered-by'), 'server does not announce what software it runs');
  const sio = await fetch(URL + '/socket.io/?EIO=4&transport=polling');
  ok(!sio.headers.get('set-cookie'), 'the live connection sets no cookies either');

  // 3. Pictures are never cached, and a room is wiped after everyone leaves
  const a = client('A'); const b = client('B');
  const code = await makeRoom(a, [b]);
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  await a.emit('chat:media', { channel: 'town', mime: 'image/jpeg', data: jpeg, w: 1, h: 1 });
  await sleep(150);
  const id = b.view.chat.town.find((m) => m.kind === 'img')?.media;
  const pic = await fetch(`${URL}/media/${id}`);
  ok(pic.status === 200 && pic.headers.get('cache-control') === 'no-store', 'chat pictures are never stored in the browser cache');
  a.s.disconnect(); b.s.disconnect();
  const grace = 4000; // the test server uses a short grace period (real server: 5 minutes)
  await sleep(grace + 3000);
  const gone = await fetch(`${URL}/media/${id}`);
  ok(gone.status === 404, 'after everyone leaves, the room\'s pictures are deleted');
  const c = client('C'); await c.ready;
  const r = await c.emit('join', { name: 'C', token: 'priv-c', code });
  ok(r.error && /no room/i.test(r.error), 'after everyone leaves, the room itself (names, chat) is gone');
  c.s.close();
});
