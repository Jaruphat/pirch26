// ===== PIRCH26 Revival — main client =====
import { createSupabaseApi } from './api-supabase.js';
import { createDemoApi } from './api-demo.js';
import { createLanApi } from './api-lan.js';
import { scripts as Scripts, greetText, autoReplyText } from './scripts.js';
import { renderFormatted, stripCodes, rainbow, nickColor, PALETTE, PALETTE_NAMES, B, K, U } from './format.js';
import { play, isSoundOn, setSound } from './sound.js';
import * as Music from './music.js';
import { WINKS, winkById, SLAP_ITEMS, QUIT_REASONS, MOTD, HELP, MANUAL, fakeHost } from './fun.js';

const cfg = window.PIRCH_CONFIG || {};
const SERVER = cfg.SERVER_NAME || 'irc.pirch26.revival';
const DEFAULT_ROOM = cfg.DEFAULT_ROOM || '#ห้องรวม';
const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
const api = cfg.BACKEND === 'lan' ? createLanApi() : useSupabase ? createSupabaseApi(cfg) : createDemoApi();

const ROOM_RE = /^#[A-Za-z0-9_ก-๛-]{1,30}$/;
const MAX_BODY = 600;
const $ = s => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// ---------------------------------------------------------------- state
const S = {
  user: null,
  me: null,               // my profile
  presence: [],
  byId: new Map(),        // id -> presence entry
  prev: new Map(),        // id -> { nick, rooms:Set }
  firstSync: true,
  windows: new Map(),     // key -> window
  order: [],
  active: null,
  seen: new Set(),
  ops: new Map(),         // room -> Set(userId)
  away: null,
  lastSendAt: 0,
  hist: [], histIdx: -1,
  tab: null,
  kicked: new Set(),
  titleUnread: 0,
  connected: false,
  allRooms: [],
  bots: [],
};

// ---------------------------------------------------------------- windows
function createWindow(type, name, extra = {}) {
  const key = type === 'status' ? 'status' : type === 'room' ? `room:${name}` : `pm:${extra.peerId}`;
  if (S.windows.has(key)) return S.windows.get(key);
  const log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  log.hidden = true;
  $('#logs').append(log);
  const w = { key, type, name, log, unread: 0, hl: false, topic: '', loading: false, buffer: [], ...extra };
  S.windows.set(key, w);
  S.order.push(key);
  renderTree();
  return w;
}

function closeWindow(key) {
  const w = S.windows.get(key);
  if (!w || key === 'status') return;
  w.log.remove();
  S.windows.delete(key);
  S.order = S.order.filter(k => k !== key);
  if (S.active === key) activate(S.order.filter(k => k !== 'status').at(-1) || 'status');
  renderTree();
}

function activate(key) {
  const w = S.windows.get(key);
  if (!w) return;
  if (S.active && S.windows.get(S.active)) S.windows.get(S.active).log.hidden = true;
  S.active = key;
  w.log.hidden = false;
  w.unread = 0; w.hl = false;
  w.log.scrollTop = w.log.scrollHeight;
  renderTree(); renderHeader(); renderNicklist(); updateTitleUnread();
  if (w.type === 'room') Music.onActivate(w.name);
  if (window.matchMedia('(min-width: 761px)').matches) $('#input').focus();
}
const activeWin = () => S.windows.get(S.active);
const roomWin = name => S.windows.get(`room:${name}`);
const joinedRooms = () => [...S.windows.values()].filter(w => w.type === 'room').map(w => w.name);

function renderTree() {
  const tree = $('#tree');
  tree.textContent = '';
  const item = (w, label) => {
    const cls = ['item', w.key === S.active && 'active', w.hl && 'hlt', w.unread && !w.hl && 'unread'].filter(Boolean).join(' ');
    const span = el('span', { class: cls, title: label, onclick: () => activate(w.key) }, label);
    if (w.type === 'room') {
      const n = usersIn(w.name).length;
      span.append(el('span', { class: 'cnt', text: ` (${n})` }));
    }
    return el('li', {}, span);
  };
  const root = el('ul');
  const status = S.windows.get('status');
  if (status) root.append(item(status, `🖥 ${SERVER}`));
  const rooms = S.order.map(k => S.windows.get(k)).filter(w => w?.type === 'room');
  const pms = S.order.map(k => S.windows.get(k)).filter(w => w?.type === 'pm');
  if (rooms.length) { root.append(el('li', { class: 'group', text: 'ห้องแชท' })); const u = el('ul'); rooms.forEach(w => u.append(item(w, w.name))); root.append(el('li', {}, u)); }
  if (pms.length) { root.append(el('li', { class: 'group', text: 'คุยส่วนตัว' })); const u = el('ul'); pms.forEach(w => u.append(item(w, `✉ ${w.name}`))); root.append(el('li', {}, u)); }
  if (S.allRooms.length) {
    const open = lsGet('pirch.allRoomsOpen', true);
    root.append(el('li', { class: 'group all-rooms-head', title: open ? 'คลิกเพื่อพับ' : 'คลิกเพื่อกาง', onclick: () => { lsSet('pirch.allRoomsOpen', !open); renderTree(); } },
      `${open ? '▾' : '▸'} ห้องทั้งหมด (${S.allRooms.length})`));
    if (open) {
      const u = el('ul', { class: 'all-rooms' });
      for (const r of S.allRooms) {
        const joined = S.windows.has(`room:${r.name}`);
        const n = usersIn(r.name).length;
        const span = el('span', { class: `item${joined ? ' joined' : ''}`, title: joined ? 'เข้าอยู่แล้ว — คลิกเพื่อเปิด' : (r.topic ? stripCodes(r.topic) : 'คลิกเพื่อเข้าห้อง'),
          onclick: () => joinRoom(r.name) }, r.name, el('span', { class: 'cnt', text: ` (${n})` }));
        u.append(el('li', {}, span));
      }
      root.append(el('li', {}, u));
    }
  }
  tree.append(root);
  renderTasks();
}

function renderHeader() {
  const w = activeWin();
  if (!w) return;
  const nick = S.me?.nick || '';
  const where = w.type === 'status' ? `Status: ${nick} on ${SERVER}` : w.type === 'room' ? w.name : `คุยส่วนตัวกับ ${w.name}`;
  $('#title-text').textContent = `PIRCH26 Revival - [${where}]`;
  const t = $('#topic');
  t.textContent = '';
  if (w.type === 'room') {
    t.append(el('b', { text: 'หัวข้อ: ' }), w.topic ? renderFormatted(w.topic) : el('i', { text: '(ยังไม่มีหัวข้อ — @op ตั้งได้ด้วย /topic)' }));
  } else if (w.type === 'pm') {
    const p = S.byId.get(w.peerId);
    t.append(el('b', { text: '✉ ' }), `${w.name} — ${p ? (p.away ? `ไม่อยู่: ${p.away}` : 'ออนไลน์') : 'ออฟไลน์'}`);
  } else {
    t.append(el('b', { text: 'Server: ' }), `${SERVER} ${api.mode === 'demo' ? '(โหมดเดโม่ — คุยกับบอท)' : ''}`);
  }
  $('#input').placeholder = w.type === 'status' ? 'พิมพ์ /join #ห้องรวม หรือ /help' : `พิมพ์ข้อความถึง ${w.name}...`;
}

function usersIn(room) {
  return S.presence.filter(p => p.rooms?.includes(room));
}
const isOp = (room, id) => S.ops.get(room)?.has(id);

function renderNicklist() {
  const w = activeWin();
  const ul = $('#nicklist');
  ul.textContent = '';
  let list = [];
  if (w?.type === 'room') list = usersIn(w.name);
  else if (w?.type === 'pm') list = [S.byId.get(S.user.id), S.byId.get(w.peerId)].filter(Boolean);
  else list = S.presence;
  const room = w?.type === 'room' ? w.name : null;
  list = [...list].sort((a, b) => {
    const oa = room && isOp(room, a.id) ? 0 : 1, ob = room && isOp(room, b.id) ? 0 : 1;
    return oa - ob || (a.nick || '').localeCompare(b.nick || '', 'th');
  });
  for (const p of list) {
    const li = el('li', {
      class: [p.away && 'away', p.id === S.user.id && 'me'].filter(Boolean).join(' '),
      style: `color:${nickColor(p.nick || '?')}`,
      title: p.away ? `ไม่อยู่: ${p.away}` : 'ดับเบิลคลิกเพื่อคุยส่วนตัว',
    }, el('span', { class: 'pfx', text: room && isOp(room, p.id) ? '@' : '' }), p.nick || '?');
    li.addEventListener('dblclick', () => p.id !== S.user.id && openQuery(p.id, p.nick, true));
    li.addEventListener('click', () => { ul.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); li.classList.add('sel'); });
    li.addEventListener('contextmenu', e => { e.preventDefault(); nickMenu(e.clientX, e.clientY, p.nick, p.id); });
    ul.append(li);
  }
  if (w?.type === 'room') for (const b of S.bots) {
    const li = el('li', { class: 'bot', style: `color:${nickColor(b.nick)}`, title: `บอท — ${b.quote || 'พิมพ์ !help'}` }, el('span', { class: 'pfx', text: '+' }), `🤖 ${b.nick}`);
    li.addEventListener('contextmenu', e => { e.preventDefault(); nickMenu(e.clientX, e.clientY, b.nick, b.id); });
    li.addEventListener('dblclick', () => COMMANDS.whois([b.nick]).catch(e => err(e.message)));
    ul.append(li);
  }
  $('#nicks-head').textContent = w?.type === 'room' ? `${list.length} คน${S.bots.length ? ` + ${S.bots.length} บอท` : ''} ในห้อง ${w.name}` : w?.type === 'pm' ? 'คุยส่วนตัว' : `${S.presence.length} คนออนไลน์`;
  $('#st-users').textContent = `${S.presence.length} คนออนไลน์`;
}

function renderTasks() {
  const t = $('#tasks');
  t.textContent = '';
  if (!S.me) return;
  t.append(el('button', { class: $('#app').hidden ? '' : 'on', onclick: () => toggleMinimize() }, `💬 PIRCH26 - ${S.me.nick}`));
}

// ---------------------------------------------------------------- lines
const hhmm = d => { const t = new Date(d || Date.now()); return `[${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}]`; };

function addLine(key, content, cls = '', at = null) {
  const w = S.windows.get(key);
  if (!w) return null;
  const nearBottom = w.log.scrollHeight - w.log.scrollTop - w.log.clientHeight < 60;
  const line = el('div', { class: `line ${cls}` }, el('span', { class: 'ts', text: hhmm(at) }));
  if (typeof content === 'string') line.append(content); else line.append(content);
  w.log.append(line);
  while (w.log.childElementCount > 600) w.log.firstElementChild.remove();
  if (nearBottom || key === S.active) w.log.scrollTop = w.log.scrollHeight;
  return line;
}
const sys = (key, text, cls = 'sys') => addLine(key, `*** ${text}`, cls);
const info = (text, cls = 'info') => sys(S.active || 'status', text, cls);
const err = text => { addLine(S.active || 'status', `*** ${text}`, 'err'); play('error'); };

function nickSpan(nick, id) {
  const s = el('span', { class: 'nick', style: `color:${nickColor(nick)}`, text: nick });
  s.addEventListener('dblclick', () => id && id !== S.user.id && openQuery(id, nick, true));
  s.addEventListener('contextmenu', e => { e.preventDefault(); nickMenu(e.clientX, e.clientY, nick, id); });
  return s;
}

function mentionsMe(m) {
  if (!S.me || m.sender === S.user.id) return false;
  return stripCodes(m.body || '').toLowerCase().includes(S.me.nick.toLowerCase());
}

/** Render a message object into a window. Returns { line, mention } */
function showMsg(key, m, { history = false } = {}) {
  const f = document.createDocumentFragment();
  let cls = '';
  const at = m.created_at;
  switch (m.kind) {
    case 'action':
      f.append('* ', nickSpan(m.nick, m.sender), ' ', renderFormatted(m.body)); cls = 'action'; break;
    case 'wink': {
      if (Music.isMusic(m.body)) {
        const p = Music.parseMusic(m.body);
        if (p?.cmd === 'play') {
          const a = el('a', { href: `https://youtu.be/${p.id}`, target: '_blank', rel: 'noopener noreferrer', class: 'yt-link', 'data-yt': p.id, text: Music.titleOf(p.id) || `youtu.be/${p.id}` });
          f.append('*** 🎵 ', nickSpan(m.nick, m.sender), ' เปิดเพลง: ', a);
          cls = 'music';
        } else { f.append('*** ⏹ ', nickSpan(m.nick, m.sender), ' หยุดเพลง'); cls = 'part'; }
        break;
      }
      const w = winkById(m.body) || { name: m.body, emoji: '😉' };
      f.append('*** ', nickSpan(m.nick, m.sender), ` ส่ง Wink "${w.name}" `, el('span', { class: 'wink-e', text: w.emoji })); cls = 'action'; break;
    }
    case 'slap':
      f.append('* ', nickSpan(m.nick, m.sender), ` ตบ ${m.target} ด้วย${m.body} 🐟`); cls = 'action'; break;
    case 'roll':
      f.append('* ', nickSpan(m.nick, m.sender), ` ทอยลูกเต๋าได้ ${m.body}`); cls = 'action'; break;
    case 'kick':
      f.append(`*** ${m.target} โดนเตะออกจากห้อง โดย `, nickSpan(m.nick, m.sender), ` (${m.body})`); cls = 'kick'; break;
    case 'topic':
      f.append('*** ', nickSpan(m.nick, m.sender), ' เปลี่ยนหัวข้อเป็น: ', renderFormatted(m.body)); cls = 'topicl'; break;
    case 'nick':
      f.append(`*** ${m.body} เปลี่ยนชื่อเป็น `, nickSpan(m.nick, m.sender)); cls = 'sys'; break;
    case 'op':
      f.append('*** ', nickSpan(m.nick, m.sender), m.body === 'deop' ? ` ถอด @op ของ ${m.target}` : ` ให้ @op กับ ${m.target}`); cls = m.body === 'deop' ? 'part' : 'sys'; break;
    default:
      f.append('<', nickSpan(m.nick, m.sender), '> ', renderFormatted(m.body, m.color ?? 1));
  }
  const mention = !history && (m.kind === 'msg' || m.kind === 'action') && mentionsMe(m);
  if (mention) cls += ' hl';
  if (history) cls += ' hist';
  const line = addLine(key, f, cls, at);
  return { line, mention };
}

// ---------------------------------------------------------------- incoming
function onIncoming(m) {
  if (S.seen.has(m.id)) return;
  const mine = m.sender === S.user.id;
  if (mine && S.lastSendAt) { setLag(performance.now() - S.lastSendAt); S.lastSendAt = 0; }

  let key;
  if (m.room) {
    key = `room:${m.room}`;
    const w = S.windows.get(key);
    if (!w) return;
    if (w.loading) { w.buffer.push(m); return; }
  } else {
    const peerId = mine ? m.to_user : m.sender;
    key = `pm:${peerId}`;
    let w = S.windows.get(key);
    if (!w) {
      if (mine) return;
      openQuery(peerId, m.nick, false, m);
      return; // openQuery loads history (which includes m) — avoid duplicate
    }
    if (w.loading) { w.buffer.push(m); return; }
  }
  S.seen.add(m.id);
  const w = S.windows.get(key);
  const { mention } = showMsg(key, m);

  // side effects
  if (m.room) {
    if (m.kind === 'topic') { w.topic = m.body; if (S.active === key) renderHeader(); }
    if (m.kind === 'op') refreshOps(m.room);
    if (m.kind === 'kick') {
      S.kicked.add(`${m.room}|${(m.target || '').toLowerCase()}`);
      if (S.me && m.target?.toLowerCase() === S.me.nick.toLowerCase()) {
        play('kick');
        leaveRoom(m.room, { silent: true });
        msgBox('โดนเตะ! 🦶', `คุณโดน ${m.nick} เตะออกจากห้อง ${m.room}\nเหตุผล: ${m.body}\n\nจะกลับเข้าไปใหม่ก็ได้นะ (/join ${m.room})`, '⛔');
        return;
      }
    }
  }
  const music = m.kind === 'wink' && Music.isMusic(m.body);
  if (music) { if (m.room) Music.live(m.room, m, S.active === key); }
  else if (m.kind === 'wink' && !mine) { play('wink'); if (S.active === key) winkFx(m.body, m.nick); }
  else if (m.kind === 'wink' && mine && S.active === key) winkFx(m.body, m.nick);
  if (m.kind === 'slap') { play('slap'); if (S.me && m.target?.toLowerCase() === S.me.nick.toLowerCase()) shakeScreen(); }
  if (m.kind === 'roll') play('roll');
  if (!mine && !m.room && m.kind !== 'wink') play('pm');
  if (!mine && !m.room && m.kind === 'msg') { const ar = autoReplyText(m.sender, S.away, m.body); if (ar) sendTo(w, 'msg', ar).catch(() => {}); }
  if (mention) play('mention');

  if (S.active !== key) {
    w.unread++;
    if (mention || !m.room) w.hl = true;
    renderTree();
  }
  if (document.hidden && !mine) { S.titleUnread++; updateTitleUnread(); }
}

function setLag(ms) {
  const s = (ms / 1000).toFixed(2);
  $('#st-lag').textContent = `Lag: ${s}s`;
}

function updateTitleUnread() {
  document.title = S.titleUnread && document.hidden ? `(${S.titleUnread}) PIRCH26 Revival` : 'PIRCH26 Revival';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.titleUnread = 0; updateTitleUnread(); } });

// ---------------------------------------------------------------- presence
function myPresence() {
  return { nick: S.me.nick, color: S.me.color, rooms: joinedRooms(), away: S.away };
}
function syncPresence() { api.updatePresence(myPresence()).catch(() => {}); }

function onPresence(list) {
  S.presence = list.filter(p => p.nick);
  S.byId = new Map(S.presence.map(p => [p.id, p]));
  const mineRooms = new Set(joinedRooms());
  if (!S.firstSync) {
    const ids = new Set([...S.prev.keys(), ...S.byId.keys()]);
    for (const id of ids) {
      if (id === S.user.id) continue;
      const prev = S.prev.get(id);
      const cur = S.byId.get(id);
      const curRooms = new Set(cur?.rooms || []);
      if (prev && !cur) {
        const reason = pick(QUIT_REASONS);
        prev.rooms.forEach(r => mineRooms.has(r) && sys(`room:${r}`, `${prev.nick} ออกจากโปรแกรม (${reason})`, 'quit'));
        const pmw = S.windows.get(`pm:${id}`);
        if (pmw) sys(pmw.key, `${prev.nick} ออฟไลน์แล้ว (${reason})`, 'quit');
        continue;
      }
      if (!cur) continue;
      for (const r of curRooms) {
        if (!prev?.rooms.has(r) && mineRooms.has(r)) {
          sys(`room:${r}`, `${cur.nick} (${fakeHost(id)}) เข้ามาในห้อง ${r}`, 'join');
          const g = greetText(r, cur.nick);
          if (g) sendTo(roomWin(r), 'msg', g).catch(() => {});
          if (S.active === `room:${r}`) play('join');
        }
      }
      if (prev) for (const r of prev.rooms) {
        if (!curRooms.has(r) && mineRooms.has(r)) {
          const k = `${r}|${prev.nick.toLowerCase()}`;
          if (S.kicked.has(k)) { S.kicked.delete(k); continue; }
          sys(`room:${r}`, `${prev.nick} ออกจากห้อง ${r}`, 'part');
          if (S.active === `room:${r}`) play('part');
        }
      }
      if (prev && prev.away !== cur.away) {
        const pmw = S.windows.get(`pm:${id}`);
        if (pmw) sys(pmw.key, cur.away ? `${cur.nick} ไม่อยู่: ${cur.away}` : `${cur.nick} กลับมาแล้ว`, 'info');
      }
    }
  }
  S.firstSync = false;
  S.prev = new Map(S.presence.map(p => [p.id, { nick: p.nick, rooms: new Set(p.rooms || []), away: p.away }]));
  renderNicklist(); renderTree(); renderHeader();
}

// ---------------------------------------------------------------- rooms & queries
async function refreshRoomList() {
  try {
    const list = await api.listRooms();
    S.allRooms = [...list].sort((a, b) => (a.name === DEFAULT_ROOM ? -1 : b.name === DEFAULT_ROOM ? 1 : a.name.localeCompare(b.name, 'th')));
    renderTree();
  } catch { /* ignore — /list still works */ }
}

async function refreshOps(room) {
  try { S.ops.set(room, new Set(await api.getOps(room))); if (activeWin()?.name === room) renderNicklist(); } catch { /* ignore */ }
}

function normRoom(raw) {
  let n = (raw || '').trim().replace(/\s+/g, '_');
  if (!n) return null;
  if (!n.startsWith('#')) n = `#${n}`;
  return n;
}

async function joinRoom(raw, { focus = true, quiet = false } = {}) {
  const name = normRoom(raw);
  if (!name || !ROOM_RE.test(name)) return err(`ชื่อห้องไม่ถูกต้อง: ${raw} (ใช้ # ตามด้วยตัวอักษร/ตัวเลข ไม่เกิน 30 ตัว)`);
  const key = `room:${name}`;
  if (S.windows.has(key)) return focus && activate(key);
  let room;
  try { room = await api.ensureRoom(name); } catch (e) { return err(`เข้าห้องไม่ได้: ${e.message}`); }
  const w = createWindow('room', name);
  w.topic = room?.topic || '';
  w.createdBy = room?.created_by || null;
  w.loading = true;
  if (focus) activate(key);
  sys(key, `กำลังเข้าห้อง ${name}...`, 'join');
  try {
    const [hist] = await Promise.all([api.history(name), refreshOps(name)]);
    if (hist.length) {
      addLine(key, '─────── ข้อความล่าสุด ───────', 'histsep');
      hist.forEach(m => { S.seen.add(m.id); showMsg(key, m, { history: true }); if (m.kind === 'wink' && Music.isMusic(m.body)) Music.record(name, m); });
      addLine(key, '────────────────────────', 'histsep');
    }
  } catch (e) { err(`โหลดประวัติไม่ได้: ${e.message}`); }
  sys(key, `คุณเข้ามาในห้อง ${name} แล้ว`, 'join');
  if (w.topic) sys(key, `หัวข้อ: ${stripCodes(w.topic)}`, 'topicl');
  w.loading = false;
  w.buffer.splice(0).forEach(onIncoming);
  lsSet('pirch.rooms', joinedRooms());
  syncPresence();
  if (!quiet) play('join');
  if (!S.allRooms.some(r => r.name === name)) refreshRoomList();
  if (focus) activate(key); else renderTree();
}

function leaveRoom(name, { silent = false } = {}) {
  const key = `room:${name}`;
  if (!S.windows.has(key)) return;
  closeWindow(key);
  Music.roomLeft(name);
  lsSet('pirch.rooms', joinedRooms());
  syncPresence();
  if (!silent) { sys('status', `คุณออกจากห้อง ${name}`, 'part'); play('part'); }
}

async function openQuery(peerId, nick, focus = true, firstMsg = null) {
  const key = `pm:${peerId}`;
  if (S.windows.has(key)) { if (focus) activate(key); return S.windows.get(key); }
  const w = createWindow('pm', nick, { peerId });
  w.loading = true;
  if (focus) activate(key);
  try {
    const hist = await api.pmHistory(peerId);
    if (firstMsg && !hist.some(m => m.id === firstMsg.id)) hist.push(firstMsg);
    hist.forEach(m => {
      S.seen.add(m.id);
      showMsg(key, m, { history: m !== firstMsg && m.id !== firstMsg?.id });
    });
  } catch (e) { err(`โหลดประวัติไม่ได้: ${e.message}`); }
  sys(key, `เปิดหน้าต่างคุยส่วนตัวกับ ${nick}`, 'info');
  w.loading = false;
  w.buffer.splice(0).forEach(onIncoming);
  if (firstMsg) {
    play(firstMsg.kind === 'wink' ? 'wink' : 'pm');
    if (!focus) { w.unread = 1; w.hl = true; renderTree(); }
    if (document.hidden) { S.titleUnread++; updateTitleUnread(); }
  }
  if (focus) activate(key);
  return w;
}

async function resolveNick(nick) {
  const clean = (nick || '').replace(/^@/, '');
  const online = S.presence.find(p => p.nick?.toLowerCase() === clean.toLowerCase());
  if (online) return { id: online.id, nick: online.nick };
  const p = await api.findProfileByNick(clean);
  return p ? { id: p.id, nick: p.nick } : null;
}

// ---------------------------------------------------------------- sending
async function sendTo(w, kind, body, target = null) {
  if (!w || w.type === 'status') throw new Error('หน้าต่างนี้พิมพ์คุยไม่ได้ — เข้าห้องก่อน เช่น /join #ห้องรวม');
  if (!body) return;
  if (body.length > MAX_BODY) throw new Error(`ข้อความยาวเกินไป (${body.length}/${MAX_BODY})`);
  if (kind === 'wink' && body === 'bsod') {
    const last = lsGet('pirch.bsodAt', 0);
    if (Date.now() - last < 60000) throw new Error(`จอฟ้าใช้ได้นาทีละครั้ง (รออีก ${Math.ceil((60000 - (Date.now() - last)) / 1000)} วินาที)`);
    lsSet('pirch.bsodAt', Date.now());
  }
  const dest = w.type === 'room' ? { room: w.name } : { to_user: w.peerId };
  S.lastSendAt = performance.now();
  const sentAt = Date.now();
  const m = await api.send({ ...dest, kind, body, target });
  if (m?.created_at) Music.setClockSkew(Date.parse(m.created_at) - (sentAt + Date.now()) / 2);
  if (m) onIncoming(m);   // show right away; realtime echo is de-duplicated
}

const COMMANDS = {
  async join(a) { await joinRoom(a[0] || DEFAULT_ROOM); },
  async j(a) { await COMMANDS.join(a); },
  async part(a) {
    const name = a[0] ? normRoom(a[0]) : activeWin()?.type === 'room' ? activeWin().name : null;
    if (!name) return err('ต้องอยู่ในห้องก่อน หรือใช้ /part #ห้อง');
    leaveRoom(name);
  },
  async leave(a) { await COMMANDS.part(a); },
  async close() { const w = activeWin(); if (w?.type === 'room') leaveRoom(w.name); else if (w?.type === 'pm') closeWindow(w.key); },
  async list() {
    const rooms = await api.listRooms();
    sys('status', `รายชื่อห้องทั้งหมด (${rooms.length} ห้อง) — คลิกชื่อเพื่อเข้า`, 'info');
    for (const r of rooms) {
      const n = usersIn(r.name).length;
      const link = el('a', { href: '#', text: r.name, onclick: e => { e.preventDefault(); joinRoom(r.name); } });
      addLine('status', el('span', {}, '   ', link, ` [${n} คน] `, r.topic ? renderFormatted(r.topic) : ''), 'info');
    }
    activate('status');
  },
  async me(a, raw) { await sendTo(activeWin(), 'action', raw); },
  async msg(a) {
    const [nick, ...rest] = a;
    const text = rest.join(' ');
    if (!nick || !text) return err('ใช้แบบนี้: /msg nick ข้อความ');
    const who = await resolveNick(nick);
    if (!who) return err(`ไม่มีคนชื่อ ${nick}`);
    const w = await openQuery(who.id, who.nick, true);
    await sendTo(w, 'msg', text);
  },
  async query(a) {
    if (!a[0]) return err('ใช้แบบนี้: /query nick');
    const who = await resolveNick(a[0]);
    if (!who) return err(`ไม่มีคนชื่อ ${a[0]}`);
    if (who.id === S.user.id) return err('คุยกับตัวเองเหรอ... เหงาขนาดนั้นเลย? 555');
    await openQuery(who.id, who.nick, true);
  },
  async q(a) { await COMMANDS.query(a); },
  async nick(a) {
    const n = a[0];
    if (!n) return err('ใช้แบบนี้: /nick ชื่อใหม่');
    const old = S.me.nick;
    if (n === old) return;
    try { S.me = await api.saveProfile({ ...S.me, nick: n }); } catch (e) { return err(e.message); }
    info(`ตอนนี้คุณชื่อ ${S.me.nick}`);
    syncPresence(); renderHeader(); renderTasks();
    for (const r of joinedRooms()) api.send({ room: r, kind: 'nick', body: old }).then(onIncoming).catch(() => {});
  },
  async whois(a) {
    if (!a[0]) return err('ใช้แบบนี้: /whois nick');
    const who = await resolveNick(a[0]);
    const p = who && await api.getProfile(who.id);
    if (!p) return err(`ไม่มีคนชื่อ ${a[0]}`);
    const pres = S.byId.get(p.id);
    const k = S.active;
    sys(k, `${p.nick} is ${fakeHost(p.id)}`, 'info');
    if (p.quote) sys(k, `${p.nick} คำคม: ${p.quote}`, 'info');
    sys(k, `${p.nick} อยู่ห้อง: ${pres?.rooms?.length ? pres.rooms.map(r => (isOp(r, p.id) ? '@' : '') + r).join(' ') : '-'}`, 'info');
    sys(k, `${p.nick} สถานะ: ${pres ? (pres.away ? `ไม่อยู่ (${pres.away})` : 'ออนไลน์') : 'ออฟไลน์'}`, 'info');
    sys(k, `${p.nick} เป็นสมาชิกตั้งแต่: ${new Date(p.created_at).toLocaleDateString('th-TH', { dateStyle: 'long' })}`, 'info');
    sys(k, 'End of /WHOIS list.', 'info');
  },
  async slap(a) {
    const w = activeWin();
    const target = a[0] || (w?.type === 'pm' ? w.name : null);
    if (!target) return err('ใช้แบบนี้: /slap nick');
    await sendTo(w, 'slap', pick(SLAP_ITEMS), target.replace(/^@/, ''));
  },
  async wink(a) {
    if (!a[0]) {
      info(`Winks ที่มี: ${WINKS.map(w => `${w.emoji} ${w.id} (${w.name})`).join(', ')}`);
      return;
    }
    const w = WINKS.find(x => x.id === a[0].toLowerCase() || x.name === a[0]);
    if (!w) return err(`ไม่มี Wink ชื่อ ${a[0]} — พิมพ์ /wink เพื่อดูรายชื่อ`);
    if (a[1]) {
      const who = await resolveNick(a[1]);
      if (!who) return err(`ไม่มีคนชื่อ ${a[1]}`);
      const pw = await openQuery(who.id, who.nick, true);
      return sendTo(pw, 'wink', w.id);
    }
    await sendTo(activeWin(), 'wink', w.id);
  },
  async play(a, raw) {
    const w = activeWin();
    if (w?.type !== 'room') return err('เปิดเพลงได้ในห้องแชทเท่านั้น');
    if (!raw) return err('ใช้แบบนี้: /play ลิงก์YouTube  เช่น /play https://youtu.be/xxxxxxxxxxx');
    const id = Music.parseYouTube(raw);
    if (!id) {
      if (/^(https?:\/\/|www\.)/i.test(raw)) return err('ลิงก์นี้ไม่ใช่ลิงก์ YouTube ที่ใช้ได้');
      return sendTo(w, 'msg', `!play ${raw}`);   // ให้ DJ-Bot ค้นให้
    }
    await sendTo(w, 'wink', `music:play:${id}`);
  },
  async stop() {
    const w = activeWin();
    if (w?.type !== 'room') return err('ต้องอยู่ในห้องที่เปิดเพลงอยู่');
    if (!Music.nowPlaying(w.name)) return info('ห้องนี้ไม่ได้เปิดเพลงอยู่');
    await sendTo(w, 'wink', 'music:stop');
  },
  async np() {
    const w = activeWin();
    const t = w?.type === 'room' && Music.nowPlaying(w.name);
    if (!t) return info('ห้องนี้ยังไม่มีเพลง — เปิดได้ด้วย /play ลิงก์YouTube');
    info(`🎵 Now playing: ${Music.titleOf(t.id) || 'youtu.be/' + t.id} (เปิดโดย ${t.by})`);
  },
  async rainbow(a, raw) {
    if (!raw) return err('ใช้แบบนี้: /rainbow ข้อความ');
    await sendTo(activeWin(), 'msg', rainbow(raw));
  },
  async roll() {
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const n = 1 + Math.floor(Math.random() * 6);
    await sendTo(activeWin(), 'roll', `${faces[n - 1]} ${n}`);
  },
  async away(a, raw) {
    S.away = raw || 'ไม่อยู่หน้าจอ';
    syncPresence();
    info(`ตั้งสถานะไม่อยู่: ${S.away}`);
  },
  async back() { S.away = null; syncPresence(); info('ยินดีต้อนรับกลับมา!'); },
  async topic(a, raw) {
    const w = activeWin();
    if (w?.type !== 'room') return err('ต้องอยู่ในห้องก่อน');
    if (!raw) return info(`หัวข้อ: ${stripCodes(w.topic || '(ว่าง)')}`);
    if (!isOp(w.name, S.user.id)) return err('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    await api.setTopic(w.name, raw);
    await sendTo(w, 'topic', raw);
  },
  async op(a) {
    const w = activeWin();
    if (w?.type !== 'room' || !a[0]) return err('ใช้ในห้องแบบนี้: /op nick');
    if (!isOp(w.name, S.user.id)) return err('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    const who = await resolveNick(a[0]);
    if (!who) return err(`ไม่มีคนชื่อ ${a[0]}`);
    await api.addOp(w.name, who.id);
    await sendTo(w, 'op', 'op', who.nick);
  },
  async deop(a) {
    const w = activeWin();
    if (w?.type !== 'room' || !a[0]) return err('ใช้ในห้องแบบนี้: /deop nick');
    if (!isOp(w.name, S.user.id)) return err('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    const who = await resolveNick(a[0]);
    if (!who) return err(`ไม่มีคนชื่อ ${a[0]}`);
    const p = await api.getProfile(who.id);
    if (p?.is_admin) return err(`${who.nick} เป็นแอดมิน ถอด @op ไม่ได้`);
    if (w.createdBy && who.id === w.createdBy && !S.me.is_admin) return err(`${who.nick} เป็นคนสร้างห้องนี้ ถอดได้เฉพาะแอดมิน`);
    await api.removeOp(w.name, who.id);
    await sendTo(w, 'op', 'deop', who.nick);
  },
  async kick(a) {
    const w = activeWin();
    if (w?.type !== 'room' || !a[0]) return err('ใช้ในห้องแบบนี้: /kick nick [เหตุผล]');
    if (!isOp(w.name, S.user.id)) return err('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    const who = await resolveNick(a[0]);
    if (!who) return err(`ไม่มีคนชื่อ ${a[0]}`);
    await sendTo(w, 'kick', a.slice(1).join(' ') || pick(['ไปนอนได้แล้ว', 'เกรียนเกิน', 'ถาม a/s/l', 'พิมพ์รัวเกิน', 'แค่อยากเตะ']), who.nick);
  },
  async delroom(a) {
    const name = a[0] ? normRoom(a[0]) : activeWin()?.type === 'room' ? activeWin().name : null;
    if (!name) return err('ใช้แบบนี้: /delroom #ชื่อห้อง (หรือพิมพ์ในห้องที่จะลบ)');
    if (name === DEFAULT_ROOM) return err(`ห้อง ${DEFAULT_ROOM} เป็นห้องหลัก ลบไม่ได้นะ`);
    const ok = await msgBox('ลบห้อง', `จะลบห้อง ${name} ถาวรเลยนะ?\nข้อความทั้งหมดในห้องจะหายไป และทุกคนในห้องจะถูกพาออก\n\n(ลบได้เฉพาะคนสร้างห้อง หรือแอดมิน)`, '🗑️', { cancel: true });
    if (!ok) return;
    await api.deleteRoom(name);
    sys('status', `ลบห้อง ${name} เรียบร้อยแล้ว`, 'part');
    refreshRoomList();
  },
  async drop(a) { await COMMANDS.delroom(a); },
  async alias(a, raw) {
    const [name, ...rest] = raw.split(/\s+/);
    if (!name) {
      const list = Object.entries(Scripts.aliases);
      if (!list.length) return info('ยังไม่มี alias — ตั้งแบบนี้: /alias brb /away ไปกินข้าว | /me ไปกินข้าวแป๊บ');
      info(`alias ของคุณ (${list.length}):`); list.forEach(([n, b]) => info(`  /${n} → ${b}`));
      return;
    }
    const body = rest.join(' ').trim();
    if (!body) return info(Scripts.aliases[name.replace(/^\//, '').toLowerCase()] ? `/${name} → ${Scripts.aliases[name.replace(/^\//, '').toLowerCase()]}` : `ไม่มี alias ชื่อ ${name}`);
    const n = Scripts.setAlias(name, body, new Set(Object.keys(COMMANDS)));
    info(`ตั้ง alias /${n} แล้ว ✓ (ใช้ $1 $2 ... $* $me $chan ได้, คั่นหลายคำสั่งด้วย " | ")`);
  },
  async unalias(a) {
    if (!a[0]) return err('ใช้แบบนี้: /unalias ชื่อ');
    info(Scripts.delAlias(a[0]) ? `ลบ alias ${a[0]} แล้ว` : `ไม่มี alias ชื่อ ${a[0]}`);
  },
  async on(a, raw) {
    const [ev, ...rest] = raw.split(/\s+/);
    const text = rest.join(' ').trim();
    if (ev?.toLowerCase() !== 'join') {
      info(`script อัตโนมัติ: ทักคนเข้าห้อง = ${Scripts.onJoin ? `"${Scripts.onJoin}"` : 'ปิด'} · ตอบ PM ตอนไม่อยู่ = ${Scripts.autoreply ? 'เปิด' : 'ปิด'}`);
      return info('ตั้งค่า: /on join สวัสดี $nick ยินดีต้อนรับสู่ $chan  ·  ปิด: /on join off  ·  /autoreply on|off');
    }
    if (!text || text === 'off') { Scripts.setOnJoin(null); return info('ปิดการทักคนเข้าห้องแล้ว'); }
    Scripts.setOnJoin(text);
    info(`เปิดทักคนเข้าห้องแล้ว: "${text}" (ทักคนเดิมซ้ำได้ทุก 10 นาที)`);
  },
  async autoreply(a) {
    const v = (a[0] || '').toLowerCase();
    if (v !== 'on' && v !== 'off') return info(`ตอบ PM อัตโนมัติตอน /away: ${Scripts.autoreply ? 'เปิด' : 'ปิด'} — เปลี่ยนด้วย /autoreply on|off`);
    Scripts.setAutoreply(v === 'on');
    info(`ตอบ PM อัตโนมัติ: ${v === 'on' ? 'เปิด' : 'ปิด'}แล้ว`);
  },
  async bots() {
    if (!S.bots.length) return info('เซิร์ฟเวอร์นี้ยังไม่มีบอท');
    info(`บอทในระบบ: ${S.bots.map(b => b.nick).join(', ')} — พิมพ์ !help ในห้องเพื่อดูคำสั่งบอท`);
  },
  async passwd() {
    if (api.mode !== 'lan') return info('เปลี่ยนรหัสผ่านได้เฉพาะโหมด LAN (โหมดนี้ล็อกอินด้วย Google)');
    const oldP = await msgBox('เปลี่ยนรหัสผ่าน', 'รหัสผ่านเดิม:', '🔑', { prompt: true, password: true });
    if (!oldP) return;
    const newP = await msgBox('เปลี่ยนรหัสผ่าน', 'รหัสผ่านใหม่ (อย่างน้อย 6 ตัว):', '🔑', { prompt: true, password: true });
    if (!newP) return;
    await api.changePassword(oldP, newP);
    info('เปลี่ยนรหัสผ่านแล้ว ✓');
  },
  async resetpass(a) {
    if (api.mode !== 'lan') return info('ใช้ได้เฉพาะโหมด LAN');
    if (!a[0]) return err('ใช้แบบนี้: /resetpass nick (แอดมินเท่านั้น)');
    const r = await api.resetPassword(a[0]);
    info(`รีเซ็ตรหัสผ่านของ ${a[0]} แล้ว — รหัสชั่วคราว: ${r.temp}  (บอกเจ้าตัวให้ล็อกอินแล้วเปลี่ยนด้วย /passwd)`);
  },
  async badword(a) {
    if (!S.me?.is_admin && api.mode !== 'demo') return err('คำสั่งนี้ใช้ได้เฉพาะแอดมิน');
    const [sub, ...rest] = a;
    const word = rest.join(' ').trim().toLowerCase();
    if (sub === 'add' && word) { await api.addBadWord(word); return info(`เพิ่มคำ "${word}" ในรายการกรองแล้ว (มีผลกับข้อความใหม่)`); }
    if ((sub === 'del' || sub === 'remove') && word) { await api.delBadWord(word); return info(`ลบคำ "${word}" ออกจากรายการกรองแล้ว`); }
    const list = await api.listBadWords();
    info(`คำที่ถูกกรอง (${list.length}): ${list.join(', ')}`);
    info('เพิ่ม: /badword add คำ  ·  ลบ: /badword del คำ');
  },
  async clear() { const w = activeWin(); if (w) w.log.textContent = ''; },
  async color() { openNickDialog(true); },
  async sound() { toggleSound(); },
  async help() {
    sys('status', 'คำสั่งทั้งหมด:', 'info');
    HELP.forEach(([c, d]) => addLine('status', `   ${c.padEnd(24, ' ')} ${d}`, 'info'));
    activate('status');
  },
  async manual() { openManual(); },
  async quit() { await quit(); },
  async exit() { await quit(); },
};

async function handleInput(text, fromAlias = false) {
  const w = activeWin();
  if (!text.trim()) return;
  if (!fromAlias) S.hist.push(text); if (S.hist.length > 50) S.hist.shift(); S.histIdx = -1;
  try {
    if (text.startsWith('/') && !text.startsWith('//')) {
      const [cmd, ...args] = text.slice(1).split(/\s+/);
      const raw = text.slice(1 + cmd.length).trim();
      const fn = COMMANDS[cmd.toLowerCase()];
      if (!fn) {
        const lines = Scripts.expand(cmd, args.filter(Boolean), { me: S.me?.nick, chan: w?.type === 'room' ? w.name : '' });
        if (!lines) return err(`ไม่รู้จักคำสั่ง /${cmd} — ลอง /help`);
        if ((S.aliasDepth = (S.aliasDepth || 0) + 1) > 5) { S.aliasDepth = 0; return err('alias เรียกซ้อนกันเกิน 5 ชั้น'); }
        try { for (const l of lines) await handleInput(l, true); } finally { S.aliasDepth--; }
        return;
      }
      await fn(args.filter(Boolean), raw);
    } else {
      await sendTo(w, 'msg', text.startsWith('//') ? text.slice(1) : text);
    }
  } catch (e) {
    err(e.message || String(e));
  }
}

// ---------------------------------------------------------------- fx
let lastBsod = 0;
function bsodFx(fromNick) {
  if (Date.now() - lastBsod < 20000) return;
  lastBsod = Date.now();
  const scr = el('div', { class: 'bsod', tabindex: '0' },
    el('div', { class: 'bsod-title', text: ' PIRCH26 ' }),
    el('p', { text: 'เกิดข้อผิดพลาดร้ายแรง 0E : 016F : BFF9B3D4 ในโปรแกรมแชท' }),
    el('p', { text: `สาเหตุ: ผู้ใช้ "${fromNick}" ส่งจอฟ้ามาแกล้งคุณ 😜` }),
    el('p', { text: '*  กดปุ่มใดก็ได้เพื่อกลับไปคุยต่อ\n*  ไม่ต้องกด CTRL+ALT+DEL นะ เครื่องคุณไม่ได้เป็นอะไรเลย 555' }),
    el('p', { class: 'bsod-c', text: 'กดปุ่มใดก็ได้เพื่อดำเนินการต่อ _' }));
  const close = () => { scr.remove(); document.removeEventListener('keydown', close, true); };
  scr.addEventListener('click', close);
  document.addEventListener('keydown', close, true);
  document.body.append(scr);
  setTimeout(close, 5000);
}
function winkFx(id, fromNick) {
  const w = winkById(id);
  if (!w) return;
  if (w.anim === 'bsod') { bsodFx(fromNick); return; }
  const fx = $('#fx');
  const box = el('div', { class: `fx-wink anim-${w.anim}` }, el('div', { class: 'e', text: w.emoji }), el('div', {}, el('span', { class: 'cap', text: `${fromNick}: ${w.name}` })));
  fx.append(box);
  if (w.anim === 'hearts' || w.anim === 'rain') {
    for (let i = 0; i < 16; i++) {
      const d = el('div', { class: w.anim === 'hearts' ? 'fx-rise' : 'fx-drop', text: w.anim === 'hearts' ? pick(['💖', '💕', '💗', '❤️']) : '💧' });
      d.style.left = `${Math.random() * 95}vw`;
      d.style.animationDelay = `${Math.random() * 0.8}s`;
      fx.append(d);
      setTimeout(() => d.remove(), 3400);
    }
  }
  setTimeout(() => box.remove(), 2700);
}
function shakeScreen() {
  const a = $('#app');
  a.classList.remove('shake-screen'); void a.offsetWidth; a.classList.add('shake-screen');
}

// ---------------------------------------------------------------- dialogs & menus
let mbResolve = null;
function msgBox(title, text, icon = 'ℹ️', { prompt = false, value = '', cancel = false, password = false } = {}) {
  $('#mb-input').type = password ? 'password' : 'text';
  $('#mb-title').textContent = title;
  $('#mb-text').textContent = text;
  $('#mb-ico').textContent = icon;
  const inp = $('#mb-input');
  inp.hidden = !prompt; inp.value = value;
  $('#mb-cancel').hidden = !(prompt || cancel);
  $('#modal-bg').hidden = false;
  setTimeout(() => (prompt ? inp.focus() : $('#mb-ok').focus()), 30);
  return new Promise(res => { mbResolve = res; });
}
function mbClose(ok) {
  $('#modal-bg').hidden = true;
  const r = mbResolve; mbResolve = null;
  r?.(ok ? ($('#mb-input').hidden ? true : $('#mb-input').value) : null);
}
$('#mb-ok').addEventListener('click', () => mbClose(true));
$('#mb-cancel').addEventListener('click', () => mbClose(false));
$('#mb-x').addEventListener('click', () => mbClose(false));
$('#mb-input').addEventListener('keydown', e => { if (e.key === 'Enter') mbClose(true); if (e.key === 'Escape') mbClose(false); });

function showMenu(menuEl, x, y, items) {
  hideMenus();
  menuEl.textContent = '';
  for (const it of items) {
    if (it === '-') { menuEl.append(el('li', { class: 'sep' })); continue; }
    const li = el('li', { class: it.disabled ? 'dis' : '' }, el('span', { class: 'mi', text: it.icon || '' }), it.label);
    li.addEventListener('click', e => { e.stopPropagation(); hideMenus(); it.run(); });
    menuEl.append(li);
  }
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(2, Math.min(x, innerWidth - r.width - 4))}px`;
  if (menuEl.id !== 'start-menu') menuEl.style.top = `${Math.max(2, Math.min(y, innerHeight - r.height - 4))}px`;
}
function hideMenus() {
  ['#ctx', '#dropdown', '#start-menu'].forEach(s => { $(s).hidden = true; });
  document.querySelectorAll('.menubar button.open').forEach(b => b.classList.remove('open'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.menu, .menubar, #start-btn')) hideMenus();
  if (!e.target.closest('.popup, [data-act="winks"], [data-act="colors"]')) { $('#winks-pop').hidden = true; $('#color-pop').hidden = true; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideMenus(); $('#winks-pop').hidden = true; $('#color-pop').hidden = true; } });

function nickMenu(x, y, nick, id) {
  if (!nick) return;
  const w = activeWin();
  const room = w?.type === 'room' ? w.name : null;
  const amOp = room && isOp(room, S.user.id);
  const self = id === S.user.id;
  showMenu($('#ctx'), x, y, [
    { icon: '🔍', label: `Whois ${nick}`, run: () => COMMANDS.whois([nick]).catch(e => err(e.message)) },
    { icon: '✉', label: 'คุยส่วนตัว (Query)', disabled: self, run: () => COMMANDS.query([nick]).catch(e => err(e.message)) },
    '-',
    { icon: '🐟', label: 'ตบ (Slap)', run: () => COMMANDS.slap([nick]).catch(e => err(e.message)) },
    { icon: '😉', label: 'ส่ง Wink ส่วนตัว...', disabled: self, run: () => openWinks(nick) },
    ...(room ? ['-',
      { icon: '@', label: 'ให้ @op', disabled: !amOp || isOp(room, id), run: () => COMMANDS.op([nick]).catch(e => err(e.message)) },
      { icon: '⊘', label: 'ถอด @op', disabled: !amOp || !isOp(room, id), run: () => COMMANDS.deop([nick]).catch(e => err(e.message)) },
      { icon: '🦶', label: 'เตะออกจากห้อง', disabled: !amOp || self, run: () => COMMANDS.kick([nick]).catch(e => err(e.message)) },
    ] : []),
  ]);
}

const MENUS = {
  'ไฟล์': () => [
    { icon: '⚙️', label: 'ตั้งค่า Nick / สี...', run: () => openNickDialog(true) },
    { icon: isSoundOn() ? '🔊' : '🔇', label: isSoundOn() ? 'ปิดเสียง' : 'เปิดเสียง', run: toggleSound },
    { icon: '🧹', label: 'ล้างหน้าจอ', run: () => COMMANDS.clear() },
    '-',
    { icon: '🔌', label: 'ออกจากระบบ (Disconnect)', run: quit },
  ],
  'ห้อง': () => [
    { icon: '#', label: 'เข้าห้อง...', run: promptJoin },
    { icon: '📋', label: 'รายชื่อห้องทั้งหมด', run: () => COMMANDS.list() },
    { icon: '📝', label: 'เปลี่ยนหัวข้อ...', disabled: activeWin()?.type !== 'room', run: promptTopic },
    { icon: '🚪', label: 'ปิดหน้าต่างนี้', disabled: activeWin()?.type === 'status', run: () => COMMANDS.close() },
    '-',
    { icon: '🗑️', label: 'ลบห้องนี้...', disabled: activeWin()?.type !== 'room', run: () => COMMANDS.delroom([]).catch(e => err(e.message)) },
  ],
  'Winks': () => WINKS.map(w => ({ icon: w.emoji, label: w.name, run: () => sendTo(activeWin(), 'wink', w.id).catch(e => err(e.message)) })),
  'ช่วยเหลือ': () => [
    { icon: '📖', label: 'คู่มือการใช้งาน', run: () => openManual() },
    { icon: '❓', label: 'คำสั่งทั้งหมด', run: () => COMMANDS.help() },
    { icon: 'ℹ️', label: 'เกี่ยวกับ PIRCH26 Revival', run: about },
  ],
};
function buildMenubar() {
  const bar = $('#menubar');
  bar.textContent = '';
  for (const name of Object.keys(MENUS)) {
    const b = el('button', { type: 'button', text: name });
    b.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = b.classList.contains('open');
      hideMenus();
      if (wasOpen) return;
      const r = b.getBoundingClientRect();
      showMenu($('#dropdown'), r.left, r.bottom, MENUS[name]());
      b.classList.add('open');
    });
    bar.append(b);
  }
}

async function promptJoin() {
  const v = await msgBox('เข้าห้อง (Join Channel)', 'พิมพ์ชื่อห้อง ถ้ายังไม่มีจะสร้างใหม่ให้:', '#️⃣', { prompt: true, value: '#' });
  if (v) joinRoom(v);
}
async function promptTopic() {
  const w = activeWin();
  const v = await msgBox('เปลี่ยนหัวข้อห้อง', `หัวข้อใหม่ของ ${w.name}:`, '📝', { prompt: true, value: stripCodes(w.topic || '') });
  if (v != null) COMMANDS.topic([], v).catch(e => err(e.message));
}
function about() {
  msgBox('เกี่ยวกับ PIRCH26 Revival',
    'PIRCH26 Revival — Fan-made Edition\nห้องแชทย้อนยุคสไตล์โปรแกรม IRC ยุค 90\nทำขึ้นเพื่อความสนุกและคิดถึงวันเก่า ๆ\nไม่เกี่ยวข้องกับผู้พัฒนา PIRCH ต้นฉบับ\n\nBackend: ' + (api.mode === 'demo' ? 'โหมดเดโม่ (ในเครื่อง)' : 'Supabase Realtime') + '\nหน้าตา: 98.css (MIT)', '💬');
}

// winks & colors popups
function positionPopup(pop, anchor) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - pr.width - 4))}px`;
  pop.style.top = `${Math.min(r.bottom + 2, innerHeight - pr.height - 40)}px`;
}
let winkTarget = null;
function openWinks(targetNick = null) {
  winkTarget = targetNick;
  $('#color-pop').hidden = true;
  $('#winks-pop .title-bar-text').textContent = targetNick ? `Winks → ${targetNick}` : 'Winks';
  positionPopup($('#winks-pop'), $('#btn-winks'));
}
function buildWinks() {
  const g = $('#winks-grid');
  for (const w of WINKS) {
    g.append(el('button', {
      type: 'button', title: w.name,
      onclick: () => {
        $('#winks-pop').hidden = true;
        const p = winkTarget ? COMMANDS.wink([w.id, winkTarget]) : sendTo(activeWin(), 'wink', w.id);
        Promise.resolve(p).catch(e => err(e.message));
        winkTarget = null;
      },
    }, el('span', { class: 'e', text: w.emoji }), w.name));
  }
}
function insertAtCursor(txt) {
  const inp = $('#input');
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + txt + inp.value.slice(e);
  inp.selectionStart = inp.selectionEnd = s + txt.length;
  inp.focus();
}
function buildSwatches(container, onPick, selected = null) {
  container.textContent = '';
  PALETTE.forEach((c, i) => {
    container.append(el('button', { type: 'button', title: `${i} ${PALETTE_NAMES[i]}`, class: i === selected ? 'sel' : '', style: `background:${c}`, onclick: () => onPick(i) }));
  });
}

// nick setup dialog
let nickColorSel = 1;
function openNickDialog(editing = false) {
  const d = $('#nick-dlg');
  $('#nick-input').value = S.me?.nick || lsGet('pirch.lastNick', '');
  $('#quote-input').value = S.me?.quote || '';
  nickColorSel = S.me?.color ?? 12;
  $('#nick-cancel').hidden = !editing;
  $('#nick-err').textContent = '';
  const refresh = () => {
    buildSwatches($('#color-grid'), i => { nickColorSel = i; refresh(); }, nickColorSel);
    const pv = $('#nick-preview');
    pv.textContent = '';
    const n = $('#nick-input').value.trim() || 'ชื่อคุณ';
    pv.append('<', el('b', { style: `color:${nickColor(n)}`, text: n }), '> ', el('span', { style: `color:${PALETTE[nickColorSel]}`, text: 'สวัสดีจ้า ยังจำกันได้ไหม~' }));
  };
  $('#nick-input').oninput = refresh;
  refresh();
  d.hidden = false;
  setTimeout(() => $('#nick-input').focus(), 30);
  return new Promise(res => {
    $('#nick-cancel').onclick = () => { d.hidden = true; res(null); };
    const save = async () => {
      const nick = $('#nick-input').value.trim();
      if (!/^[A-Za-z0-9_ก-๛\[\]{}|^-]{2,20}$/.test(nick)) { $('#nick-err').textContent = 'ชื่อ 2–20 ตัว ใช้ ไทย/อังกฤษ/ตัวเลข/_ - [ ] { } | ^ ห้ามเว้นวรรค'; play('error'); return; }
      $('#nick-save').disabled = true;
      const old = S.me?.nick;
      try {
        S.me = await api.saveProfile({ nick, color: nickColorSel, quote: $('#quote-input').value.trim() || null });
        lsSet('pirch.lastNick', nick);
        d.hidden = true;
        if (editing) {
          info(`บันทึกแล้ว: ${S.me.nick}`);
          syncPresence(); renderHeader(); renderTasks();
          if (old && old !== S.me.nick) for (const r of joinedRooms()) api.send({ room: r, kind: 'nick', body: old }).then(onIncoming).catch(() => {});
        }
        res(S.me);
      } catch (e) { $('#nick-err').textContent = e.message; play('error'); }
      finally { $('#nick-save').disabled = false; }
    };
    $('#nick-save').onclick = save;
    $('#nick-input').onkeydown = e => { if (e.key === 'Enter') save(); };
  });
}

function openManual() {
  hideMenus();
  const pre = $('#manual-text');
  if (!pre.textContent) pre.textContent = MANUAL;
  pre.scrollTop = 0;
  $('#manual').hidden = false;
  lsSet('pirch.manualSeen', true);
}

function toggleSound() {
  setSound(!isSoundOn());
  const ico = isSoundOn() ? '🔊' : '🔇';
  $('#btn-sound').textContent = ico; $('#tray-sound').textContent = ico;
  info(isSoundOn() ? 'เปิดเสียงแล้ว' : 'ปิดเสียงแล้ว');
}
function toggleMinimize() {
  if (!S.me) return;
  $('#app').hidden = !$('#app').hidden;
  renderTasks();
}

async function quit() {
  const ok = await msgBox('Disconnect', 'จะออกจากระบบจริงเหรอ? (แม่จะได้ใช้โทรศัพท์ซะที)', '❓', { cancel: true });
  if (!ok) return;
  await api.signOut();
  location.reload();
}

// ---------------------------------------------------------------- input box
function wireInput() {
  const inp = $('#input');
  $('#input-form').addEventListener('submit', e => {
    e.preventDefault();
    const v = inp.value;
    inp.value = '';
    handleInput(v);
  });
  inp.addEventListener('keydown', e => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const map = { b: B, u: U, k: K };
      if (map[e.key.toLowerCase()]) { e.preventDefault(); insertAtCursor(map[e.key.toLowerCase()]); return; }
    }
    if (e.key === 'ArrowUp' && S.hist.length) {
      e.preventDefault();
      S.histIdx = S.histIdx < 0 ? S.hist.length - 1 : Math.max(0, S.histIdx - 1);
      inp.value = S.hist[S.histIdx];
    } else if (e.key === 'ArrowDown' && S.histIdx >= 0) {
      e.preventDefault();
      S.histIdx++;
      if (S.histIdx >= S.hist.length) { S.histIdx = -1; inp.value = ''; } else inp.value = S.hist[S.histIdx];
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const w = activeWin();
      const pool = (w?.type === 'room' ? usersIn(w.name) : S.presence).map(p => p.nick).filter(Boolean);
      if (!S.tab) {
        const m = /(\S+)$/.exec(inp.value.slice(0, inp.selectionStart));
        if (!m) return;
        const matches = pool.filter(n => n.toLowerCase().startsWith(m[1].toLowerCase()));
        if (!matches.length) return;
        S.tab = { start: m.index, matches, i: 0, atStart: m.index === 0 };
      } else S.tab.i = (S.tab.i + 1) % S.tab.matches.length;
      const n = S.tab.matches[S.tab.i] + (S.tab.atStart ? ': ' : ' ');
      inp.value = inp.value.slice(0, S.tab.start) + n;
    }
    if (e.key !== 'Tab') S.tab = null;
  });
}

// ---------------------------------------------------------------- toolbar / global actions
const ACTIONS = {
  join: promptJoin,
  list: () => COMMANDS.list().catch(e => err(e.message)),
  part: () => COMMANDS.close(),
  winks: () => ($('#winks-pop').hidden ? openWinks() : ($('#winks-pop').hidden = true)),
  colors: () => {
    $('#winks-pop').hidden = true;
    if (!$('#color-pop').hidden) { $('#color-pop').hidden = true; return; }
    buildSwatches($('#color-pop-grid'), i => { insertAtCursor(K + String(i).padStart(2, '0')); $('#color-pop').hidden = true; });
    positionPopup($('#color-pop'), $('#btn-colors'));
  },
  bold: () => insertAtCursor(B),
  underline: () => insertAtCursor(U),
  sound: toggleSound,
  music: async () => {
    if (activeWin()?.type !== 'room') return err('เข้าห้องก่อน แล้วค่อยเปิดเพลงนะ');
    const v = await msgBox('PIRCH Jukebox 🎵', 'วางลิงก์ YouTube ที่จะเปิดให้ทั้งห้องฟัง:', '🎵', { prompt: true, value: '' });
    if (v) COMMANDS.play([], v).catch(e => err(e.message));
  },
  nicks: () => document.body.classList.toggle('show-nicks'),
  settings: () => openNickDialog(true),
  help: () => openManual(),
  helpBox: () => (S.me ? COMMANDS.help() : msgBox('อ่านก่อน.txt', 'PIRCH26 Revival\n\n1) กด Connect แล้วล็อกอินด้วย Google\n2) ตั้งชื่อเล่น (nick) และสีตัวอักษร\n3) เข้าห้อง #ห้องรวม แล้วคุยได้เลย!\n\nดับเบิลคลิกชื่อเพื่อน = คุยส่วนตัว\nคลิกขวาชื่อเพื่อน = ตบ / Wink / Whois\nพิมพ์ /help ดูคำสั่งทั้งหมด', '📄')),
  about,
  open: () => { if (S.me) { $('#app').hidden = false; renderTasks(); } else $('#login-dlg').hidden = false; },
  minimize: toggleMinimize,
  quit,
  noop: () => {},
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && ACTIONS[b.dataset.act]) { e.stopPropagation(); ACTIONS[b.dataset.act](); }
  const c = e.target.closest('[data-close]');
  if (c) $(`#${c.dataset.close}`).hidden = true;
});
$('#btn-rainbow').addEventListener('click', () => {
  const inp = $('#input');
  const t = stripCodes(inp.value);
  $('#color-pop').hidden = true;
  if (t.trim()) { inp.value = rainbow(t); inp.focus(); }
  else info('พิมพ์ข้อความก่อน แล้วค่อยกดสีรุ้ง');
});
$('#tray-sound').addEventListener('click', toggleSound);
$('#start-btn').addEventListener('click', e => {
  e.stopPropagation();
  const sm = $('#start-menu');
  if (!sm.hidden) return hideMenus();
  showMenu(sm, 2, 0, [
    { icon: '💬', label: 'PIRCH26 Revival', run: ACTIONS.open },
    { icon: '📄', label: 'อ่านก่อน.txt (คู่มือ)', run: openManual },
    { icon: '🖥️', label: 'เกี่ยวกับ...', run: about },
    '-',
    { icon: '🔌', label: S.me ? 'Log Off ' + S.me.nick + '...' : 'Shut Down...', run: () => (S.me ? quit() : msgBox('Shut Down', 'ตอนนี้ปลอดภัยที่จะปิดเครื่องแล้ว\n(จริง ๆ แค่ปิดแท็บก็ได้ 555)', '🌙')) },
  ]);
});
setInterval(() => { const d = new Date(); $('#clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }, 1000);

// ---------------------------------------------------------------- boot
async function connect() {
  $('#login-dlg').hidden = true;
  if (!S.me) S.me = await api.getMyProfile();
  if (!S.me) S.me = await openNickDialog(false);
  if (!S.me) return;
  $('#app').hidden = false;
  createWindow('status', 'Status');
  activate('status');
  MOTD.forEach(l => addLine('status', l, 'motd'));
  addLine('status', '- 📖 ลืมวิธีใช้? กดปุ่ม ❓ หรือพิมพ์ /manual เพื่อเปิดคู่มือ', 'motd');
  sys('status', `Connecting to ${SERVER} (6667)...`);
  if (api.mode === 'demo') sys('status', 'โหมดเดโม่: ยังไม่ได้ใส่ค่า Supabase ใน config.js — คุยกับบอทในเครื่องไปก่อนนะ', 'err');
  if (api.mode === 'lan') sys('status', 'โหมด LAN: ข้อมูลแชทเก็บอยู่ในเซิร์ฟเวอร์ของออฟฟิศเท่านั้น', 'info');

  api.subscribe({
    onMessage: onIncoming,
    onRoomCreated: () => refreshRoomList(),
    onRoomDeleted: name => {
      S.allRooms = S.allRooms.filter(r => r.name !== name); renderTree();
      if (roomWin(name)) {
        leaveRoom(name, { silent: true });
        sys('status', `ห้อง ${name} ถูกลบไปแล้ว`, 'part');
        play('part');
      }
    },
    onStatus: s => {
      const ok = s === 'SUBSCRIBED';
      $('#st-conn').textContent = ok ? `เชื่อมต่อ ${SERVER} แล้ว` : `สถานะ: ${s}`;
      if (ok && !S.connected) sys('status', `เชื่อมต่อแล้ว! ยินดีต้อนรับ ${S.me.nick} 🎉`, 'join');
      if (!ok && S.connected) sys('status', `การเชื่อมต่อมีปัญหา (${s}) กำลังลองใหม่...`, 'err');
      S.connected = ok;
    },
  });
  Music.initJukebox({
    onStop: room => { const w = roomWin(room); if (w) sendTo(w, 'wink', 'music:stop').catch(e => err(e.message)); },
    onTitle: (id, title) => document.querySelectorAll(`a.yt-link[data-yt="${id}"]`).forEach(a => { a.textContent = title; }),
    onError: msg => info(`🎵 ${msg}`, 'err'),
  });
  api.joinPresence(myPresence(), onPresence);
  renderTasks();
  try { S.bots = (await api.listBots?.()) || []; } catch { S.bots = []; }
  if (S.bots.length) sys('status', `🤖 บอทพร้อมรับใช้: ${S.bots.map(b => b.nick).join(', ')} — พิมพ์ !help ในห้อง`, 'info');

  if (!lsGet('pirch.manualSeen', false)) setTimeout(openManual, 800);
  refreshRoomList();
  setInterval(refreshRoomList, 60000);
  const rooms = lsGet('pirch.rooms', []);
  const toJoin = rooms.length ? rooms : [DEFAULT_ROOM];
  for (let i = 0; i < toJoin.length; i++) await joinRoom(toJoin[i], { focus: i === 0, quiet: i > 0 });
}

async function boot() {
  buildMenubar(); buildWinks(); wireInput();
  const ico = isSoundOn() ? '🔊' : '🔇';
  $('#btn-sound').textContent = ico; $('#tray-sound').textContent = ico;
  $('#login-server').value = SERVER;
  $('#login-note').textContent = api.mode === 'demo'
    ? '⚠️ โหมดเดโม่: ยังไม่ได้ตั้งค่า Supabase — กด Connect เพื่อลองเล่นกับบอทได้เลย'
    : api.mode === 'lan' ? 'ใส่ชื่อเล่นกับรหัสผ่าน แล้วกด Connect — ยังไม่มีบัญชีกด "สมัครใหม่" (คนแรกที่สมัครจะเป็นแอดมิน)'
    : 'กด Connect แล้วล็อกอินด้วยบัญชี Google (ไม่ต้องติดตั้งอะไร)';
  let register = false;
  if (api.mode === 'lan') {
    const row = (label, input) => el('div', { class: 'field-row' }, el('label', { style: 'width:70px', text: label }), input);
    const fs = el('fieldset', {}, el('legend', { text: 'บัญชีผู้ใช้' }),
      row('Nick:', el('input', { type: 'text', id: 'lan-user', maxlength: '20', autocomplete: 'username', value: lsGet('pirch.lastNick', '') })),
      row('รหัสผ่าน:', el('input', { type: 'password', id: 'lan-pass', autocomplete: 'current-password' })));
    $('#login-note').before(fs);
    const regBtn = el('button', { id: 'btn-register', type: 'button', text: 'สมัครใหม่' });
    $('#btn-login').before(regBtn);
    regBtn.addEventListener('click', () => { register = true; $('#btn-login').click(); });
    $('#lan-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-login').click(); });
  }

  let user = null;
  try { user = await api.init(); } catch (e) { $('#login-note').textContent = `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ${e.message}`; }
  if (user) { S.user = user; await connect(); return; }

  $('#login-dlg').hidden = false;
  $('#btn-login').addEventListener('click', async () => {
    $('#btn-login').disabled = true;
    $('#login-progress').hidden = false;
    play('modem');
    const steps = ['กำลังหมุนโทรศัพท์... ☎️', 'ปี๊ดดด ก๊าาา ซ่าาา~ 📠', 'กำลังยืนยันตัวตน...'];
    steps.forEach((s, i) => setTimeout(() => { $('#login-progress-text').textContent = s; }, i * 1000));
    await new Promise(r => setTimeout(r, api.mode === 'demo' ? 3000 : api.mode === 'lan' ? 1200 : 2200));
    try {
      const u = api.mode === 'lan'
        ? await api.signIn({ username: $('#lan-user').value.trim(), password: $('#lan-pass').value, register })
        : await api.signIn();
      if (api.mode === 'lan') lsSet('pirch.lastNick', $('#lan-user').value.trim());
      if (u) { S.user = u; await connect(); }
    } catch (e) {
      $('#login-note').textContent = `ล็อกอินไม่สำเร็จ: ${e.message}`;
      register = false;
      $('#btn-login').disabled = false;
      $('#login-progress').hidden = true;
    }
  });
}

boot();
