// Newcomers never see chat that was sent before they joined.
const { sleep, client, makeRoom, ok, run } = require('./helpers');

run(async () => {
  const a = client('Ana'); const b = client('Ben');
  const code = await makeRoom(a, [b]);
  await a.emit('chat', { channel: 'town', text: 'secret plan before Cara came' });
  await a.emit('chat:sticker', { channel: 'town', sticker: 'shh' });
  await sleep(150);
  ok(b.view.chat.town.length === 2, 'people already in the room see the messages');

  const c = client('Cara'); await c.ready;
  await sleep(20);
  await c.emit('join', { name: 'Cara', token: c.token, code });
  await sleep(150);
  ok(c.view.chat.town.length === 0, 'a newcomer sees none of the old chat (text or stickers)');

  await b.emit('chat', { channel: 'town', text: 'hi Cara' });
  await sleep(150);
  ok(c.view.chat.town.length === 1 && c.view.chat.town[0].text === 'hi Cara', 'the newcomer sees messages sent after they joined');
  ok(a.view.chat.town.length === 3, 'everyone else still sees the whole conversation');

  // a refresh on the same device keeps your own history
  c.s.disconnect(); await sleep(100);
  const c2 = client('Cara'); await c2.ready;
  await c2.emit('rejoin', { code, token: c.token });
  await sleep(150);
  ok(c2.view.chat.town.length === 1, 'after a refresh you keep the messages from your own visit');

  // someone else typing the name of a player who went offline gets the seat, but not the old chat
  b.s.disconnect(); await sleep(100);
  const imp = client('Ben'); await imp.ready;
  await imp.emit('join', { name: 'Ben', token: 'someone-else', code });
  await sleep(150);
  ok(imp.view.chat.town.length === 0, 'taking over an offline player\'s seat by name does not reveal the old chat');

  [a, c2, imp].forEach((x) => x.s.close());
});
