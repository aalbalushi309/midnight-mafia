// Plays three complete games covering every role, in both host modes,
// and checks that secret roles never leak (except through the x-ray cheat).
const { ROLES } = require('../shared/roles');
const { sleep, pick, cheatKey, client, makeRoom, ok, log, run } = require('./helpers');

const MAFIA = ['mafioso', 'godfather', 'framer', 'consigliere', 'silencer', 'janitor', 'consort'];

async function playGame(label, mode, n, roles) {
  console.log(`\n ${label}`);
  const host = client('Host');
  const ps = Array.from({ length: n }, (_, i) => client('P' + (i + 1)));
  await makeRoom(host, ps);
  const all = mode === 'player' ? ps : [host, ...ps];
  await host.emit('lobby:settings', { hostMode: mode });
  if (mode === 'player') await host.emit('lobby:setHost', { playerId: host.view.me });
  await host.emit('lobby:settings', { maxPlayers: 20 });
  for (const c of ps) await c.emit('lobby:spectate', { spectator: false });
  await host.emit('lobby:settings', { roles, mafiaCount: 2, nightSec: 15, discussionSec: 15, votingSec: 10 });

  // the x-ray cheat: wrong key refused, right key works — only for P1
  ok((await ps[0].emit('xray:unlock', { key: 'wrong' })).error, 'x-ray: a wrong key is refused');
  ok((await ps[0].emit('xray:unlock', { key: cheatKey() })).ok, 'x-ray: the right key unlocks');
  const start = await host.emit('game:start');
  ok(start.ok, 'game starts' + (start.error ? ': ' + start.error : ''));
  await sleep(200);

  ok(Object.keys(ps[0].view.xray?.roles || {}).length === all.length, 'x-ray user sees every role');
  ok(!ps[1].view.xray, 'nobody else gets x-ray');
  const v2 = ps[1].view.game;
  const leaks = v2.players.filter((p) => p.role && p.id !== ps[1].view.me && !(v2.me.team === 'mafia' && ROLES[p.role].team === 'mafia'));
  ok(leaks.length === 0, 'a normal player sees no one else\'s role (only Mafia see their teammates)');
  log('roles:', ps.map((p) => `${p.name}=${p.view.game.me.role}`).join(' '));

  let guard = 0; let badErrors = 0;
  while (host.view.game.phase !== 'ended' && guard++ < 60) {
    const g = host.view.game;
    if (g.phase === 'night') {
      for (const c of all) {
        const me = c.view.game?.me; if (!me || !me.alive) continue;
        const others = c.view.game.players.filter((p) => p.alive && p.id !== c.view.me);
        if (me.team === 'mafia') {
          const t = others.filter((p) => !(p.role && MAFIA.includes(p.role)));
          if (t.length) await c.emit('night:mafiaVote', { target: pick(t).id });
        }
        const tgt = pick(others)?.id; const tgt2 = pick(others.filter((p) => p.id !== tgt))?.id;
        const res = await c.emit('night:act', { target: Math.random() < 0.15 ? c.view.me : tgt, target2: tgt2, option: pick(['heal', 'poison']) });
        // these refusals are the rules working (e.g. "no night action", "used up"); anything else is a bug
        if (res.error && !/no night action|night 1|uses|potion|same player|yourself|Only on|used up/i.test(res.error)) { badErrors++; log('unexpected:', me.role, res.error); }
      }
    } else if (g.phase === 'voting') {
      for (const c of all) {
        const me = c.view.game?.me; if (!me || !me.alive) continue;
        if (me.role === 'mayor' && !me.mayorRevealed) await c.emit('day:revealMayor');
        const others = c.view.game.players.filter((p) => p.alive && p.id !== c.view.me);
        await c.emit('vote', { target: Math.random() < 0.15 ? 'skip' : pick(others.slice(0, 2)).id });
      }
    } else if (g.phase === 'day') {
      await pick(all).emit('chat', { channel: 'town', text: 'I think it is ' + pick(ps).name });
    }
    await sleep(50);
    if (mode === 'player' || (g.phase !== 'night' && g.phase !== 'voting')) await host.emit('host:advance');
    else await sleep(2800); // auto mode: everyone acted, so it moves on by itself
    await sleep(80);
  }
  const g = host.view.game;
  g.log.forEach((e) => log(e.text));
  ok(badErrors === 0, 'no unexpected errors from night actions');
  ok(g.phase === 'ended' && g.winners.length > 0, `the game ends with winners (${guard} phases): ${g.winText}`);
  ok(ps[1].view.game.players.every((p) => p.role), 'after the game, everyone\'s role is revealed');
  ok((await host.emit('host:lobby')).ok, 'host can go back to the lobby');
  await sleep(100);
  ok(host.view.game === null, 'the room is back in the lobby');
  [host, ...ps].forEach((c) => c.s.close());
}

run(async () => {
  await playGame('Game 1: human host, 9 players', 'player', 9, { detective: 1, doctor: 1, bodyguard: 1, vigilante: 1, mayor: 1, godfather: 1, framer: 1, jester: 1 });
  await playGame('Game 2: automatic host, 10 players', 'auto', 9, { veteran: 1, tracker: 1, lookout: 1, escort: 1, witch: 1, consigliere: 1, janitor: 1, cupid: 1 });
  await playGame('Game 3: human host, 12 players', 'player', 12, { detective: 1, doctor: 1, medium: 1, miller: 1, silencer: 1, consort: 1, serialkiller: 1, arsonist: 1, survivor: 1, executioner: 1 });
});
