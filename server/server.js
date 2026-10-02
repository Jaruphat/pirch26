// =====================================================================
//  PIRCH26 — LAN server (no Supabase, no internet needed)
//  Node.js >= 22.13, zero npm dependencies (node:sqlite + Server-Sent Events)
//
//  node server/server.js            → http://<this-machine-ip>:8080
//  env: PORT=8080  DATA_DIR=./data  SERVER_NAME=irc.office.lan
//       YOUTUBE_API_KEY=...  (optional: lets DJ-Bot search YouTube when the LAN has internet)
// =====================================================================
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOTS, BOT_IDS, handleEvent, searchResult, parseYouTubeSearch } from '../public/js/bots-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = +(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const SERVER_NAME = process.env.SERVER_NAME || 'irc.pirch26.lan';
const DEFAULT_ROOM = '#ห้องรวม';
const YT_KEY = process.env.YOUTUBE_API_KEY || '';

const NICK_RE = /^[A-Za-z0-9_ก-๛\[\]{}|^-]{2,20}$/;
const ROOM_RE = /^#[A-Za-z0-9_ก-๛-]{1,30}$/;
const KINDS = new Set(['msg', 'action', 'wink', 'slap', 'roll', 'kick', 'topic', 'nick', 'op']);
const DEFAULT_BAD = ['เหี้ย', 'เหี่ย', 'สัส', 'ควย', 'เย็ด', 'แตด', 'จัญไร', 'ระยำ', 'ชิบหาย', 'ส้นตีน', 'ตีนตบ', 'อีดอก', 'อีสัตว์', 'ไอ้สัตว์', 'ไอ้เวร', 'อีเวร', 'ไอ้ห่า', 'อีห่า', 'กะหรี่', 'ร่าน', 'เงี่ยน', 'หน้าหี', 'อีหี', 'หีแม่', 'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'bastard'];

// ---------------------------------------------------------------- database
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'pirch26.db'));
db.exec(`
  pragma journal_mode = wal;
  pragma foreign_keys = on;
  create table if not exists users (id text primary key, username text not null unique collate nocase, pass text not null, created_at text not null);
  create table if not exists profiles (id text primary key, nick text not null unique collate nocase, color integer not null default 1,
    quote text, is_admin integer not null default 0, is_bot integer not null default 0, created_at text not null);
  create table if not exists sessions (token_hash text primary key, user_id text not null references users(id) on delete cascade, created_at text not null);
  create table if not exists rooms (name text primary key, topic text not null default '', created_by text, created_at text not null);
  create table if not exists room_ops (room text not null references rooms(name) on delete cascade, user_id text not null, primary key (room, user_id));
  create table if not exists messages (id integer primary key autoincrement, room text references rooms(name) on delete cascade, to_user text,
    sender text not null, nick text not null, color integer not null, kind text not null, body text not null, target text, created_at text not null);
  create index if not exists messages_room on messages(room, id);
  create index if not exists messages_pm on messages(to_user, sender, id);
  create table if not exists bad_words (word text primary key);
  create table if not exists kv (key text primary key, value text not null);
`);
const now = () => new Date().toISOString();
const q = (sql) => db.prepare(sql);
const one = (sql, ...a) => q(sql).get(...a);
const all = (sql, ...a) => q(sql).all(...a);
const run = (sql, ...a) => q(sql).run(...a);

if (!one('select 1 from rooms limit 1')) {
  for (const [name, topic] of [[DEFAULT_ROOM, 'ยินดีต้อนรับสู่ PIRCH26 (LAN) ~ คุยกันในออฟฟิศ ^_^'], ['#เพลงรัก', 'เปิดเพลงฟังด้วยกัน !play ชื่อเพลง'], ['#เม้าท์มอย', 'พักเบรกคุยเล่น']]) {
    run('insert into rooms (name, topic, created_by, created_at) values (?, ?, null, ?)', name, topic, now());
  }
}
if (!one('select 1 from bad_words limit 1')) for (const w of DEFAULT_BAD) run('insert or ignore into bad_words values (?)', w);
for (const b of Object.values(BOTS)) {
  run(`insert into profiles (id, nick, color, quote, is_bot, created_at) values (?, ?, ?, ?, 1, ?)
       on conflict(id) do update set is_bot = 1, quote = excluded.quote`, b.id, b.nick, b.color, b.quote, now());
}

// ---------------------------------------------------------------- helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };

function hashPass(pw) { const salt = randomBytes(16); return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`; }
function checkPass(pw, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const sha = t => createHash('sha256').update(t).digest('hex');

let badCache = null;
const esc = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP_TH = '(?:[\\s._*~+=/\\\\|-]|\\x02|\\x0f|\\x16|\\x1d|\\x1f|\\x03[0-9]{0,2}(?:,[0-9]{1,2})?)*';
const SEP_EN = '(?:[._*~+=/\\\\|-]|\\x02|\\x0f|\\x16|\\x1d|\\x1f|\\x03[0-9]{0,2}(?:,[0-9]{1,2})?)*';
function badRegexes() {
  badCache ??= all('select word from bad_words').map(({ word }) => new RegExp([...word.toLowerCase()].map(esc).join(/^[a-z]+$/i.test(word) ? SEP_EN : SEP_TH), 'gi'));
  return badCache;
}
const clean = t => (t == null ? t : badRegexes().reduce((s, re) => s.replace(re, '***'), String(t)));
const hasBad = t => t != null && clean(t) !== t;

const profile = id => one('select id, nick, color, quote, is_admin, is_bot, created_at from profiles where id = ?', id);
const toProfile = p => p && { ...p, is_admin: !!p.is_admin, is_bot: !!p.is_bot };
const isAdmin = id => !!one('select 1 from profiles where id = ? and is_admin = 1', id);
const isOp = (room, id) => isAdmin(id) || !!one('select 1 from room_ops where room = ? and user_id = ?', room, id);
const msgRow = r => r && { ...r, to_user: r.to_user ?? null, room: r.room ?? null, target: r.target ?? null };

// ---------------------------------------------------------------- realtime (SSE)
const conns = new Map(); // connId -> { res, userId, state }
function emit(conn, ev) { try { conn.res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* closed */ } }
function broadcast(ev, filter = () => true) { for (const c of conns.values()) if (filter(c)) emit(c, ev); }
let presTimer = null;
function presenceChanged() {
  clearTimeout(presTimer);
  presTimer = setTimeout(() => {
    const byUser = new Map();
    for (const c of conns.values()) {
      if (!c.state) continue;
      const cur = byUser.get(c.userId) || { id: c.userId, nick: c.state.nick, color: c.state.color, away: null, rooms: new Set() };
      (c.state.rooms || []).forEach(r => cur.rooms.add(r));
      cur.nick = c.state.nick; cur.color = c.state.color; cur.away = c.state.away || cur.away;
      byUser.set(c.userId, cur);
    }
    const list = [...byUser.values()].map(p => ({ ...p, rooms: [...p.rooms] }));
    broadcast({ t: 'presence', list });
  }, 80);
}
setInterval(() => { for (const c of conns.values()) { try { c.res.write(': ping\n\n'); } catch { /* ignore */ } } }, 25000);

function deliver(m) {
  if (m.room) broadcast({ t: 'msg', m });
  else broadcast({ t: 'msg', m }, c => c.userId === m.sender || c.userId === m.to_user);
}

// ---------------------------------------------------------------- messages + bots
const recent = new Map(); // userId -> [timestamps]
function insertMessage(p, { room = null, to_user = null, kind = 'msg', body, target = null }) {
  const info = run(`insert into messages (room, to_user, sender, nick, color, kind, body, target, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    room, to_user, p.id, p.nick, p.color, kind, body, target, now());
  const m = msgRow(one('select * from messages where id = ?', info.lastInsertRowid));
  deliver(m);
  return m;
}

function botState() { try { return JSON.parse(one("select value from kv where key = 'bots'")?.value || '{}'); } catch { return {}; } }
function saveBotState(s) { run("insert into kv values ('bots', ?) on conflict(key) do update set value = excluded.value", JSON.stringify(s)); }
function botSay(replies) {
  for (const r of replies) {
    if (r.room && !one('select 1 from rooms where name = ?', r.room)) continue;
    insertMessage(profile(BOTS[r.bot].id), { room: r.room, kind: r.kind, body: r.body, target: r.target });
  }
}
async function runBots(evt) {
  const state = botState();
  const res = handleEvent(evt, state, { youtube: !!YT_KEY });
  botSay(res.replies);
  saveBotState(state);
  if (res.search) {
    let result;
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/search');
      Object.entries({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '1', regionCode: 'TH', q: res.search.query, key: YT_KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u, { signal: AbortSignal.timeout(7000) });
      result = parseYouTubeSearch(await r.json());
    } catch (e) { result = { error: e.name === 'TimeoutError' ? 'ติดต่อ YouTube ไม่ได้ (LAN อาจไม่มีอินเทอร์เน็ต)' : e.message }; }
    const s2 = botState();
    botSay(searchResult(res.search, result, s2));
    saveBotState(s2);
  }
}

// ---------------------------------------------------------------- API (called as POST /api/rpc {fn, args})
const loginTries = new Map();
function newSession(userId) {
  const token = randomBytes(32).toString('hex');
  run('insert into sessions values (?, ?, ?)', sha(token), userId, now());
  return token;
}
const PUBLIC_FNS = new Set(['register', 'login']);
const API = {
  register(ctx, { username, password }) {
    username = String(username || '').trim();
    if (!NICK_RE.test(username)) fail('ชื่อ 2–20 ตัว ใช้ ไทย/อังกฤษ/ตัวเลข/_ - [ ] { } | ^ ห้ามเว้นวรรค');
    if (hasBad(username)) fail('ชื่อนี้มีคำไม่สุภาพ ลองชื่ออื่นนะ');
    if (String(password || '').length < 6) fail('รหัสผ่านต้องยาวอย่างน้อย 6 ตัว');
    if (one('select 1 from users where username = ?', username) || one('select 1 from profiles where nick = ?', username)) fail('ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ');
    const id = randomUUID();
    const first = !one('select 1 from users limit 1');
    run('insert into users values (?, ?, ?, ?)', id, username, hashPass(password), now());
    run('insert into profiles (id, nick, color, quote, is_admin, created_at) values (?, ?, 12, null, ?, ?)', id, username, first ? 1 : 0, now());
    ctx.setCookie(newSession(id));
    setImmediate(() => runBots({ type: 'new_user', nick: username }).catch(() => {}));
    return { id, first_admin: first };
  },
  login(ctx, { username, password }) {
    const ip = ctx.ip, t = Date.now();
    const tries = (loginTries.get(ip) || []).filter(x => t - x < 60000);
    if (tries.length >= 10) fail('ลองผิดบ่อยเกินไป รอ 1 นาทีนะ', 429);
    const u = one('select u.* from users u left join profiles p on p.id = u.id where u.username = ? or p.nick = ?', String(username || ''), String(username || ''));
    if (!u || !checkPass(String(password || ''), u.pass)) { tries.push(t); loginTries.set(ip, tries); fail('ชื่อหรือรหัสผ่านไม่ถูกต้อง', 401); }
    ctx.setCookie(newSession(u.id));
    return { id: u.id };
  },
  logout(ctx) { run('delete from sessions where token_hash = ?', ctx.tokenHash); ctx.setCookie(''); return true; },
  me(ctx) { return { id: ctx.uid }; },
  changePassword(ctx, { oldPassword, newPassword }) {
    const u = one('select * from users where id = ?', ctx.uid);
    if (!checkPass(String(oldPassword || ''), u.pass)) fail('รหัสผ่านเดิมไม่ถูกต้อง');
    if (String(newPassword || '').length < 6) fail('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัว');
    run('update users set pass = ? where id = ?', hashPass(newPassword), ctx.uid);
    return true;
  },
  resetPassword(ctx, { nick }) {
    if (!isAdmin(ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะแอดมิน');
    const p = one('select id from profiles where nick = ? and is_bot = 0', String(nick || ''));
    if (!p || !one('select 1 from users where id = ?', p.id)) fail(`ไม่มีคนชื่อ ${nick}`);
    const temp = randomBytes(6).toString('base64url');
    run('update users set pass = ? where id = ?', hashPass(temp), p.id);
    run('delete from sessions where user_id = ?', p.id);
    return { temp };
  },
  getMyProfile(ctx) { return toProfile(profile(ctx.uid)); },
  getProfile(ctx, { id }) { return toProfile(profile(id)); },
  findProfileByNick(ctx, { nick }) { return toProfile(one('select id, nick, color, quote, is_admin, is_bot, created_at from profiles where nick = ?', String(nick || ''))); },
  listBots() { return all('select id, nick, color, quote, created_at from profiles where is_bot = 1').map(p => ({ ...p, is_bot: true })); },
  saveProfile(ctx, { nick, color, quote }) {
    nick = String(nick || '').trim();
    if (!NICK_RE.test(nick)) fail('รูปแบบไม่ถูกต้อง (ชื่อ 2-20 ตัว ห้ามเว้นวรรค)');
    if (hasBad(nick)) fail('ชื่อนี้มีคำไม่สุภาพ ลองชื่ออื่นนะ');
    if (one('select 1 from profiles where nick = ? and id <> ?', nick, ctx.uid)) fail('ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ');
    color = Math.max(0, Math.min(15, +color || 0));
    run('update profiles set nick = ?, color = ?, quote = ? where id = ?', nick, color, quote ? clean(String(quote).slice(0, 120)) : null, ctx.uid);
    return toProfile(profile(ctx.uid));
  },
  listRooms() { return all('select name, topic, created_at from rooms order by name'); },
  ensureRoom(ctx, { name }) {
    if (!ROOM_RE.test(String(name || ''))) fail('ชื่อห้องไม่ถูกต้อง');
    let r = one('select * from rooms where name = ?', name);
    if (r) return r;
    if (hasBad(name)) fail('ชื่อห้องมีคำไม่สุภาพ ลองชื่ออื่นนะ');
    run('insert into rooms (name, topic, created_by, created_at) values (?, ?, ?, ?)', name, '', ctx.uid, now());
    run('insert or ignore into room_ops values (?, ?)', name, ctx.uid);
    broadcast({ t: 'room_created', name });
    return one('select * from rooms where name = ?', name);
  },
  setTopic(ctx, { room, topic }) {
    if (!isOp(room, ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    run('update rooms set topic = ? where name = ?', clean(String(topic || '').slice(0, 200)), room);
    return true;
  },
  getOps(ctx, { room }) {
    return [...all('select user_id from room_ops where room = ?', room).map(r => r.user_id), ...all('select id from profiles where is_admin = 1').map(r => r.id)];
  },
  addOp(ctx, { room, userId }) {
    if (!isOp(room, ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    run('insert or ignore into room_ops values (?, ?)', room, userId);
    return true;
  },
  removeOp(ctx, { room, userId }) {
    if (!isOp(room, ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    if (!run('delete from room_ops where room = ? and user_id = ?', room, userId).changes) fail('คนนี้ไม่ได้เป็น @op ของห้องนี้');
    return true;
  },
  deleteRoom(ctx, { name }) {
    const r = one('select * from rooms where name = ?', name);
    if (!r) fail('ไม่มีห้องนี้');
    if (name === DEFAULT_ROOM) fail('ห้องหลักลบไม่ได้');
    if (r.created_by !== ctx.uid && !isAdmin(ctx.uid)) fail('ลบได้เฉพาะคนที่สร้างห้องนี้ หรือแอดมินเท่านั้น');
    run('delete from rooms where name = ?', name);
    broadcast({ t: 'room_deleted', name });
    return true;
  },
  history(ctx, { room, limit = 60 }) {
    return all('select * from messages where room = ? order by id desc limit ?', room, Math.min(200, +limit || 60)).reverse().map(msgRow);
  },
  pmHistory(ctx, { otherId, limit = 60 }) {
    return all(`select * from messages where room is null and ((sender = ? and to_user = ?) or (sender = ? and to_user = ?)) order by id desc limit ?`,
      ctx.uid, otherId, otherId, ctx.uid, Math.min(200, +limit || 60)).reverse().map(msgRow);
  },
  send(ctx, { room = null, to_user = null, kind = 'msg', body, target = null }) {
    const p = profile(ctx.uid);
    if (!p) fail('ต้องตั้ง nick ก่อนนะ');
    if (!KINDS.has(kind)) fail('ชนิดข้อความไม่ถูกต้อง');
    body = String(body ?? '');
    if (body.length < 1 || body.length > 600) fail('ข้อความว่างหรือยาวเกินไป');
    if (!room === !to_user) fail('ต้องระบุห้องหรือผู้รับอย่างใดอย่างหนึ่ง');
    if (room && !one('select 1 from rooms where name = ?', room)) fail('ไม่มีห้องนี้');
    if (to_user && !profile(to_user)) fail('ไม่มีผู้รับคนนี้');
    const t = Date.now();
    const rec = (recent.get(ctx.uid) || []).filter(x => t - x < 10000);
    if (rec.length >= 8) fail('ใจเย็น ๆ พิมพ์รัวเกินไปแล้ว (Excess Flood!)');
    rec.push(t); recent.set(ctx.uid, rec);
    if (['kick', 'topic', 'op'].includes(kind) && (!room || !isOp(room, ctx.uid))) fail('คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง');
    if (['msg', 'action', 'topic', 'kick'].includes(kind)) body = clean(body);
    const m = insertMessage(p, { room, to_user, kind, body, target: target == null ? null : String(target).slice(0, 40) });
    if (room && kind === 'msg' && body.startsWith('!') && !BOT_IDS.includes(p.id)) {
      setImmediate(() => runBots({ type: 'message', room, sender: p.id, nick: p.nick, kind, body }).catch(e => console.error('bot error', e)));
    }
    return m;
  },
  presence(ctx, { conn, state }) {
    const c = conns.get(conn);
    if (!c || c.userId !== ctx.uid) fail('connection not found', 409);
    const p = profile(ctx.uid);
    c.state = { nick: p.nick, color: p.color, rooms: (state?.rooms || []).filter(r => typeof r === 'string').slice(0, 50), away: state?.away ? String(state.away).slice(0, 80) : null };
    presenceChanged();
    return true;
  },
  listBadWords(ctx) { if (!isAdmin(ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะแอดมิน'); return all('select word from bad_words order by word').map(r => r.word); },
  addBadWord(ctx, { word }) {
    if (!isAdmin(ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะแอดมิน');
    word = String(word || '').trim().toLowerCase();
    if (word.length < 2 || word.length > 40) fail('คำต้องยาว 2–40 ตัว');
    if (!run('insert or ignore into bad_words values (?)', word).changes) fail('มีคำนี้อยู่แล้ว');
    badCache = null; return true;
  },
  delBadWord(ctx, { word }) {
    if (!isAdmin(ctx.uid)) fail('คำสั่งนี้ใช้ได้เฉพาะแอดมิน');
    if (!run('delete from bad_words where word = ?', String(word || '').trim().toLowerCase()).changes) fail('ไม่มีคำนี้ในรายการ');
    badCache = null; return true;
  },
};

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; media-src https:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'",
};
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
function auth(req) {
  const tok = cookies(req).pirch_sid;
  if (!tok) return null;
  const s = one('select user_id from sessions where token_hash = ?', sha(tok));
  return s ? { uid: s.user_id, tokenHash: sha(tok) } : null;
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 65536) fail('request too large', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail('bad json'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/config.js') {
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
      return res.end(`window.PIRCH_CONFIG = ${JSON.stringify({ BACKEND: 'lan', SERVER_NAME, DEFAULT_ROOM, YOUTUBE_SEARCH: !!YT_KEY })};\n`);
    }
    if (url.pathname === '/api/rpc' && req.method === 'POST') {
      if (req.headers['x-pirch'] !== '1') fail('missing header', 403);
      const { fn, args } = await readJson(req);
      if (!Object.hasOwn(API, fn)) fail('unknown function', 404);
      const a = auth(req);
      if (!a && !PUBLIC_FNS.has(fn)) fail('ต้องล็อกอินก่อน', 401);
      let cookie = null;
      const ctx = { ...(a || {}), ip: req.socket.remoteAddress, setCookie: v => { cookie = v; } };
      const data = API[fn](ctx, args || {});
      const headers = {};
      if (cookie !== null) headers['Set-Cookie'] = `pirch_sid=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookie ? 60 * 60 * 24 * 90 : 0}`;
      return send(res, 200, { data: data ?? null }, headers);
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const a = auth(req);
      if (!a) fail('ต้องล็อกอินก่อน', 401);
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const id = randomUUID();
      const conn = { res, userId: a.uid, state: null };
      conns.set(id, conn);
      emit(conn, { t: 'hello', conn: id });
      req.on('close', () => { conns.delete(id); presenceChanged(); });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') fail('not found', 404);
    // static files
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(PUBLIC + path.sep)) fail('not found', 404);
    let st; try { st = await stat(file); } catch { fail('not found', 404); }
    if (!st.isFile()) fail('not found', 404);
    const cache = rel.startsWith('/vendor/') ? 'public, max-age=2592000, immutable' : 'no-cache';
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'server error' : e.message });
  }
});
server.listen(PORT, () => {
  console.log(`PIRCH26 LAN server → http://localhost:${PORT}  (data: ${DATA_DIR})`);
  console.log(`DJ-Bot YouTube search: ${YT_KEY ? 'on' : 'off (set YOUTUBE_API_KEY to enable)'}`);
});
