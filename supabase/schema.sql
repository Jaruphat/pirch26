-- =====================================================================
--  PIRCH26 Revival — Supabase schema
--  วิธีใช้: Supabase Dashboard > SQL Editor > New query > วางทั้งไฟล์ > Run
--  รันซ้ำได้ (idempotent) ถ้าจะล้างทั้งหมดให้ดูส่วน RESET ท้ายไฟล์
-- =====================================================================

-- ---------- profiles : 1 แถวต่อ 1 คน (nick แบบ IRC) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nick       text not null check (nick ~ '^[A-Za-z0-9_ก-๛\[\]{}|^-]{2,20}$'),
  color      smallint not null default 1 check (color between 0 and 15),   -- สีตัวอักษร (mIRC palette)
  quote      text check (char_length(quote) <= 120),                        -- คำคม / สถานะ
  is_admin   boolean not null default false,                                -- ตั้งเองใน SQL เท่านั้น
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_nick_lower on public.profiles (lower(nick));

-- ---------- rooms ----------
create table if not exists public.rooms (
  name       text primary key check (name ~ '^#[A-Za-z0-9_ก-๛-]{1,30}$'),
  topic      text not null default '' check (char_length(topic) <= 200),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- room_ops : ใครเป็น @op ห้องไหน ----------
create table if not exists public.room_ops (
  room    text references public.rooms(name) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (room, user_id)
);

-- ---------- messages : ข้อความในห้อง + PM ----------
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  room       text references public.rooms(name) on delete cascade,     -- ข้อความในห้อง
  to_user    uuid references public.profiles(id) on delete cascade,    -- หรือ PM หาคนนี้
  sender     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  nick       text not null default '',
  color      smallint not null default 1,
  kind       text not null default 'msg'
             check (kind in ('msg','action','wink','slap','roll','kick','topic','nick','op')),
  body       text not null check (char_length(body) between 1 and 600),
  target     text,                                                     -- nick เป้าหมาย (kick/slap/op)
  created_at timestamptz not null default now(),
  constraint room_xor_pm check ((room is null) <> (to_user is null))
);
create index if not exists messages_room_id   on public.messages (room, id desc);
create index if not exists messages_to_id     on public.messages (to_user, id desc);
create index if not exists messages_sender_id on public.messages (sender, id desc);

-- =====================================================================
--  Functions & triggers
-- =====================================================================
create or replace function public.is_op(p_room text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_ops where room = p_room and user_id = p_user)
      or exists (select 1 from profiles where id = p_user and is_admin);
$$;

-- คนสร้างห้องได้ @op อัตโนมัติ
create or replace function public.rooms_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into room_ops(room, user_id) values (new.name, new.created_by) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists rooms_after_insert on public.rooms;
create trigger rooms_after_insert after insert on public.rooms
  for each row execute function public.rooms_after_insert();

-- ก่อนบันทึกข้อความ: ใส่ nick/สีจริงจาก profile (กันปลอมชื่อ), กัน flood, เช็คสิทธิ์ op
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p profiles;
  recent int;
begin
  new.sender := auth.uid();
  select * into p from profiles where id = new.sender;
  if not found then
    raise exception 'ต้องตั้ง nick ก่อนนะ';
  end if;
  new.nick := p.nick;
  new.color := p.color;
  new.created_at := now();

  select count(*) into recent from messages
   where sender = new.sender and created_at > now() - interval '10 seconds';
  if recent >= 8 then
    raise exception 'ใจเย็น ๆ พิมพ์รัวเกินไปแล้ว (Excess Flood!)';
  end if;

  if new.kind in ('kick','topic','op')
     and (new.room is null or not is_op(new.room, new.sender)) then
    raise exception 'คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง';
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

-- =====================================================================
--  Row Level Security + สิทธิ์ระดับคอลัมน์
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.room_ops enable row level security;
alter table public.messages enable row level security;

revoke all on public.profiles, public.rooms, public.room_ops, public.messages from anon, authenticated;
grant select on public.profiles, public.rooms, public.room_ops, public.messages to authenticated;
grant insert (id, nick, color, quote) on public.profiles to authenticated;
grant update (nick, color, quote)     on public.profiles to authenticated;
grant insert (name, topic)            on public.rooms    to authenticated;
grant update (topic)                  on public.rooms    to authenticated;
grant insert, delete                  on public.room_ops to authenticated;
grant insert (room, to_user, kind, body, target) on public.messages to authenticated;

-- profiles
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- rooms
drop policy if exists rooms_read   on public.rooms;
drop policy if exists rooms_insert on public.rooms;
drop policy if exists rooms_topic  on public.rooms;
create policy rooms_read   on public.rooms for select to authenticated using (true);
create policy rooms_insert on public.rooms for insert to authenticated with check (created_by = auth.uid());
create policy rooms_topic  on public.rooms for update to authenticated using (public.is_op(name, auth.uid()));

-- room_ops
drop policy if exists ops_read   on public.room_ops;
drop policy if exists ops_insert on public.room_ops;
drop policy if exists ops_delete on public.room_ops;
create policy ops_read   on public.room_ops for select to authenticated using (true);
create policy ops_insert on public.room_ops for insert to authenticated with check (public.is_op(room, auth.uid()));
create policy ops_delete on public.room_ops for delete to authenticated using (public.is_op(room, auth.uid()));

-- messages: ข้อความในห้องทุกคนเห็น, PM เห็นเฉพาะคนส่ง/คนรับ
drop policy if exists msg_read   on public.messages;
drop policy if exists msg_insert on public.messages;
create policy msg_read on public.messages for select to authenticated
  using (room is not null or sender = auth.uid() or to_user = auth.uid());
create policy msg_insert on public.messages for insert to authenticated
  with check (sender = auth.uid());

-- =====================================================================
--  Realtime (ข้อความเด้งทันที)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- =====================================================================
--  ห้องเริ่มต้น
-- =====================================================================
insert into public.rooms (name, topic, created_by) values
  ('#ห้องรวม',  'ยินดีต้อนรับสู่ PIRCH26 Revival ~ ห้ามเกรียน ห้ามขายตรง ห้ามถามอายุ ^_^', null),
  ('#วัยรุ่น',   'วัยรุ่นยุค 56k มารวมกันตรงนี้!!', null),
  ('#คนเหงา',   'เหงาไหม... คุยกันได้นะ', null),
  ('#เกมเมอร์', 'RO / Counter-Strike 1.6 / Red Alert ใครยังเล่นอยู่บ้าง', null),
  ('#เพลงรัก',  'ขอเพลงได้ตลอดคืน ~ Now playing: เพลงรักยุค 90', null)
on conflict (name) do nothing;

-- =====================================================================
--  (ไม่บังคับ) ตั้งตัวเองเป็นแอดมิน = @op ทุกห้อง
--  หลังล็อกอินและตั้ง nick แล้ว รัน:
--    update public.profiles set is_admin = true where nick = 'ชื่อเล่นของคุณ';
--
--  (ไม่บังคับ) ลบข้อความเก่ากว่า 30 วันทุกคืน — ต้องเปิด extension pg_cron ก่อน
--    select cron.schedule('pirch-cleanup', '0 4 * * *',
--      $$delete from public.messages where created_at < now() - interval '30 days'$$);
--
--  RESET (ลบทุกอย่าง):
--    drop table if exists public.messages, public.room_ops, public.rooms, public.profiles cascade;
-- =====================================================================

-- =====================================================================
--  v2: ลบห้องได้ (คนสร้างห้อง หรือแอดมิน) — ข้อความ/op ในห้องจะถูกลบตาม (cascade)
-- =====================================================================
grant delete on public.rooms to authenticated;
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete to authenticated
  using (created_by = auth.uid()
         or exists (select 1 from public.profiles where id = auth.uid() and is_admin));
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;

-- =====================================================================
--  v3: กรองคำหยาบ (ทำที่ฐานข้อมูล — เลี่ยงจากหน้าเว็บไม่ได้)
--  - ข้อความ / หัวข้อห้อง / เหตุผลตอนเตะ / คำคม : คำหยาบถูกแทนด้วย ***
--  - ชื่อเล่น (nick) และชื่อห้อง : ถ้ามีคำหยาบจะตั้งไม่ได้
--  - จับแบบใส่จุด/ขีด/สีคั่นตัวอักษรด้วย เช่น "ค.ว.ย" "f.u.c.k" (คำไทยจับแบบเว้นวรรคด้วย)
--  - แอดมินเพิ่ม/ลบคำได้จากหน้าเว็บ: /badword add คำ , /badword del คำ , /badword
--  รันซ้ำได้
-- =====================================================================
create table if not exists public.bad_words (
  word       text primary key check (char_length(word) between 2 and 40),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_user and is_admin);
$$;

-- แทนคำหยาบด้วย ***
create or replace function public.clean_text(t text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  w text;
  -- ตัวคั่นที่ยอมให้แทรกระหว่างตัวอักษร (จุด ขีด ดอกจัน รหัสสี)
  -- คำภาษาไทยยอมให้เว้นวรรคคั่นด้วย; คำอังกฤษไม่ยอม (กัน "this hit" ถูกมองเป็น "shit")
  sep_th constant text := '(?:[[:space:]._*~+=/\\|-]|\x02|\x0f|\x16|\x1d|\x1f|\x03[0-9]{0,2}(?:,[0-9]{1,2})?)*';
  sep_en constant text := '(?:[._*~+=/\\|-]|\x02|\x0f|\x16|\x1d|\x1f|\x03[0-9]{0,2}(?:,[0-9]{1,2})?)*';
  sep text;
  pat text;
begin
  if t is null or t = '' then return t; end if;
  for w in select word from bad_words loop
    sep := case when w ~ '^[A-Za-z]+$' then sep_en else sep_th end;
    select string_agg(regexp_replace(c, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), sep)
      into pat from regexp_split_to_table(lower(w), '') as c;
    t := regexp_replace(t, pat, '***', 'gi');
  end loop;
  return t;
end $$;

create or replace function public.has_bad_word(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and public.clean_text(t) is distinct from t;
$$;

-- ข้อความ: แทรกการกรองเข้าไปใน trigger เดิม
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p profiles;
  recent int;
begin
  new.sender := auth.uid();
  select * into p from profiles where id = new.sender;
  if not found then
    raise exception 'ต้องตั้ง nick ก่อนนะ';
  end if;
  new.nick := p.nick;
  new.color := p.color;
  new.created_at := now();

  select count(*) into recent from messages
   where sender = new.sender and created_at > now() - interval '10 seconds';
  if recent >= 8 then
    raise exception 'ใจเย็น ๆ พิมพ์รัวเกินไปแล้ว (Excess Flood!)';
  end if;

  if new.kind in ('kick','topic','op')
     and (new.room is null or not is_op(new.room, new.sender)) then
    raise exception 'คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง';
  end if;

  if new.kind in ('msg','action','topic','kick') then
    new.body := clean_text(new.body);
  end if;
  return new;
end $$;

-- ชื่อเล่น + คำคม
create or replace function public.profiles_clean()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if has_bad_word(new.nick) then raise exception 'ชื่อนี้มีคำไม่สุภาพ ลองชื่ออื่นนะ'; end if;
  new.quote := clean_text(new.quote);
  return new;
end $$;
drop trigger if exists profiles_clean on public.profiles;
create trigger profiles_clean before insert or update on public.profiles
  for each row execute function public.profiles_clean();

-- ชื่อห้อง + หัวข้อห้อง
create or replace function public.rooms_clean()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and has_bad_word(new.name) then raise exception 'ชื่อห้องมีคำไม่สุภาพ ลองชื่ออื่นนะ'; end if;
  new.topic := coalesce(clean_text(new.topic), '');
  return new;
end $$;
drop trigger if exists rooms_clean on public.rooms;
create trigger rooms_clean before insert or update on public.rooms
  for each row execute function public.rooms_clean();

-- สิทธิ์: ดู/เพิ่ม/ลบคำได้เฉพาะแอดมิน
alter table public.bad_words enable row level security;
revoke all on public.bad_words from anon, authenticated;
grant select, insert, delete on public.bad_words to authenticated;
drop policy if exists bw_read on public.bad_words;
drop policy if exists bw_insert on public.bad_words;
drop policy if exists bw_delete on public.bad_words;
create policy bw_read   on public.bad_words for select to authenticated using (public.is_admin());
create policy bw_insert on public.bad_words for insert to authenticated with check (public.is_admin());
create policy bw_delete on public.bad_words for delete to authenticated using (public.is_admin());

-- คำเริ่มต้น (แก้/เพิ่ม/ลบได้ทีหลัง)
insert into public.bad_words (word) values
  ('เหี้ย'), ('เหี่ย'), ('สัส'), ('ควย'), ('เย็ด'), ('แตด'), ('จัญไร'), ('ระยำ'),
  ('ชิบหาย'), ('ส้นตีน'), ('ตีนตบ'), ('อีดอก'), ('อีสัตว์'), ('ไอ้สัตว์'), ('ไอ้เวร'), ('อีเวร'),
  ('ไอ้ห่า'), ('อีห่า'), ('กะหรี่'), ('ร่าน'), ('เงี่ยน'), ('หน้าหี'), ('อีหี'), ('หีแม่'),
  ('fuck'), ('shit'), ('bitch'), ('asshole'), ('cunt'), ('bastard')
on conflict do nothing;
