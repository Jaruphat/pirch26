// ===== PIRCH26 config =====
// คัดลอกไฟล์นี้เป็น config.js แล้วใส่ค่า (config.js ไม่ถูก commit ขึ้น git)
//   - เว้นว่างทั้งหมด            → โหมดเดโม่ (คุยกับบอทในเครื่อง)
//   - ใส่ SUPABASE_URL + KEY    → โหมดออนไลน์ (Supabase + Google login)
//   - โหมด LAN ไม่ต้องใช้ไฟล์นี้ (server/server.js สร้าง config ให้เอง)
window.PIRCH_CONFIG = {
  SUPABASE_URL: '',          // เช่น 'https://abcdxyz.supabase.co'
  SUPABASE_ANON_KEY: '',     // anon / publishable key (เปิดเผยได้ ปลอดภัยเพราะมี RLS)
  SERVER_NAME: 'irc.pirch26.revival',
  DEFAULT_ROOM: '#ห้องรวม',
};
