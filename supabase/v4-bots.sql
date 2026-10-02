-- =====================================================================
--  v4: บอท (DJ-Bot / PIRCH-Bot) ผ่าน n8n
--  ต้องรัน v3-badwords.sql ก่อน · รันซ้ำได้
--
--  การทำงาน:
--   1) มีคนพิมพ์ข้อความขึ้นต้นด้วย "!" ในห้อง หรือมีสมาชิกใหม่
--      → trigger ส่ง webhook (pg_net) ไปที่ n8n
--   2) n8n ตัดสินใจว่าบอทจะพูดอะไร แล้ว insert ข้อความกลับเข้า messages
--      ด้วย service_role key โดยใส่ sender = id ของบอท
--
--  หลังรันไฟล์นี้ ให้ตั้งค่า URL/secret ของ n8n (ดูท้ายไฟล์)
-- =====================================================================
create extension if not exists pg_net;

-- ---------- บอทเป็น profile พิเศษ (ไม่มีบัญชีล็อกอิน) ----------
alter table public.profiles add column if not exists is_bot boolean not null default false;
alter table public.profiles drop constraint if exists profiles_id_fkey;   -- บอทไม่มีแถวใน auth.users

-- เมื่อลบผู้ใช้ใน Authentication ให้ลบ profile ตาม (แทน FK cascade เดิม)
create or replace function public.on_auth_user_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id and not is_bot;
  return old;
end $$;
drop trigger if exists pirch_on_auth_user_deleted on auth.users;
create trigger pirch_on_auth_user_deleted after delete on auth.users
  for each row execute function public.on_auth_user_deleted();

insert into public.profiles (id, nick, color, quote, is_bot) values
  ('00000000-0000-4000-8000-00000000d0d0', 'DJ-Bot',    6,  'ขอเพลงได้เลย พิมพ์ !play ชื่อเพลง 🎵', true),
  ('00000000-0000-4000-8000-000000000b07', 'PIRCH-Bot', 12, 'พิมพ์ !help ดูว่าบอททำอะไรได้บ้าง 🤖', true)
on conflict (id) do update set is_bot = true, quote = excluded.quote;

-- ---------- ค่าตั้ง webhook (อ่านได้เฉพาะฐานข้อมูลเอง) ----------
create table if not exists public.bot_config (key text primary key, value text not null);
alter table public.bot_config enable row level security;          -- ไม่มี policy = ผู้ใช้ทั่วไปอ่านไม่ได้
revoke all on public.bot_config from anon, authenticated;

-- ---------- ข้อความ: ให้ service_role (n8n) ส่งในนามบอทได้ ----------
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p profiles;
  recent int;
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if auth.uid() is not null then
    new.sender := auth.uid();
  elsif is_service then
    if not exists (select 1 from profiles where id = new.sender and is_bot) then
      raise exception 'service_role ส่งได้เฉพาะในนามบอท';
    end if;
  else
    raise exception 'ต้องล็อกอินก่อน';
  end if;

  select * into p from profiles where id = new.sender;
  if not found then
    raise exception 'ต้องตั้ง nick ก่อนนะ';
  end if;
  new.nick := p.nick;
  new.color := p.color;
  new.created_at := now();

  if not p.is_bot then
    select count(*) into recent from messages
     where sender = new.sender and created_at > now() - interval '10 seconds';
    if recent >= 8 then
      raise exception 'ใจเย็น ๆ พิมพ์รัวเกินไปแล้ว (Excess Flood!)';
    end if;
    if new.kind in ('kick','topic','op')
       and (new.room is null or not is_op(new.room, new.sender)) then
      raise exception 'คำสั่งนี้ใช้ได้เฉพาะ @op ของห้อง';
    end if;
  end if;

  if new.kind in ('msg','action','topic','kick') then
    new.body := clean_text(new.body);
  end if;
  return new;
end $$;

-- ---------- ส่ง event ไป n8n ----------
create or replace function public.bots_notify(payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  url text := (select value from bot_config where key = 'webhook_url');
  secret text := (select value from bot_config where key = 'webhook_secret');
begin
  if url is null or url = '' then return; end if;
  perform net.http_post(
    url := url,
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Pirch-Secret', coalesce(secret, '')),
    timeout_milliseconds := 5000
  );
exception when others then
  -- บอทล่มต้องไม่ทำให้แชทล่ม
  raise warning 'bots_notify failed: %', sqlerrm;
end $$;

create or replace function public.messages_after_insert_bots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.room is not null and new.kind = 'msg' and left(new.body, 1) = '!'
     and not exists (select 1 from profiles where id = new.sender and is_bot) then
    perform bots_notify(jsonb_build_object(
      'type', 'message', 'room', new.room, 'sender', new.sender, 'nick', new.nick,
      'kind', new.kind, 'body', new.body, 'id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists messages_after_insert_bots on public.messages;
create trigger messages_after_insert_bots after insert on public.messages
  for each row execute function public.messages_after_insert_bots();

create or replace function public.profiles_after_insert_bots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_bot then
    perform bots_notify(jsonb_build_object('type', 'new_user', 'nick', new.nick));
  end if;
  return new;
end $$;
drop trigger if exists profiles_after_insert_bots on public.profiles;
create trigger profiles_after_insert_bots after insert on public.profiles
  for each row execute function public.profiles_after_insert_bots();

-- =====================================================================
--  ตั้งค่า n8n (แก้ 2 บรรทัดนี้แล้วรันแยก):
--    insert into public.bot_config values
--      ('webhook_url',    'https://<n8n-ของคุณ>/webhook/pirch26-bots'),
--      ('webhook_secret', '<ตั้งรหัสลับเอง ให้ตรงกับ credential ใน n8n>')
--    on conflict (key) do update set value = excluded.value;
--
--  ปิดบอทชั่วคราว:  delete from public.bot_config where key = 'webhook_url';
-- =====================================================================
