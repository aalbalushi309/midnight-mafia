/* Midnight Mafia — browser client */
(() => {
  const { ROLES, TEAM_INFO } = window.MafiaRoles;
  const socket = io();
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- local storage (wrapped: may be unavailable) ----------
  // Privacy: everything is kept ONLY for this browser tab (sessionStorage), so a refresh keeps your
  // seat, but closing the tab forgets you completely. Nothing is ever kept on the server either.
  // The one exception is the owner's own x-ray key (mm_theme), which only exists on their own device.
  const LONG_TERM = new Set(['mm_theme']);
  const area = (k) => (LONG_TERM.has(k) ? localStorage : sessionStorage);
  const store = {
    get(k) { try { return area(k).getItem(k); } catch (_) { return null; } },
    set(k, v) { try { area(k).setItem(k, v); } catch (_) {} },
    del(k) { try { area(k).removeItem(k); } catch (_) {} },
  };
  // clean up anything older versions of the game left on this device
  try { for (const k of ['mm_token', 'mm_room', 'mm_name', 'mm_sens', 'mm_micok']) localStorage.removeItem(k); } catch (_) {}
  // A random, anonymous id for this tab only (lets you rejoin your seat after a refresh)
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  let token = store.get('mm_token');
  if (!token) { token = newToken(); store.set('mm_token', token); }

  let S = null;              // latest server view
  let clockOffset = 0;
  const ui = {
    chatTab: 'town', mtab: 'room', seenNews: 0, roleShown: false, sel: null, sel2: null, potion: 'heal',
    xrayOn: false, narrate: false, spokenLog: 0, lastPhase: null, seenChat: {}, showGuide: false,
  };

  // ---------- helpers ----------
  const COLORS = ['#e8b65a', '#f87171', '#60a5fa', '#4ade80', '#c084fc', '#f472b6', '#facc15', '#2dd4bf', '#fb923c', '#a3e635', '#38bdf8', '#e879f9'];
  const colorFor = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const avatar = (p) => `<div class="avatar" data-vpid="${p.id}" style="background:${colorFor(p.id)}">${esc((p.name || '?')[0].toUpperCase())}</div>`;
  const nameOf = (id) => (S?.players.find((p) => p.id === id) || {}).name || '???';
  const roleTag = (r) => r && ROLES[r] ? `<span class="team-${ROLES[r].team}">${ROLES[r].icon} ${ROLES[r].name}</span>` : '';
  const toast = (msg, err) => {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3500);
  };
  const emit = (ev, data) => new Promise((res) => socket.emit(ev, data, (r) => { if (r && r.error && r.error !== 'nope' && r.error !== 'gone') toast(r.error, true); res(r || {}); }));
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- connection ----------
  socket.on('connect', () => {
    const room = store.get('mm_room');
    if (room) emit('rejoin', { code: room, token }).then((r) => { if (r.error) { store.del('mm_room'); if (S) { S = null; render(); } } else if (V.on) socket.emit('voice:join'); });
    const key = store.get('mm_theme');
    if (key) emit('xray:unlock', { key });
  });
  socket.on('state', (view) => {
    const prevPhase = S?.game?.phase; const prevRound = S?.game?.round;
    S = view;
    if (view.game) clockOffset = view.game.now - Date.now();
    store.set('mm_room', view.code);
    if (view.game && (view.game.phase !== prevPhase || view.game.round !== prevRound)) onPhaseChange(prevPhase);
    if (!view.game) { ui.lastPhase = null; }
    render();
  });
  socket.on('kicked', () => { voiceStop(true); store.del('mm_room'); S = null; toast('You were removed from the room.', true); render(); });

  function onPhaseChange(prev) {
    const g = S.game;
    ui.sel = null; ui.sel2 = null;
    if (g.phase === 'night' && prev !== undefined) ui.roleShown = false;
    if (g.phase === 'night' && ui.chatTab === 'town' && S.chat.mafia) ui.chatTab = 'mafia';
    if (g.phase === 'day' && ui.chatTab !== 'dead') ui.chatTab = 'town';
    const autoTab = { night: 'me', day: 'news', voting: 'me', verdict: 'news', ended: 'me' }[g.phase];
    if (autoTab) ui.mtab = autoTab;
    buzz(g.phase === 'night' || g.phase === 'voting' ? [90, 60, 90] : [60]);
    keepAwake();
    const titles = { night: `🌙 Night ${g.round}`, day: `☀️ Day ${g.round}`, voting: '🗳️ Time to vote', verdict: '⚖️ The verdict', ended: '🏁 Game over' };
    if (prev !== undefined || g.phase === 'night') flash(titles[g.phase]);
  }
  // ---------- phone helpers ----------
  const isPhone = () => window.matchMedia('(max-width: 720px)').matches;
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) {} }
  let wakeLock = null;
  async function keepAwake() {
    try {
      if (!S?.game || S.game.phase === 'ended') { if (wakeLock) { wakeLock.release(); wakeLock = null; } return; }
      if (!wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

  function bottomNav() {
    if (!S) return '';
    let tabs;
    if (!S.game) {
      tabs = [['room', '🏠', 'Room'], ['setup', '⚙️', 'Setup'], ['chat', '💬', 'Chat']];
    } else {
      const g = S.game;
      const meLabel = S.isModerator ? ['🎙️', 'Host'] : g.me ? ['🎭', g.phase === 'voting' ? 'Vote' : 'You'] : ['👀', 'Watch'];
      tabs = [['me', ...meLabel], ['town', '👥', 'Town'], ['news', '📰', 'News'], ['chat', '💬', 'Chat']];
    }
    if (!tabs.some((t) => t[0] === ui.mtab)) ui.mtab = tabs[0][0];
    const newsCount = S.game ? S.game.log.length + (S.game.me?.private?.length || 0) : 0;
    if (ui.mtab === 'news') ui.seenNews = newsCount;
    const chatUnread = Object.keys(S.chat).some((c) => S.chat[c].length > (ui.seenChat[c] || 0));
    const needs = S.game?.me?.needsAction || (S.game?.phase === 'voting' && S.game?.me?.alive && !S.game.votes?.[S.me]);
    const dot = { me: needs, news: newsCount > ui.seenNews, chat: chatUnread && ui.mtab !== 'chat' };
    return `<nav class="bottom-nav">${tabs.map(([k, ic, label]) => `<button class="${ui.mtab === k ? 'on' : ''}" data-mtab="${k}"><span class="ic">${ic}${dot[k] ? '<span class="ndot"></span>' : ''}</span><span>${label}</span></button>`).join('')}</nav>`;
  }

  function flash(text) {
    const f = document.createElement('div'); f.className = 'flash'; f.textContent = text;
    document.body.appendChild(f); setTimeout(() => f.remove(), 2500);
  }

  // ---------- narration (text-to-speech for the announcements) ----------
  function localVoice() {
    const vs = ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter((v) => v.localService);
    return vs.find((v) => /^en/i.test(v.lang) && v.default) || vs.find((v) => /^en/i.test(v.lang)) || vs.find((v) => v.default) || vs[0] || null;
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); // some browsers load the list lazily
  function narrate() {
    if (!S?.game) { ui.spokenLog = 0; return; }
    const log = S.game.log;
    if (!ui.narrate || !('speechSynthesis' in window)) { ui.spokenLog = log.length; return; }
    // Privacy: only voices built into the device. Some browsers offer "online" voices that send
    // the text to Google/Microsoft — those are never used. No offline voice → stay silent.
    const voice = localVoice();
    if (!voice) { ui.spokenLog = log.length; return; }
    for (let i = ui.spokenLog; i < log.length; i++) {
      const u = new SpeechSynthesisUtterance(log[i].text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ''));
      u.voice = voice; u.lang = voice.lang;
      u.rate = 0.95; u.pitch = 0.8; speechSynthesis.speak(u);
    }
    ui.spokenLog = log.length;
  }

  // =====================================================================
  // RENDER
  // =====================================================================
  function render() {
    const active = document.activeElement;
    const keep = active && active.id && active.id !== 'chatInput' && /INPUT|SELECT/.test(active.tagName) ? { id: active.id, val: active.value } : null;

    const phase = !S ? 'lobby' : !S.game ? 'lobby' : S.game.phase;
    const scrollY = window.scrollY;
    const typed = !S || !S.game ? { nameIn: $('#nameIn')?.value, codeIn: $('#codeIn')?.type === 'hidden' ? undefined : $('#codeIn')?.value } : {};
    const app = $('#app');
    // The chat dock lives OUTSIDE #app, so redrawing the game never touches it
    // (no lost scroll position, no lost typing focus, no keyboard closing on phones).
    $('#top').innerHTML = S ? topbar(S.game ? undefined : 'Lobby') : '';
    if (!S) app.innerHTML = homeView();
    else if (!S.game) app.innerHTML = lobbyView();
    else app.innerHTML = gameView();
    $('#navSlot').innerHTML = S ? bottomNav() : '';
    $('#shell').classList.toggle('with-chat', !!S);
    $('#chatDock').classList.toggle('hidden', !S);
    if (S) renderChat();
    document.body.className = 'phase-' + phase + (S ? ' has-nav mt-' + ui.mtab : '');
    if (Math.abs(window.scrollY - scrollY) > 2) window.scrollTo(0, scrollY);
    for (const [id, v] of Object.entries(typed)) { const el = document.getElementById(id); if (el && v !== undefined && el.type !== 'hidden') el.value = v; }
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.value = keep.val; el.focus(); } }
    const log = $('#logBox'); if (log) log.scrollTop = log.scrollHeight;
    narrate();
    tick();
    keepAwake();
    renderVoice();
  }

  // =====================================================================
  // VOICE CHAT
  // Your mic only sends while you are actually talking (it goes quiet by itself
  // when you stop). Audio goes through the game server, which decides who hears
  // whom: at night only the Mafia hear each other, the dead talk among themselves, etc.
  // =====================================================================
  const RATE = 16000, FRAME = 640; // mic is checked every 40 ms; sound is sent in 80 ms packets
  const SENS = { 1: ['Low', 5, 0.03], 2: ['Normal', 3, 0.014], 3: ['High', 2, 0.006] }; // label, × noise floor, minimum level
  const V = { on: false, ctx: null, stream: null, src: null, node: null, out: null, muted: false, talking: false, openUntil: 0,
    level: 0, floor: 0.006, sens: +(store.get('mm_sens') || 2) || 2, prev: null, peers: {}, heard: {}, q: [], enc: { pred: 0, idx: 0 } };
  const WORKLET = `class Cap extends AudioWorkletProcessor {
    constructor(){ super(); this.r = sampleRate / ${RATE}; this.pos = 0; this.lp = 0; this.last = 0; this.buf = new Float32Array(${FRAME}); this.n = 0; }
    process(inputs){
      const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
      const f = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) { this.lp += 0.45 * (ch[i] - this.lp); f[i] = this.lp; }
      for (; this.pos < ch.length; this.pos += this.r) {
        const i = Math.floor(this.pos), t = this.pos - i;
        const a = i < 0 ? this.last : f[i], b = i + 1 < ch.length ? f[i + 1] : f[i];
        this.buf[this.n++] = a + (b - a) * t;
        if (this.n === ${FRAME}) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(${FRAME}); this.n = 0; }
      }
      this.pos -= ch.length; this.last = f[ch.length - 1];
      return true;
    }
  }
  registerProcessor('mm-cap', Cap);`;
  // ---- Voice compression: IMA ADPCM, 4 bits per sample (half the size of the old 8-bit format).
  // Packet = [predictor int16][step index][0] + 2 samples per byte. Each packet carries its own
  // starting state, so a lost packet never garbles the next one.
  const ADPCM_IDX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
  const ADPCM_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
  const adpcmStep = (st, nib) => {
    let step = ADPCM_STEP[st.idx]; let diff = step >> 3;
    if (nib & 4) diff += step; if (nib & 2) diff += step >> 1; if (nib & 1) diff += step >> 2;
    st.pred = Math.max(-32768, Math.min(32767, st.pred + (nib & 8 ? -diff : diff)));
    st.idx = Math.max(0, Math.min(88, st.idx + ADPCM_IDX[nib]));
  };
  function adpcmEnc(pcm, st) {
    const out = new Uint8Array(4 + Math.ceil(pcm.length / 2));
    out[0] = st.pred & 255; out[1] = (st.pred >> 8) & 255; out[2] = st.idx;
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
      let diff = s - st.pred; let nib = 0; if (diff < 0) { nib = 8; diff = -diff; }
      let step = ADPCM_STEP[st.idx];
      if (diff >= step) { nib |= 4; diff -= step; } step >>= 1;
      if (diff >= step) { nib |= 2; diff -= step; } step >>= 1;
      if (diff >= step) nib |= 1;
      adpcmStep(st, nib);
      out[4 + (i >> 1)] |= i & 1 ? nib << 4 : nib;
    }
    return out;
  }
  function adpcmDec(u) {
    const st = { pred: (u[0] | (u[1] << 8)) << 16 >> 16, idx: Math.min(88, u[2]) };
    const n = (u.length - 4) * 2; const f = new Float32Array(n);
    for (let i = 0; i < n; i++) { const b = u[4 + (i >> 1)]; adpcmStep(st, i & 1 ? b >> 4 : b & 15); f[i] = st.pred / 32768; }
    return f;
  }

  // Must run inside a tap (phones only allow sound to start from a tap)
  function primeAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('no audio');
    V.ctx = V.ctx || new AC();
    V.ctx.resume();
    if (!V.out) { V.out = V.ctx.createGain(); V.out.connect(V.ctx.destination); }
  }
  // Microphone ONLY — never the camera. Returns 16 kHz sound frames to onFrame.
  async function openMic(onFrame) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    try {
      if (!V.workletReady) {
        await V.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
        V.workletReady = true;
      }
      const src = V.ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(V.ctx, 'mm-cap');
      node.port.onmessage = (e) => onFrame(e.data);
      const sink = V.ctx.createGain(); sink.gain.value = 0; // keeps it running without playing your own voice back
      src.connect(node).connect(sink).connect(V.ctx.destination);
      return { stream, close() { try { src.disconnect(); node.disconnect(); } catch (_) {} stream.getTracks().forEach((t) => t.stop()); } };
    } catch (e) { stream.getTracks().forEach((t) => t.stop()); throw e; }
  }
  // When the mic can't be used: a clear card with the exact steps for THIS phone, and a Try again button.
  function micHelp(e, retry) {
    const blocked = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    const busy = e && (e.name === 'NotReadableError' || e.name === 'AbortError');
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const steps = ios
      ? ['Tap <b>aA</b> on the left of the address bar', 'Tap <b>Website Settings</b>', 'Set <b>Microphone</b> to <b>Allow</b>']
      : android
        ? ['Tap the <b>🔒</b> or <b>⚙</b> next to the web address', 'Tap <b>Permissions</b> (or Site settings)', 'Turn <b>Microphone</b> on']
        : ['Click the <b>🔒</b> next to the web address', 'Find <b>Microphone</b>', 'Choose <b>Allow</b>, then reload if asked'];
    const title = blocked ? 'Your mic is blocked' : busy ? 'Your mic is busy' : 'No mic found';
    const body = blocked
      ? `<p class="consent-sub">No problem, it takes 10 seconds to fix:</p><ol class="help-steps">${steps.map((s) => `<li><span>${s}</span></li>`).join('')}</ol>`
      : busy ? '<p class="consent-sub">Another app is using it (a call, WhatsApp, a recorder…). Close it, then try again.</p>'
        : '<p class="consent-sub">This device has no microphone we can use. Try plugging in headphones with a mic, or use your phone.</p>';
    openModal(`<div class="consent">
      <div class="consent-ic warn"><span>🎤</span></div>
      <h2>${title}</h2>
      ${body}
      ${retry ? '<button class="btn primary big block" data-retry>Try again</button>' : ''}
      <button class="btn ghost block" data-close>${retry === voiceRetry ? 'Just listen' : 'Close'}</button>
      ${retry === voiceRetry ? '<p class="consent-foot">You can still hear everyone without a mic.</p>' : ''}
    </div>`, true);
    if (retry) $('#modal [data-retry]').addEventListener('click', () => { closeModal(); retry(); });
  }
  const voiceRetry = () => voiceMicAgain();

  // Ask before the mic is ever used. Explains exactly what is (and isn't) used.
  function micConsent(what) {
    if (store.get('mm_micok') === '1') { try { primeAudio(); } catch (_) {} return Promise.resolve(true); }
    return new Promise((resolve) => {
      openModal(`<div class="consent">
        <div class="consent-ic"><span>🎤</span></div>
        <h2>${what === 'rec' ? 'Send a voice message?' : 'Talk with your voice?'}</h2>
        <p class="consent-sub">${what === 'rec' ? 'We need your mic to record it.' : 'Your mic turns on only while you talk.'}</p>
        <div class="consent-chips">
          <span class="chip ok">🎤 Mic only</span>
          <span class="chip no">📷 No camera</span>
          <span class="chip no">📍 No location</span>
          <span class="chip no">📱 No phone info</span>
        </div>
        <button class="btn primary big block" data-consent="1">Allow mic</button>
        <button class="btn ghost block" data-consent="0">Not now</button>
        <p class="consent-foot">Next, your phone asks once. Tap <b>Allow</b>.<br/>${what === 'rec' ? 'Messages are deleted when the room closes.' : 'Live only. Nothing is recorded.'}</p>
      </div>`, true);
      const box = $('#modal');
      const done = (v) => { box.removeEventListener('click', onClick, true); closeModal(); resolve(v); };
      const onClick = (e) => {
        const b = e.target.closest('[data-consent]');
        if (b) { e.stopPropagation(); if (b.dataset.consent === '1') { store.set('mm_micok', '1'); try { primeAudio(); } catch (_) {} done(true); } else done(false); }
        else if (e.target.id === 'modal') done(false);
      };
      box.addEventListener('click', onClick, true);
    });
  }

  async function voiceStart() {
    if (V.on || !S) return;
    if (!(await micConsent('voice'))) return;
    try { primeAudio(); } catch (_) { return toast('Voice chat does not work in this browser. Try Chrome or Safari.', true); }
    V.on = true; V.peers = {};
    socket.emit('voice:join');
    renderVoice();
    await voiceMicAgain();
  }
  async function voiceMicAgain() {
    if (!V.on || V.mic) return;
    try { primeAudio(); } catch (_) {}
    try {
      const mic = await openMic(onMicFrame);
      if (!V.on) { mic.close(); return; }
      V.mic = mic; V.stream = mic.stream;
      toast('🎤 You’re in! Just talk.');
    } catch (e) {
      V.stream = null;
      micHelp(e, voiceRetry);
    }
    renderVoice();
  }
  function voiceStop(quiet) {
    if (!V.on) return;
    V.on = false; V.talking = false;
    if (!quiet) socket.emit('voice:leave');
    if (V.mic) V.mic.close();
    V.mic = V.stream = null; V.peers = {}; V.heard = {}; V.q = [];
    renderVoice();
  }

  // Every 40 ms of mic sound: is this person talking? If yes, send it; if not, send nothing.
  function onMicFrame(pcm) {
    if (!V.on) return;
    let sq = 0; for (let i = 0; i < pcm.length; i++) sq += pcm[i] * pcm[i];
    const lvl = Math.sqrt(sq / pcm.length); V.level = lvl;
    const [, mult, min] = SENS[V.sens] || SENS[2];
    const now = performance.now();
    if (lvl > Math.max(min, V.floor * mult)) V.openUntil = now + 700; // keep sending a moment after the last word
    const talking = now < V.openUntil;
    if (!talking) V.floor = lvl < V.floor ? V.floor * 0.8 + lvl * 0.2 : V.floor + (lvl - V.floor) * 0.01; // learn the room's background noise
    V.floor = Math.max(0.002, Math.min(0.05, V.floor));
    const allowed = talking && !V.muted && S?.voice?.can;
    if (allowed) {
      if (!V.talking && V.prev) V.q.push(V.prev); // don't cut off the first syllable
      V.q.push(pcm);
      if (V.q.length >= 2) sendVoice(); // 2 × 40 ms = one 80 ms packet
    } else if (V.q.length) sendVoice(); // finished talking: send what's left
    V.prev = pcm;
    if (allowed !== V.talking) { V.talking = allowed; paintSpeaking(); }
  }

  function sendVoice() {
    const n = V.q.reduce((a, f) => a + f.length, 0); const pcm = new Float32Array(n);
    let o = 0; for (const f of V.q) { pcm.set(f, o); o += f.length; }
    V.q = [];
    socket.volatile.emit('v', adpcmEnc(pcm, V.enc).buffer);
  }

  // Someone else's voice arrives: queue it a tiny bit ahead so it plays smoothly.
  socket.on('v', (pid, data) => {
    if (!V.on || !V.ctx || !data || data.byteLength < 6) return;
    const pcm = adpcmDec(new Uint8Array(data));
    const buf = V.ctx.createBuffer(1, pcm.length, RATE); buf.getChannelData(0).set(pcm);
    const src = V.ctx.createBufferSource(); src.buffer = buf; src.connect(V.out);
    const p = V.peers[pid] || (V.peers[pid] = { t: 0 });
    const now = V.ctx.currentTime;
    if (p.t < now + 0.02 || p.t > now + 0.7) p.t = now + 0.16; // small cushion so 80 ms packets play smoothly
    src.start(p.t); p.t += buf.duration;
    const fresh = !V.heard[pid] || Date.now() - V.heard[pid] > 400;
    V.heard[pid] = Date.now();
    if (fresh) paintSpeaking();
  });

  function speakingNow() {
    const now = Date.now();
    const ids = Object.keys(V.heard).filter((id) => now - V.heard[id] < 400);
    if (V.talking && S) ids.push(S.me);
    return ids;
  }
  function paintSpeaking() {
    const ids = new Set(speakingNow());
    document.querySelectorAll('[data-vpid]').forEach((el) => el.classList.toggle('talking', ids.has(el.dataset.vpid)));
    const mic = $('#vMic'); if (mic) mic.classList.toggle('live', V.talking);
  }
  setInterval(() => { if (V.on) paintSpeaking(); }, 250);

  function renderVoice() {
    const bar = $('#voiceBar'); if (!bar) return;
    if (!S) { if (V.on) voiceStop(true); bar.innerHTML = ''; bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const members = (S.voice?.members || []).filter((id) => S.players.some((p) => p.id === id));
    const others = members.filter((id) => id !== S.me);
    const names = others.map((id) => `<b>${esc(nameOf(id))}</b>`);
    const chip = (id) => `<span class="vchip" data-vpid="${id}"><span class="vdot" style="background:${colorFor(id)}">${esc((nameOf(id) || '?')[0].toUpperCase())}</span>${id === S.me ? 'You' : esc(nameOf(id))}</span>`;
    if (!V.on) {
      const who = !names.length ? 'Talk with your voice instead of typing 🎉'
        : names.length <= 3 ? `${names.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${names.length === 1 ? 'is' : 'are'} talking. Join them!`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} others are talking. Join them!`;
      bar.innerHTML = `<button class="btn small vjoin ${names.length ? 'pulse' : ''}" data-action="voiceJoin">🎙️ Join voice</button>
        <span class="small vinvite">${who}</span>`;
    } else {
      const v = S.voice || {}; const sens = SENS[V.sens] || SENS[2];
      bar.innerHTML = `<button id="vMic" class="vmic ${V.muted || !V.stream ? 'off' : ''} ${V.talking ? 'live' : ''}" data-action="voiceMute" title="${V.stream ? 'Mute / unmute' : 'Turn on your mic'}">${!V.stream ? '🎧' : V.muted ? '🔇' : '🎤'}</button>
        <span class="vhint ${v.can ? '' : 'no'}">${!V.stream ? '🎧 Listening · tap 🎧 to talk' : V.muted ? '🔇 Muted · tap to talk' : esc(v.text || '')}</span>
        <span class="grow"></span>
        ${V.stream ? `<button class="btn small ghost" data-action="voiceSens" title="How loud you must talk before your mic opens">🎚️ ${sens[0]}</button>` : ''}
        <button class="btn small ghost" data-action="voiceLeave" title="Leave voice">✕<span class="hide-sm"> Leave voice</span></button>
        <div class="vchips">${[S.me, ...others].map(chip).join('')}${others.length ? '' : '<span class="muted small">Nobody else yet. Invite your friends to join voice!</span>'}</div>`;
    }
    paintSpeaking();
  }

  // ---------------- HOME ----------------
  // Turn whatever was typed or pasted into a room code: "abcd", " AB CD ", or a whole invite link all work
  function parseCode(v) {
    v = String(v || '').trim();
    const m = v.match(/[?&]room=([A-Za-z]{4})/); if (m) return m[1].toUpperCase();
    return v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }
  function homeView() {
    const invite = parseCode(new URLSearchParams(location.search).get('room') || '');
    const name = store.get('mm_name') || '';
    const nameField = `<div class="field"><label for="nameIn">Your name</label>
          <input id="nameIn" maxlength="18" placeholder="Type your name" value="${esc(name)}" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" /></div>`;
    const body = invite ? `
        <div style="text-align:center"><div class="muted small">You're invited to room</div><div class="room-code" style="font-size:44px">${invite}</div></div>
        ${nameField}
        <input type="hidden" id="codeIn" value="${invite}" />
        <button class="btn primary big block" type="submit" data-mode="join">🚪 Join room ${invite}</button>
        <div id="homeErr" class="home-err hidden"></div>
        <div class="muted small" style="text-align:center">Not the right room? <a href="/" data-action="clearInvite">Enter a different code</a></div>`
      : `
        ${nameField}
        <div class="field"><label for="codeIn">Room code from your friend</label>
          <div class="row"><input id="codeIn" class="code-input grow" placeholder="ABCD" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" />
          <button class="btn primary big" type="submit" data-mode="join">Join</button></div></div>
        <div id="homeErr" class="home-err hidden"></div>
        <div class="divider">or start your own</div>
        <button class="btn big block" type="submit" data-mode="create">✨ Create a new room</button>`;
    return `
    <div class="home"><div class="home-card">
      <div class="moon" data-secret="logo">🌙</div>
      <h1 class="logo">Midnight Mafia</h1>
      <div class="tagline">The town sleeps. Someone among you is lying.</div>
      <form id="homeForm" class="panel stack" autocomplete="off" novalidate>${body}</form>
      <p class="muted small" style="margin-top:16px"><a href="#" data-action="guide">📖 How to play & all roles</a></p>
      <p class="privacy-note">🔒 No sign-up, no tracking, no cookies. Nothing is saved: rooms, chats and pictures are wiped when everyone leaves.</p>
    </div></div>`;
  }
  function homeError(msg) {
    const el = $('#homeErr'); if (!el) return toast(msg, true);
    el.textContent = msg; el.classList.toggle('hidden', !msg);
  }
  let joining = false;
  async function doJoin(mode) {
    if (joining) return;
    const name = ($('#nameIn')?.value || '').trim();
    const code = parseCode($('#codeIn')?.value);
    if (!name) { homeError('Type your name first 🙂'); $('#nameIn')?.focus(); return; }
    if (mode === 'join' && code.length !== 4) { homeError('The room code has 4 letters, like ABCD. Ask the host for it.'); $('#codeIn')?.focus(); return; }
    store.set('mm_name', name);
    joining = true; homeError('');
    const btns = [...document.querySelectorAll('#homeForm button')]; btns.forEach((b) => (b.disabled = true));
    const label = document.querySelector(`#homeForm [data-mode="${mode}"]`); const old = label?.textContent;
    if (label) label.textContent = 'Connecting…';
    try {
      if (!socket.connected) {
        socket.connect();
        await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('offline')), 10000); socket.once('connect', () => { clearTimeout(t); res(); }); });
      }
      const r = await socket.timeout(10000).emitWithAck('join', { name, token, code, create: mode === 'create' });
      if (r && r.error) { homeError(r.error); return; }
      history.replaceState(null, '', location.pathname); ui.mtab = 'room';
      setTimeout(() => { if (S?.game && !S.game.me && S.game.phase !== 'ended') toast('👀 The game already started, so you are watching for now. You can play in the next round!'); }, 400);
    } catch (_) {
      homeError("Can't reach the game right now. Check your internet, then try again. (Is the host's computer still on?)");
    } finally {
      joining = false; btns.forEach((b) => (b.disabled = false)); if (label && old) label.textContent = old;
    }
  }
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'homeForm') return;
    e.preventDefault();
    const mode = e.submitter?.dataset.mode || (parseCode($('#codeIn')?.value).length === 4 ? 'join' : 'create');
    if (mode === 'create' && !e.submitter && !$('#codeIn')?.value) return homeError('Type the room code and tap Join — or tap “Create a new room”.');
    doJoin(mode);
  });

  // ---------------- LOBBY ----------------
  function lobbyView() {
    const s = S.settings; const me = S.me;
    const isOwner = S.ownerId === me; const ctrl = S.isController;
    const playerMode = s.hostMode === 'player';
    const hostSitsOut = playerMode && !s.hostPlays;
    const playing = S.players.filter((p) => p.connected && !p.spectator && !(hostSitsOut && p.id === S.hostId));
    const meP = S.players.find((p) => p.id === me) || {};
    const electing = playerMode && !S.hostId;
    const hv = S.hostVotes || {};
    const hvCount = {}; Object.values(hv).forEach((t) => (hvCount[t] = (hvCount[t] || 0) + 1));
    const voters = Object.keys(hv).length; const online = S.players.filter((p) => p.connected).length;
    const host = S.players.find((p) => p.id === S.hostId);
    const counts = setupCounts(playing.length);

    const plist = S.players.map((p) => {
      const isHost = playerMode && p.id === S.hostId;
      const badges = [p.id === S.ownerId ? '<span class="badge gold">👑 Creator</span>' : '', isHost ? `<span class="badge purple">🎙️ Host${s.hostPlays ? ' + plays' : ''}</span>` : '', p.id === me ? '<span class="badge">You</span>' : '', S.voice?.members?.includes(p.id) ? '<span class="badge green" title="In voice chat">🎙️ Voice</span>' : '', electing && hvCount[p.id] ? `<span class="badge red">🗳️ ${hvCount[p.id]}</span>` : ''].join('');
      let controls = '';
      if (electing) controls += `<button class="btn small ${hv[me] === p.id ? 'on' : ''}" data-action="voteHost" data-id="${p.id}">${hv[me] === p.id ? '✔ Voted' : 'Vote host'}</button>`;
      if (playerMode && isOwner && !isHost && !electing) controls += `<button class="btn small ghost" data-action="makeHost" data-id="${p.id}">Make host</button>`;
      if (p.spectator) controls = '<span class="badge">👀 Watching</span>' + controls;
      if (ctrl && s.assignMode === 'manual' && !(isHost && hostSitsOut) && !p.spectator) {
        controls += `<select data-assign="${p.id}"><option value="">— pick role —</option>${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${s.manual && s.manual[p.id] === k ? 'selected' : ''}>${r.icon} ${r.name}</option>`).join('')}</select>`;
      }
      if ((isOwner || ctrl) && p.id !== me) controls += `<button class="btn small ghost" data-action="kick" data-id="${p.id}" title="Remove">✕</button>`;
      return `<div class="prow ${p.id === me ? 'me' : ''}">${avatar(p)}<span class="name">${esc(p.name)}</span><span class="dot ${p.connected ? '' : 'off'}"></span>${badges}${controls}</div>`;
    }).join('');

    const el = S.lastElection && Date.now() - S.lastElection.t < 60000 ? S.lastElection : null;
    const hostBox = !playerMode ? `<div class="muted small">No moderator — the game narrates itself with timers. Everyone plays, and the room creator can skip ahead.</div>`
      : host ? `<div class="stack">
          <div>🎙️ Host: <b>${esc(host.name)}</b>${host.id === me ? ' (you)' : ''}</div>
          ${el ? `<div class="small" style="color:var(--gold2)">🗳️ The group chose ${esc(el.name)} with ${el.votes} vote${el.votes > 1 ? 's' : ''}${el.tie ? ' (tie broken randomly)' : ''}.</div>` : ''}
          <label class="toggle"><input type="checkbox" data-toggle="hostPlays" ${s.hostPlays ? 'checked' : ''} ${isOwner || ctrl ? '' : 'disabled'}/> The host also plays</label>
          <div class="muted small">${s.hostPlays ? 'The host gets a secret role like everyone else and just presses the buttons to move the game along. No peeking at roles.' : 'The host sits out, sees every role and every night move, and narrates the game.'}</div>
          ${isOwner || S.hostId === me ? '<button class="btn small ghost" data-action="clearHost">🔄 Choose a different host</button>' : ''}
        </div>`
      : `<div class="stack">
          <div><b>🗳️ Vote for the host!</b> <span class="muted small">Tap “Vote host” next to someone in the player list. When everyone has voted, the most votes wins.</span></div>
          <div class="small">Votes: <b>${voters}/${online}</b></div>
          <label class="toggle"><input type="checkbox" data-toggle="hostPlays" ${s.hostPlays ? 'checked' : ''} ${isOwner ? '' : 'disabled'}/> The host also plays</label>
          <div class="row wrap">
            ${isOwner && voters ? '<button class="btn small" data-action="finishHostVote">✅ Finish vote now</button>' : ''}
            ${isOwner ? '<button class="btn small" data-action="randomHost">🎲 Random host</button>' : ''}
            <button class="btn small ghost" data-action="volunteer">🙋 I'll host</button>
          </div>
        </div>`;

    const dis = ctrl ? '' : 'disabled';
    const settingsPanel = `
      <div class="panel stack">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">Game setup</h3>
          ${ctrl ? '<button class="btn small" data-action="surprise">🎲 Surprise setup</button>' : `<span class="muted small">Only the ${playerMode ? 'host' : 'owner'} can edit</span>`}</div>
        <div class="fields">
          <div class="field"><label>Max players</label><input type="number" id="set_maxPlayers" min="4" max="30" value="${s.maxPlayers}" ${dis} data-setting="maxPlayers" /></div>
          <div class="field"><label>Mafia members</label><input type="number" id="set_mafiaCount" min="1" max="10" value="${s.mafiaCount}" ${dis} data-setting="mafiaCount" />
            <span class="muted small">Recommended: ${S.recommendedMafia}</span></div>
        </div>
        <div class="field"><label>How are roles given out?</label>
          <div class="seg">
            <button class="${s.assignMode === 'random' ? 'on' : ''}" data-set="assignMode" data-val="random" ${dis}>🎲 Random</button>
            <button class="${s.assignMode === 'manual' ? 'on' : ''}" data-set="assignMode" data-val="manual" ${dis}>✍️ Host picks each role</button>
          </div></div>
        ${s.assignMode === 'random' ? `
          <div class="summary-bar ${counts.bad ? 'bad' : ''}">
            <span>👥 ${playing.length} playing</span><span>•</span>
            <span class="team-mafia">🔪 ${counts.mafia} Mafia</span><span>•</span>
            <span class="team-town">🏘️ ${counts.townSpecial} town roles + ${Math.max(0, counts.citizens)} Citizens</span><span>•</span>
            <span class="team-neutral">🎭 ${counts.neutral} neutral</span>
            ${counts.bad ? `<b>— ${counts.total} roles for ${playing.length} players, remove some.</b>` : ''}
          </div>
          ${['town', 'mafia', 'neutral'].map((team) => `
            <div class="team-title team-${team}">${TEAM_INFO[team].name}</div>
            <div class="role-grid">${Object.entries(ROLES).filter(([k, r]) => r.team === team && k !== 'citizen' && k !== 'mafioso').map(([k, r]) => {
              const c = s.roles[k] || 0;
              return `<div class="rcard ${c ? 'active' : ''}"><button class="info" data-action="roleInfo" data-role="${k}">ⓘ</button>
                <span class="ricon">${r.icon}</span><span class="rname">${r.name}</span>
                <div class="counter">${ctrl ? `<button data-role-dec="${k}">−</button><span>${c}</span><button data-role-inc="${k}">+</button>` : `<span>${c ? '×' + c : '—'}</span>`}</div></div>`;
            }).join('')}</div>`).join('')}
          <div class="muted small">Empty Mafia slots become Mafiosi 🔪, empty town slots become Citizens 🧑‍🌾. The roles are shuffled randomly.</div>
        ` : `<div class="muted small">${ctrl ? 'Choose a role for each player using the dropdowns in the player list.' : 'The host is hand-picking everyone\'s role.'}</div>`}
        <div>
          <label class="toggle"><input type="checkbox" data-toggle="revealOnDeath" ${s.revealOnDeath ? 'checked' : ''} ${dis}/> Reveal a player's role when they die</label>
          <label class="toggle"><input type="checkbox" data-toggle="showRoleList" ${s.showRoleList ? 'checked' : ''} ${dis}/> Show everyone which roles are in the game</label>
          <label class="toggle"><input type="checkbox" data-toggle="doctorSelf" ${s.doctorSelf ? 'checked' : ''} ${dis}/> Doctor may protect themselves</label>
          <label class="toggle"><input type="checkbox" data-toggle="majority" ${s.majority ? 'checked' : ''} ${dis}/> Need a majority (more than half) to vote someone out</label>
        </div>
        <div class="fields">
          <div class="field"><label>Night (seconds)</label><input type="number" id="set_nightSec" value="${s.nightSec}" ${dis} data-setting="nightSec" /></div>
          <div class="field"><label>Discussion (seconds)</label><input type="number" id="set_discussionSec" value="${s.discussionSec}" ${dis} data-setting="discussionSec" /></div>
          <div class="field"><label>Voting (seconds)</label><input type="number" id="set_votingSec" value="${s.votingSec}" ${dis} data-setting="votingSec" /></div>
        </div>
        ${playerMode ? '<div class="muted small">With a human host the timers are a guide — the host moves the game along.</div>' : ''}
      </div>`;

    return `
    <div class="page lobby-page">
      <div class="col" data-m="room">
        <div class="panel stack" style="text-align:center">
          <h3>Room code</h3>
          <div class="room-code">${S.code}</div>
          <div class="row" style="justify-content:center"><button class="btn small" data-action="copyLink">🔗 Copy invite link</button></div>
        </div>
        <div class="panel stack">
          <h3>How do you want to join?</h3>
          <div class="seg">
            <button class="${!meP.spectator ? 'on' : ''}" data-action="spectate" data-val="0">🎮 Play</button>
            <button class="${meP.spectator ? 'on' : ''}" data-action="spectate" data-val="1">👀 Just watch</button>
          </div>
          <div class="muted small">${meP.spectator ? 'You are a spectator: no role, and you\'ll see every role and night move while the game runs. You can\'t talk to the town during a game.' : 'You will get a secret role when the game starts.'}</div>
        </div>
        <div class="panel stack">
          <h3>Who's hosting?</h3>
          <div class="seg">
            <button class="${playerMode ? 'on' : ''}" data-set="hostMode" data-val="player" ${isOwner ? '' : 'disabled'}>🎙️ A player hosts</button>
            <button class="${!playerMode ? 'on' : ''}" data-set="hostMode" data-val="auto" ${isOwner ? '' : 'disabled'}>🤖 No host (auto)</button>
          </div>
          ${hostBox}
        </div>
        <div class="panel"><h3>Players · ${playing.length}/${s.maxPlayers}</h3><div class="plist">${plist}</div></div>
        ${ctrl ? `<button class="btn primary big block" data-action="start">🌙 Start the game</button><div class="muted small phone-only" style="text-align:center">Set up roles in the ⚙️ Setup tab below.</div>` : `<div class="wait-box">Waiting for the ${playerMode ? 'host' : 'creator'} to start…</div>`}
      </div>
      <div class="col" data-m="setup">${settingsPanel}</div>
    </div>`;
  }

  function setupCounts(n) {
    const s = S.settings;
    let mafiaSpecial = 0, townSpecial = 0, neutral = 0;
    for (const [k, c] of Object.entries(s.roles)) {
      const t = ROLES[k]?.team; if (t === 'mafia') mafiaSpecial += c; else if (t === 'town') townSpecial += c; else if (t === 'neutral') neutral += c;
    }
    const mafia = Math.max(s.mafiaCount, mafiaSpecial);
    const total = mafia + townSpecial + neutral;
    return { mafia, townSpecial, neutral, citizens: n - total, total, bad: total > n };
  }

  function topbar(label) {
    const g = S?.game;
    const phaseLabel = !g ? label : { night: `🌙 Night ${g.round}`, day: `☀️ Day ${g.round}`, voting: `🗳️ Voting · Day ${g.round}`, verdict: `⚖️ Verdict · Day ${g.round}`, ended: '🏁 Game over' }[g.phase];
    return `<div class="topbar">
      <span class="logo" data-secret="logo">🌙<span class="hide-sm"> Midnight Mafia</span></span>
      <span class="phase-pill">${phaseLabel}</span>
      ${g && g.endsAt ? '<span class="countdown" id="countdown"></span>' : ''}
      <span class="grow"></span>
      <span class="muted small">Room <b style="color:var(--gold2);letter-spacing:.1em">${S.code}</b></span>
      ${g ? `<button class="btn small ${ui.narrate ? 'on' : ''}" data-action="narrate" title="Read announcements aloud">🔊</button>` : ''}
      <button class="btn small ghost" data-action="guide" title="Roles & rules">📖</button>
      <button class="btn small ghost" data-action="leave" title="Leave">🚪<span class="hide-sm"> Leave</span></button>
    </div>`;
  }

  // ---------------- GAME ----------------
  function gameView() {
    const g = S.game; const me = g.me; const mod = S.isModerator;
    return `
    <div class="page">
      <div class="col" data-m="town">
        ${g.phase === 'ended' ? `<div class="desktop-only">${endBanner()}</div>` : ''}
        <div class="panel"><h3>${g.phase === 'voting' && g.me?.alive ? 'Tap a player to vote' : 'The town'}</h3><div class="pgrid">${playerCards()}</div>
          ${g.roleList ? `<div class="muted small" style="margin-top:12px">In this game: ${roleListSummary(g.roleList)}</div>` : ''}
        </div>
        ${g.host ? hostDashboard() : ''}
      </div>
      <div class="col">
        <div class="mpart" data-m="me">
        ${g.phase === 'ended' && !mod ? `<div class="phone-only">${endBanner()}</div>` : ''}
        ${mod ? hostControls() : me ? roleCard() + actionPanel() + playingHostBar() : spectatorPanel() + playingHostBar()}
        </div>
        <div class="panel" data-m="news"><h3>Town news</h3><div class="log" id="logBox">${logEntries()}</div></div>
      </div>
    </div>`;
  }

  function roleListSummary(list) {
    const c = {}; list.forEach((r) => (c[r] = (c[r] || 0) + 1));
    return Object.entries(c).map(([r, n]) => `${roleTag(r)}${n > 1 ? ' ×' + n : ''}`).join(' · ');
  }

  function playerCards() {
    const g = S.game; const me = g.me;
    const selecting = selectMode();
    const xr = ui.xrayOn && S.xray;
    return g.players.map((p) => {
      const votesFor = Object.entries(g.votes || {}).filter(([, t]) => t === p.id).map(([v]) => v);
      const count = g.tally?.[p.id] || 0;
      const clickable = selecting && selecting.can(p);
      const sel = ui.sel === p.id || ui.sel2 === p.id || (g.phase === 'voting' && g.votes?.[S.me] === p.id);
      const status = [
        !p.alive ? '<span class="badge red">💀 Dead</span>' : '',
        p.silenced ? '<span class="badge">🤐 Silenced</span>' : '',
        p.mayorRevealed ? '<span class="badge gold">🎩 Mayor</span>' : '',
        g.phase === 'voting' && p.alive && p.hasVoted ? '<span class="badge green">✔ voted</span>' : '',
        !p.connected ? '<span class="badge">📴</span>' : '',
        S.voice?.members?.includes(p.id) ? '<span class="badge green" title="In voice chat">🎙️</span>' : '',
        me?.lover === p.id ? '<span class="badge purple">💘 Lover</span>' : '',
        me?.exeTarget === p.id && me.role === 'executioner' ? '<span class="badge red">🎯 Target</span>' : '',
        me?.dousedPlayers?.includes(p.id) ? '<span class="badge">⛽ Doused</span>' : '',
      ].join('');
      return `<div class="pcard ${p.id === S.me ? 'me' : ''} ${!p.alive ? 'dead' : ''} ${clickable ? 'clickable' : ''} ${sel ? 'selected' : ''}" ${clickable ? `data-pick="${p.id}"` : ''}>
        ${xr && S.xray.roles[p.id] ? `<span class="xr team-${ROLES[S.xray.roles[p.id]].team}">${ROLES[S.xray.roles[p.id]].icon} ${ROLES[S.xray.roles[p.id]].name}</span>` : ''}
        ${count ? `<span class="votes">${count}</span>` : ''}
        ${avatar(p)}
        <span class="pname">${esc(p.name)}${p.id === S.me ? ' (you)' : ''}</span>
        ${p.role && (ui.roleShown || !p.alive || p.mayorRevealed || g.phase === 'ended' || S.isModerator || !g.me) ? `<span class="prole">${roleTag(p.role)}</span>` : ''}
        <span class="status">${status}</span>
        ${votesFor.length && (g.phase === 'voting' || g.phase === 'verdict') ? `<span class="voters">← ${votesFor.map((v) => esc(nameOf(v))).join(', ')}</span>` : ''}
      </div>`;
    }).join('');
  }

  // What can be clicked on the player grid right now?
  function selectMode() {
    const g = S.game; const me = g.me;
    if (!me || !me.alive || S.isModerator) return null;
    if (g.phase === 'voting') return { can: (p) => p.alive && p.id !== S.me, pick: (id) => emit('vote', { target: g.votes?.[S.me] === id ? null : id }) };
    if (g.phase !== 'night') return null;
    const act = ROLES[me.role].act;
    if (act && actAvailable(me, act) && !me.action) {
      return { can: (p) => p.alive && (act.target !== 'other' || p.id !== S.me) && act.target !== 'self', pick: (id) => pickTarget(id, act) };
    }
    return null;
  }
  function pickTarget(id, act) {
    if (act.target === 'two') {
      if (ui.sel === id) ui.sel = null; else if (ui.sel2 === id) ui.sel2 = null;
      else if (!ui.sel) ui.sel = id; else ui.sel2 = id;
    } else ui.sel = ui.sel === id ? null : id;
    render();
  }
  function actAvailable(me, act) {
    const g = S.game;
    if (act.nightOneOnly && g.round !== 1) return false;
    if (act.notNightOne && g.round === 1) return false;
    if (act.uses && me.uses[act.kind] <= 0) return false;
    if (act.kind === 'potion' && me.uses.heal <= 0 && me.uses.poison <= 0) return false;
    return true;
  }

  function roleCard() {
    const me = S.game.me; const r = ROLES[me.role];
    const mates = me.team === 'mafia' ? S.game.players.filter((p) => p.id !== S.me && p.role && ROLES[p.role].team === 'mafia') : [];
    const extra = [];
    if (r.act?.uses) extra.push(`Uses left: <b>${me.uses[r.act.kind]}</b>`);
    if (me.role === 'witch') extra.push(`Potions: 🩹 heal ×${me.uses.heal} · ☠️ poison ×${me.uses.poison}`);
    if (me.exeTarget && me.role === 'executioner') extra.push(`🎯 Your target: <b>${esc(nameOf(me.exeTarget))}</b>`);
    if (me.lover) extra.push(`💘 You are in love with <b>${esc(nameOf(me.lover))}</b>`);
    if (mates.length) extra.push(`🤝 Your family: ${mates.map((m) => `<b>${esc(m.name)}</b> (${ROLES[m.role].name})`).join(', ')}`);
    return `<div class="role-card ${r.team}">
      ${ui.roleShown ? `<button class="btn small ghost hide-role" data-action="hideRole">🙈 Hide</button>` : ''}
      <div class="big-icon">${r.icon}</div>
      <div class="role-name">${r.name}</div>
      <div class="team-${r.team}" style="font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase">${TEAM_INFO[r.team].name} · ${me.alive ? 'Alive' : '💀 Dead'}</div>
      <p style="margin:10px 0 4px">${r.desc}</p>
      <p class="muted small" style="margin:0">🏆 ${r.goal}</p>
      ${extra.length ? `<div class="stack small" style="margin-top:10px">${extra.map((e) => `<div>${e}</div>`).join('')}</div>` : ''}
      ${!ui.roleShown ? `<div class="cover" data-action="showRole"><div><span class="big">🂠</span>Tap to see your secret role<br><span class="small">Make sure nobody is looking at your screen</span></div></div>` : ''}
    </div>`;
  }

  function actionPanel() {
    const g = S.game; const me = g.me; const r = ROLES[me.role];
    if (g.phase === 'ended') return '';
    if (!me.alive) return `<div class="panel wait-box">💀 You are dead. You can still watch, and chat with the other ghosts in the <b>Graveyard</b>.</div>`;
    let html = '';
    if (g.phase === 'night') {
      const act = r.act;
      if (me.team === 'mafia') html += mafiaPanel();
      if (act && actAvailable(me, act)) html += nightActionPanel(act);
      else if (me.team !== 'mafia') html += `<div class="wait-box">😴 ${act ? 'Your ability isn\'t available tonight.' : 'You have no night ability.'} Close your eyes and wait for the morning…</div>`;
      if (me.role === 'medium') html += `<div class="muted small" style="margin-top:10px">🔮 The Graveyard chat is open to you tonight.</div>`;
      return `<div class="panel"><h3>Tonight</h3>${html}</div>`;
    }
    if (g.phase === 'day') {
      html = `<div class="wait-box">☀️ Discuss! Who's acting suspicious? ${S.settings.hostMode === 'auto' ? 'Voting opens when the timer runs out.' : 'The host will open the voting.'}</div>`;
    }
    if (g.phase === 'voting') {
      const myVote = g.votes?.[S.me];
      const tg = g.players.filter((p) => p.alive && p.id !== S.me);
      html = `<div class="muted small" style="margin-bottom:8px">Vote to eliminate someone${S.game.me.mayorRevealed ? ' (your vote counts ×2)' : ''}. You can change your vote until voting closes.</div>
        <div class="targets">${tg.map((p) => `<button class="target kill ${myVote === p.id ? 'on' : ''}" data-vote="${p.id}">${esc(p.name)}</button>`).join('')}
        <button class="target ${myVote === 'skip' ? 'on' : ''}" data-vote="skip">🤷 Skip vote</button></div>
        <div class="muted small" style="margin-top:8px">Skip votes: ${g.skip || 0}</div>`;
    }
    if (g.phase === 'verdict') {
      html = `<div class="wait-box">⚖️ The town has spoken. ${S.settings.hostMode === 'auto' ? 'Night falls in a moment…' : S.isController ? 'Start the night when everyone is ready.' : 'Waiting for the host to start the night.'}</div>`;
    }
    if (me.role === 'mayor' && !me.mayorRevealed && (g.phase === 'day' || g.phase === 'voting')) {
      html += `<button class="btn block" style="margin-top:10px" data-action="mayor">🎩 Reveal that I'm the Mayor (vote ×2)</button>`;
    }
    return `<div class="panel"><h3>${g.phase === 'voting' ? 'Your vote' : 'Today'}</h3>${html}</div>`;
  }

  // Phase buttons for a host who is also playing (or the creator in auto mode). No secrets shown here.
  function playingHostBar() {
    const g = S.game; if (!S.isController || g.phase === 'ended') return '';
    const auto = S.settings.hostMode === 'auto';
    const labels = auto
      ? { night: '⏭ End the night now', day: '⏭ Skip to voting', voting: '⏭ Close voting now', verdict: '⏭ Start the night now' }
      : { night: '☀️ End the night', day: '🗳️ Open the voting', voting: '⚖️ Close the voting', verdict: `🌙 Start night ${g.round + 1}` };
    const info = g.phase === 'night' ? (g.pendingCount ? `⏳ ${g.pendingCount} player${g.pendingCount > 1 ? 's are' : ' is'} still deciding…` : '✅ Everyone has made their move.')
      : g.phase === 'voting' ? `Votes in: ${g.players.filter((p) => p.alive && p.hasVoted).length}/${g.players.filter((p) => p.alive).length}` : '';
    return `<div class="panel stack"><h3 style="margin:0">${auto ? '👑 Room creator controls' : S.hostId === S.me ? (g.me ? '🎙️ You are the host (and playing)' : '🎙️ You are the host') : '🎙️ Standing in for the host (they disconnected)'}</h3>
      ${info ? `<div class="small">${info}</div>` : ''}
      <button class="btn ${auto ? '' : 'primary'} block" data-action="advance">${labels[g.phase]}</button></div>`;
  }

  function nightActionPanel(act) {
    const g = S.game; const me = g.me;
    if (me.action && !me.action.skip) {
      const a = me.action;
      const what = act.target === 'self' ? act.label : `${act.label}: <b>${esc(nameOf(a.target))}</b>${a.target2 ? ` + <b>${esc(nameOf(a.target2))}</b>` : ''}${a.option ? ` (${a.option})` : ''}`;
      return `<div class="done-box" style="margin-top:10px">✅ Locked in — ${what}<div style="margin-top:8px"><button class="btn small" data-action="cancelAct">Change</button></div></div>`;
    }
    if (me.action && me.action.skip) return `<div class="done-box" style="margin-top:10px">😴 You chose to do nothing tonight. <button class="btn small" data-action="cancelAct">Change</button></div>`;
    if (act.target === 'self') {
      return `<div style="margin-top:10px"><div class="muted small" style="margin-bottom:8px">${act.uses ? `${me.uses[act.kind]} left.` : ''}</div>
        <div class="row"><button class="btn primary grow" data-action="actSelf">${ROLES[me.role].icon} ${act.label} tonight</button><button class="btn" data-action="skipAct">Not tonight</button></div></div>`;
    }
    const tg = g.players.filter((p) => p.alive && (act.target !== 'other' || p.id !== S.me));
    const two = act.target === 'two';
    const blockedHeal = me.role === 'doctor' ? me.lastHealed : null;
    return `<div style="margin-top:${S.game.me.team === 'mafia' ? 14 : 0}px">
      <div class="small" style="margin-bottom:8px"><b>${ROLES[me.role].icon} ${act.label}</b> — ${two ? 'pick two players' : 'pick a player'}${act.hint ? `. <span class="muted">${act.hint}</span>` : ''}</div>
      ${me.role === 'witch' ? `<div class="seg" style="margin-bottom:8px">
        <button class="${ui.potion === 'heal' ? 'on' : ''}" data-potion="heal" ${me.uses.heal ? '' : 'disabled'}>🩹 Heal (${me.uses.heal})</button>
        <button class="${ui.potion === 'poison' ? 'on' : ''}" data-potion="poison" ${me.uses.poison ? '' : 'disabled'}>☠️ Poison (${me.uses.poison})</button></div>` : ''}
      <div class="targets">${tg.map((p) => `<button class="target ${ui.sel === p.id || ui.sel2 === p.id ? 'on' : ''}" data-target="${p.id}" ${p.id === blockedHeal || (me.role === 'doctor' && p.id === S.me && !S.settings.doctorSelf) ? 'disabled' : ''}>${esc(p.name)}${p.id === S.me ? ' (me)' : ''}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn primary grow" data-action="submitAct" ${ui.sel && (!two || ui.sel2) ? '' : 'disabled'}>Confirm</button><button class="btn" data-action="skipAct">Do nothing</button></div>
    </div>`;
  }

  function mafiaPanel() {
    const g = S.game; const me = g.me;
    const tg = g.players.filter((p) => p.alive && !(p.role && ROLES[p.role].team === 'mafia'));
    const votes = me.mafiaVotes || {};
    const tally = {}; Object.values(votes).forEach((t) => (tally[t] = (tally[t] || 0) + 1));
    return `<div class="small" style="margin-bottom:8px"><b class="team-mafia">🔪 The family's hit</b> — vote on tonight's victim${g.players.some((p) => p.role === 'godfather' && p.alive && ROLES[me.role] && p.id !== S.me) ? ' (Godfather breaks ties)' : ''}.</div>
      <div class="targets">${tg.map((p) => `<button class="target kill ${me.mafiaVote === p.id ? 'on' : ''}" data-mvote="${p.id}">${esc(p.name)}${tally[p.id] ? ` · ${tally[p.id]}` : ''}</button>`).join('')}
      <button class="target ${me.mafiaVote === 'none' ? 'on' : ''}" data-mvote="none">🚫 No kill${tally.none ? ` · ${tally.none}` : ''}</button></div>
      <div class="muted small" style="margin-top:6px">${Object.entries(votes).map(([m, t]) => `${esc(nameOf(m))} → ${t === 'none' ? 'no kill' : esc(nameOf(t))}`).join(' · ') || 'Nobody has voted yet.'}</div>`;
  }

  function logEntries() {
    const g = S.game;
    const items = g.log.map((e) => ({ ...e, cls: e.kind }));
    (g.me?.private || []).forEach((e) => items.push({ ...e, cls: 'private' }));
    items.sort((a, b) => a.t - b.t);
    return items.map((e) => `<div class="entry ${e.cls}">${esc(e.text)}</div>`).join('') || '<div class="muted">Nothing yet…</div>';
  }

  function endBanner() {
    const g = S.game;
    const won = g.winners?.includes(S.me);
    const playing = !!g.me;
    const winners = g.winners.map((id) => esc(nameOf(id))).join(', ') || 'nobody';
    return `<div class="winner-banner ${playing && !won ? 'lost' : ''}">
      <div style="font-size:48px">${playing ? (won ? '🏆' : '💀') : '🏁'}</div>
      <div class="title">${playing ? (won ? 'You won!' : 'You lost') : 'Game over'}</div>
      <p>${esc(g.winText)}</p>
      <p class="small muted">Winners: ${winners}</p>
      ${S.isController || S.ownerId === S.me ? '<button class="btn primary" data-action="toLobby">↩ Back to lobby & play again</button>' : '<span class="muted small">Waiting for the host to start a new round…</span>'}
    </div>`;
  }

  // ---------------- HOST ----------------
  const SCRIPT = {
    night: 'Everyone, close your eyes. The town is sleeping… Mafia, wake up and choose your victim. Special roles, wake up and use your powers.',
    day: 'Everyone, wake up. Morning has arrived. Read the news, then discuss — who do you think is Mafia?',
    voting: 'Time to vote. Nominate your suspects and cast your votes. The accused may defend themselves.',
    verdict: 'The town has spoken. When you\'re ready, send everyone back to sleep.',
    ended: 'The game is over! Reveal everything and enjoy the chaos.',
  };
  function hostControls() {
    const g = S.game;
    const labels = { night: '☀️ End the night & reveal the morning', day: '🗳️ Open the voting', voting: '⚖️ Close the voting', verdict: `🌙 Start night ${g.round + 1}` };
    const pending = g.host.pending.map((id) => esc(nameOf(id)));
    return `<div class="panel stack">
      <h3>🎙️ You are the host</h3>
      <div class="script">“${SCRIPT[g.phase]}”</div>
      ${g.phase === 'night' ? `<div class="small">${pending.length ? `⏳ Still deciding: <b>${pending.join(', ')}</b>` : '✅ Everyone has made their move.'}</div>` : ''}
      ${g.phase === 'voting' ? `<div class="small">Votes in: ${g.players.filter((p) => p.alive && p.hasVoted).length}/${g.players.filter((p) => p.alive).length}</div>` : ''}
      ${g.phase !== 'ended' ? `<button class="btn primary big block" data-action="advance">${labels[g.phase]}</button>` : endBanner()}
      <div class="muted small">You see all roles and secrets. Don't play favourites 😉</div>
    </div>`;
  }
  function spectatorPanel() {
    const g = S.game;
    return `<div class="panel stack"><h3 style="margin:0">👀 You are spectating</h3>
      <div class="small">You can see every role and every night move. Keep it secret! 🤐</div>
      <div class="muted small">${g.phase === 'ended' ? 'You can join the next game from the lobby.' : 'You can chat with dead players in the Graveyard. Switch to “Play” in the lobby to join the next game.'}</div></div>`;
  }
  function hostDashboard() {
    const g = S.game; const h = g.host;
    const rows = g.players.map((p) => {
      const a = h.acts[p.id]; const mv = h.mafiaVotes[p.id];
      const act = ROLES[p.role].act;
      let tonight = '—';
      if (g.phase === 'night') {
        if (a?.skip) tonight = '😴 nothing';
        else if (a) tonight = `${act ? act.label : ''} → ${act?.target === 'self' ? 'self' : esc(nameOf(a.target))}${a.target2 ? ' + ' + esc(nameOf(a.target2)) : ''}${a.option ? ` (${a.option})` : ''}`;
        else if (h.pending.includes(p.id) && act) tonight = '⏳';
        if (mv) tonight += ` <span class="team-mafia">· kill vote → ${mv === 'none' ? 'none' : esc(nameOf(mv))}</span>`;
      }
      const notes = [];
      if (h.exe[p.id]) notes.push(`🎯 target: ${esc(nameOf(h.exe[p.id]))}`);
      if (h.lovers?.includes(p.id)) notes.push('💘 lover');
      return `<tr class="${p.alive ? '' : 'dead'}"><td><b>${esc(p.name)}</b>${p.alive ? '' : ' 💀'}</td><td>${roleTag(p.role)}</td><td>${tonight}</td><td class="small">${notes.join('<br>')}</td></tr>`;
    }).join('');
    const reports = g.players.map((p) => {
      const msgs = (h.privateLog[p.id] || []).filter((m) => m.round === g.round || (g.phase === 'night' && m.round === g.round - 1));
      return msgs.length ? `<div class="small"><b>${esc(p.name)}:</b> ${msgs.map((m) => esc(m.text)).join(' · ')}</div>` : '';
    }).join('');
    return `<div class="panel"><h3>${S.isModerator ? 'Host dashboard' : '👀 Spectator view'} — everything</h3>
      <div class="scroll-x"><table class="htable"><tr><th>Player</th><th>Role</th><th>Tonight</th><th>Notes</th></tr>${rows}</table></div>
      ${reports ? `<h3 style="margin-top:16px">Secret messages players received</h3><div class="stack">${reports}</div>` : ''}
    </div>`;
  }

  // ---------------- CHAT ----------------
  const chatView = { tab: null, last: null };
  const { STICKERS } = window.MafiaRoles;
  const msgBody = (m) => {
    if (m.kind === 'sticker' && STICKERS[m.sticker]) { const [e, t] = STICKERS[m.sticker]; return `<div class="sticker"><span class="se">${e}</span><span class="st">${esc(t)}</span></div>`; }
    if (m.kind === 'img') return `<img class="cimg" src="/media/${esc(m.media)}" alt="picture" loading="lazy" data-zoom="${esc(m.media)}" style="aspect-ratio:${+m.w} / ${+m.h}" />`;
    if (m.kind === 'audio') return `<button type="button" class="vmsg" data-play="${esc(m.media)}"><span class="pi">▶</span><span class="wave">${'<i></i>'.repeat(14)}</span><span class="dur">${fmt(m.dur * 1000)}</span></button>`;
    return esc(m.text);
  };
  const msgHtml = (m) => `<div class="msg ${m.tag || ''} ${m.kind ? 'media' : ''}"><b style="color:${m.tag ? '' : colorFor(m.pid || 'x')}">${esc(m.from)}${m.tag === 'host' ? ' 🎙️' : ''}</b>${msgBody(m)}</div>`;
  const nearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 60;

  function renderChat(forceBottom) {
    if (!S) return;
    const chans = Object.keys(S.chat);
    if (!chans.includes(ui.chatTab)) ui.chatTab = 'town';
    const names = { town: S.game && S.game.phase !== 'ended' ? '🏘️ Town' : '💬 Chat', mafia: '🔪 Mafia', dead: '👻 Graveyard' };
    const tabsHtml = chans.map((c) => {
      const n = S.chat[c].length; const unread = c !== ui.chatTab && n > (ui.seenChat[c] || 0);
      return `<button class="${c === ui.chatTab ? 'on' : ''}" data-chat="${c}">${names[c]}${unread ? '<span class="unread"></span>' : ''}</button>`;
    }).join('');
    const tabsEl = $('#chatTabs'); if (tabsEl.innerHTML !== tabsHtml) tabsEl.innerHTML = tabsHtml;

    const msgs = S.chat[ui.chatTab] || [];
    if (!isPhone() || ui.mtab === 'chat') ui.seenChat[ui.chatTab] = msgs.length;
    const box = $('#chatMsgs');
    const wasAtBottom = nearBottom(box);
    box.querySelectorAll('.pending').forEach((el) => el.remove());
    // Follow the last message we drew (the server only sends the newest 150, so counting isn't enough)
    const key = (m) => `${m.t}|${m.from}|${m.text}|${m.media || m.sticker || ''}`;
    const lastIdx = chatView.tab === ui.chatTab && chatView.last ? msgs.findIndex((m) => key(m) === chatView.last) : -1;
    const sameStream = lastIdx !== -1;
    let added = 0;
    if (sameStream) {
      // only add what's new — the rest of the list (and your scroll position) is untouched
      const fresh = msgs.slice(lastIdx + 1);
      added = fresh.length;
      if (added) box.insertAdjacentHTML('beforeend', fresh.map(msgHtml).join(''));
      // keep the list from growing forever; when you're reading older messages, hold your place
      const extra = box.children.length - 200;
      if (extra > 0) {
        // pin the first message you can see, trim old ones above it, then put it back exactly where it was
        const anchor = wasAtBottom ? null : [...box.children].find((el) => el.offsetTop + el.offsetHeight > box.scrollTop);
        const offset = anchor ? anchor.offsetTop - box.scrollTop : 0;
        for (let i = 0; i < extra && box.firstElementChild !== anchor; i++) box.firstElementChild.remove();
        if (anchor) box.scrollTop = anchor.offsetTop - offset;
      }
    } else if (!(chatView.tab === ui.chatTab && !msgs.length && !chatView.last)) {
      box.innerHTML = msgs.length ? msgs.map(msgHtml).join('')
        : `<div class="empty">${{ town: 'Say hi to the town 👋', mafia: 'Plot quietly. Only the Mafia can read this.', dead: 'The dead whisper here…' }[ui.chatTab]}<div class="chat-privacy">🔒 You only see messages sent after you joined. Newcomers can't read old chat.</div></div>`;
      forceBottom = true;
    }
    Object.assign(chatView, { tab: ui.chatTab, last: msgs.length ? key(msgs[msgs.length - 1]) : null });
    if (forceBottom || wasAtBottom) { box.scrollTop = box.scrollHeight; $('#chatNew').classList.add('hidden'); }
    else if (sameStream && added > 0) $('#chatNew').classList.remove('hidden');

    const can = S.canWrite[ui.chatTab];
    const input = $('#chatInput');
    if (input.disabled === can) input.disabled = !can;
    const me = S.game?.me;
    const ph = can ? (ui.chatTab === 'dead' && me?.alive ? 'Speak to the dead (anonymously)…' : 'Say something…')
      : (me?.alive === false && ui.chatTab === 'town' ? 'The dead cannot speak to the living' : S.game?.players.find((p) => p.id === S.me)?.silenced ? 'You have been silenced 🤐' : S.game && !S.game.me && !S.isModerator && ui.chatTab === 'town' && S.game.phase !== 'ended' ? 'Spectators can\'t talk to the town' : S.game?.phase === 'night' && ui.chatTab === 'town' ? 'Shh… the town is asleep' : 'You can\'t chat here right now');
    if (input.placeholder !== ph) input.placeholder = ph;
    document.querySelectorAll('#chatForm .cbtn').forEach((b) => { b.disabled = !can; });
    if (!can && ui.tray === 'sticker') closeTray();
  }

  // ---------------- chat extras: stickers, pictures, voice messages ----------------
  const tray = () => $('#chatTray');
  function closeTray() { ui.tray = null; tray().classList.add('hidden'); tray().innerHTML = ''; }
  function showPending(html) {
    const box = $('#chatMsgs'); box.querySelector('.empty')?.remove();
    const me = S.players.find((p) => p.id === S.me);
    box.insertAdjacentHTML('beforeend', `<div class="msg pending"><b style="color:${colorFor(S.me)}">${esc(me ? me.name : 'You')}</b>${html}</div>`);
    box.scrollTop = box.scrollHeight;
  }
  const clearPending = () => $('#chatMsgs').querySelectorAll('.pending').forEach((el) => el.remove());
  async function sendMedia(payload, label) {
    showPending(`<i class="muted">${label}</i>`);
    const r = await new Promise((res) => socket.timeout(30000).emit('chat:media', { channel: ui.chatTab, ...payload }, (err, x) => res(err ? { error: 'Sending failed. Check your internet and try again.' } : x || {})));
    if (r.error) { clearPending(); toast(r.error, true); }
  }

  // Pictures: shrunk on your phone first (fast to send, and the original file with its hidden
  // location/camera details never leaves your device).
  async function sendPicture(file) {
    if (!file || !/^image\//.test(file.type)) return toast('Pick a picture.', true);
    try {
      if (file.type === 'image/gif' && file.size < 2e6) {
        const bmp = await createImageBitmap(file);
        return sendMedia({ mime: 'image/gif', data: await file.arrayBuffer(), w: bmp.width, h: bmp.height }, '🖼️ Sending GIF…');
      }
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      let max = 1280, q = 0.82, blob, w, h;
      for (let i = 0; i < 4; i++) {
        const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); w = Math.round(bmp.width * s); h = Math.round(bmp.height * s);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
        blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
        if (blob.size < 900e3) break; max = Math.round(max * 0.75); q -= 0.1;
      }
      await sendMedia({ mime: 'image/jpeg', data: await blob.arrayBuffer(), w, h }, '🖼️ Sending picture…');
    } catch (_) { toast("Couldn't open that picture.", true); }
  }

  // Voice messages: recorded as a simple WAV so every phone (iPhone too) can play it.
  const REC_MAX = 60;
  const R = { on: false, mic: null, frames: [], start: 0, timer: null };
  async function recStart() {
    if (R.on) return;
    if (!(await micConsent('rec'))) return;
    try { primeAudio(); } catch (_) { return toast('Voice messages do not work in this browser.', true); }
    R.frames = []; R.on = true; ui.tray = 'rec';
    tray().classList.remove('hidden');
    tray().innerHTML = `<div class="rec-bar"><span class="rec-dot"></span><b id="recTime">0:00</b><span class="muted small grow">Recording… max ${REC_MAX}s</span>
      <button type="button" class="btn small ghost" data-rec="cancel">✕ Cancel</button><button type="button" class="btn small primary" data-rec="send">➤ Send</button></div>`;
    try {
      const mic = await openMic((pcm) => { if (R.on) R.frames.push(pcm); });
      if (!R.on) { mic.close(); return; }
      R.mic = mic; R.start = Date.now();
      R.timer = setInterval(() => {
        const s = (Date.now() - R.start) / 1000; const t = $('#recTime'); if (t) t.textContent = fmt(s * 1000);
        if (s >= REC_MAX) recStop(true);
      }, 250);
    } catch (e) { R.on = false; closeTray(); micHelp(e, recStart); }
  }
  function recStop(send) {
    if (!R.on) return;
    R.on = false; clearInterval(R.timer); if (R.mic) R.mic.close(); R.mic = null; closeTray();
    const n = R.frames.reduce((a, f) => a + f.length, 0);
    if (!send) return;
    if (n < RATE * 0.5) return toast('Too short. Hold on a bit longer 🙂');
    const pcm = new Float32Array(n); let o = 0; for (const f of R.frames) { pcm.set(f, o); o += f.length; }
    R.frames = [];
    // gentle normalise so quiet voices are clear
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const g = peak > 0.01 ? Math.min(4, 0.9 / peak) : 1;
    const buf = new ArrayBuffer(44 + n * 2); const dv = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, RATE, true);
    dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i] * g)) * 32767, true);
    sendMedia({ mime: 'audio/wav', data: buf, dur: n / RATE }, '🎤 Sending voice message…');
  }

  // Playing voice messages (one at a time)
  const player = { audio: null, btn: null };
  function stopPlaying() { if (player.audio) { player.audio.pause(); player.audio = null; } if (player.btn) { player.btn.classList.remove('playing'); player.btn.querySelector('.pi').textContent = '▶'; player.btn = null; } }
  function playVoice(btn) {
    if (player.btn === btn) return stopPlaying();
    stopPlaying();
    const a = new Audio('/media/' + btn.dataset.play);
    player.audio = a; player.btn = btn; btn.classList.add('playing'); btn.querySelector('.pi').textContent = '⏸';
    a.onended = stopPlaying; a.onerror = () => { stopPlaying(); toast('That voice message has expired.', true); };
    a.play().catch(() => stopPlaying());
  }

  function stickerTray() {
    ui.tray = 'sticker'; tray().classList.remove('hidden');
    tray().innerHTML = `<div class="stk-grid">${Object.entries(STICKERS).map(([k, [e, t]]) => `<button type="button" class="stk" data-stk="${k}"><span class="se">${e}</span><span class="st">${esc(t)}</span></button>`).join('')}</div>`;
  }

  $('#chatDock').addEventListener('click', (e) => {
    const t = e.target.closest('[data-ctool],[data-stk],[data-rec],[data-play],[data-zoom]'); if (!t) return;
    const d = t.dataset;
    if (d.ctool === 'sticker') return ui.tray === 'sticker' ? closeTray() : stickerTray();
    if (d.ctool === 'photo') { closeTray(); return $('#photoIn').click(); }
    if (d.ctool === 'rec') return R.on ? recStop(true) : recStart();
    if (d.stk) { closeTray(); showPending(`<i class="muted">${STICKERS[d.stk][0]} sending…</i>`); return emit('chat:sticker', { channel: ui.chatTab, sticker: d.stk }).then((r) => r.error && clearPending()); }
    if (d.rec) return recStop(d.rec === 'send');
    if (d.play) return playVoice(t);
    if (d.zoom) openModal(`<div class="row" style="justify-content:flex-end"><button class="btn small ghost" data-close>✕</button></div><img class="zoomed" src="/media/${esc(d.zoom)}" alt="picture" />`);
  });
  $('#photoIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) sendPicture(f); });
  // a picture that finishes loading shouldn't push the chat away from the newest message
  $('#chatMsgs').addEventListener('load', (e) => { if (e.target.tagName === 'IMG') { const b = $('#chatMsgs'); if (b.scrollHeight - b.scrollTop - b.clientHeight < 400) b.scrollTop = b.scrollHeight; } }, true);
  $('#chatMsgs').addEventListener('scroll', (e) => { if (nearBottom(e.target)) $('#chatNew').classList.add('hidden'); });
  $('#chatNew').addEventListener('click', () => { const b = $('#chatMsgs'); b.scrollTop = b.scrollHeight; $('#chatNew').classList.add('hidden'); });
  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chatInput'); const text = input.value.trim(); if (!text || input.disabled) return;
    input.value = '';
    input.focus();
    // show it right away (faded) — it turns solid when the server confirms
    const box = $('#chatMsgs');
    box.querySelector('.empty')?.remove();
    const me = S.players.find((p) => p.id === S.me);
    box.insertAdjacentHTML('beforeend', `<div class="msg pending"><b style="color:${colorFor(S.me)}">${esc(me ? me.name : 'You')}</b>${esc(text)}</div>`);
    box.scrollTop = box.scrollHeight;
    const r = await emit('chat', { channel: ui.chatTab, text });
    if (r.error) { box.querySelectorAll('.pending').forEach((el) => el.remove()); input.value = text; }
  });

  // ---------------- countdown ----------------
  function tick() {
    const el = $('#countdown'); if (!el || !S?.game?.endsAt) return;
    const left = S.game.endsAt - (Date.now() + clockOffset);
    el.textContent = left > 0 ? fmt(left) : (S.settings.hostMode === 'auto' ? '0:00' : "Time's up!");
    el.classList.toggle('low', left < 10000);
  }
  setInterval(tick, 500);

  // ---------------- modals ----------------
  function openModal(html, tiny) {
    const m = $('#modal'); m.innerHTML = `<div class="box ${tiny ? 'tiny' : ''}">${html}</div>`; m.classList.remove('hidden');
  }
  document.addEventListener('click', (e) => { if (e.target.matches && e.target.matches('[data-selectall]')) e.target.select(); });
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

  function guideModal() {
    const team = (t) => Object.entries(ROLES).filter(([, r]) => r.team === t).map(([, r]) => `<div class="guide-role"><span class="ricon">${r.icon}</span><div><b>${r.name}</b><div class="small">${r.desc}</div><div class="small muted">🏆 ${r.goal}</div></div></div>`).join('');
    openModal(`<div class="row" style="justify-content:space-between"><h2 class="serif">How to play</h2><button class="btn small ghost" data-close>✕</button></div>
      <ol class="small" style="padding-left:18px">
        <li><b>Night:</b> everyone "sleeps". The Mafia secretly vote on a victim, special roles use their powers on their phones.</li>
        <li><b>Morning:</b> the town learns who died (and maybe their role).</li>
        <li><b>Day:</b> argue, accuse, defend, lie. Use the Town chat or talk out loud.</li>
        <li><b>Vote:</b> the player with the most votes is eliminated. Ties and "skip" save everyone.</li>
        <li><b>Win:</b> Town wins when every Mafia (and Serial Killer / Arsonist) is gone. Mafia wins when they equal or outnumber everyone else. Neutrals have their own goals.</li>
      </ol>
      <p class="small muted">Tip: Godfather looks innocent to the Detective. Miller and framed players look guilty. Fire can't be healed.</p>
      <div class="team-title team-town">Town</div>${team('town')}
      <div class="team-title team-mafia">Mafia</div>${team('mafia')}
      <div class="team-title team-neutral">Neutral</div>${team('neutral')}`);
  }

  // ---------------- the secret x-ray ----------------
  // Opened by typing "xray" anywhere (outside inputs) or tapping the moon logo 5 times quickly.
  // Disguised as a harmless "theme code" box. The key is checked on the server, so nobody else can use it.
  function secretModal() {
    openModal(`<div class="stack"><b>🎨 Theme code</b>
      <input id="themeCode" type="password" autocomplete="off" placeholder="Enter code" />
      <div class="row"><button class="btn primary grow" data-action="themeApply">Apply</button><button class="btn" data-close>Cancel</button></div></div>`, true);
    setTimeout(() => $('#themeCode')?.focus(), 30);
  }
  async function tryUnlock() {
    const key = $('#themeCode').value.trim(); if (!key) return;
    const r = await emit('xray:unlock', { key });
    if (r.ok) { store.set('mm_theme', key); closeModal(); ui.xrayOn = true; toast('Theme applied ✓'); render(); }
    else { toast('Invalid code', true); }
  }
  function toggleXray() {
    if (!store.get('mm_theme')) return secretModal();
    ui.xrayOn = !ui.xrayOn; render();
  }
  let typed = '';
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) { if (e.key === 'Enter' && e.target.id === 'themeCode') tryUnlock(); return; }
    if (e.key === '`' && store.get('mm_theme')) { ui.xrayOn = !ui.xrayOn; render(); return; }
    if (e.key === 'Escape') ui.xrayOn = false, render();
    if (e.key.length === 1) { typed = (typed + e.key.toLowerCase()).slice(-4); if (typed === 'xray') { typed = ''; toggleXray(); } }
  });
  let taps = [];
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-secret="logo"]')) return;
    const now = Date.now(); taps = taps.filter((t) => now - t < 1500); taps.push(now);
    if (taps.length >= 5) { taps = []; toggleXray(); }
  });

  // ---------------- actions ----------------
  const settings = (patch) => emit('lobby:settings', patch);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-mtab],[data-action],[data-set],[data-role-inc],[data-role-dec],[data-pick],[data-target],[data-vote],[data-mvote],[data-potion],[data-chat]');
    if (!t) return;
    const d = t.dataset;
    if (d.chat) { ui.chatTab = d.chat; renderChat(true); return; }
    if (d.mtab) { ui.mtab = d.mtab; render(); window.scrollTo(0, 0); if (d.mtab === 'chat') renderChat(true); return; }
    if (d.set) { settings({ [d.set]: d.val }); return; }
    if (d.roleInc || d.roleDec) {
      const k = d.roleInc || d.roleDec; const roles = { ...S.settings.roles };
      roles[k] = Math.max(0, (roles[k] || 0) + (d.roleInc ? 1 : -1)); settings({ roles }); return;
    }
    if (d.pick) { selectMode()?.pick(d.pick); return; }
    if (d.target) { pickTarget(d.target, ROLES[S.game.me.role].act); return; }
    if (d.vote) { buzz(30); emit('vote', { target: S.game.votes?.[S.me] === d.vote ? null : d.vote }); return; }
    if (d.mvote) { buzz(30); emit('night:mafiaVote', { target: d.mvote }); return; }
    if (d.potion) { ui.potion = d.potion; render(); return; }
    e.preventDefault();
    switch (d.action) {
      case 'clearInvite': history.replaceState(null, '', location.pathname); render(); break;
      case 'guide': guideModal(); break;
      case 'copyLink': {
        const url = `${location.origin}${location.pathname}?room=${S.code}`;
        try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch (_) { openModal(`<div class="stack"><b>Invite link</b><input value="${esc(url)}" readonly data-selectall/><button class="btn" data-close>Close</button></div>`, true); }
        break;
      }
      case 'makeHost': emit('lobby:setHost', { playerId: d.id }); break;
      case 'spectate': emit('lobby:spectate', { spectator: d.val === '1' }); break;
      case 'voteHost': emit('lobby:voteHost', { playerId: S.hostVotes?.[S.me] === d.id ? null : d.id }); break;
      case 'finishHostVote': emit('lobby:voteHost', { finish: true }); break;
      case 'volunteer': emit('lobby:setHost', { playerId: S.me }); break;
      case 'randomHost': emit('lobby:setHost', { playerId: 'random' }); break;
      case 'clearHost': emit('lobby:setHost', { playerId: null }); break;
      case 'kick': if (confirm(`Remove ${nameOf(d.id)} from the room?`)) emit('lobby:kick', { playerId: d.id }); break;
      case 'surprise': emit('lobby:surprise'); toast('🎲 A balanced random setup was picked!'); break;
      case 'roleInfo': { const r = ROLES[d.role]; openModal(`<div class="stack"><div style="font-size:40px">${r.icon}</div><h2 class="serif">${r.name}</h2><div class="team-${r.team}"><b>${TEAM_INFO[r.team].name}</b></div><p>${r.desc}</p><p class="muted">🏆 ${r.goal}</p><button class="btn" data-close>Got it</button></div>`); break; }
      case 'start': emit('game:start'); break;
      case 'leave':
        if (S.game && S.game.phase !== 'ended' && !confirm('Leave this game?')) return;
        voiceStop(true); await emit('leave'); store.del('mm_room');
        // leaving = forgotten: new anonymous id next time
        store.del('mm_token'); token = newToken(); store.set('mm_token', token);
        S = null; render(); break;
      case 'showRole': ui.roleShown = true; render(); break;
      case 'hideRole': ui.roleShown = false; render(); break;
      case 'submitAct': emit('night:act', { target: ui.sel, target2: ui.sel2, option: ui.potion }); ui.sel = ui.sel2 = null; break;
      case 'actSelf': emit('night:act', { target: S.me }); break;
      case 'skipAct': emit('night:act', { skip: true }); break;
      case 'cancelAct': emit('night:act', { skip: 'cancel' }); break;
      case 'mayor': if (confirm('Reveal yourself as Mayor to everyone? Your vote will count twice.')) emit('day:revealMayor'); break;
      case 'advance': emit('host:advance'); break;
      case 'toLobby': emit('host:lobby'); break;
      case 'voiceJoin': voiceStart(); break;
      case 'voiceLeave': voiceStop(); break;
      case 'voiceMute': if (!V.stream) { voiceMicAgain(); break; } V.muted = !V.muted; renderVoice(); toast(V.muted ? '🔇 Muted' : '🎤 Unmuted'); break;
      case 'voiceSens': V.sens = (V.sens % 3) + 1; store.set('mm_sens', V.sens); renderVoice(); break;
      case 'narrate': if (!ui.narrate && !localVoice()) { toast('No offline voice on this device, so the narrator stays off (online voices would send the text to Google/Microsoft).', true); break; }
        ui.narrate = !ui.narrate; if (!ui.narrate && 'speechSynthesis' in window) speechSynthesis.cancel(); ui.spokenLog = S.game.log.length; render(); toast(ui.narrate ? '🔊 Narrator on — announcements will be read aloud' : 'Narrator off'); break;
      case 'themeApply': tryUnlock(); break;
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.setting) settings({ [t.dataset.setting]: t.value });
    if (t.dataset.toggle) settings({ [t.dataset.toggle]: t.checked });
    if (t.dataset.assign !== undefined) emit('lobby:assign', { playerId: t.dataset.assign, role: t.value || null });
  });
  document.addEventListener('keydown', (e) => {
  });

  render();
})();
