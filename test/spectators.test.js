// Spectators, late joiners, host drop-out hand-over.
const { sleep, pick, client, ok, log, run } = require('./helpers');

async function play(cs, ctrl) {
  let loops = 0;
  while (ctrl().view.game.phase !== 'ended' && loops++ < 50) {
    const ph = ctrl().view.game.phase;
    for (const c of cs) {
      if (!c.s.connected || !c.view.game) continue;
      const me = c.view.game.me; if (!me || !me.alive) continue;
      const others = c.view.game.players.filter((p) => p.alive && p.id !== c.view.me);
      if (ph === 'night') { if (me.team === 'mafia') await c.emit('night:mafiaVote', { target: pick(others).id }); await c.emit('night:act', { target: pick(others).id }); }
      else if (ph === 'voting') await c.emit('vote', { target: pick(others.slice(0, 2)).id });
    }
    await sleep(80);
    if (ctrl().view.game.phase === ph) { const r = await ctrl().emit('host:advance'); if (r.error) { log('advance err', r.error); break; } }
    await sleep(80);
  }
  return ctrl().view.game.phase === 'ended';
}
run(async () => {
  const me = client('Haman'); await me.ready;
  await me.emit('join', { name: 'Haman', token: me.token, create: true }); await sleep(80);
  const code = me.view.code;
  const fr = []; for (let i = 0; i < 6; i++) { const c = client('F' + i); await c.ready; await c.emit('join', { name: c.name, token: c.token, code }); fr.push(c); }
  await sleep(100);
  // 1) I choose to spectate, F0 hosts and sits out
  await me.emit('lobby:spectate', { spectator: true });
  await me.emit('lobby:setHost', { playerId: fr[0].view.me });
  await sleep(80);
  ok(me.view.lineupCount === 5, 'lineup excludes spectator + sit-out host (5): ' + me.view.lineupCount);
  const host = fr[0];
  await host.emit('lobby:settings', { mafiaCount: 1, roles: { detective: 1, doctor: 1 } });
  let r = await host.emit('game:start'); ok(r.ok, 'host starts game ' + JSON.stringify(r));
  await sleep(120);
  const g = me.view.game;
  ok(!g.me, 'spectator has no role');
  ok(g.players.length === 5 && g.players.every((p) => p.role), 'spectator sees all 5 roles');
  ok(!!g.host, 'spectator gets the everything view');
  ok(me.view.canWrite.town === false && me.view.canWrite.dead === true, 'spectator cannot talk to town, can talk in graveyard');
  const f1 = fr[1].view.game;
  ok(f1.players.filter((p) => p.role && p.id !== fr[1].view.me).every((p) => f1.me.team === 'mafia'), 'players still cannot see roles');
  // 2) a friend joins mid-game -> spectator
  const late = client('Late'); await late.ready;
  r = await late.emit('join', { name: 'Late', token: late.token, code }); await sleep(80);
  ok(r.ok && late.view.isSpectator && !late.view.game.me, 'late joiner enters as spectator');
  // 3) host disconnects mid-game -> creator (me) gets control
  host.s.disconnect(); await sleep(150);
  ok(me.view.isController, 'creator takes over when the host disconnects');
  const ended = await play([...fr.slice(1)], () => me);
  ok(ended, 'game finishes with stand-in host: ' + me.view.game.winText);
  // 4) back to lobby; I switch to Play
  r = await me.emit('host:lobby'); await sleep(80);
  ok(r.ok && !me.view.game, 'back to lobby');
  await me.emit('lobby:spectate', { spectator: false }); await sleep(80);
  ok(!me.view.players.find((p) => p.id === me.view.me).spectator, 'I can switch back to Play');
  // 5) creator disconnects in lobby -> someone else gets creator powers
  me.s.disconnect(); await sleep(150);
  ok(fr[1].view.ownerId === fr[1].view.me || fr[2].view.ownerId === fr[1].view.me, 'creator powers pass on when creator leaves');
});
