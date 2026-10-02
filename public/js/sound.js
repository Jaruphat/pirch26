// All sounds are synthesized with WebAudio — no audio files needed.
let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem('pirch.sound') !== 'off'; } catch { /* ignore */ }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isSoundOn() { return enabled; }
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem('pirch.sound', on ? 'on' : 'off'); } catch { /* ignore */ }
}

function tone(freq, start, dur, { type = 'square', vol = 0.06, to = null } = {}) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(start, dur, vol = 0.05, filterFreq = 2000) {
  const a = ac(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = 0.8;
  const g = a.createGain();
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

const SOUNDS = {
  join()  { tone(660, 0, 0.09); tone(990, 0.09, 0.14); },
  part()  { tone(880, 0, 0.09); tone(520, 0.09, 0.16); },
  msg()   { tone(1200, 0, 0.04, { vol: 0.03 }); },
  mention() { tone(1046, 0, 0.1, { type: 'triangle', vol: 0.12 }); tone(1318, 0.1, 0.18, { type: 'triangle', vol: 0.12 }); },
  pm()    { [0, 0.14, 0.28].forEach(t => tone(1500, t, 0.07, { type: 'sine', vol: 0.12 })); },
  wink()  { tone(200, 0, 0.35, { type: 'sine', vol: 0.15, to: 900 }); tone(900, 0.35, 0.2, { type: 'sine', vol: 0.1, to: 400 }); },
  slap()  { noise(0, 0.18, 0.25, 1200); tone(120, 0, 0.12, { vol: 0.1 }); },
  kick()  { tone(110, 0, 0.5, { type: 'sawtooth', vol: 0.1, to: 55 }); },
  error() { tone(300, 0, 0.12); tone(220, 0.13, 0.25); },
  roll()  { for (let i = 0; i < 6; i++) noise(i * 0.06, 0.04, 0.12, 3000 + i * 300); },
  // 56k modem handshake (approximation, ~3s)
  modem() {
    const dtmf = [[697, 1209], [770, 1336], [852, 1477], [697, 1336], [941, 1336], [770, 1209], [852, 1336]];
    dtmf.forEach(([a, b], i) => { tone(a, i * 0.11, 0.08, { type: 'sine', vol: 0.05 }); tone(b, i * 0.11, 0.08, { type: 'sine', vol: 0.05 }); });
    const s = 0.9;
    tone(2100, s, 0.5, { type: 'sine', vol: 0.05 });
    tone(1650, s + 0.55, 0.25, { type: 'sine', vol: 0.05 });
    tone(980, s + 0.8, 0.25, { type: 'sine', vol: 0.05 });
    noise(s + 1.05, 1.2, 0.07, 1800);
    tone(1200, s + 1.1, 1.0, { type: 'square', vol: 0.02, to: 2400 });
    noise(s + 2.2, 0.6, 0.05, 900);
  },
};

export function play(name) {
  if (!enabled) return;
  try { SOUNDS[name]?.(); } catch { /* ignore */ }
}
