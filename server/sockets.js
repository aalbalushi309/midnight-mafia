/**
 * Everything the browser can ask the server to do (join, vote, chat, night actions, voice…).
 */
const { ROLES, STICKERS, randomSetup } = require('../shared/roles');
const { checkCheatKey } = require('./config');
const { rand, newId, clean } = require('./util');
const { MEDIA_TYPES, dropRoomMedia, storeMedia } = require('./media');
const { rooms, createRoom, isOwner, controllerId, lineup, isModerator } = require('./rooms');
const { startGame, pname, announce, clearTimer, advance, maybeAutoAdvance } = require('./game');
const { canWrite, voiceOk, broadcast } = require('./views');

// Socket handlers
/** Wires up every socket event. Called once at startup. */
function attachSockets(io) {
  io.on('connection', (socket) => {
    socket.data.badKeys = 0;
    const ctx = () => {
      const room = rooms.get(socket.data.room);
      if (!room || !room.players.has(socket.data.pid)) return null;
      return { room, pid: socket.data.pid, g: room.game };
    };
    const guard = (fn) => (data = {}, ack) => {
      try {
        const err = fn(data || {});
        if (typeof ack === 'function') ack(err ? { error: err } : { ok: true });
      } catch (e) {
        console.error('Error:', e && e.message); // never logs who did it or what they sent
        if (typeof ack === 'function') ack({ error: 'Something went wrong.' });
      }
    };

    socket.on('join', guard(({ code, name, token, create }) => {
      name = clean(name, 18); token = clean(token, 64);
      if (!name) return 'Enter your name.';
      if (!token) return 'Missing session token.';
      let room;
      if (create) { room = createRoom(); }
      else {
        let c = String(code || ''); const m = c.match(/[?&]room=([A-Za-z]{4})/); if (m) c = m[1];
        c = c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        room = rooms.get(c);
        if (!room) {
          return `There's no room "${c}". Check the code with the host (it's shown big in their lobby). If the host restarted the game, they have a new code.`;
        }
      }
      let player = [...room.players.values()].find((p) => p.token === token);
      if (!player) {
        // Same name as someone who is currently offline (e.g. she opened the link in WhatsApp first,
        // then in Chrome): give her that seat back instead of saying the name is taken.
        const offline = [...room.players.values()].find((p) => !p.connected && p.name.toLowerCase() === name.toLowerCase());
        // ...but as a newcomer: someone typing an offline player's name must not get to read
        // what was said before. (A refresh on the same device keeps your chat; that uses the token.)
        if (offline) { offline.token = token; offline.joinedAt = Date.now(); player = offline; }
      }
      if (!player) {
        if ([...room.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) return `Someone in this room is already called "${name}". Pick a different name.`;
        if (room.players.size >= 40) return 'The room is full.';
        const running = room.game && room.game.phase !== 'ended';
        const full = lineup(room).length >= room.settings.maxPlayers;
        // Late arrivals and overflow join as spectators; they can switch to Play in the lobby.
        player = { id: newId(), name, token, connected: true, joinedAt: Date.now(), spectator: !!(running || full) };
        room.players.set(player.id, player);
        if (!room.ownerId) room.ownerId = player.id;
      } else if (!room.game) {
        player.name = name;
      }
      player.connected = true;
      socket.data.room = room.code; socket.data.pid = player.id;
      socket.join(room.code);
      broadcast(room);
    }));

    socket.on('rejoin', guard(({ code, token }) => {
      const room = rooms.get(clean(code, 6).toUpperCase());
      if (!room) return 'gone';
      const player = [...room.players.values()].find((p) => p.token === clean(token, 64));
      if (!player) return 'gone';
      player.connected = true;
      socket.data.room = room.code; socket.data.pid = player.id;
      broadcast(room);
    }));

    socket.on('leave', guard(() => {
      const c = ctx(); if (!c) return;
      const { room, pid } = c;
      socket.data.room = null;
      if (!room.game) {
        room.players.delete(pid);
        if (room.hostId === pid) room.hostId = null;
        delete room.settings.manual[pid];
        if (room.ownerId === pid) room.ownerId = [...room.players.keys()][0] || null;
        if (!room.players.size) { clearTimer(room); rooms.delete(room.code); dropRoomMedia(room.code); return; }
      } else {
        room.players.get(pid).connected = false;
      }
      broadcast(room);
    }));

    // ---- Lobby ----
    socket.on('lobby:spectate', guard(({ playerId, spectator }) => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      const target = playerId || pid;
      if (target !== pid && controllerId(room) !== pid && !isOwner(room, pid)) return 'You can only change yourself.';
      const p = room.players.get(target); if (!p) return 'Unknown player.';
      if (!spectator && !p.spectator) return;
      if (!spectator && lineup(room).length >= room.settings.maxPlayers) return 'The game is full. Ask the host to raise the max players.';
      p.spectator = !!spectator;
      delete room.settings.manual[target];
      broadcast(room);
    }));

    socket.on('lobby:setHost', guard(({ playerId }) => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (room.game && room.game.phase !== 'ended') return 'Game in progress.';
      const owner = isOwner(room, pid);
      if (playerId === 'random') {
        if (!owner) return 'Only the room creator can do that.';
        const ids = [...room.players.values()].filter((p) => p.connected).map((p) => p.id);
        room.hostId = ids[rand(ids.length)];
      } else if (playerId === null) {
        if (!owner && room.hostId !== pid) return 'Only the creator or the host can do that.';
        room.hostId = null;
      } else if (playerId === pid && !room.hostId) {
        room.hostId = pid; // volunteer
      } else {
        if (!owner && room.hostId !== pid) return 'Only the creator (or current host) can choose the host.';
        if (!room.players.has(playerId)) return 'Unknown player.';
        room.hostId = playerId;
      }
      if (room.hostId && !room.settings.hostPlays) delete room.settings.manual[room.hostId];
      room.hostVotes = {};
      room.game = null;
      broadcast(room);
    }));

    // Everyone votes for who should host. When every connected player has voted, the top pick wins (ties: random).
    socket.on('lobby:voteHost', guard(({ playerId, finish }) => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (room.game && room.game.phase !== 'ended') return 'Game in progress.';
      if (room.settings.hostMode !== 'player') return 'There is no host in auto mode.';
      if (room.hostId) return 'A host is already chosen.';
      if (finish) {
        if (!isOwner(room, pid)) return 'Only the room creator can end the vote early.';
      } else if (playerId === null) delete room.hostVotes[pid];
      else if (room.players.has(playerId)) room.hostVotes[pid] = playerId;
      else return 'Unknown player.';
      for (const v of Object.keys(room.hostVotes)) if (!room.players.has(v) || !room.players.has(room.hostVotes[v])) delete room.hostVotes[v];
      const connected = [...room.players.values()].filter((p) => p.connected);
      const allIn = connected.length >= 2 && connected.every((p) => room.hostVotes[p.id]);
      if (finish || allIn) {
        const tally = {};
        for (const t of Object.values(room.hostVotes)) tally[t] = (tally[t] || 0) + 1;
        const max = Math.max(0, ...Object.values(tally));
        if (!max) return 'Nobody has voted yet.';
        const top = Object.keys(tally).filter((t) => tally[t] === max);
        room.hostId = top[rand(top.length)];
        if (!room.settings.hostPlays) delete room.settings.manual[room.hostId];
        room.hostVotes = {};
        room.lastElection = { name: room.players.get(room.hostId).name, votes: max, tie: top.length > 1, t: Date.now() };
      }
      broadcast(room);
    }));

    socket.on('lobby:settings', guard((patch) => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (controllerId(room) !== pid && !(isOwner(room, pid) && (patch.hostMode || 'hostPlays' in patch))) return 'Only the host can change settings.';
      if (room.game && room.game.phase !== 'ended') return 'Game in progress.';
      const s = room.settings;
      const num = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
      if (patch.hostMode === 'player' || patch.hostMode === 'auto') s.hostMode = patch.hostMode;
      if ('maxPlayers' in patch) s.maxPlayers = num(patch.maxPlayers, 4, 30, s.maxPlayers);
      if ('mafiaCount' in patch) s.mafiaCount = num(patch.mafiaCount, 1, 10, s.mafiaCount);
      if (patch.roles && typeof patch.roles === 'object') {
        const r = {};
        for (const [k, v] of Object.entries(patch.roles)) if (ROLES[k] && k !== 'citizen' && k !== 'mafioso') { const n = num(v, 0, 6, 0); if (n) r[k] = n; }
        s.roles = r;
      }
      if (patch.assignMode === 'random' || patch.assignMode === 'manual') s.assignMode = patch.assignMode;
      for (const k of ['revealOnDeath', 'showRoleList', 'doctorSelf', 'majority', 'hostPlays']) if (k in patch) s[k] = !!patch[k];
      if ('nightSec' in patch) s.nightSec = num(patch.nightSec, 15, 600, s.nightSec);
      if ('discussionSec' in patch) s.discussionSec = num(patch.discussionSec, 15, 1800, s.discussionSec);
      if ('votingSec' in patch) s.votingSec = num(patch.votingSec, 10, 600, s.votingSec);
      broadcast(room);
    }));

    socket.on('lobby:assign', guard(({ playerId, role }) => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (controllerId(room) !== pid) return 'Only the host can assign roles.';
      if (!room.players.has(playerId)) return 'Unknown player.';
      if (role && !ROLES[role]) return 'Unknown role.';
      if (role) room.settings.manual[playerId] = role; else delete room.settings.manual[playerId];
      broadcast(room);
    }));

    socket.on('lobby:surprise', guard(() => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (controllerId(room) !== pid) return 'Only the host can do that.';
      const n = lineup(room).length;
      const setup = randomSetup(Math.max(n, 4));
      room.settings.mafiaCount = setup.mafiaCount;
      room.settings.roles = setup.roles;
      room.settings.assignMode = 'random';
      broadcast(room);
    }));

    socket.on('lobby:kick', guard(({ playerId }) => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (!isOwner(room, pid) && controllerId(room) !== pid) return 'Not allowed.';
      if (room.game && room.game.phase !== 'ended') return 'Game in progress.';
      if (playerId === pid) return 'You cannot kick yourself.';
      room.players.delete(playerId);
      delete room.settings.manual[playerId];
      if (room.hostId === playerId) room.hostId = null;
      for (const sock of io.sockets.sockets.values()) {
        if (sock.data.room === room.code && sock.data.pid === playerId) { sock.data.room = null; sock.emit('kicked'); }
      }
      broadcast(room);
    }));

    socket.on('game:start', guard(() => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (controllerId(room) !== pid) return room.settings.hostMode === 'player' ? 'Only the host can start the game.' : 'Only the room owner can start.';
      if (room.game && room.game.phase !== 'ended') return 'Game already running.';
      return startGame(room);
    }));

    socket.on('host:advance', guard(() => {
      const c = ctx(); if (!c) return; const { room, pid, g } = c;
      if (!g || g.phase === 'ended') return;
      if (controllerId(room) !== pid) return 'Only the host can do that.';
      advance(room);
    }));

    socket.on('host:lobby', guard(() => {
      const c = ctx(); if (!c) return; const { room, pid } = c;
      if (controllerId(room) !== pid && !isOwner(room, pid)) return 'Only the host can do that.';
      clearTimer(room);
      room.game = null;
      room.chat = { town: [], mafia: [], dead: [] };
      for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
      broadcast(room);
    }));

    // ---- Night ----
    socket.on('night:act', guard(({ target, target2, option, skip }) => {
      const c = ctx(); if (!c) return; const { room, pid, g } = c;
      if (!g || g.phase !== 'night') return 'It is not night.';
      const me = g.players[pid]; if (!me || !me.alive) return 'You cannot act.';
      const act = ROLES[me.role].act;
      if (skip === 'cancel') { delete g.night.acts[pid]; broadcast(room); return; }
      if (skip) { g.night.acts[pid] = { skip: true }; broadcast(room); maybeAutoAdvance(room); return; }
      if (!act) return 'Your role has no night action.';
      if (act.nightOneOnly && g.round !== 1) return 'Only on night 1.';
      if (act.notNightOne && g.round === 1) return 'You cannot do that on night 1.';
      if (act.uses && me.uses[act.kind] <= 0) return 'No uses left.';
      const okTarget = (t) => g.players[t] && g.players[t].alive;
      if (act.target === 'self') target = pid;
      else if (!okTarget(target)) return 'Pick a living player.';
      if (act.target === 'other' && target === pid) return 'You cannot target yourself.';
      if (act.target === 'two' && (!okTarget(target2) || target2 === target)) return 'Pick two different players.';
      if (me.role === 'doctor') {
        if (target === pid && !room.settings.doctorSelf) return 'You cannot protect yourself in this game.';
        if (target === me.lastHealed) return 'You cannot protect the same player two nights in a row.';
      }
      if (me.role === 'witch') {
        if (option !== 'heal' && option !== 'poison') return 'Choose a potion.';
        if (me.uses[option] <= 0) return 'That potion is used up.';
      }
      g.night.acts[pid] = { target, target2: act.target === 'two' ? target2 : undefined, option: me.role === 'witch' ? option : undefined };
      broadcast(room); maybeAutoAdvance(room);
    }));

    socket.on('night:mafiaVote', guard(({ target }) => {
      const c = ctx(); if (!c) return; const { room, pid, g } = c;
      if (!g || g.phase !== 'night') return 'It is not night.';
      const me = g.players[pid]; if (!me || !me.alive || me.team !== 'mafia') return 'Not allowed.';
      if (target !== 'none' && !(g.players[target] && g.players[target].alive && g.players[target].team !== 'mafia')) return 'Pick a living non-Mafia player.';
      g.night.mafiaVotes[pid] = target;
      broadcast(room); maybeAutoAdvance(room);
    }));

    // ---- Day ----
    socket.on('day:revealMayor', guard(() => {
      const c = ctx(); if (!c) return; const { room, pid, g } = c;
      if (!g || !['day', 'voting'].includes(g.phase)) return 'Only during the day.';
      const me = g.players[pid];
      if (!me || !me.alive || me.role !== 'mayor' || me.mayorRevealed) return 'Not allowed.';
      me.mayorRevealed = true;
      announce(room, `🎩 ${pname(room, pid)} has revealed themselves as the MAYOR! Their vote now counts twice.`, 'warn');
      broadcast(room);
    }));

    socket.on('vote', guard(({ target }) => {
      const c = ctx(); if (!c) return; const { room, pid, g } = c;
      if (!g || g.phase !== 'voting') return 'Voting is not open.';
      const me = g.players[pid]; if (!me || !me.alive) return 'Only living players vote.';
      if (target === null) delete g.votes[pid];
      else if (target === 'skip' || (g.players[target] && g.players[target].alive && target !== pid)) g.votes[pid] = target;
      else return 'Invalid vote.';
      broadcast(room); maybeAutoAdvance(room);
    }));

    // ---- Chat ----
    socket.on('chat', guard(({ channel, text }) => {
      const c = ctx(); if (!c) return; const { room, pid, g } = c;
      text = clean(text, 300); if (!text) return;
      return postChat(room, pid, g, channel, { text });
    }));
    function postChat(room, pid, g, channel, extra) {
      if (!['town', 'mafia', 'dead'].includes(channel)) return 'Bad channel.';
      if (!canWrite(room, pid, channel)) return 'You cannot speak there right now.';
      const me = g && g.players[pid];
      let from = pname(room, pid); let tag = null;
      if (isModerator(room, pid)) tag = 'host';
      else if (channel === 'dead' && me && me.alive && me.role === 'medium') { from = 'The Medium'; tag = 'medium'; }
      room.chat[channel].push({ from, pid: tag === 'medium' ? null : pid, tag, text: '', ...extra, t: Date.now() });
      if (room.chat[channel].length > 300) room.chat[channel].splice(0, 100);
      broadcast(room);
    }
    // Stickers, pictures and voice messages
    socket.on('chat:sticker', guard(({ channel, sticker }) => {
      const c = ctx(); if (!c) return;
      if (!Object.prototype.hasOwnProperty.call(STICKERS, sticker)) return 'Unknown sticker.';
      return postChat(c.room, c.pid, c.g, channel, { kind: 'sticker', sticker });
    }));
    socket.on('chat:media', guard(({ channel, mime, data, w, h, dur }) => {
      const c = ctx(); if (!c) return;
      if (Date.now() - (socket.data.lastMedia || 0) < 1500) return 'Slow down a little 🙂';
      const kind = MEDIA_TYPES[mime]; if (!kind || !(data instanceof Buffer)) return 'That file type is not supported.';
      if (data.length > 2.5e6) return 'That file is too big.';
      // check the file really is what it says (first bytes), so nothing else can be smuggled in
      const sig = data.subarray(0, 12).toString('latin1');
      const real = mime === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8 : mime === 'image/png' ? sig.startsWith('\x89PNG') : mime === 'image/gif' ? sig.startsWith('GIF8')
        : mime === 'image/webp' ? sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP' : sig.startsWith('RIFF') && sig.slice(8, 12) === 'WAVE';
      if (!real) return 'That file looks broken.';
      if (!canWrite(c.room, c.pid, channel)) return 'You cannot speak there right now.';
      socket.data.lastMedia = Date.now();
      const id = storeMedia(c.room, data, mime);
      const extra = kind === 'img'
        ? { kind, media: id, w: Math.max(1, Math.min(4000, +w || 300)), h: Math.max(1, Math.min(4000, +h || 300)) }
        : { kind, media: id, dur: Math.max(0, Math.min(120, Math.round(+dur || 0))) };
      return postChat(c.room, c.pid, c.g, channel, extra);
    }));

    // ---- Voice ----
    socket.on('voice:join', guard(() => { const c = ctx(); if (!c) return 'Join a room first.'; socket.data.voice = true; broadcast(c.room); }));
    socket.on('voice:leave', guard(() => { socket.data.voice = false; const c = ctx(); if (c) broadcast(c.room); }));
    // One small audio packet (~80 ms of speech). Only sent while someone is actually talking.
    socket.on('v', (buf) => {
      if (!socket.data.voice || !(buf instanceof Buffer) || buf.length > 4000) return;
      const now = Date.now(); // simple flood guard: ~60 packets a second max
      if (now - (socket.data.vWin || 0) > 1000) { socket.data.vWin = now; socket.data.vCount = 0; }
      if (++socket.data.vCount > 60) return;
      const c = ctx(); if (!c) return; const { room, pid } = c;
      const to = [];
      for (const id of io.sockets.adapter.rooms.get(room.code) || []) {
        const s = io.sockets.sockets.get(id);
        if (!s || !s.data.voice || s.data.pid === pid || s.data.room !== room.code) continue;
        if (voiceOk(room, pid, s.data.pid)) to.push(id);
      }
      // packaged once and sent to everyone who may hear it (much lighter than one send per listener)
      if (to.length) io.to(to).volatile.emit('v', pid, buf);
    });

    // ---- The secret x-ray ----
    socket.on('xray:unlock', guard(({ key }) => {
      if (socket.data.badKeys >= 5) return 'nope';
      if (!checkCheatKey(clean(key, 64))) { socket.data.badKeys++; return 'nope'; }
      socket.data.xray = true;
      const c = ctx(); if (c) broadcast(c.room);
    }));
    socket.on('xray:lock', guard(() => { socket.data.xray = false; const c = ctx(); if (c) broadcast(c.room); }));

    socket.on('disconnect', () => {
      const c = ctx(); if (!c) return;
      const { room, pid } = c;
      const stillHere = [...io.sockets.sockets.values()].some((s) => s.id !== socket.id && s.data.room === room.code && s.data.pid === pid);
      if (!stillHere) { room.players.get(pid).connected = false; broadcast(room); }
      else if (socket.data.voice) { socket.data.voice = false; broadcast(room); }
    });
  });
}

module.exports = { attachSockets };
