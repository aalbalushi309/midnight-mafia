// Stickers / pictures / voice messages: validation, privacy, headers.
const { URL, sleep, client, ok, run } = require('./helpers');

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
function wav(n) { const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; }
run(async () => {
  const cs = Array.from({ length: 5 }, client); await Promise.all(cs.map((c) => c.ready));
  await cs[0].emit('join', { name: 'A', token: 'mt-A', create: true }); await sleep(200);
  const code = cs[0].view.code;
  for (let i = 1; i < 5; i++) await cs[i].emit('join', { name: 'P' + i, token: 'mt-' + i, code });
  let r = await cs[1].emit('chat:sticker', { channel: 'town', sticker: 'sus' }); ok(r.ok, 'sticker sends');
  r = await cs[1].emit('chat:sticker', { channel: 'town', sticker: '__proto__' }); ok(r.error, 'unknown sticker refused');
  r = await cs[2].emit('chat:media', { channel: 'town', mime: 'image/jpeg', data: jpeg, w: 1, h: 1 }); ok(r.ok, 'picture sends ' + JSON.stringify(r));
  await sleep(200);
  const img = cs[3].view.chat.town.find((m) => m.kind === 'img'); ok(img && img.media.length === 32, 'others see the picture with a random id');
  let res = await fetch(`${URL}/media/${img.media}`); ok(res.status === 200 && res.headers.get('content-type') === 'image/jpeg', 'picture downloads as image/jpeg');
  ok(res.headers.get('content-security-policy') === "default-src 'none'", 'media is served locked down');
  r = await cs[2].emit('chat:media', { channel: 'town', mime: 'image/jpeg', data: jpeg }); ok(r.error && /Slow/.test(r.error), 'spam guard: ' + r.error);
  await sleep(1600);
  r = await cs[2].emit('chat:media', { channel: 'town', mime: 'image/jpeg', data: Buffer.from('<script>alert(1)</script>') }); ok(r.error, 'fake picture (html) refused: ' + r.error);
  await sleep(1600);
  r = await cs[2].emit('chat:media', { channel: 'town', mime: 'text/html', data: Buffer.from('<b>') }); ok(r.error, 'html upload refused');
  r = await cs[3].emit('chat:media', { channel: 'town', mime: 'audio/wav', data: wav(16000), dur: 1 }); ok(r.ok, 'voice message sends');
  await sleep(200);
  const au = cs[0].view.chat.town.find((m) => m.kind === 'audio'); ok(au && au.dur === 1, 'voice message shows with its length');
  res = await fetch(`${URL}/media/${au.media}`); ok(res.status === 200 && res.headers.get('content-type') === 'audio/wav', 'voice message downloads as wav');
  res = await fetch(`${URL}/`); ok(/camera=\(\)/.test(res.headers.get('permissions-policy') || '') && /geolocation=\(\)/.test(res.headers.get('permissions-policy')), 'site blocks camera + location: ' + res.headers.get('permissions-policy').slice(0, 60));
  // mafia-only pictures stay with the mafia
  await cs[0].emit('lobby:settings', { hostMode: 'auto', mafiaCount: 1, roles: {} }); await cs[0].emit('game:start'); await sleep(300);
  const maf = cs.find((c) => c.view.game.me?.team === 'mafia'); const town = cs.find((c) => c.view.game.me && c.view.game.me.team !== 'mafia');
  await sleep(1600); // stay under the anti-spam limit (1 file per 1.5 s)
  r = await maf.emit('chat:media', { channel: 'mafia', mime: 'image/jpeg', data: jpeg, w: 1, h: 1 }); ok(r.ok, 'mafia sends a picture to the mafia chat at night');
  await sleep(200);
  const id = maf.view.chat.mafia.find((m) => m.kind === 'img')?.media;
  ok(id && !JSON.stringify(town.view).includes(id), 'town never receives the mafia picture id');
  r = await town.emit('chat:sticker', { channel: 'town', sticker: 'lol' }); ok(r.error, 'sleeping town cannot send stickers at night: ' + r.error);
});
