// ===== Jukebox: ฟังเพลง YouTube พร้อมกันทั้งห้อง =====
// ข้อความเพลงส่งเป็น kind 'wink' ที่ body ขึ้นต้นด้วย "music:" (ไม่ต้องแก้ schema ฐานข้อมูล)
//   music:play:<videoId>   เปิดเพลง (ทุกคนในห้องเล่นจากเวลาที่ส่ง)
//   music:stop             หยุดเพลง
export const isMusic = b => typeof b === 'string' && b.startsWith('music:');
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTube(input) {
  const s = (input || '').trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v');
    const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
    if (!id && m) id = m[1];
  }
  return id && ID_RE.test(id) ? id : null;
}
export function parseMusic(body) {
  const [, cmd, id] = body.split(':');
  if (cmd === 'play' && ID_RE.test(id || '')) return { cmd: 'play', id };
  if (cmd === 'stop') return { cmd: 'stop' };
  return null;
}

const M = {
  rooms: new Map(),     // room -> { id, by, at }
  titles: new Map(),    // videoId -> title
  tuned: null,          // room currently playing on this device
  cur: null,            // track currently loaded
  dismissed: null,      // `${room}|${at}` user closed this track locally
  skew: 0,              // server clock - local clock (ms)
  player: null, ytReady: null, timer: null, tapTimer: null,
  onStop: () => {}, onTitle: () => {}, onError: () => {},
};
const nowServer = () => Date.now() + M.skew;
export function setClockSkew(ms) { if (Number.isFinite(ms) && Math.abs(ms) < 6 * 3600e3) M.skew = ms; }
export const titleOf = id => M.titles.get(id) || null;
export const nowPlaying = room => M.rooms.get(room) || null;

export function initJukebox({ onStop, onTitle, onError }) {
  Object.assign(M, { onStop, onTitle, onError });
  buildUI();
}

/** record a music message (history or live) without starting playback */
export function record(room, m) {
  const p = parseMusic(m.body);
  if (!p) return null;
  if (p.cmd === 'play') M.rooms.set(room, { id: p.id, by: m.nick, at: Date.parse(m.created_at) || nowServer() });
  else M.rooms.delete(room);
  return p;
}
/** live message arrived */
export function live(room, m, isActiveRoom) {
  const p = record(room, m);
  if (!p) return;
  if (p.cmd === 'play' && (isActiveRoom || M.tuned === room || !M.cur)) tune(room);
  if (p.cmd === 'stop' && M.tuned === room) stopLocal(`⏹ ${m.nick} หยุดเพลงแล้ว`);
}
export function onActivate(room) {
  const t = M.rooms.get(room);
  if (!t || M.dismissed === `${room}|${t.at}`) return;
  if (M.tuned === room && M.cur?.at === t.at) return;
  tune(room);
}
export function roomLeft(room) {
  M.rooms.delete(room);
  if (M.tuned === room) stopLocal('', true);
}

// ---------------------------------------------------------------- playback
function loadYT() {
  if (M.ytReady) return M.ytReady;
  M.ytReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { M.ytReady = null; reject(new Error('โหลดเครื่องเล่น YouTube ไม่ได้')); };
    document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) { M.ytReady = null; reject(new Error('โหลดเครื่องเล่น YouTube ไม่ทัน (timeout)')); } }, 15000);
  });
  return M.ytReady;
}

const elapsed = t => Math.max(0, (nowServer() - t.at) / 1000);

async function tune(room) {
  const t = M.rooms.get(room);
  if (!t) return;
  M.tuned = room; M.cur = { ...t, room }; M.dismissed = null;
  show(true);
  setTitle(titleOf(t.id) || 'กำลังโหลด...');
  $('#jb-meta').textContent = `🎵 ${t.by} เปิดใน ${room}`;
  $('#jb-tap').hidden = true;
  let YT;
  try { YT = await loadYT(); } catch (e) { setTitle('⚠ ' + e.message); M.onError(e.message); return; }
  if (M.cur?.at !== t.at) return; // changed while loading
  const start = elapsed(t);
  if (M.player?.loadVideoById) {
    M.player.loadVideoById({ videoId: t.id, startSeconds: start });
  } else {
    M.player = new YT.Player('jb-player', {
      host: 'https://www.youtube-nocookie.com',
      width: '100%', height: '100%', videoId: t.id,
      playerVars: { autoplay: 1, start: Math.floor(start), playsinline: 1, rel: 0, controls: 1, fs: 0 },
      events: {
        onReady: e => { e.target.setVolume(volume()); if (isMuted()) e.target.mute(); e.target.seekTo(elapsed(M.cur), true); e.target.playVideo(); },
        onStateChange: onState,
        onError: onYTError,
      },
    });
  }
  startTimer();
  clearTimeout(M.tapTimer);
  M.tapTimer = setTimeout(() => {
    const st = M.player?.getPlayerState?.();
    if (M.cur && st !== 1 && st !== 3 && st !== 0) $('#jb-tap').hidden = false; // autoplay blocked
  }, 2500);
}

function onState(e) {
  const YTS = window.YT.PlayerState;
  const data = e.target.getVideoData?.();
  if (data?.title && M.cur && data.video_id === M.cur.id && !M.titles.has(M.cur.id)) {
    M.titles.set(M.cur.id, data.title);
    setTitle(data.title);
    M.onTitle(M.cur.id, data.title);
  }
  $('#jukebox').classList.toggle('playing', e.data === YTS.PLAYING);
  if (e.data === YTS.PLAYING) $('#jb-tap').hidden = true;
  if (e.data === YTS.ENDED && M.cur) { setTitle(`${titleOf(M.cur.id) || 'เพลง'} — จบแล้ว ✓`); M.cur = { ...M.cur, ended: true }; }
}
function onYTError(e) {
  const map = { 2: 'ลิงก์วิดีโอไม่ถูกต้อง', 5: 'เล่นวิดีโอนี้ไม่ได้', 100: 'ไม่พบวิดีโอ (อาจถูกลบหรือเป็นส่วนตัว)', 101: 'เจ้าของปิดการเล่นนอก YouTube', 150: 'เจ้าของปิดการเล่นนอก YouTube' };
  const msg = `เพลงนี้เปิดในห้องไม่ได้: ${map[e.data] || 'error ' + e.data}`;
  setTitle('⚠ ' + msg);
  M.onError(msg);
}

function stopLocal(note = '', hide = false) {
  try { M.player?.stopVideo?.(); } catch { /* ignore */ }
  clearInterval(M.timer); clearTimeout(M.tapTimer);
  if (M.cur) M.dismissed = `${M.cur.room}|${M.cur.at}`;
  M.cur = null; M.tuned = null;
  $('#jukebox').classList.remove('playing');
  $('#jb-time').textContent = '--:--';
  if (note) setTitle(note);
  if (hide || !note) show(false);
}

function startTimer() {
  clearInterval(M.timer);
  M.timer = setInterval(() => {
    const p = M.player;
    if (!p?.getCurrentTime || !M.cur) return;
    const c = p.getCurrentTime() || 0, d = p.getDuration() || 0;
    $('#jb-time').textContent = d ? `${fmt(c)} / ${fmt(d)}` : fmt(c);
  }, 1000);
}
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- UI
const $ = s => document.querySelector(s);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const volume = () => lsGet('pirch.vol', 70);
const isMuted = () => lsGet('pirch.mute', false);

function setTitle(t) {
  const el = $('#jb-title');
  el.textContent = t;
  el.parentElement.classList.toggle('scroll', t.length > 26);
}
function show(on) { $('#jukebox').hidden = !on; }

function buildUI() {
  if ($('#jukebox')) return;
  const box = document.createElement('div');
  box.className = 'window jukebox';
  box.id = 'jukebox';
  box.hidden = true;
  box.innerHTML = `
    <div class="title-bar" id="jb-drag"><div class="title-bar-text">🎵 PIRCH Jukebox</div>
      <div class="title-bar-controls"><button aria-label="Minimize" id="jb-min" title="ย่อ / ขยาย"></button><button aria-label="Close" id="jb-close" title="ปิด (หยุดเฉพาะเครื่องเรา)"></button></div></div>
    <div class="window-body">
      <div class="jb-lcd">
        <div class="jb-row"><span id="jb-time">--:--</span><span class="jb-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div>
        <div class="jb-marquee"><span id="jb-title"></span></div>
      </div>
      <div class="jb-video"><div id="jb-player"></div><button id="jb-tap" hidden>▶ แตะเพื่อฟังเพลงด้วยกัน</button></div>
      <div class="jb-meta" id="jb-meta"></div>
      <div class="jb-ctrl">
        <button id="jb-mute" title="ปิดเสียงเฉพาะเครื่องเรา">🔊</button>
        <input type="range" id="jb-vol" min="0" max="100" title="ระดับเสียง">
        <button id="jb-stop" title="หยุดเพลงทั้งห้อง">⏹ หยุดทั้งห้อง</button>
      </div>
    </div>`;
  document.body.append(box);
  // ย่อ/ขยาย — มือถือเริ่มแบบย่อ, จำค่าที่เลือกไว้
  const setMini = on => {
    box.classList.toggle('mini', on);
    const b = $('#jb-min');
    b.setAttribute('aria-label', on ? 'Restore' : 'Minimize');
    b.title = on ? 'ขยาย' : 'ย่อ';
    lsSet('pirch.jbMini', on);
  };
  setMini(lsGet('pirch.jbMini', window.matchMedia('(max-width: 760px)').matches));
  $('#jb-min').addEventListener('click', () => setMini(!box.classList.contains('mini')));
  box.querySelector('.jb-lcd').addEventListener('click', () => { if (box.classList.contains('mini')) setMini(false); });
  const vol = $('#jb-vol');
  vol.value = volume();
  const syncMute = () => { $('#jb-mute').textContent = isMuted() ? '🔇' : '🔊'; };
  syncMute();
  vol.addEventListener('input', () => { lsSet('pirch.vol', +vol.value); M.player?.setVolume?.(+vol.value); });
  $('#jb-mute').addEventListener('click', () => {
    const m = !isMuted(); lsSet('pirch.mute', m); syncMute();
    if (m) M.player?.mute?.(); else M.player?.unMute?.();
  });
  $('#jb-stop').addEventListener('click', () => M.tuned && M.onStop(M.tuned));
  $('#jb-close').addEventListener('click', () => stopLocal('', true));
  $('#jb-tap').addEventListener('click', () => {
    if (!M.player || !M.cur) return;
    M.player.seekTo(elapsed(M.cur), true); M.player.playVideo();
    $('#jb-tap').hidden = true;
  });
  // drag by title bar
  const bar = $('#jb-drag');
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    const move = ev => {
      box.style.left = `${Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx))}px`;
      box.style.top = `${Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy))}px`;
      box.style.right = 'auto'; box.style.bottom = 'auto';
    };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
}
