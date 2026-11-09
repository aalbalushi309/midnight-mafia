/**
 * Small helpers shared by the server modules.
 */
const crypto = require('crypto');

const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newId = () => crypto.randomBytes(6).toString('hex');
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

module.exports = { rand, shuffle, newId, clean };
