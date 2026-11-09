// Voice routing rules: who hears whom in lobby / night / day, and a spectator.
const { sleep, client, ok, log, run } = require('./helpers');

const pkt = Buffer.alloc(640, 130);
async function speak(from, all) {
  all.forEach((c) => (c.got = []));
  from.s.emit('v', pkt); await sleep(250);
  return all.filter((c) => c !== from && c.got.some((g) => g.pid === from.view.me)).map((c) => c.name).sort();
}
run(async () => {
  const names = ['Host', 'B', 'C', 'D', 'E', 'F'];
  const cs = names.map(client); await Promise.all(cs.map((c) => c.ready));
  await cs[0].emit('join', { name: 'Host', token: 'vt-Host', create: true }); await sleep(200);
  const code = cs[0].view.code;
  for (const c of cs.slice(1)) await c.emit('join', { name: c.name, token: 'vt-' + c.name, code });
  const spec = client('Spec'); await spec.ready; await spec.emit('join', { name: 'Spec', token: 'vt-spec', code });
  await spec.emit('lobby:spectate', { spectator: true });
  const all = [...cs, spec];
  for (const c of all) await c.emit('voice:join');
  await sleep(300);
  ok(cs[0].view.voice.members.length === 7, 'everyone shows up as in voice: ' + cs[0].view.voice.members.length);
  let heard = await speak(cs[1], all);
  ok(heard.length === 6, 'lobby: everyone hears B -> ' + heard);
  // not in voice -> hears nothing
  await cs[5].emit('voice:leave'); heard = await speak(cs[1], all);
  ok(!heard.includes('F'), 'someone who left voice hears nothing'); await cs[5].emit('voice:join');

  await cs[0].emit('lobby:settings', { hostMode: 'auto', mafiaCount: 2, roles: {} });
  const r = await cs[0].emit('game:start'); ok(r.ok, 'game starts ' + JSON.stringify(r)); await sleep(300);
  log('phase', cs[0].view.game.phase, 'spec?', spec.view.isSpectator);
  const players = cs; const mafia = players.filter((c) => c.view.game.me?.team === 'mafia'); const town = players.filter((c) => c.view.game.me?.team !== 'mafia');
  log('mafia:', mafia.map((c) => c.name), 'hints:', mafia[0].view.voice.text, '|', town[0].view.voice.text);
  ok(cs[0].view.game.phase === 'night', 'it is night');
  heard = await speak(mafia[0], all);
  ok(JSON.stringify(heard) === JSON.stringify([mafia[1].name, 'Spec'].sort()), 'night: mafia heard only by the other mafia + spectator -> ' + heard);
  heard = await speak(town[0], all);
  ok(heard.join() === 'Spec', 'night: sleeping town is heard by nobody playing -> ' + heard);
  ok(!town[0].view.voice.can && mafia[0].view.voice.can, 'hints: town cannot talk at night, mafia can');
  heard = await speak(spec, all);
  ok(heard.length === 0, 'spectator is not heard by living players -> ' + heard);
  // skip to day
  await cs[0].emit('host:advance'); await sleep(400);
  log('phase now', cs[0].view.game.phase);
  const alive = players.filter((c) => c.view.game.players.find((p) => p.id === c.view.me).alive);
  const speaker = alive.find((c) => c.view.voice.can);
  heard = await speak(speaker, all);
  ok(heard.length === 6, 'day: a living player is heard by everyone -> ' + heard);
  const dead = players.find((c) => !c.view.game.players.find((p) => p.id === c.view.me).alive);
  if (dead) { heard = await speak(dead, all); ok(heard.every((n) => n === 'Spec' || !players.find((c) => c.name === n).view.game.players.find((p) => p.id === players.find((c) => c.name === n).view.me).alive), 'day: dead player only heard by dead/spectators -> ' + heard); }
  else log('(nobody died at night)');
});
