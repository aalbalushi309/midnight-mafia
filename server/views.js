/**
 * What each person is allowed to see and hear: chat channels, voice rules, and their personal view of the game.
 */
const hub = require('./hub');
const { recommendedMafia } = require('../shared/roles');
const { ownerId, controllerId, isSpectator, lineup, isModerator } = require('./rooms');
const { pname, needsNightAction, voteTally } = require('./game');

// Per-player views (roles never leave the server unless you're allowed to see them)
function canRead(room, pid, ch) {
  const g = room.game;
  if (ch === 'town') return true;
  if (!g) return false;
  if (g.phase === 'ended' || isModerator(room, pid)) return true;
  const p = g.players[pid]; if (!p) return true; // spectators read every channel
  if (ch === 'mafia') return p.team === 'mafia';
  if (ch === 'dead') return !p.alive || (p.role === 'medium' && g.phase === 'night');
  return false;
}
function canWrite(room, pid, ch) {
  const g = room.game;
  if (isModerator(room, pid)) return ch === 'town' || (g && ['mafia', 'dead'].includes(ch));
  if (!g || g.phase === 'ended') return ch === 'town';
  const p = g.players[pid]; if (!p) return ch === 'dead'; // spectators may only whisper with the dead
  if (ch === 'town') return p.alive && g.phase !== 'night' && p.silencedDay !== g.round;
  if (ch === 'mafia') return p.alive && p.team === 'mafia' && g.phase === 'night';
  if (ch === 'dead') return !p.alive || (p.role === 'medium' && g.phase === 'night');
  return false;
}

// Voice chat. Audio goes through the server, so the server alone decides who hears whom
// (the Mafia's night talk can never reach the town, not even by a hacked client).
function voiceOk(room, a, b) { // can speaker a be heard by listener b?
  const g = room.game;
  if (!g || g.phase === 'ended') return true;
  if (isModerator(room, a) || isModerator(room, b)) return true;
  const pa = g.players[a]; const pb = g.players[b];
  if (!pb) return true; // spectators hear everything (like they read every chat)
  const ghostA = !pa || !pa.alive; const ghostB = !pb.alive;
  if (g.phase === 'night') {
    if (!ghostA && !ghostB && pa.team === 'mafia' && pb.team === 'mafia') return true;
    const medA = !ghostA && pa.role === 'medium'; const medB = !ghostB && pb.role === 'medium';
    return (ghostA || medA) && (ghostB || medB) && (ghostA || ghostB);
  }
  if (ghostA) return ghostB;
  return pa.silencedDay !== g.round;
}
function voiceHint(room, pid) {
  const g = room.game;
  if (!g || g.phase === 'ended') return { can: true, text: 'Everyone hears you' };
  if (isModerator(room, pid)) return { can: true, text: 'You are the host: everyone hears you' };
  const p = g.players[pid];
  if (!p) return { can: true, text: 'Only the dead & spectators hear you' };
  if (!p.alive) return { can: true, text: '💀 Only the dead & spectators hear you' };
  if (g.phase === 'night') {
    if (p.team === 'mafia') return { can: true, text: '🔪 Only the Mafia hears you' };
    if (p.role === 'medium') return { can: true, text: '🔮 The dead hear you' };
    return { can: false, text: '🌙 Night: you are asleep, nobody hears you' };
  }
  if (p.silencedDay === g.round) return { can: false, text: '🤐 You are silenced today' };
  return { can: true, text: '☀️ Everyone hears you' };
}
function voiceMembers(room) {
  const set = new Set();
  for (const id of hub.io.sockets.adapter.rooms.get(room.code) || []) {
    const s = hub.io.sockets.sockets.get(id); if (s && s.data.voice && s.data.room === room.code) set.add(s.data.pid);
  }
  return [...set];
}

function viewFor(room, pid, socket) {
  const g = room.game; const s = room.settings;
  const ctrl = controllerId(room) === pid;
  const mod = isModerator(room, pid);
  const chatSince = room.players.get(pid)?.joinedAt ?? Date.now();
  const view = {
    me: pid,
    code: room.code,
    ownerId: ownerId(room),
    isSpectator: isSpectator(room, pid),
    lineupCount: lineup(room).length,
    hostId: room.hostId,
    isController: ctrl,
    hostVotes: room.hostVotes,
    lastElection: room.lastElection || null,
    isModerator: mod,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected, spectator: !!p.spectator, inGame: !!(g && g.players[p.id]) })),
    settings: { ...s, manual: ctrl ? s.manual : undefined },
    recommendedMafia: recommendedMafia(lineup(room).length),
    chat: {},
    canWrite: {},
    game: null,
  };
  for (const ch of ['town', 'mafia', 'dead']) {
    // Privacy: you only ever see messages sent AFTER you joined the room — never the old chat.
    if (canRead(room, pid, ch)) { view.chat[ch] = room.chat[ch].filter((m) => m.t >= chatSince).slice(-150); view.canWrite[ch] = canWrite(room, pid, ch); }
  }
  view.voice = { on: !!(socket && socket.data.voice), members: voiceMembers(room), ...voiceHint(room, pid) };
  if (!g) return view;

  const me = g.players[pid];
  const ended = g.phase === 'ended';
  const spectating = !me && !mod;
  const seeAll = mod || ended || spectating;
  const { tally, skip } = voteTally(g);
  view.game = {
    phase: g.phase, round: g.round, endsAt: g.endsAt, now: Date.now(),
    log: g.log,
    winners: g.winners, winText: g.winText,
    roleList: (s.showRoleList || seeAll) ? g.roleList : null,
    players: Object.values(g.players).map((p) => {
      const showRole = seeAll || (!p.alive && s.revealOnDeath && !p.cleaned) || p.id === pid || (me && me.team === 'mafia' && p.team === 'mafia');
      return {
        id: p.id, name: pname(room, p.id), alive: p.alive, deathText: p.deathText,
        role: showRole ? p.role : (p.mayorRevealed ? 'mayor' : null),
        mayorRevealed: p.mayorRevealed,
        silenced: p.alive && p.silencedDay === g.round && g.phase !== 'night',
        hasVoted: g.phase === 'voting' ? !!g.votes[p.id] : false,
        connected: room.players.get(p.id)?.connected,
      };
    }),
    votes: g.phase === 'voting' || g.phase === 'verdict' ? g.votes : {},
    tally, skip,
    me: me ? {
      role: me.role, team: me.team, alive: me.alive, uses: me.uses, lastHealed: me.lastHealed,
      exeTarget: me.exeTarget, doused: undefined,
      lover: g.lovers && g.lovers.includes(pid) ? g.lovers.find((x) => x !== pid) : null,
      action: g.night.acts[pid] || null,
      mafiaVote: me.team === 'mafia' ? g.night.mafiaVotes[pid] || null : null,
      mafiaVotes: me.team === 'mafia' && g.phase === 'night' ? g.night.mafiaVotes : null,
      needsAction: g.phase === 'night' && me.alive && needsNightAction(room, me),
      private: g.privateLog[pid] || [],
      dousedPlayers: me.role === 'arsonist' ? Object.values(g.players).filter((p) => p.doused && p.alive).map((p) => p.id) : undefined,
    } : null,
  };
  if (ctrl && !mod) {
    view.game.pendingCount = g.phase === 'night' ? Object.values(g.players).filter((p) => p.alive && needsNightAction(room, p)).length : 0;
  }
  if (mod || spectating) {
    view.game.host = {
      acts: g.night.acts, mafiaVotes: g.night.mafiaVotes, lovers: g.lovers,
      pending: Object.values(g.players).filter((p) => p.alive && g.phase === 'night' && needsNightAction(room, p)).map((p) => p.id),
      privateLog: g.privateLog,
      exe: Object.fromEntries(Object.values(g.players).filter((p) => p.exeTarget).map((p) => [p.id, p.exeTarget])),
    };
  }
  if (socket && socket.data.xray) {
    view.xray = {
      roles: Object.fromEntries(Object.values(g.players).map((p) => [p.id, p.role])),
      lovers: g.lovers,
      mafiaVotes: g.phase === 'night' ? g.night.mafiaVotes : null,
    };
  }
  return view;
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const sock of hub.io.sockets.sockets.values()) {
    if (sock.data.room === room.code) sock.emit('state', viewFor(room, sock.data.pid, sock));
  }
}

hub.broadcast = broadcast;

module.exports = { canWrite, voiceOk, broadcast };
