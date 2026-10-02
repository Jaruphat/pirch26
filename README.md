# 💬 PIRCH26 Revival

**ห้องแชทย้อนยุคสไตล์ PIRCH98 / mIRC บน Windows 98** ใช้ผ่านเบราว์เซอร์ ไม่ต้องติดตั้งโปรแกรม

*A retro, browser-based chat room inspired by the late-90s IRC client PIRCH98 — Windows 98 look, colored text, Winks, `/slap`, ops & kicks, a shared YouTube jukebox, chat bots, and mIRC-style personal scripts. Runs on Supabase (cloud) or as a self-hosted LAN server with zero dependencies.*

> Fan-made เพื่อความสนุก ไม่เกี่ยวข้องกับผู้พัฒนา PIRCH ต้นฉบับ · สร้างร่วมกับ [Claude](https://claude.ai)

---

## เลือกวิธีรัน

| โหมด | เหมาะกับ | ล็อกอิน | ต้องมี |
|---|---|---|---|
| **เดโม่** | ลองเล่นคนเดียว | ไม่ต้อง | เปิดไฟล์ผ่าน web server อะไรก็ได้ |
| **LAN** (ออฟฟิศ) | ใช้ในวงแลน ข้อมูลอยู่ในเครื่องเราเอง | nick + รหัสผ่าน | Node.js 22.13+ **หรือ** Docker |
| **Supabase** (ออนไลน์) | เพื่อน ๆ ทั่วอินเทอร์เน็ต | Google | โปรเจกต์ Supabase (ฟรี) + ที่วางไฟล์ static |

### 1) เดโม่
```bash
cd public && python3 -m http.server 8080      # เปิด http://localhost:8080
```
ไม่มี `config.js` = โหมดเดโม่ คุยกับบอทในเครื่อง

### 2) LAN ในออฟฟิศ 🏢
**แบบ Docker** (แนะนำ)
```bash
docker compose -f docker-compose.lan.yml up -d --build
```
**แบบไม่มี Docker** (Windows/Mac/Linux ที่ลง [Node.js 22.13+](https://nodejs.org))
```bash
node server/server.js                # Windows ดับเบิลคลิก server/start-windows.bat ก็ได้
```
แล้วให้ทุกคนเปิด `http://<IP เครื่องเซิร์ฟเวอร์>:8080`

- **คนแรกที่สมัครจะเป็นแอดมิน** (เป็น @op ทุกห้อง, ลบห้อง, จัดการคำหยาบ, `/resetpass nick` รีเซ็ตรหัสให้คนอื่น)
- รหัสผ่านเก็บแบบ scrypt hash, session เป็น HttpOnly cookie
- ข้อมูลอยู่ใน SQLite ที่ `data/pirch26.db` (Docker: volume `pirch26-data`) — backup แค่ไฟล์นี้ไฟล์เดียว
- **ไม่ต้องมีอินเทอร์เน็ต** ฟีเจอร์ที่ต้องใช้เน็ตคือ Jukebox (YouTube) และ DJ-Bot ค้นเพลง ถ้าออฟฟิศออกเน็ตได้ ใส่ `YOUTUBE_API_KEY` เพื่อเปิดการค้นเพลง
- ตัวแปร: `PORT` (8080) · `DATA_DIR` (./data) · `SERVER_NAME` · `YOUTUBE_API_KEY`
- แนะนำให้วางหลัง reverse proxy ที่มี HTTPS ถ้าใช้ข้ามตึก/ข้าม VPN

### 3) Supabase (ออนไลน์ + Google login)
1. สร้างโปรเจกต์ที่ supabase.com → **SQL Editor** รันไฟล์ตามลำดับ:
   `supabase/schema.sql` (รวม v2 ลบห้อง + v3 กรองคำหยาบไว้แล้ว) → `supabase/v4-bots.sql` (ถ้าจะใช้บอท)
2. **Authentication → Sign In / Providers → Google** เปิดใช้ ใส่ Client ID/Secret จาก Google Cloud
   (redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`)
3. **Authentication → URL Configuration** ใส่ URL เว็บของคุณใน Site URL และ Redirect URLs
4. คัดลอก `public/config.example.js` เป็น `public/config.js` ใส่ `SUPABASE_URL` และ anon key
5. วางโฟลเดอร์ `public/` บน static hosting ไหนก็ได้ หรือใช้ `deploy/` (nginx + Traefik บน VPS):
   ```bash
   PIRCH_HOST=root@your-vps PIRCH_DOMAIN=chat.example.com ./deploy/deploy.sh
   ```
6. ตั้งตัวเองเป็นแอดมิน: `update public.profiles set is_admin = true where nick = 'ชื่อคุณ';`

---

## 🤖 บอท

| คำสั่ง (พิมพ์ในห้อง) | บอท | ทำอะไร |
|---|---|---|
| `!play ชื่อเพลง` หรือ `/play ชื่อเพลง` | DJ-Bot | ค้น YouTube แล้วเปิดให้ทั้งห้องฟังพร้อมกัน |
| `!np` | DJ-Bot | เพลงที่เปิดอยู่ |
| `!ดวง` | PIRCH-Bot | ดูดวงประจำวัน (คนเดิมวันเดิมได้ดวงเดิม) |
| `!8ball คำถาม` | PIRCH-Bot | ลูกแก้ววิเศษ |
| `!quiz` `!ตอบ` `!hint` `!เฉลย` `!score` | PIRCH-Bot | เกมตอบคำถามยุค 90 เก็บคะแนนรายห้อง |
| `!คำคม` · `!help` | PIRCH-Bot | |
| (อัตโนมัติ) | PIRCH-Bot | ต้อนรับสมาชิกใหม่ใน #ห้องรวม |

โค้ดบอทอยู่ที่เดียว: **`public/js/bots-core.js`** (pure JS) แล้วถูกใช้ 2 ทาง
- **โหมด LAN** — `server/server.js` รันบอทเองในตัว ไม่ต้องตั้งอะไรเพิ่ม
- **โหมด Supabase** — รันบน **n8n** ผ่าน webhook:
  1. รัน `supabase/v4-bots.sql` (เปิด `pg_net`, สร้าง profile บอท, trigger ส่ง event)
  2. Import `n8n/pirch26-bots.json` เข้า n8n (เมนู Import from File หรือ `n8n import:workflow --input=pirch26-bots.json`)
  3. ตั้ง credential 3 ตัวใน workflow: **Header Auth** (`X-Pirch-Secret`), **Query Auth** (`key` = YouTube Data API v3 key), **Supabase API** (URL + service_role key) แล้วกด Active
  4. บอก Supabase ว่า webhook อยู่ไหน:
     ```sql
     insert into public.bot_config values
       ('webhook_url', 'https://<n8n>/webhook/pirch26-bots'),
       ('webhook_secret', '<รหัสลับเดียวกับ Header Auth>')
     on conflict (key) do update set value = excluded.value;
     ```
  - แก้บอท → แก้ `bots-core.js` แล้วรัน `node n8n/build.mjs` เพื่อสร้าง workflow ใหม่

YouTube Data API แบบฟรีค้นได้ราว 100 ครั้ง/วัน (search ใช้ 100 จาก 10,000 units)

## 📜 Script ส่วนตัว (แบบ mIRC — ทำงานเฉพาะเบราว์เซอร์ของเราเอง)
```
/alias brb /away ไปกินข้าว | /me ไปกินข้าวแป๊บ     → พิมพ์ /brb   ($1 $2 $* $me $chan)
/alias · /unalias brb
/on join สวัสดี $nick ยินดีต้อนรับสู่ $chan            → ทักคนเข้าห้อง (คนเดิมซ้ำได้ทุก 10 นาที) · /on join off
/autoreply on|off                                     → ตอบ PM อัตโนมัติตอน /away
```
Wink **"จอฟ้า"** 💙 = จอฟ้าปลอมแกล้งเพื่อน 5 วินาที (นาทีละครั้ง) — ไม่มี "script ถล่ม/จอฟ้าของจริง" และระบบออกแบบให้ทำไม่ได้: ข้อความทุกอันแสดงเป็น text ล้วน ไม่มีโค้ดของใครไปรันบนเครื่องคนอื่น

## ฟีเจอร์อื่น ๆ
หลายห้อง + รายชื่อห้องทั้งหมด · PM · @op / `/op` `/deop` `/kick` `/topic` · สร้าง/ลบห้อง · Winks 13 แบบ · สีแบบ mIRC (Ctrl+K/B/U, `/rainbow`) · Jukebox YouTube ฟังพร้อมกันทั้งห้อง (ย่อ/ขยายได้) · กรองคำหยาบฝั่งเซิร์ฟเวอร์ (`/badword`) · กัน flood · คู่มือในตัว (`/manual`) · เสียงทั้งหมดสังเคราะห์ด้วย WebAudio · ใช้บนมือถือได้

## โครงสร้าง
```
public/                 หน้าเว็บ (static)
  js/app.js             UI + คำสั่ง
  js/api-supabase.js    backend: Supabase      js/api-lan.js   backend: LAN server     js/api-demo.js  backend: เดโม่
  js/bots-core.js       ตรรกะบอท (ใช้ร่วม LAN + n8n)
  js/scripts.js         alias / /on join / autoreply
  js/music.js           Jukebox   js/format.js สี mIRC   js/sound.js เสียง   js/fun.js ข้อความ/คู่มือ
  vendor/               98.css (MIT), supabase-js (MIT)
server/server.js        LAN server (Node 22, node:sqlite + Server-Sent Events, ไม่มี dependency)
supabase/*.sql          schema + RLS + triggers (รันซ้ำได้)
n8n/                    workflow บอท + build script
deploy/                 nginx + Traefik สำหรับโหมด Supabase บน VPS
Dockerfile, docker-compose.lan.yml   โหมด LAN
```

## ความปลอดภัย
- Supabase: Row Level Security ทุกตาราง, สิทธิ์ระดับคอลัมน์ (แก้ `is_admin`/`is_bot` เองไม่ได้), nick/สีในข้อความมาจาก profile ฝั่งเซิร์ฟเวอร์ (ปลอมชื่อไม่ได้), PM อ่านได้เฉพาะคู่สนทนา, service_role ส่งข้อความได้เฉพาะในนามบอท
- LAN: กฎเดียวกันทำใน `server.js`, cookie HttpOnly + SameSite, ต้องมี header `X-Pirch` (กัน CSRF), จำกัดการเดารหัส 10 ครั้ง/นาที
- ทั้งสองโหมด: กรองคำหยาบ, กัน flood 8 ข้อความ/10 วินาที, CSP header, ไม่มี `innerHTML` กับข้อความผู้ใช้

## License
MIT — ดู [LICENSE](LICENSE) · 98.css และ supabase-js เป็น MIT ตามไฟล์ใน `public/vendor/`
