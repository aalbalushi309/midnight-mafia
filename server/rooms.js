/**
 * Rooms, players, and who is in charge (creator, host, moderator, spectators).
 */
const { rand } = require('./util');

/** @type {Map<string, any>} */
const rooms = new Map();
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rand(24)]).join(''); } while (rooms.has(c)); return c; };

function defaultSettings() {
  return {
    hostMode: 'player',    // 'player' = a person moderates & doesn't play; 'auto' = no moderator, the game runs itself
    maxPlayers: 15,
    mafiaCount: 2,
    roles: { detective: 1, doctor: 1 },
    assignMode: 'random',  // 'random' | 'manual'
    manual: {},            // playerId -> role key (manual mode)
    revealOnDeath: true,
    showRoleList: true,
    doctorSelf: true,
    hostPlays: false,      // the chosen host also gets a role and plays (but can't see secrets)
    majority: false,       // require more than half of living votes to eliminate
    nightSec: 60,
    discussionSec: 180,
    votingSec: 60,
  };
}

function createRoom() {
  const code = newCode();
  const room = {
    code, ownerId: null, hostId: null,
    players: new Map(), // id -> {id,name,token,connected,joinedAt}
    settings: defaultSettings(),
    game: null,
    chat: { town: [], mafia: [], dead: [] },
    timer: null,
    hostVotes: {}, // voterId -> candidateId (choosing the host together)
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

// Who controls setup & phases: the moderator in host mode (the owner until a host is picked), the owner in auto mode.
// If the creator drops out, the next connected person gets creator powers so the room never gets stuck.
function ownerId(room) {
  const o = room.players.get(room.ownerId);
  if (o && o.connected) return o.id;
  const next = [...room.players.values()].find((p) => p.connected);
  return next ? next.id : room.ownerId;
}
const isOwner = (room, pid) => ownerId(room) === pid;
// Same for the host: if they disconnect, control passes to the creator (or whoever is still here).
function controllerId(room) {
  if (room.settings.hostMode === 'player') {
    const h = room.players.get(room.hostId);
    if (h && h.connected) return h.id;
  }
  return ownerId(room);
}
const isSpectator = (room, pid) => {
  const p = room.players.get(pid); if (!p) return true;
  if (room.game) return !room.game.players[pid] && !isModerator(room, pid);
  return !!p.spectator;
};
// Who would be dealt a role if the game started now
const lineup = (room) => [...room.players.values()].filter((p) => p.connected && !p.spectator && !isModerator(room, p.id)).map((p) => p.id);
// A "moderator" is a host who sits out and sees everything. A host who also plays only gets the phase buttons.
const isModerator = (room, pid) => room.settings.hostMode === 'player' && !room.settings.hostPlays && room.hostId === pid;

module.exports = { lineup, ownerId, controllerId, isSpectator, isModerator, rooms, createRoom, isOwner };
