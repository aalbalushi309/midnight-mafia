// The group votes for a host; the elected host also plays a full game.
const { sleep, pick, client, makeRoom, ok, log, run } = require('./helpers');

run(async () => {
  const cs = Array.from({ length: 6 }, (_, i) => client('P' + i));
  await makeRoom(cs[0], cs.slice(1));
  const id = (i) => cs[i].view.me;

  ok((await cs[2].emit('lobby:voteHost', { finish: true })).error, 'only the room creator can end the vote early');
  ok((await cs[0].emit('lobby:settings', { hostPlays: true })).ok, 'creator turns on "the host also plays"');

  // 3 votes for P3, 2 for P1 — the 6th vote completes the election
  for (const [v, t] of [[0, 3], [1, 3], [2, 1], [3, 1], [4, 3]]) await cs[v].emit('lobby:voteHost', { playerId: id(t) });
  await sleep(80);
  ok(!cs[0].view.hostId, 'no host is chosen until everyone has voted');
  await cs[5].emit('lobby:voteHost', { playerId: id(3) });
  await sleep(100);
  ok(cs[0].view.hostId === id(3), 'the player with the most votes (P3) becomes host');

  const host = cs.find((c) => c.view.me === cs[0].view.hostId);
  ok(host.view.isController && !host.view.isModerator, 'a playing host controls the game but is not an all-seeing moderator');
  ok((await cs.find((c) => c !== host).emit('game:start')).error, 'someone who is not the host cannot start the game');
  await host.emit('lobby:settings', { mafiaCount: 1, roles: { detective: 1, doctor: 1 } });
  ok((await host.emit('game:start')).ok, 'the host starts the game');
  await sleep(150);

  const g = host.view.game;
  ok(!!g.me?.role, 'the host got a role of their own');
  ok(!g.host, 'the playing host does not get the secret dashboard');
  ok(g.players.length === 6, 'all 6 players are in the game');
  const maf = cs.find((c) => c !== host && c.view.game.me?.team === 'mafia');
  if (maf) {
    await maf.emit('chat', { channel: 'mafia', text: 'plan for tonight' }); await sleep(150);
    ok(host.view.chat.mafia?.some((m) => m.text === 'plan for tonight'), 'the host can read the Mafia chat');
    if (host.view.game.me.team !== 'mafia') ok(!host.view.canWrite.mafia, 'a host who is not Mafia can read it but not write in it');
    const townie = cs.find((c) => c !== host && c.view.game.me?.team !== 'mafia');
    ok(!townie.view.chat.mafia, 'ordinary town players still cannot see the Mafia chat');
  }

  let loops = 0;
  while (host.view.game.phase !== 'ended' && loops++ < 40) {
    const ph = host.view.game.phase;
    for (const c of cs) {
      const me = c.view.game.me; if (!me || !me.alive) continue;
      const others = c.view.game.players.filter((p) => p.alive && p.id !== c.view.me);
      if (ph === 'night') {
        if (me.team === 'mafia') await c.emit('night:mafiaVote', { target: pick(others).id });
        await c.emit('night:act', { target: pick(others).id });
      } else if (ph === 'voting') await c.emit('vote', { target: pick(others.slice(0, 2)).id });
    }
    await sleep(100);
    if (host.view.game.phase === ph) await host.emit('host:advance');
    await sleep(100);
  }
  log('result:', host.view.game.winText);
  ok(host.view.game.phase === 'ended', `the game reaches an ending (${loops} phases)`);
  cs.forEach((c) => c.s.close());
});
