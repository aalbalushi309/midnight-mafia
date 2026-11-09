/**
 * The live connection hub. Set once at startup so the game logic can push
 * updates to players without depending on the networking code directly.
 */
module.exports = {
  /** @type {import('socket.io').Server | null} */
  io: null,
  /** Sends every player in the room their own up-to-date view. Set by views.js. */
  broadcast: (_room) => { throw new Error('hub.broadcast used before views.js loaded'); },
};
