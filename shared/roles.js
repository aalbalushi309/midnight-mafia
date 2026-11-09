// Shared role definitions — used by both the server (require) and the browser (window.ROLES).
(function (root) {
  // act.target: 'other' = any living player except you, 'any' = includes yourself,
  //             'self' = a yes/no toggle on yourself, 'two' = pick two players (Cupid)
  const ROLES = {
    // ---------------- TOWN ----------------
    citizen: {
      name: 'Citizen', team: 'town', icon: '🧑‍🌾',
      desc: 'No special power. Use logic, watch votes, and find the Mafia.',
      goal: 'Eliminate all Mafia and hostile killers.',
    },
    detective: {
      name: 'Detective', team: 'town', icon: '🕵️',
      desc: 'Each night, investigate one player to learn if they look like Mafia. The Godfather looks innocent; the Miller and framed players look guilty.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'investigate', label: 'Investigate', target: 'other' },
    },
    doctor: {
      name: 'Doctor', team: 'town', icon: '🩺',
      desc: 'Each night, protect one player from being killed. You may not protect the same player two nights in a row.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'heal', label: 'Protect', target: 'any' },
    },
    bodyguard: {
      name: 'Bodyguard', team: 'town', icon: '🛡️',
      desc: 'Guard one player each night. If they are attacked, you die in their place — and take the attacker down with you.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'guard', label: 'Guard', target: 'other' },
    },
    vigilante: {
      name: 'Vigilante', team: 'town', icon: '🔫',
      desc: 'You have 2 bullets. At night you may shoot a player. Shoot carefully — innocents bleed too.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'shoot', label: 'Shoot', target: 'other', uses: 2, notNightOne: true },
    },
    mayor: {
      name: 'Mayor', team: 'town', icon: '🎩',
      desc: 'During the day you may reveal yourself as Mayor. Once revealed, your vote counts as 2 — but everyone knows who you are.',
      goal: 'Eliminate all Mafia and hostile killers.',
      dayAct: 'reveal',
    },
    veteran: {
      name: 'Veteran', team: 'town', icon: '🎖️',
      desc: 'You may go on alert 2 times. While on alert you cannot be killed, and you shoot EVERYONE who visits you — friend or foe.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'alert', label: 'Go on alert', target: 'self', uses: 2 },
    },
    tracker: {
      name: 'Tracker', team: 'town', icon: '👣',
      desc: 'Follow one player each night and learn who they visited.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'track', label: 'Track', target: 'other' },
    },
    lookout: {
      name: 'Lookout', team: 'town', icon: '🔭',
      desc: 'Watch one player\'s house each night and learn everyone who visited them.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'watch', label: 'Watch', target: 'other' },
    },
    medium: {
      name: 'Medium', team: 'town', icon: '🔮',
      desc: 'At night you can read and talk in the Graveyard chat with the dead.',
      goal: 'Eliminate all Mafia and hostile killers.',
    },
    escort: {
      name: 'Escort', team: 'town', icon: '💃',
      desc: 'Distract one player each night. Their night ability fails.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'block', label: 'Distract', target: 'other' },
    },
    miller: {
      name: 'Miller', team: 'town', icon: '🌾',
      desc: 'You are innocent… but you look like Mafia to the Detective. Good luck explaining that.',
      goal: 'Eliminate all Mafia and hostile killers.',
    },
    witch: {
      name: 'Witch', team: 'town', icon: '🧪',
      desc: 'You have one Healing potion and one Poison potion for the whole game. Use them at night.',
      goal: 'Eliminate all Mafia and hostile killers.',
      act: { kind: 'potion', label: 'Use potion', target: 'any', options: ['heal', 'poison'] },
    },

    // ---------------- MAFIA ----------------
    mafioso: {
      name: 'Mafioso', team: 'mafia', icon: '🔪',
      desc: 'Vote with your family on who to kill each night. You are the one who carries out the hit.',
      goal: 'Outnumber the town.',
    },
    godfather: {
      name: 'Godfather', team: 'mafia', icon: '🤵',
      desc: 'Leader of the Mafia. You look innocent to the Detective, and your vote breaks ties on the kill.',
      goal: 'Outnumber the town.',
    },
    framer: {
      name: 'Framer', team: 'mafia', icon: '🖼️',
      desc: 'Each night, frame a player so they look like Mafia to the Detective tonight.',
      goal: 'Outnumber the town.',
      act: { kind: 'frame', label: 'Frame', target: 'other' },
    },
    consigliere: {
      name: 'Consigliere', team: 'mafia', icon: '📜',
      desc: 'Each night, investigate a player to learn their exact role.',
      goal: 'Outnumber the town.',
      act: { kind: 'consig', label: 'Investigate', target: 'other' },
    },
    silencer: {
      name: 'Silencer', team: 'mafia', icon: '🤐',
      desc: 'Each night, silence a player — they cannot chat during the next day (they can still vote).',
      goal: 'Outnumber the town.',
      act: { kind: 'silence', label: 'Silence', target: 'other' },
    },
    janitor: {
      name: 'Janitor', team: 'mafia', icon: '🧹',
      desc: '2 times per game, clean a player. If they die tonight, their role is hidden from the town (but you learn it).',
      goal: 'Outnumber the town.',
      act: { kind: 'clean', label: 'Clean', target: 'other', uses: 2 },
    },
    consort: {
      name: 'Consort', team: 'mafia', icon: '💋',
      desc: 'Distract one player each night. Their night ability fails.',
      goal: 'Outnumber the town.',
      act: { kind: 'block', label: 'Distract', target: 'other' },
    },

    // ---------------- NEUTRAL ----------------
    jester: {
      name: 'Jester', team: 'neutral', icon: '🃏',
      desc: 'Act suspicious. If the town votes you out, you win.',
      goal: 'Get yourself voted out during the day.',
    },
    serialkiller: {
      name: 'Serial Killer', team: 'neutral', icon: '🩸', killer: true,
      desc: 'Kill one player every night. You work alone and the Detective sees you as innocent.',
      goal: 'Be the last one standing.',
      act: { kind: 'kill', label: 'Kill', target: 'other' },
    },
    arsonist: {
      name: 'Arsonist', team: 'neutral', icon: '🔥', killer: true,
      desc: 'Douse a player in gasoline each night, or ignite to burn every doused player at once. Fire cannot be healed.',
      goal: 'Be the last one standing.',
      act: { kind: 'douse', label: 'Douse / Ignite', target: 'any', hint: 'Pick yourself to IGNITE everyone doused.' },
    },
    survivor: {
      name: 'Survivor', team: 'neutral', icon: '🦺',
      desc: 'You have 3 bulletproof vests. Put one on at night to survive any attack (except fire).',
      goal: 'Be alive when the game ends.',
      act: { kind: 'vest', label: 'Wear vest', target: 'self', uses: 3 },
    },
    executioner: {
      name: 'Executioner', team: 'neutral', icon: '⚖️',
      desc: 'You are given a target. Convince the town to vote them out. If they die at night, you become a Jester.',
      goal: 'Get your target voted out.',
    },
    cupid: {
      name: 'Cupid', team: 'neutral', icon: '💘',
      desc: 'On night 1, choose two players to fall in love. If one lover dies, the other dies of heartbreak. You win if both lovers survive to the end.',
      goal: 'Keep your lovers alive until the end.',
      act: { kind: 'link', label: 'Make lovers', target: 'two', nightOneOnly: true },
    },
  };

  const TEAM_INFO = {
    town: { name: 'Town', color: '#4ade80' },
    mafia: { name: 'Mafia', color: '#f43f5e' },
    neutral: { name: 'Neutral', color: '#c084fc' },
  };

  // Research-based balance: ~20–25% of players are Mafia (≈1 Mafia per 4–5 players),
  // and roughly 1–2 town power roles per Mafia power role.
  function recommendedMafia(n) {
    if (n <= 5) return 1;
    return Math.max(1, Math.round(n * 0.22));
  }

  // Build a balanced random setup for n players.
  function randomSetup(n, rng) {
    rng = rng || Math.random;
    const pick = (arr) => arr.splice(Math.floor(rng() * arr.length), 1)[0];
    const mafia = recommendedMafia(n);
    const roles = {};
    const add = (k) => { roles[k] = (roles[k] || 0) + 1; };
    // Mafia specials
    const mafiaPool = ['framer', 'consigliere', 'silencer', 'janitor', 'consort'];
    if (n >= 9) add('godfather');
    let mafiaSpecials = Math.min(mafia - 1, mafiaPool.length);
    if (n >= 9) mafiaSpecials = Math.max(0, mafiaSpecials - 1);
    for (let i = 0; i < mafiaSpecials; i++) add(pick(mafiaPool));
    // Town core
    add('detective'); add('doctor');
    const townPool = ['bodyguard', 'vigilante', 'mayor', 'veteran', 'tracker', 'lookout', 'escort', 'medium', 'witch', 'miller'];
    const extraTown = Math.max(0, Math.round((n - 6) / 2.5));
    for (let i = 0; i < extraTown && townPool.length; i++) add(pick(townPool));
    // Neutral
    const neutralPool = n >= 10 ? ['jester', 'executioner', 'survivor', 'serialkiller', 'cupid', 'arsonist'] : ['jester', 'executioner', 'survivor'];
    if (n >= 7) add(pick(neutralPool));
    if (n >= 13) add(pick(neutralPool));
    return { mafiaCount: mafia, roles };
  }

  // Chat stickers (big emoji + a caption)
  const STICKERS = {
    sus: ['🤨', 'SUS'], innocent: ['😇', "I'm innocent!"], liar: ['🤥', 'LIAR'], trust: ['🤝', 'Trust me'],
    mafia: ['🔪', "It's the Mafia!"], shh: ['🤫', 'Shhh…'], vote: ['🗳️', 'Vote them out!'], watching: ['👀', "I'm watching you"],
    think: ['🤔', 'Hmm…'], lol: ['😂', 'LOL'], cry: ['😭', 'Noooo'], angry: ['😡', 'HOW?!'],
    rip: ['🪦', 'RIP'], saved: ['🩺', 'I saved you'], detective: ['🕵️', 'I know something…'], sleep: ['😴', 'zzz'],
    fire: ['🔥', 'Spicy'], gg: ['🏆', 'GG'], love: ['💘', 'Love you'], skull: ['💀', 'Dead 💀'],
  };
  const api = { ROLES, TEAM_INFO, STICKERS, recommendedMafia, randomSetup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MafiaRoles = api;
})(typeof window !== 'undefined' ? window : globalThis);
