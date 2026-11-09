// Voice rules: lobby = everyone; night & verdict = only the host; day & voting = every living player.
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

  // A host who sits out and narrates; B–F play
  await cs[0].emit('lobby:settings', { hostMode: 'player', hostPlays: false, mafiaCount: 1, roles: {} });
  await cs[0].emit('lobby:setHost', { playerId: cs[0].view.me });
  const r = await cs[0].emit('game:start'); ok(r.ok, 'game starts ' + JSON.stringify(r)); await sleep(300);
  const host = cs[0]; const players = cs.slice(1);
  const mafia = players.filter((c) => c.view.game.me?.team === 'mafia'); const town = players.filter((c) => c.view.game.me && c.view.game.me.team !== 'mafia');
  const isAlive = (c) => c.view.game.players.find((p) => p.id === c.view.me)?.alive;

  ok(host.view.game.phase === 'night', 'it is night');
  heard = await speak(host, all);
  ok(heard.length === 6, 'night: the host is heard by everyone -> ' + heard);
  heard = await speak(mafia[0], all);
  ok(heard.length === 0, 'night: a Mafia player is heard by nobody (only the host talks) -> ' + heard);
  heard = await speak(town[0], all);
  ok(heard.length === 0, 'night: a town player is heard by nobody -> ' + heard);
  heard = await speak(spec, all);
  ok(heard.length === 0, 'night: a spectator is heard by nobody -> ' + heard);
  ok(!mafia[0].view.voice.can && !town[0].view.voice.can && host.view.voice.can, 'night hints: players see "only the host talks now", the host can talk');
  log('night hint:', town[0].view.voice.text);

  // Day discussion: everyone alive talks
  await host.emit('host:advance'); await sleep(400);
  ok(host.view.game.phase === 'day', 'it is day');
  let speaker = players.find((c) => isAlive(c) && c.view.voice.can);
  heard = await speak(speaker, all);
  ok(heard.length === 6, 'day: a living player is heard by everyone -> ' + heard);
  const dead = players.find((c) => !isAlive(c));
  if (dead) { heard = await speak(dead, all); ok(heard.every((n) => n === 'Spec' || n === 'Host' || !isAlive(all.find((c) => c.name === n))), 'day: a dead player is only heard by the dead, spectators and host -> ' + heard); }

  // Voting: everyone alive talks
  await host.emit('host:advance'); await sleep(400);
  ok(host.view.game.phase === 'voting', 'it is voting time');
  speaker = players.find((c) => isAlive(c) && c.view.voice.can);
  heard = await speak(speaker, all);
  ok(heard.length === 6, 'voting: a living player is heard by everyone -> ' + heard);

  // Verdict: only the host talks again
  for (const c of players) if (isAlive(c)) { const t = c.view.game.players.find((p) => p.alive && p.id !== c.view.me); await c.emit('vote', { target: t.id }); }
  await host.emit('host:advance'); await sleep(400);
  if (host.view.game.phase === 'verdict') {
    heard = await speak(players.find(isAlive), all);
    ok(heard.length === 0, 'verdict: players are heard by nobody -> ' + heard);
    heard = await speak(host, all);
    ok(heard.length === 6, 'verdict: the host is heard by everyone -> ' + heard);
  } else log('(game moved past the verdict:', host.view.game.phase + ')');
});
