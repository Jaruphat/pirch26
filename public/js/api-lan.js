// Backend สำหรับโหมด LAN: คุยกับ server/server.js (REST + Server-Sent Events)
export function createLanApi() {
  let me = null;
  let es = null;
  let conn = null;
  let pendingPresence = null;
  const handlers = { onMessage: () => {}, onStatus: () => {}, onRoomDeleted: () => {}, onRoomCreated: () => {}, onPresence: () => {} };

  async function rpc(fn, args = {}) {
    let r;
    try {
      r = await fetch('/api/rpc', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Pirch': '1' }, body: JSON.stringify({ fn, args }) });
    } catch { throw new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ (เช็คการเชื่อมต่อ LAN)'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `เซิร์ฟเวอร์ตอบ ${r.status}`);
    return j.data;
  }

  function connectEvents() {
    es?.close();
    es = new EventSource('/api/events');
    es.onopen = () => handlers.onStatus('SUBSCRIBED');
    es.onerror = () => handlers.onStatus('CHANNEL_ERROR');   // EventSource reconnects by itself
    es.onmessage = e => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.t === 'hello') { conn = ev.conn; if (pendingPresence) api.updatePresence(pendingPresence); }
      else if (ev.t === 'msg') handlers.onMessage(ev.m);
      else if (ev.t === 'presence') handlers.onPresence(ev.list);
      else if (ev.t === 'room_deleted') handlers.onRoomDeleted(ev.name);
      else if (ev.t === 'room_created') handlers.onRoomCreated(ev.name);
    };
  }

  const api = {
    mode: 'lan',
    rpc,
    async init() {
      try { me = await rpc('me'); } catch { me = null; }
      return me;
    },
    async signIn({ username, password, register }) {
      await rpc(register ? 'register' : 'login', { username, password });
      me = await rpc('me');
      return me;
    },
    async signOut() { es?.close(); await rpc('logout').catch(() => {}); },
    getMyProfile: () => rpc('getMyProfile'),
    saveProfile: p => rpc('saveProfile', p),
    getProfile: id => rpc('getProfile', { id }),
    findProfileByNick: nick => rpc('findProfileByNick', { nick }),
    listBots: () => rpc('listBots'),
    listRooms: () => rpc('listRooms'),
    ensureRoom: name => rpc('ensureRoom', { name }),
    setTopic: (room, topic) => rpc('setTopic', { room, topic }),
    getOps: room => rpc('getOps', { room }),
    addOp: (room, userId) => rpc('addOp', { room, userId }),
    removeOp: (room, userId) => rpc('removeOp', { room, userId }),
    deleteRoom: name => rpc('deleteRoom', { name }),
    history: (room, limit) => rpc('history', { room, limit }),
    pmHistory: (otherId, limit) => rpc('pmHistory', { otherId, limit }),
    send: msg => rpc('send', msg),
    listBadWords: () => rpc('listBadWords'),
    addBadWord: word => rpc('addBadWord', { word }),
    delBadWord: word => rpc('delBadWord', { word }),
    changePassword: (oldPassword, newPassword) => rpc('changePassword', { oldPassword, newPassword }),
    resetPassword: nick => rpc('resetPassword', { nick }),
    subscribe(h) { Object.assign(handlers, h); connectEvents(); },
    joinPresence(state, onSync) { handlers.onPresence = onSync; api.updatePresence(state); },
    async updatePresence(state) {
      pendingPresence = state;
      if (!conn) return;
      try { await rpc('presence', { conn, state }); } catch { /* reconnecting */ }
    },
  };
  return api;
}
