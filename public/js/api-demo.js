// โหมดเดโม่: ไม่ต้องมี Supabase — ทุกอย่างอยู่ในเบราว์เซอร์ มีบอทแกล้งคุยด้วย
import { WINKS, SLAP_ITEMS } from './fun.js';
import { BOTS as CORE_BOTS, handleEvent } from './bots-core.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const now = () => new Date().toISOString();

const BOTS = [
  { id: 'bot-kaem', nick: 'น้องแก้ม_2541', color: 13, quote: 'ใครเหงามาคุยกันได้น้า ^^', rooms: ['#ห้องรวม', '#คนเหงา', '#เพลงรัก'] },
  { id: 'bot-tuk',  nick: 'TukTuk',        color: 12, quote: 'ขายบัตรเน็ต 15 ชม. ถูก ๆ (ล้อเล่น)', rooms: ['#ห้องรวม', '#วัยรุ่น', '#เกมเมอร์'] },
  { id: 'bot-boy',  nick: 'BoyZa^^',       color: 4,  quote: 'Counter-Strike 1.6 ตลอดกาล', rooms: ['#ห้องรวม', '#เกมเมอร์', '#วัยรุ่น'] },
  { id: 'bot-jaew', nick: 'ป้าแจ๋ว',        color: 6,  quote: 'ป้าเล่นเน็ตเป็นแล้วนะหลาน', rooms: ['#ห้องรวม', '#คนเหงา'] },
  { id: 'bot-dark', nick: 'xX_Angel_Xx',   color: 2,  quote: 'ปีกหักแต่ใจยังสู้ ~*~', rooms: ['#ห้องรวม', '#เพลงรัก', '#คนเหงา'] },
];

const CHATTER = [
  'สวัสดีจ้าทุกคน', 'ใครอยู่ กทม. บ้าง', 'ง่วงอ่ะ แต่ยังไม่อยากนอน', 'เน็ตหลุดอีกแล้ว เซ็งเลย',
  'ใครมี ICQ บ้าง ขอเลขหน่อย', 'เพลงนี้เพราะมากกกก', '555555+', 'อิอิ', 'ขอเพลงรักเก่า ๆ หน่อยค่า',
  'พรุ่งนี้สอบคณิต ช่วยด้วยยย', 'ร้านเน็ตแถวบ้านชั่วโมงละ 15 บาทเอง', 'มีใครเล่น RO เซิร์ฟ Chaos ไหม',
  'แม่จะโทรเข้า ต้องไปก่อนนะ', 'a/s/l ? (ล้อเล่นน่า อย่าเตะ)', 'ใครจำ Winamp ได้บ้าง It really whips...',
  'รอโหลดรูปนานมาก ขึ้นทีละบรรทัด', 'ชอบสีตัวอักษรเธอจัง', 'ไปก่อนนะ ขอไปดูการ์ตูนเช้าวันเสาร์',
];
const REPLIES = ['ว่าไงจ๊ะ', 'เรียกทำไมอ่ะ อิอิ', 'อยู่นี่ ๆ', 'หืมมม?', 'จ้าาา', 'ไม่บอกหรอก :P', 'คิดถึงเหมือนกันนะ'];

export function createDemoApi() {
  const me = { id: 'me-demo', email: 'demo@pirch26.local' };
  let myProfile = null;
  let signedIn = false;
  let seq = 1000;
  let onMessage = () => {};
  let onPresence = () => {};
  let onRoomDeleted = () => {};
  let myPresence = null;
  const bots = BOTS.map(b => ({ ...b, rooms: [...b.rooms], away: null, created_at: '1999-12-31T23:59:00Z' }));
  const rooms = new Map([
    ['#ห้องรวม', 'ยินดีต้อนรับสู่ PIRCH26 Revival ~ ห้ามเกรียน ห้ามขายตรง ห้ามถามอายุ ^_^'],
    ['#วัยรุ่น', 'วัยรุ่นยุค 56k มารวมกันตรงนี้!!'],
    ['#คนเหงา', 'เหงาไหม... คุยกันได้นะ'],
    ['#เกมเมอร์', 'RO / Counter-Strike 1.6 / Red Alert ใครยังเล่นอยู่บ้าง'],
    ['#เพลงรัก', 'ขอเพลงได้ตลอดคืน ~ Now playing: เพลงรักยุค 90'],
  ].map(([name, topic]) => [name, { name, topic, created_at: '1998-06-01T00:00:00Z' }]));
  const ops = new Map([...rooms.keys()].map(r => [r, new Set(['bot-jaew'])]));
  const log = [];

  const coreBots = Object.values(CORE_BOTS).map(b => ({ ...b, is_bot: true, created_at: '2026-01-01T00:00:00Z' }));
  const coreState = {};
  const allProfiles = () => [...bots, ...coreBots, ...(myProfile ? [myProfile] : [])];
  function runCoreBots(m) {
    if (!m.room || m.kind !== 'msg' || !String(m.body).startsWith('!')) return;
    const r = handleEvent({ type: 'message', room: m.room, sender: m.sender, nick: m.nick, kind: m.kind, body: m.body }, coreState, { youtube: false });
    r.replies.forEach((x, i) => setTimeout(() => {
      const b = coreBots.find(c => c.id === CORE_BOTS[x.bot].id);
      emit({ id: ++seq, room: x.room, to_user: null, sender: b.id, nick: b.nick, color: b.color, kind: x.kind, body: x.body, target: null, created_at: now() });
    }, 400 + i * 150));
  }
  const emit = m => { log.push(m); setTimeout(() => onMessage(m), 60 + Math.random() * 180); };
  const pushPresence = () => {
    const list = bots.filter(b => b.online !== false).map(b => ({ id: b.id, nick: b.nick, color: b.color, away: b.away, rooms: [...b.rooms] }));
    if (myPresence) list.push({ id: me.id, ...myPresence });
    setTimeout(() => onPresence(list), 30);
  };
  const botSay = (bot, fields) => emit({ id: ++seq, sender: bot.id, nick: bot.nick, color: bot.color, created_at: now(), target: null, to_user: null, room: null, kind: 'msg', ...fields });

  function botReact(m) {
    if (m.sender !== me.id || (m.body || '').startsWith('music:')) return;
    const inRoom = m.room ? bots.filter(b => b.rooms.includes(m.room)) : [];
    const later = (fn, ms = 1200 + Math.random() * 1800) => setTimeout(fn, ms);
    if (m.to_user) {
      const bot = bots.find(b => b.id === m.to_user);
      if (bot) later(() => botSay(bot, { to_user: me.id, body: m.kind === 'wink' ? pick(WINKS).id : pick(REPLIES), kind: m.kind === 'wink' ? 'wink' : 'msg' }));
      return;
    }
    const text = (m.body || '').toLowerCase();
    const mentioned = inRoom.find(b => text.includes(b.nick.toLowerCase().slice(0, 4)));
    if (m.kind === 'slap' && m.target) {
      const bot = inRoom.find(b => b.nick.toLowerCase() === m.target.toLowerCase());
      if (bot) later(() => botSay(bot, { room: m.room, kind: 'slap', target: myProfile.nick, body: pick(SLAP_ITEMS) }));
    } else if (m.kind === 'wink' && inRoom.length && Math.random() < 0.6) {
      later(() => botSay(pick(inRoom), { room: m.room, kind: 'wink', body: pick(WINKS).id }));
    } else if (m.kind === 'kick' && m.target) {
      const bot = inRoom.find(b => b.nick.toLowerCase() === m.target.toLowerCase());
      if (bot) {
        bot.rooms = bot.rooms.filter(r => r !== m.room); pushPresence();
        setTimeout(() => { bot.rooms.push(m.room); pushPresence(); botSay(bot, { room: m.room, body: 'ใครเตะเค้าอ่ะ T_T' }); }, 8000);
      }
    } else if (mentioned) {
      later(() => botSay(mentioned, { room: m.room, body: `${myProfile.nick}: ${pick(REPLIES)}` }));
    } else if (m.kind === 'msg' && inRoom.length && Math.random() < 0.35) {
      later(() => botSay(pick(inRoom), { room: m.room, body: pick(CHATTER) }));
    }
  }

  function startChatter() {
    const tick = () => {
      const myRooms = myPresence?.rooms || [];
      const r = Math.random();
      if (myRooms.length) {
        const room = pick(myRooms);
        const cands = bots.filter(b => b.rooms.includes(room));
        if (cands.length) {
          const bot = pick(cands);
          if (r < 0.75) botSay(bot, { room, body: pick(CHATTER) });
          else if (r < 0.85) botSay(bot, { room, kind: 'action', body: pick(['กินมาม่าอยู่', 'เปิดเพลงเสียงดัง', 'หาวววว', 'ไปเข้าห้องน้ำแป๊บ']) });
          else if (r < 0.93) botSay(bot, { room, kind: 'wink', body: pick(WINKS).id });
          else {
            // bot goes away / comes back / leaves & rejoins for join-part flavor
            const b = pick(bots);
            b.away = b.away ? null : 'ไปกินข้าว';
            pushPresence();
          }
        }
      }
      setTimeout(tick, 5000 + Math.random() * 7000);
    };
    setTimeout(tick, 3500);
  }

  const api = {
    mode: 'demo',
    async init() { return signedIn ? me : null; },
    async signIn() { signedIn = true; return me; },
    async signOut() { signedIn = false; myPresence = null; location.reload(); },
    async getMyProfile() { return myProfile; },
    async saveProfile(p) {
      if (!/^[A-Za-z0-9_ก-๛\[\]{}|^-]{2,20}$/.test(p.nick)) throw new Error('รูปแบบไม่ถูกต้อง (ชื่อ 2-20 ตัว ห้ามเว้นวรรค)');
      if (bots.some(b => b.nick.toLowerCase() === p.nick.toLowerCase())) throw new Error('ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ');
      myProfile = { id: me.id, nick: p.nick, color: p.color, quote: p.quote ?? null, created_at: myProfile?.created_at ?? now() };
      return myProfile;
    },
    async listBots() { return coreBots; },
    async getProfile(id) { return allProfiles().find(p => p.id === id) ?? null; },
    async findProfileByNick(nick) { return allProfiles().find(p => p.nick.toLowerCase() === nick.toLowerCase()) ?? null; },
    async listRooms() { return [...rooms.values()]; },
    async ensureRoom(name) {
      if (!rooms.has(name)) { rooms.set(name, { name, topic: '', created_at: now() }); ops.set(name, new Set([me.id])); }
      return rooms.get(name);
    },
    async setTopic(room, topic) { rooms.get(room).topic = topic; },
    async deleteRoom(name) {
      if (!rooms.has(name)) throw new Error('ไม่มีห้องนี้');
      rooms.delete(name); ops.delete(name);
      bots.forEach(b => { b.rooms = b.rooms.filter(r => r !== name); });
      for (let i = log.length - 1; i >= 0; i--) if (log[i].room === name) log.splice(i, 1);
      setTimeout(() => { onRoomDeleted(name); pushPresence(); }, 120);
    },
    async getOps(room) { return [...(ops.get(room) || []), me.id]; }, // เดโม่: คุณเป็น @op ทุกห้อง จะได้ลองเตะบอทได้
    async addOp(room, userId) { ops.get(room)?.add(userId); },
    async listBadWords() { return ['(โหมดเดโม่ไม่มีระบบกรองคำ)']; },
    async addBadWord() { throw new Error('โหมดเดโม่ไม่มีระบบกรองคำหยาบ'); },
    async delBadWord() { throw new Error('โหมดเดโม่ไม่มีระบบกรองคำหยาบ'); },
    async removeOp(room, userId) {
      if (!ops.get(room)?.delete(userId)) throw new Error('คนนี้ไม่ได้เป็น @op ของห้องนี้');
    },
    async history(room) { return log.filter(m => m.room === room).slice(-60); },
    async pmHistory(otherId) { return log.filter(m => !m.room && (m.sender === otherId || m.to_user === otherId)).slice(-60); },
    async send(msg) {
      if (!myProfile) throw new Error('ต้องตั้ง nick ก่อนนะ');
      const recent = log.filter(m => m.sender === me.id && Date.now() - Date.parse(m.created_at) < 10000).length;
      if (recent >= 8) throw new Error('ใจเย็น ๆ พิมพ์รัวเกินไปแล้ว (Excess Flood!)');
      const m = { id: ++seq, room: msg.room ?? null, to_user: msg.to_user ?? null, sender: me.id, nick: myProfile.nick, color: myProfile.color, kind: msg.kind ?? 'msg', body: msg.body, target: msg.target ?? null, created_at: now() };
      emit(m);
      botReact(m);
      runCoreBots(m);
      return m;
    },
    subscribe(h) { onMessage = h.onMessage; onRoomDeleted = h.onRoomDeleted || (() => {}); setTimeout(() => h.onStatus?.('SUBSCRIBED'), 100); },
    joinPresence(state, onSync) { onPresence = onSync; myPresence = state; pushPresence(); startChatter(); },
    async updatePresence(state) { myPresence = state; pushPresence(); },
  };
  return api;
}
