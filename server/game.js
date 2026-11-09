/**
 * The game itself: dealing roles, phases, night actions, voting and win conditions.
 */
const hub = require('./hub');
const { ROLES } = require('../shared/roles');
const { rand, shuffle } = require('./util');
const { lineup } = require('./rooms');

// Role assignment
function buildRoleList(room, playerIds) {
  const s = room.settings;
  const n = playerIds.length;
  const list = [];
  let mafiaSpecials = 0;
  for (const [k, c] of Object.entries(s.roles)) {
    if (!ROLES[k] || k === 'citizen' || k === 'mafioso') continue;
    for (let i = 0; i < c; i++) { list.push(k); if (ROLES[k].team === 'mafia') mafiaSpecials++; }
  }
  const mafiaTotal = Math.max(s.mafiaCount, mafiaSpecials);
  for (let i = mafiaSpecials; i < mafiaTotal; i++) list.push('mafioso');
  if (list.length > n) return { error: `Setup needs ${list.length} players but only ${n} are playing. Remove some roles.` };
  while (list.length < n) list.push('citizen');
  if (!list.some((r) => ROLES[r].team === 'mafia')) return { error: 'You need at least 1 Mafia.' };
  return { list };
}

function startGame(room) {
  const s = room.settings;
  const ids = lineup(room);
  if (s.hostMode === 'player' && !room.hostId) return 'Pick a host (moderator) first.';
  if (ids.length < 4) return `You need at least 4 players (now ${ids.length}). Spectators and a host who sits out don't count.`;
  if (ids.length > s.maxPlayers) return `Too many players (max ${s.maxPlayers}).`;

  let assignment = {};
  if (s.assignMode === 'manual') {
    for (const id of ids) {
      const r = s.manual[id];
      if (!r || !ROLES[r]) return `The host still has to choose a role for ${room.players.get(id).name}.`;
      assignment[id] = r;
    }
    if (!Object.values(assignment).some((r) => ROLES[r].team === 'mafia')) return 'Give at least one player a Mafia role.';
  } else {
    const res = buildRoleList(room, ids);
    if (res.error) return res.error;
    const roles = shuffle(res.list);
    shuffle([...ids]).forEach((id, i) => { assignment[id] = roles[i]; });
  }

  const players = {};
  for (const id of ids) {
    const role = assignment[id];
    const def = ROLES[role];
    players[id] = {
      id, role, team: def.team, alive: true,
      uses: { shoot: 2, alert: 2, clean: 2, vest: 3, heal: 1, poison: 1 },
      lastHealed: null, doused: false, silencedDay: 0, mayorRevealed: false,
      cleaned: false, deathText: null, originalRole: role, exeTarget: null,
    };
  }
  // Executioner targets: a random living town member
  for (const p of Object.values(players)) {
    if (p.role === 'executioner') {
      const pool = Object.values(players).filter((q) => q.team === 'town' && q.id !== p.id);
      if (pool.length) p.exeTarget = pool[rand(pool.length)].id;
      else p.role = 'jester';
    }
  }
  room.chat = { town: [], mafia: [], dead: [] };
  room.game = {
    phase: 'night', round: 1, players,
    roleList: Object.values(assignment).sort(),
    night: { acts: {}, mafiaVotes: {} },
    votes: {},
    lovers: null,
    extraWinners: new Set(),
    log: [],
    privateLog: {}, // id -> [{round, text}]
    endsAt: null,
    winners: null, winText: null,
  };
  announce(room, '🌙 Night 1 falls over the town. Everyone close your eyes…');
  for (const p of Object.values(players)) {
    if (p.exeTarget) privMsg(room, p.id, `Your target is ${pname(room, p.exeTarget)}. Get them voted out!`);
  }
  enterPhase(room, 'night');
  return null;
}

// Helpers
function pname(room, id) { const p = room.players.get(id); return p ? p.name : '???'; }
function announce(room, text, kind = 'info') { room.game.log.push({ round: room.game.round, phase: room.game.phase, text, kind, t: Date.now() }); }
function privMsg(room, id, text) { (room.game.privateLog[id] = room.game.privateLog[id] || []).push({ round: room.game.round, text, t: Date.now() }); }
const aliveIds = (g) => Object.values(g.players).filter((p) => p.alive).map((p) => p.id);
function roleLabel(room, p) {
  if (!room.settings.revealOnDeath) return 'Their role stays a mystery.';
  if (p.cleaned) return '🧹 Their role was cleaned up — nobody knows what they were.';
  return `They were the ${ROLES[p.role].icon} ${ROLES[p.role].name}.`;
}

function needsNightAction(room, p) {
  const g = room.game;
  const act = ROLES[p.role].act;
  if (p.team === 'mafia' && !g.night.mafiaVotes[p.id]) return true;
  if (!act) return false;
  if (act.nightOneOnly && g.round !== 1) return false;
  if (act.notNightOne && g.round === 1) return false;
  if (act.uses && p.uses[act.kind] <= 0) return false;
  if (act.kind === 'potion' && p.uses.heal <= 0 && p.uses.poison <= 0) return false;
  return !g.night.acts[p.id];
}

function clearTimer(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }

function enterPhase(room, phase) {
  const g = room.game; const s = room.settings;
  clearTimer(room);
  g.phase = phase;
  const secs = { night: s.nightSec, day: s.discussionSec, voting: s.votingSec, verdict: 8 }[phase];
  g.endsAt = secs ? Date.now() + secs * 1000 : null;
  if (phase === 'night') g.night = { acts: {}, mafiaVotes: {} };
  if (phase === 'voting') g.votes = {};
  if (s.hostMode === 'auto' && secs) room.timer = setTimeout(() => advance(room, true), secs * 1000);
  hub.broadcast(room);
}

function advance(room, fromTimer) {
  const g = room.game; if (!g) return;
  if (g.phase === 'night') resolveNight(room);
  else if (g.phase === 'day') enterPhase(room, 'voting');
  else if (g.phase === 'voting') resolveVote(room);
  else if (g.phase === 'verdict') { g.round++; announce(room, `🌙 Night ${g.round} falls. The town sleeps…`); enterPhase(room, 'night'); }
}

// In auto mode, move on as soon as everyone has done their part.
function maybeAutoAdvance(room) {
  const g = room.game; if (!g || (room.settings.hostMode !== 'auto' && !room.settings.hostPlays)) return;
  if (g.phase === 'night') {
    const pending = Object.values(g.players).filter((p) => p.alive && needsNightAction(room, p));
    if (!pending.length) { clearTimer(room); room.timer = setTimeout(() => advance(room), 2500); }
  } else if (g.phase === 'voting') {
    if (aliveIds(g).every((id) => g.votes[id])) { clearTimer(room); room.timer = setTimeout(() => advance(room), 2500); }
  }
}

// Night resolution
const CAUSE = {
  mafia: 'was killed by the Mafia 🔪', vig: 'was shot by the Vigilante 🔫', sk: 'was stabbed by the Serial Killer 🩸',
  poison: 'was poisoned by the Witch 🧪', fire: 'burned to death 🔥', veteran: 'was shot by a Veteran on alert 🎖️',
  bgDie: 'died heroically protecting someone 🛡️', bgKill: 'was killed by a Bodyguard 🛡️', heart: 'died of a broken heart 💔',
};

function resolveNight(room) {
  const g = room.game; const P = g.players; const R = g.round;
  clearTimer(room);
  const alive = (id) => P[id] && P[id].alive;
  const acts = {};
  for (const id of aliveIds(g)) { const a = g.night.acts[id]; if (a && !a.skip) acts[id] = a; }

  // --- Mafia kill target (majority, Godfather breaks ties) ---
  const mafiaAlive = aliveIds(g).filter((id) => P[id].team === 'mafia');
  const tally = {};
  for (const id of mafiaAlive) { const t = g.night.mafiaVotes[id]; if (t && t !== 'none' && alive(t)) tally[t] = (tally[t] || 0) + 1; }
  let mafiaTarget = null;
  const max = Math.max(0, ...Object.values(tally));
  if (max > 0) {
    const tied = Object.keys(tally).filter((t) => tally[t] === max);
    const gf = mafiaAlive.find((id) => P[id].role === 'godfather');
    mafiaTarget = tied.length === 1 ? tied[0] : (gf && tied.includes(g.night.mafiaVotes[gf]) ? g.night.mafiaVotes[gf] : tied[rand(tied.length)]);
  }
  const killer = mafiaAlive.find((id) => P[id].role === 'mafioso') || mafiaAlive.find((id) => P[id].role === 'godfather') || mafiaAlive[0];

  // --- Cupid (night 1) ---
  for (const [id, a] of Object.entries(acts)) {
    if (P[id].role === 'cupid' && R === 1 && a.target && a.target2 && a.target !== a.target2 && alive(a.target) && alive(a.target2)) {
      g.lovers = [a.target, a.target2];
      privMsg(room, a.target, `💘 Cupid's arrow struck! You are in love with ${pname(room, a.target2)}. If one of you dies, so does the other.`);
      privMsg(room, a.target2, `💘 Cupid's arrow struck! You are in love with ${pname(room, a.target)}. If one of you dies, so does the other.`);
      privMsg(room, id, `You made ${pname(room, a.target)} and ${pname(room, a.target2)} fall in love.`);
    }
  }

  // --- Self actions (cannot be blocked) ---
  const alerting = new Set(); const vested = new Set();
  for (const [id, a] of Object.entries(acts)) {
    const p = P[id];
    if (p.role === 'veteran' && p.uses.alert > 0) { alerting.add(id); p.uses.alert--; }
    if (p.role === 'survivor' && p.uses.vest > 0) { vested.add(id); p.uses.vest--; }
  }

  // --- Roleblocks ---
  const blocked = new Set();
  for (const [id, a] of Object.entries(acts)) {
    if ((P[id].role === 'escort' || P[id].role === 'consort') && alive(a.target) && !alerting.has(a.target)) blocked.add(a.target);
  }
  for (const id of blocked) {
    if (acts[id] || id === killer) privMsg(room, id, '💤 Someone distracted you last night. Your ability failed.');
  }
  const active = (id) => acts[id] && !blocked.has(id);

  // --- Visits ---
  const visits = [];
  const SELF_KINDS = new Set(['alert', 'vest', 'link']);
  for (const [id, a] of Object.entries(acts)) {
    const act = ROLES[P[id].role].act; if (!act || SELF_KINDS.has(act.kind)) continue;
    const isBlocker = P[id].role === 'escort' || P[id].role === 'consort';
    if ((isBlocker || active(id)) && a.target && a.target !== id) visits.push({ from: id, to: a.target });
  }
  let mafiaKillOn = false;
  if (mafiaTarget && killer) {
    if (blocked.has(killer)) { for (const m of mafiaAlive) privMsg(room, m, 'The hit failed — your killer was distracted.'); }
    else { mafiaKillOn = true; if (!visits.some((v) => v.from === killer && v.to === mafiaTarget)) visits.push({ from: killer, to: mafiaTarget }); }
  }

  // --- Framing, dousing, protection ---
  const framed = new Set(); const healed = {}; const guards = {}; const attacks = [];
  let ignite = null;
  for (const [id, a] of Object.entries(acts)) {
    if (!active(id)) continue;
    const p = P[id]; const t = a.target;
    switch (p.role) {
      case 'framer': framed.add(t); break;
      case 'arsonist':
        if (t === id) ignite = id;
        else if (alive(t)) { P[t].doused = true; privMsg(room, id, `You doused ${pname(room, t)} in gasoline.`); }
        break;
      case 'doctor': (healed[t] = healed[t] || []).push(id); p.lastHealed = t; break;
      case 'witch':
        if (a.option === 'heal' && p.uses.heal > 0) { (healed[t] = healed[t] || []).push(id); p.uses.heal--; }
        if (a.option === 'poison' && p.uses.poison > 0) { attacks.push({ from: id, to: t, kind: 'poison' }); p.uses.poison--; }
        break;
      case 'bodyguard': (guards[t] = guards[t] || []).push(id); break;
      case 'vigilante': if (p.uses.shoot > 0 && R > 1) { attacks.push({ from: id, to: t, kind: 'vig' }); p.uses.shoot--; } break;
      case 'serialkiller': attacks.push({ from: id, to: t, kind: 'sk' }); break;
    }
  }
  for (const p of Object.values(P)) if (p.role === 'doctor' && !active(p.id)) p.lastHealed = null;
  if (mafiaKillOn) attacks.unshift({ from: killer, to: mafiaTarget, kind: 'mafia' });
  if (ignite) {
    for (const p of Object.values(P)) if (p.alive && p.doused) { attacks.push({ from: ignite, to: p.id, kind: 'fire', unstoppable: true }); p.doused = false; }
    privMsg(room, ignite, '🔥 You lit the match.');
  }
  for (const vet of alerting) {
    for (const v of visits) if (v.to === vet && v.from !== vet) attacks.push({ from: vet, to: v.from, kind: 'veteran' });
  }

  // --- Resolve attacks ---
  const dying = new Map(); const usedGuard = new Set();
  for (const atk of attacks) {
    const t = atk.to; if (!alive(t)) continue;
    if (alerting.has(t) && atk.kind !== 'fire') { privMsg(room, t, '🎖️ Someone attacked you, but you were on alert and fought back.'); continue; }
    if (!atk.unstoppable) {
      if (vested.has(t)) { privMsg(room, t, '🦺 You were attacked, but your vest saved you!'); continue; }
      const bg = atk.kind !== 'veteran' && (guards[t] || []).find((b) => !usedGuard.has(b) && alive(b));
      if (bg) {
        usedGuard.add(bg);
        dying.set(bg, CAUSE.bgDie);
        if (atk.from !== bg && alive(atk.from)) dying.set(atk.from, CAUSE.bgKill);
        privMsg(room, t, '🛡️ You were attacked, but a Bodyguard jumped in front of you!');
        continue;
      }
      if (healed[t]) {
        privMsg(room, t, '🩺 You were attacked, but someone nursed you back to health!');
        for (const h of healed[t]) privMsg(room, h, `Your target ${pname(room, t)} was attacked — and you saved them!`);
        continue;
      }
    }
    if (!dying.has(t)) dying.set(t, CAUSE[atk.kind]);
  }

  // --- Information roles ---
  for (const [id, a] of Object.entries(acts)) {
    if (!active(id)) continue;
    const p = P[id]; const t = a.target; if (!P[t]) continue;
    const tp = P[t];
    if (p.role === 'detective') {
      const guilty = framed.has(t) || tp.role === 'miller' || (tp.team === 'mafia' && tp.role !== 'godfather');
      privMsg(room, id, guilty ? `🔎 ${pname(room, t)} looks SUSPICIOUS — they appear to be Mafia!` : `🔎 ${pname(room, t)} seems innocent.`);
    } else if (p.role === 'consigliere') {
      privMsg(room, id, `📜 ${pname(room, t)} is the ${ROLES[tp.role].name}.`);
    } else if (p.role === 'tracker') {
      const went = visits.filter((v) => v.from === t).map((v) => pname(room, v.to));
      privMsg(room, id, went.length ? `👣 ${pname(room, t)} visited ${went.join(', ')}.` : `👣 ${pname(room, t)} stayed home.`);
    } else if (p.role === 'lookout') {
      const who = [...new Set(visits.filter((v) => v.to === t && v.from !== id).map((v) => pname(room, v.from)))];
      privMsg(room, id, who.length ? `🔭 ${pname(room, t)} was visited by ${who.join(', ')}.` : `🔭 Nobody visited ${pname(room, t)}.`);
    } else if (p.role === 'silencer') {
      tp.silencedDay = R;
    } else if (p.role === 'janitor' && p.uses.clean > 0 && dying.has(t)) {
      tp.cleaned = true; p.uses.clean--;
      privMsg(room, id, `🧹 You cleaned ${pname(room, t)}. They were the ${ROLES[tp.role].name}.`);
    }
  }

  // --- Lovers ---
  if (g.lovers) {
    const [a, b] = g.lovers;
    if (dying.has(a) && alive(b) && !dying.has(b)) dying.set(b, CAUSE.heart);
    if (dying.has(b) && alive(a) && !dying.has(a)) dying.set(a, CAUSE.heart);
  }

  // --- Apply ---
  announce(room, `🌅 Morning of Day ${R}.`, 'phase');
  if (!dying.size) announce(room, '☀️ Nobody died last night.', 'good');
  for (const [id, cause] of dying) {
    const p = P[id]; p.alive = false; p.deathText = `${cause} on Night ${R}`;
    announce(room, `💀 ${pname(room, id)} ${cause}. ${roleLabel(room, p)}`, 'death');
    privMsg(room, id, '💀 You died. You can now chat in the Graveyard.');
  }
  for (const p of Object.values(P)) if (p.alive && p.silencedDay === R) announce(room, `🤐 ${pname(room, p.id)} has been silenced and cannot speak today.`, 'warn');
  becomeJesterCheck(room);
  if (!checkWin(room)) enterPhase(room, 'day');
}

function becomeJesterCheck(room) {
  for (const p of Object.values(room.game.players)) {
    if (p.alive && p.role === 'executioner' && p.exeTarget && !room.game.players[p.exeTarget].alive) {
      p.role = 'jester'; p.team = 'neutral';
      privMsg(room, p.id, '🃏 Your target died at night. You are now a Jester — get yourself voted out to win!');
    }
  }
}

// Day vote
function voteTally(g) {
  const tally = {}; let skip = 0;
  for (const id of aliveIds(g)) {
    const v = g.votes[id]; if (!v) continue;
    const w = g.players[id].mayorRevealed ? 2 : 1;
    if (v === 'skip') skip += w;
    else if (g.players[v] && g.players[v].alive) tally[v] = (tally[v] || 0) + w;
  }
  return { tally, skip };
}

function resolveVote(room) {
  const g = room.game; clearTimer(room);
  const { tally, skip } = voteTally(g);
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter((t) => tally[t] === max);
  const living = aliveIds(g).reduce((n, id) => n + (g.players[id].mayorRevealed ? 2 : 1), 0);
  let out = null;
  if (max > 0 && top.length === 1 && max > skip && (!room.settings.majority || max > living / 2)) out = top[0];
  if (!out) {
    announce(room, top.length > 1 && max > 0 ? '⚖️ The vote is tied. Nobody is eliminated today.' : '⚖️ The town could not agree. Nobody is eliminated today.', 'info');
  } else {
    const p = g.players[out];
    p.alive = false; p.deathText = `was voted out on Day ${g.round}`;
    const revealed = room.settings.revealOnDeath ? `They were the ${ROLES[p.role].icon} ${ROLES[p.role].name}.` : 'Their role stays a mystery.';
    announce(room, `🪢 The town has voted out ${pname(room, out)} (${max} votes). ${revealed}`, 'death');
    privMsg(room, out, '💀 You were voted out. You can now chat in the Graveyard.');
    if (p.role === 'jester') { g.extraWinners.add(out); announce(room, '🃏 HA HA HA! That was the Jester — and the Jester WINS!', 'warn'); }
    for (const e of Object.values(g.players)) {
      if (e.role === 'executioner' && e.exeTarget === out) { g.extraWinners.add(e.id); announce(room, '⚖️ An Executioner got their target voted out and WINS!', 'warn'); }
    }
    if (g.lovers && g.lovers.includes(out)) {
      const other = g.lovers.find((x) => x !== out);
      if (g.players[other].alive) { g.players[other].alive = false; g.players[other].deathText = CAUSE.heart; announce(room, `💔 ${pname(room, other)} ${CAUSE.heart}. ${roleLabel(room, g.players[other])}`, 'death'); }
    }
  }
  becomeJesterCheck(room);
  if (!checkWin(room)) enterPhase(room, 'verdict');
}

// Win conditions
function checkWin(room) {
  const g = room.game; const P = Object.values(g.players);
  const alive = P.filter((p) => p.alive);
  const m = alive.filter((p) => p.team === 'mafia').length;
  const killers = alive.filter((p) => ROLES[p.role].killer);
  const k = killers.length;
  const o = alive.length - m - k;
  let winTeam = null; let text = null; let soloWinner = null;
  if (alive.length === 0) { winTeam = 'none'; text = 'Everyone is dead. Nobody wins!'; }
  else if (m === 0 && k === 0) { winTeam = 'town'; text = '🏘️ The TOWN wins! Every threat has been eliminated.'; }
  else if (k === 0 && m >= o) { winTeam = 'mafia'; text = '🔪 The MAFIA wins! They now control the town.'; }
  else if (m === 0 && k === 1 && o <= 1) { soloWinner = killers[0]; winTeam = 'solo'; text = `${ROLES[soloWinner.role].icon} The ${ROLES[soloWinner.role].name} wins! Nobody could stop them.`; }
  else if (o === 0 && alive.length <= 2) { winTeam = 'none'; text = 'The last killers face off… it\'s a draw!'; }
  if (!winTeam) return false;

  const winners = new Set(g.extraWinners);
  for (const p of P) {
    if (winTeam === 'town' && p.team === 'town') winners.add(p.id);
    if (winTeam === 'mafia' && p.team === 'mafia') winners.add(p.id);
    if (p.role === 'survivor' && p.alive) winners.add(p.id);
  }
  if (soloWinner) winners.add(soloWinner.id);
  if (g.lovers && g.lovers.every((id) => g.players[id].alive)) {
    g.lovers.forEach((id) => winners.add(id));
    for (const p of P) if (p.role === 'cupid') winners.add(p.id);
  }
  clearTimer(room);
  g.phase = 'ended'; g.endsAt = null; g.winners = [...winners]; g.winText = text;
  announce(room, `🏁 GAME OVER — ${text}`, 'end');
  hub.broadcast(room);
  return true;
}

module.exports = { pname, needsNightAction, voteTally, startGame, announce, clearTimer, advance, maybeAutoAdvance };
