-- Inspected live table: bigint identity id; station_id/building/floor/room/status text.
-- Additive and repeatable: existing ids and operational statuses are preserved.
begin;
set local lock_timeout = '5s';
alter table public.stations
  add column if not exists floor_number smallint,
  add column if not exists room_status text not null default 'normal';

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.stations'::regclass and conname='stations_floor_number_range') then
    alter table public.stations add constraint stations_floor_number_range check (floor_number between 1 and 3) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.stations'::regclass and conname='stations_room_status_values') then
    alter table public.stations add constraint stations_room_status_values check (room_status in ('normal','out_of_service')) not valid;
  end if;
end $$;

create unique index if not exists stations_station_id_unique
  on public.stations (station_id) where station_id is not null;

with buildings(building, code) as (values
  ('COED','COED'),('Old CAS','OLD-CAS'),('CONHS','CONHS'),
  ('College of Arts and Sciences','CAS'),('College of Engineering','COENG'),('CIT','CIT')
), rooms(floor_number, floor, room, token) as (values
  (1,'1st Floor','Dean''s Office','DEAN'),(1,'1st Floor','Faculty Room','FACULTY'),
  (1,'1st Floor','Room 101','101'),(1,'1st Floor','Room 102','102'),
  (1,'1st Floor','Room 103','103'),(1,'1st Floor','Room 104','104'),(1,'1st Floor','Room 105','105'),
  (2,'2nd Floor','Room 201','201'),(2,'2nd Floor','Room 202','202'),
  (2,'2nd Floor','Room 203','203'),(2,'2nd Floor','Room 204','204'),(2,'2nd Floor','Room 205','205'),
  (3,'3rd Floor','Room 301','301'),(3,'3rd Floor','Room 302','302'),
  (3,'3rd Floor','Room 303','303'),(3,'3rd Floor','Room 304','304'),(3,'3rd Floor','Room 305','305')
)
insert into public.stations (station_id,building,floor_number,floor,room,status,room_status)
select 'SSU-'||b.code||'-'||r.floor_number||'-'||r.token,
       b.building,r.floor_number,r.floor,r.room,'offline','normal'
from buildings b cross join rooms r
on conflict (station_id) where station_id is not null do update
set building=excluded.building, floor_number=excluded.floor_number,
    floor=excluded.floor, room=excluded.room;

do $$ begin
  if (select count(*) from public.stations where station_id like any (array['SSU-COED-%','SSU-OLD-CAS-%','SSU-CONHS-%','SSU-CAS-%','SSU-COENG-%','SSU-CIT-%'])) <> 102 then
    raise exception 'Station verification failed: expected 102 managed locations';
  end if;
end $$;
commit;

select building, count(*) as station_locations, count(distinct floor_number) as floors,
       count(distinct room) as rooms, count(*) filter (where status='online') as online_stations
from public.stations
where station_id like any (array['SSU-COED-%','SSU-OLD-CAS-%','SSU-CONHS-%','SSU-CAS-%','SSU-COENG-%','SSU-CIT-%'])
group by building order by building;
