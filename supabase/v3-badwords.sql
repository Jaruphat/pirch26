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
