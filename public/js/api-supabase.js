// Backend จริง: Supabase (Auth Google + Postgres + Realtime)
export function createSupabaseApi(cfg) {
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  let user = null;
  let presenceCh = null;
  let dbCh = null;

  const fail = (error) => {
    if (!error) return;
    if (error.code === '23505') throw new Error('ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ');
    if (error.code === '23514') throw new Error('รูปแบบไม่ถูกต้อง (ชื่อ 2-20 ตัว ห้ามเว้นวรรค)');
    throw new Error(error.message || String(error));
  };

  const api = {
    mode: 'supabase',

    async init() {
      const { data } = await sb.auth.getSession();
      if (location.search.includes('code=') || location.hash.includes('access_token')) {
        history.replaceState(null, '', location.pathname);
      }
      user = data.session?.user ?? null;
      return user ? { id: user.id, email: user.email } : null;
    },

    async signIn() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname },
      });
      fail(error);
      return null; // browser redirects
    },

    async signOut() {
      try { presenceCh && (await presenceCh.untrack()); } catch { /* ignore */ }
      await sb.removeAllChannels();
      await sb.auth.signOut();
    },

    async getMyProfile() {
      const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
      fail(error);
      return data;
    },

    async saveProfile(p) {
      const existing = await api.getMyProfile();
      const row = { nick: p.nick, color: p.color, quote: p.quote ?? null };
      const q = existing
        ? sb.from('profiles').update(row).eq('id', user.id).select().single()
        : sb.from('profiles').insert({ id: user.id, ...row }).select().single();
      const { data, error } = await q;
      fail(error);
      return data;
    },

    async getProfile(id) {
      const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
      fail(error);
      return data;
    },

    async findProfileByNick(nick) {
      const pattern = nick.replace(/[\\%_]/g, '\\$&');
      const { data, error } = await sb.from('profiles').select('*').ilike('nick', pattern).limit(1);
      fail(error);
      return data?.[0] ?? null;
    },

    async listRooms() {
      const { data, error } = await sb.from('rooms').select('name, topic, created_at').order('name');
      fail(error);
      return data;
    },

    async ensureRoom(name) {
      let { data, error } = await sb.from('rooms').select('*').eq('name', name).maybeSingle();
      fail(error);
      if (data) return data;
      ({ data, error } = await sb.from('rooms').insert({ name, topic: '' }).select().single());
      if (error?.code === '23505') return (await sb.from('rooms').select('*').eq('name', name).single()).data;
      fail(error);
      return data;
    },

    async setTopic(room, topic) {
      const { error } = await sb.from('rooms').update({ topic }).eq('name', room);
      fail(error);
    },

    async getOps(room) {
      const [ops, admins] = await Promise.all([
        sb.from('room_ops').select('user_id').eq('room', room),
        sb.from('profiles').select('id').eq('is_admin', true),
      ]);
      fail(ops.error); fail(admins.error);
      return [...ops.data.map(r => r.user_id), ...admins.data.map(r => r.id)];
    },

    async listBots() {
      const { data, error } = await sb.from('profiles').select('id, nick, color, quote, created_at').eq('is_bot', true);
      if (error) return []; // v4-bots.sql not installed yet
      return data;
    },

    async listBadWords() {
      const { data, error } = await sb.from('bad_words').select('word').order('word');
      fail(error);
      return data.map(r => r.word);
    },
    async addBadWord(word) {
      const { error } = await sb.from('bad_words').insert({ word });
      if (error?.code === '23505') throw new Error('มีคำนี้อยู่แล้ว');
      if (error?.code === '42P01') throw new Error('ยังไม่ได้รัน SQL ระบบกรองคำหยาบ (v3-badwords.sql)');
      fail(error);
    },
    async delBadWord(word) {
      const { data, error } = await sb.from('bad_words').delete().eq('word', word).select('word');
      fail(error);
      if (!data?.length) throw new Error('ไม่มีคำนี้ในรายการ');
    },

    async removeOp(room, userId) {
      const { data, error } = await sb.from('room_ops').delete().eq('room', room).eq('user_id', userId).select('user_id');
      fail(error);
      if (!data?.length) throw new Error('คนนี้ไม่ได้เป็น @op ของห้องนี้');
    },

    async addOp(room, userId) {
      const { error } = await sb.from('room_ops').insert({ room, user_id: userId });
      if (error?.code === '23505') return;
      fail(error);
    },

    async history(room, limit = 60) {
      const { data, error } = await sb.from('messages').select('*')
        .eq('room', room).order('id', { ascending: false }).limit(limit);
      fail(error);
      return data.reverse();
    },

    async pmHistory(otherId, limit = 60) {
      const me = user.id;
      const { data, error } = await sb.from('messages').select('*').is('room', null)
        .or(`and(sender.eq.${me},to_user.eq.${otherId}),and(sender.eq.${otherId},to_user.eq.${me})`)
        .order('id', { ascending: false }).limit(limit);
      fail(error);
      return data.reverse();
    },

    async send(msg) {
      const row = { room: msg.room ?? null, to_user: msg.to_user ?? null, kind: msg.kind ?? 'msg', body: msg.body, target: msg.target ?? null };
      const { data, error } = await sb.from('messages').insert(row).select().single();
      fail(error);
      return data;
    },

    async deleteRoom(name) {
      const { data, error } = await sb.from('rooms').delete().eq('name', name).select('name');
      fail(error);
      if (!data?.length) throw new Error('ลบได้เฉพาะคนที่สร้างห้องนี้ หรือแอดมินเท่านั้น');
    },

    subscribe({ onMessage, onStatus, onRoomDeleted, onRoomCreated }) {
      dbCh = sb.channel('pirch-db')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onMessage(p.new))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, p => p.old?.name && onRoomDeleted?.(p.old.name))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms' }, () => onRoomCreated?.())
        .subscribe(s => onStatus?.(s));
    },

    joinPresence(state, onSync) {
      presenceCh = sb.channel('pirch-online', { config: { presence: { key: user.id } } });
      presenceCh.on('presence', { event: 'sync' }, () => {
        const st = presenceCh.presenceState();
        const list = Object.entries(st).map(([id, metas]) => {
          const last = metas[metas.length - 1] || {};
          const rooms = [...new Set(metas.flatMap(m => m.rooms || []))];
          return { id, nick: last.nick, color: last.color, away: last.away || null, rooms };
        });
        onSync(list);
      });
      presenceCh.subscribe(async s => { if (s === 'SUBSCRIBED') await presenceCh.track(state); });
    },

    async updatePresence(state) {
      if (presenceCh) await presenceCh.track(state);
    },
  };
  return api;
}
