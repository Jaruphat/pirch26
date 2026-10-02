// ===== Personal scripts (แบบ mIRC remote/aliases) — ทำงานเฉพาะในเบราว์เซอร์ของเราเอง =====
// ปลอดภัยโดยออกแบบ: script เป็นแค่ "ข้อความ/คำสั่งที่เราพิมพ์เองได้อยู่แล้ว" ไม่มีโค้ดใดไปรันบนเครื่องคนอื่น
const KEY = 'pirch.scripts';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const st = Object.assign({ aliases: {}, onJoin: null, autoreply: true }, load());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } };

const NAME_RE = /^[a-z0-9ก-๛_]{1,20}$/i;
export const scripts = {
  get aliases() { return st.aliases; },
  get onJoin() { return st.onJoin; },
  get autoreply() { return st.autoreply; },
  setAlias(name, body, builtins) {
    name = name.replace(/^\//, '').toLowerCase();
    if (!NAME_RE.test(name)) throw new Error('ชื่อ alias ใช้ตัวอักษร/ตัวเลข/_ ไม่เกิน 20 ตัว');
    if (builtins.has(name)) throw new Error(`/${name} เป็นคำสั่งของระบบ ตั้งทับไม่ได้`);
    if (!body || body.length > 300) throw new Error('คำสั่งของ alias ว่างหรือยาวเกิน 300 ตัว');
    if (Object.keys(st.aliases).length >= 50 && !st.aliases[name]) throw new Error('ตั้ง alias ได้สูงสุด 50 อัน');
    st.aliases[name] = body; save();
    return name;
  },
  delAlias(name) {
    name = name.replace(/^\//, '').toLowerCase();
    if (!st.aliases[name]) return false;
    delete st.aliases[name]; save(); return true;
  },
  /** expand an alias into one or more lines (split with " | ") */
  expand(name, args, vars) {
    const body = st.aliases[name.toLowerCase()];
    if (body == null) return null;
    return body.split(/\s+\|\s+/).map(line => line
      .replace(/\$\*/g, args.join(' '))
      .replace(/\$([1-9])/g, (_, n) => args[n - 1] ?? '')
      .replace(/\$me\b/g, vars.me || '')
      .replace(/\$chan\b/g, vars.chan || '')
      .trim()).filter(Boolean);
  },
  setOnJoin(text) { st.onJoin = text ? text.slice(0, 200) : null; save(); },
  setAutoreply(on) { st.autoreply = !!on; save(); },
};

// rate limits so scripts can't spam the room
const greeted = new Map();
export function greetText(room, nick) {
  if (!st.onJoin) return null;
  const k = `${room}|${nick.toLowerCase()}`, t = Date.now();
  if (t - (greeted.get(k) || 0) < 10 * 60e3) return null;
  greeted.set(k, t);
  return st.onJoin.replace(/\$nick\b/g, nick).replace(/\$chan\b/g, room);
}
const replied = new Map();
export const AUTO_TAG = '[ตอบอัตโนมัติ]';
export function autoReplyText(fromId, away, body) {
  if (!st.autoreply || !away || String(body || '').startsWith(AUTO_TAG)) return null;
  const t = Date.now();
  if (t - (replied.get(fromId) || 0) < 10 * 60e3) return null;
  replied.set(fromId, t);
  return `${AUTO_TAG} ตอนนี้ไม่อยู่: ${away}`;
}
