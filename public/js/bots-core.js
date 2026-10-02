// ===== PIRCH26 bots — shared logic =====
// Pure JS (no DOM, no network). Used by:
//   - server/server.js       (LAN mode, runs the bots itself)
//   - n8n/pirch26-bots.json  (Supabase mode, this file is embedded in a Code node by n8n/build.mjs)
// handleEvent() decides what the bots say; searching YouTube is done by the caller,
// then searchResult() turns the search result into replies.

export const BOTS = {
  dj:    { id: '00000000-0000-4000-8000-00000000d0d0', nick: 'DJ-Bot',    color: 6,  quote: 'ขอเพลงได้เลย พิมพ์ !play ชื่อเพลง 🎵' },
  pirch: { id: '00000000-0000-4000-8000-000000000b07', nick: 'PIRCH-Bot', color: 12, quote: 'พิมพ์ !help ดูว่าบอททำอะไรได้บ้าง 🤖' },
};
export const BOT_IDS = Object.values(BOTS).map(b => b.id);
export const DEFAULT_ROOM = '#ห้องรวม';

const stripCodes = t => String(t || '').replace(/\x03(\d{1,2}(,\d{1,2})?)?|[\x02\x0F\x16\x1D\x1F]/g, '');
const norm = t => stripCodes(t).trim().toLowerCase().replace(/\s+/g, ' ');
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
const pickBy = (arr, seed) => arr[seed % arr.length];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const FORTUNE = {
  love: ['คนที่แอบชอบกำลังรอให้คุณทักก่อน 💌', 'มีคนเก่าแวะเวียนมาทักในห้องแชท', 'โสดแต่ไม่เหงา เพราะมีเพื่อนใน #ห้องรวม', 'ระวังส่ง Wink ผิดคน 😳', 'ความรักหวานเหมือนโอวัลตินเย็น', 'ดวงคู่: คนที่ nick ขึ้นต้นด้วยตัวอักษรเดียวกับคุณ'],
  work: ['งานเดินเร็วเหมือนเน็ตตอนตี 3', 'หัวหน้าอารมณ์ดี รีบขออะไรวันนี้เลย', 'ระวังกดส่งอีเมลก่อนแนบไฟล์', 'มีงานด่วนเข้ามา แต่ปิดได้ทันเวลา', 'ไอเดียดี ๆ จะมาตอนอาบน้ำ', 'ประชุมวันนี้สั้นกว่าที่คิด (ปาฏิหาริย์!)'],
  money: ['มีเงินเข้าแบบไม่คาดคิด แม้จะแค่ 20 บาทในกระเป๋ากางเกง', 'ประหยัดได้ ถ้าไม่สั่งชานมไข่มุกแก้วที่สาม', 'ค่าเน็ตเดือนนี้ไม่บานปลาย', 'มีคนคืนเงินที่ยืมไปนานแล้ว', 'อย่าเพิ่งซื้อของที่อยู่ในตะกร้ามา 3 เดือน'],
  color: ['ฟ้า Windows 98', 'เขียวจอ CRT', 'เทาเงิน (สีปุ่ม)', 'น้ำเงินกรมท่า', 'ชมพูบานเย็น', 'เหลือง Post-it'],
  item: ['แผ่นดิสก์ 3.5 นิ้ว', 'บัตรเติมเงินมือถือ', 'ปากกาลูกลื่นที่ใช้กรอเทป', 'เมาส์ลูกกลิ้ง', 'โปสการ์ดดารา', 'เพจเจอร์'],
};
const EIGHTBALL = ['แน่นอน 100%', 'ใช่เลย!', 'น่าจะใช่นะ', 'ถามใหม่อีกทีหลังเน็ตหลุด', 'ยังบอกไม่ได้ รอโมเด็มต่อติดก่อน', 'อย่าหวังเลย', 'ไม่น่าจะใช่', 'คำตอบคือ... ไม่!', 'ลองถามแม่ดูก่อน', 'ดวงบอกว่าใช่ แต่ใจบอกว่าไม่', 'ฟันธง: ได้!', 'เดี๋ยวก่อน... ขอคิดแป๊บ (ไม่ได้)'];
const QUOTES = ['เน็ตหลุดไม่ว่า ขอแค่ใจเราไม่หลุดจากกัน', 'รักแท้ไม่มีวัน Ping timeout', 'ชีวิตก็เหมือนโหลดรูป... ค่อย ๆ ขึ้นทีละบรรทัด', 'ความคิดถึงไม่ต้องใช้ชั่วโมงอินเทอร์เน็ต', 'คนที่ใช่ จะส่ง Wink มาเอง', 'อย่าลืม Save งานก่อนไฟดับ', 'บางคนเข้ามาในห้องแชทเพื่อคุย บางคนเข้ามาเพื่อสอนเราว่าต้อง /ignore', 'ถ้ารักจริง ต้องรอได้แม้ 56k'];
const QUIZ = [
  { q: 'โมเด็มบ้านยุคนั้นเร็วสุดกี่ kbps?', a: ['56', '56k', '56kbps'] },
  { q: 'Windows รุ่นที่ออกปี ค.ศ. 1998 ชื่อว่าอะไร?', a: ['98', 'windows 98', 'win98', 'วินโดว์ 98'] },
  { q: 'แผ่นดิสก์ยุคนั้นมีขนาดกี่นิ้ว?', a: ['3.5', '3.5 นิ้ว', '3 นิ้วครึ่ง'] },
  { q: 'แผ่นดิสก์ 3.5 นิ้ว (HD) จุได้ประมาณกี่ MB?', a: ['1.44', '1.44mb', '1.44 mb'] },
  { q: 'IRC ย่อมาจากอะไร?', a: ['internet relay chat'] },
  { q: 'a/s/l ที่ชอบถามกันในห้องแชท ย่อมาจากอะไร?', a: ['age sex location', 'age/sex/location', 'อายุ เพศ ที่อยู่'] },
  { q: 'ICQ อ่านออกเสียงแล้วตรงกับประโยคภาษาอังกฤษว่าอะไร?', a: ['i seek you'] },
  { q: 'Nokia รุ่นในตำนานที่มีเกมงูและทนทานสุด ๆ คือรุ่นอะไร?', a: ['3310', 'nokia 3310'] },
  { q: 'เกมออนไลน์ที่ฮิตมากในไทยช่วงต้นยุค 2000 ที่ต้องไปตีโปริงคือเกมอะไร?', a: ['ragnarok', 'ro', 'แร็กนาร็อก', 'แรคนาร็อค'] },
  { q: 'ปุ่มใน MSN Messenger ที่ทำให้หน้าต่างเพื่อนสั่น เรียกว่าอะไร?', a: ['nudge', 'สั่น', 'buzz'] },
  { q: 'Google ก่อตั้งในปี ค.ศ. อะไร?', a: ['1998'] },
  { q: 'โปรแกรมแชทในตำนานที่เรากำลังรำลึกถึง ชื่อเต็มคือ PIRCH อะไร?', a: ['98', 'pirch98'] },
];

const HELP = [
  '🤖 คำสั่งบอท (พิมพ์ในห้อง):',
  '  !play ชื่อเพลง — DJ-Bot ค้นเพลงจาก YouTube แล้วเปิดให้ทั้งห้อง   ·   !np — เพลงที่เล่นอยู่',
  '  !ดวง — ดูดวงประจำวัน   ·   !8ball คำถาม — ถามลูกแก้ววิเศษ   ·   !คำคม — คำคมยุค 56k',
  '  !quiz — เกมตอบคำถามยุค 90   ·   !ตอบ คำตอบ   ·   !hint   ·   !เฉลย   ·   !score',
];

/**
 * @param {object} evt   { type:'message', room, to_user, sender, nick, kind, body } | { type:'new_user', nick }
 * @param {object} state persisted between calls (mutated)
 * @param {object} opt   { youtube: boolean, now: ms }
 * @returns {{ replies: Array<{bot,room,kind,body,target?}>, search: {room,query,by}|null }}
 */
export function handleEvent(evt, state, opt = {}) {
  const now = opt.now ?? Date.now();
  const out = { replies: [], search: null };
  const say = (bot, room, body, kind = 'msg', target = null) => out.replies.push({ bot, room, kind, body: String(body).slice(0, 500), target });
  state.np ??= {}; state.quiz ??= {}; state.scores ??= {};

  if (evt.type === 'new_user') {
    say('pirch', DEFAULT_ROOM, `🎉 ยินดีต้อนรับ ${evt.nick} สมาชิกใหม่ของ PIRCH26! พิมพ์ !help เพื่อดูว่าบอททำอะไรได้`);
    return out;
  }
  if (evt.type !== 'message' || !evt.room || evt.to_user || BOT_IDS.includes(evt.sender)) return out;
  if (evt.kind !== 'msg') return out;
  const text = stripCodes(evt.body).trim();
  if (!text.startsWith('!')) return out;
  const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const arg = rest.join(' ').trim();
  const room = evt.room, nick = evt.nick || 'ใครสักคน';

  switch (cmd) {
    case 'help': case 'ช่วย': case 'bot':
      HELP.forEach(l => say('pirch', room, l));
      break;

    case 'play': case 'เปิด': case 'เพลง': {
      if (!arg) { say('dj', room, `${nick}: พิมพ์ชื่อเพลงด้วยนะ เช่น !play ยังคิดถึง`); break; }
      if (opt.youtube === false) { say('dj', room, '😢 เซิร์ฟเวอร์นี้ปิดการค้นเพลงไว้ (ไม่มี YouTube API key หรือไม่มีอินเทอร์เน็ต) — ใช้ /play ลิงก์YouTube แทนได้'); break; }
      out.search = { room, query: arg.slice(0, 100), by: nick };
      break;
    }
    case 'np': {
      const n = state.np[room];
      say('dj', room, n ? `🎵 Now playing: ${n.title} (ขอโดย ${n.by})` : 'ตอนนี้ยังไม่มีเพลงจาก DJ-Bot — ลอง !play ชื่อเพลง');
      break;
    }
    case 'ดวง': case 'horoscope': case 'fortune': {
      const day = new Date(now + 7 * 3600e3).toISOString().slice(0, 10); // วันตามเวลาไทย
      const s = hash(`${nick.toLowerCase()}|${day}`);
      say('pirch', room, `🔮 ดวงวันนี้ของ ${nick}: 💕 ${pickBy(FORTUNE.love, s)} · 💼 ${pickBy(FORTUNE.work, s >>> 3)} · 💰 ${pickBy(FORTUNE.money, s >>> 6)} · สีมงคล ${pickBy(FORTUNE.color, s >>> 9)} · ของนำโชค ${pickBy(FORTUNE.item, s >>> 12)}`);
      break;
    }
    case '8ball': case 'ถาม': {
      if (!arg) { say('pirch', room, `${nick}: ถามคำถามด้วยสิ เช่น !8ball พรุ่งนี้ฝนตกไหม`); break; }
      say('pirch', room, `🎱 ${nick} ถามว่า "${arg.slice(0, 120)}" — ลูกแก้วตอบว่า: ${pick(EIGHTBALL)}`);
      break;
    }
    case 'คำคม': case 'quote':
      say('pirch', room, `💬 "${pick(QUOTES)}"`);
      break;

    case 'quiz': case 'ควิซ': {
      const cur = state.quiz[room];
      if (cur && now - cur.at < 120e3) { say('pirch', room, `❓ คำถามยังค้างอยู่: ${cur.q} (ตอบด้วย !ตอบ ...)`); break; }
      const used = new Set((state.quizUsed ??= {})[room] || []);
      let idx = QUIZ.findIndex((_, i) => !used.has(i));
      if (idx < 0) { used.clear(); idx = Math.floor(Math.random() * QUIZ.length); }
      const order = QUIZ.map((_, i) => i).filter(i => !used.has(i));
      idx = order[Math.floor(Math.random() * order.length)] ?? idx;
      used.add(idx); state.quizUsed[room] = [...used];
      state.quiz[room] = { i: idx, q: QUIZ[idx].q, at: now };
      say('pirch', room, `❓ QUIZ: ${QUIZ[idx].q}   (ตอบด้วย !ตอบ คำตอบ · ใบ้ !hint · ยอมแพ้ !เฉลย)`);
      break;
    }
    case 'ตอบ': case 'a': case 'answer': {
      const cur = state.quiz[room];
      if (!cur) { say('pirch', room, 'ยังไม่มีคำถามนะ พิมพ์ !quiz เพื่อเริ่ม'); break; }
      if (QUIZ[cur.i].a.includes(norm(arg))) {
        const sc = (state.scores[room] ??= {});
        sc[nick] = (sc[nick] || 0) + 1;
        delete state.quiz[room];
        say('pirch', room, `✅ ถูกต้อง! ${nick} ได้ 1 คะแนน (รวม ${sc[nick]}) 🎉  เล่นต่อ !quiz`);
      } else say('pirch', room, `❌ ยังไม่ใช่นะ ${nick} ลองใหม่!`);
      break;
    }
    case 'hint': case 'ใบ้': {
      const cur = state.quiz[room];
      if (!cur) break;
      const a = QUIZ[cur.i].a[0];
      say('pirch', room, `💡 ใบ้: ขึ้นต้นด้วย "${[...a][0]}" ยาว ${[...a].length} ตัวอักษร`);
      break;
    }
    case 'เฉลย': case 'skip': {
      const cur = state.quiz[room];
      if (!cur) break;
      delete state.quiz[room];
      say('pirch', room, `📢 เฉลย: ${QUIZ[cur.i].a[0]}   (เล่นต่อ !quiz)`);
      break;
    }
    case 'score': case 'คะแนน': {
      const sc = Object.entries(state.scores[room] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      say('pirch', room, sc.length ? `🏆 คะแนนห้อง ${room}: ${sc.map(([n, s], i) => `${i + 1}. ${n} (${s})`).join('  ')}` : 'ยังไม่มีใครได้คะแนนเลย พิมพ์ !quiz');
      break;
    }
    default: break; // unknown ! command — stay quiet
  }
  return out;
}

const decodeEntities = s => String(s || '').replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" }[e]));

/** Turn a YouTube search result into DJ replies. result: { id, title } | null | { error } */
export function searchResult(search, result, state) {
  state.np ??= {};
  if (!result || result.error || !/^[A-Za-z0-9_-]{11}$/.test(result.id || '')) {
    return [{ bot: 'dj', room: search.room, kind: 'msg', body: result?.error ? `😵 ค้นเพลงไม่สำเร็จ (${String(result.error).slice(0, 80)})` : `🤔 หาเพลง "${search.query}" ไม่เจอเลย ลองพิมพ์ชื่ออื่นดูนะ` }];
  }
  const title = decodeEntities(result.title).slice(0, 150);
  state.np[search.room] = { title, by: search.by, id: result.id };
  return [
    { bot: 'dj', room: search.room, kind: 'msg', body: `🎵 จัดไป! "${title}" — ขอโดย ${search.by}` },
    { bot: 'dj', room: search.room, kind: 'wink', body: `music:play:${result.id}` },
  ];
}

/** Pick the first video from a YouTube Data API v3 search response. */
export function parseYouTubeSearch(json) {
  if (json?.error) return { error: json.error.message || 'YouTube API error' };
  const it = (json?.items || []).find(x => x?.id?.videoId);
  return it ? { id: it.id.videoId, title: it.snippet?.title || it.id.videoId } : null;
}
