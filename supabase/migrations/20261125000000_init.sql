-- =====================================================================
-- Last Asylum · App de alianza — esquema inicial
-- Se ejecuta UNA vez (GitHub Action o SQL Editor). Después todo se
-- gestiona desde la propia app.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Perfiles y roles
--   pending = registrado, esperando aprobación
--   member  = miembro
--   r4      = oficial (escribe guías, eventos, noticias, aprueba)
--   r5      = líder (todo lo anterior + roles + ajustes privados)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nick        text not null,
  role        text not null default 'pending' check (role in ('pending','member','r4','r5')),
  lang        text not null default 'en',
  tz          text not null default 'UTC',
  created_at  timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('member','r4','r5'), false)
$$;

create or replace function public.is_officer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('r4','r5'), false)
$$;

-- ---------------------------------------------------------------------
-- Ajustes públicos (los ven todos) y privados (solo R5 / funciones)
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),
  alliance_name    text not null default 'Last Asylum',
  alliance_tag     text not null default '',
  server_tz        text not null default 'UTC',
  welcome          text not null default '',
  vapid_public_key text,
  push_ready       boolean not null default false,
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;

create table if not exists public.private_settings (
  id                   int primary key default 1 check (id = 1),
  owner_email          text not null default 'angeddgg@gmail.com', -- entra como R5
  invite_code          text not null default '',
  contact_email        text not null default 'mailto:admin@example.com',
  vapid_private_jwk    jsonb,
  cron_secret          text,
  discord_webhook_url  text not null default '',
  discord_bot_token    text not null default '',
  discord_channel_ids  text not null default '',          -- canales que se muestran en la app
  discord_push_channel_ids text not null default '',      -- canales que además mandan notificación
  discord_state        jsonb not null default '{}'::jsonb,
  mirror_chat_to_discord boolean not null default true,
  google_translate_key text not null default '',
  deepl_key            text not null default ''
);
insert into public.private_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Alta de usuarios: cualquiera puede registrarse, pero entra como
-- PENDIENTE hasta que la líder o un R4/R5 lo apruebe. El email de la
-- dueña de la app (owner_email) entra directamente como R5.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  v_role  text;
begin
  select lower(owner_email) into v_owner from public.private_settings where id = 1;
  if v_owner is not null and lower(new.email) = v_owner then
    v_role := 'r5';
  else
    v_role := 'pending';
  end if;

  insert into public.profiles (id, nick, role, lang, tz)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nick',''), split_part(new.email,'@',1)),
    v_role,
    coalesce(nullif(new.raw_user_meta_data->>'lang',''), 'en'),
    coalesce(nullif(new.raw_user_meta_data->>'tz',''), 'UTC')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nadie puede subirse el rango a sí mismo.
create or replace function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_me text := public.my_role();
begin
  if new.role is distinct from old.role then
    if auth.uid() is null then
      return new;                                   -- funciones del servidor
    elsif v_me = 'r5' then
      if old.id = auth.uid() and new.role <> 'r5'
         and (select count(*) from public.profiles where role = 'r5') <= 1 then
        raise exception 'Debe quedar al menos un R5';
      end if;
      return new;
    elsif v_me = 'r4' and old.role = 'pending' and new.role = 'member' then
      return new;
    else
      raise exception 'Sin permiso para cambiar rangos';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_role();

-- ---------------------------------------------------------------------
-- Contenido
-- ---------------------------------------------------------------------
create table if not exists public.guides (
  id          bigint generated always as identity primary key,
  title       text not null,
  category    text not null default 'eventos',
  body        text not null default '',
  lang        text not null default 'en',
  pinned      boolean not null default false,
  sort        int not null default 0,
  author_id   uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Las horas de los eventos se guardan en HORA DEL SERVIDOR (app_settings.server_tz).
create table if not exists public.events (
  id                  bigint generated always as identity primary key,
  title               text not null,
  description         text not null default '',
  checklist           text not null default '',          -- una línea = un punto
  start_date          date not null default current_date, -- fecha (servidor)
  start_time          text not null default '00:00',      -- HH:MM (servidor)
  duration_min        int  not null default 60,
  recurrence          text not null default 'once' check (recurrence in ('once','daily','weekly')),
  weekdays            int[] not null default '{}',        -- 0=domingo … 6=sábado
  end_date            date,
  remind_before       int[] not null default '{60,15}',   -- minutos antes
  remind_during_every int  not null default 0,            -- 0 = sin avisos durante
  remind_end_before   int  not null default 0,            -- aviso X min antes de terminar
  shield              boolean not null default false,     -- evento de escudo
  color               text not null default '#e5484d',
  to_discord          boolean not null default true,
  active              boolean not null default true,
  created_by          uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null default now()
);

create table if not exists public.event_mutes (
  user_id  uuid references public.profiles(id) on delete cascade,
  event_id bigint references public.events(id) on delete cascade,
  primary key (user_id, event_id)
);

create table if not exists public.announcements (
  id          bigint generated always as identity primary key,
  title       text not null,
  body        text not null default '',
  to_discord  boolean not null default true,
  pushed      boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.reminders (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title       text not null,
  body        text not null default '',
  fire_at     timestamptz not null,
  repeat_min  int not null default 0,
  sent        boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  channel      text not null check (channel in ('general','officers','discord')),
  user_id      uuid references public.profiles(id) on delete set null default auth.uid(),
  author_name  text not null default '',
  body         text not null,
  source       text not null default 'app' check (source in ('app','discord','system')),
  external_id  text unique,
  mirrored     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists messages_channel_idx on public.messages (channel, created_at desc);

-- Rellena el nombre del autor automáticamente.
create or replace function public.fill_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'app' then
    new.user_id := auth.uid();
    select nick into new.author_name from public.profiles where id = auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists messages_fill_author on public.messages;
create trigger messages_fill_author before insert on public.messages
  for each row execute function public.fill_author();

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_log (
  key        text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.translations (
  hash        text not null,
  target      text not null,
  translated  text not null,
  primary key (hash, target)
);

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
-- ---------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.app_settings       enable row level security;
alter table public.private_settings   enable row level security;
alter table public.guides             enable row level security;
alter table public.events             enable row level security;
alter table public.event_mutes        enable row level security;
alter table public.announcements      enable row level security;
alter table public.reminders          enable row level security;
alter table public.messages           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log   enable row level security;
alter table public.translations       enable row level security;

-- profiles
drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select to authenticated using (true);
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_officer()) with check (id = auth.uid() or public.is_officer());
drop policy if exists p_profiles_del on public.profiles;
create policy p_profiles_del on public.profiles for delete to authenticated
  using (public.my_role() = 'r5' or (public.my_role() = 'r4' and role in ('pending','member')));

-- app_settings: lectura pública (incluso sin sesión, para el nombre y la clave push)
drop policy if exists p_app_sel on public.app_settings;
create policy p_app_sel on public.app_settings for select using (true);
drop policy if exists p_app_upd on public.app_settings;
create policy p_app_upd on public.app_settings for update to authenticated
  using (public.my_role() = 'r5') with check (public.my_role() = 'r5');

-- private_settings: solo R5
drop policy if exists p_priv_sel on public.private_settings;
create policy p_priv_sel on public.private_settings for select to authenticated using (public.my_role() = 'r5');
drop policy if exists p_priv_upd on public.private_settings;
create policy p_priv_upd on public.private_settings for update to authenticated
  using (public.my_role() = 'r5') with check (public.my_role() = 'r5');

-- guides / events / announcements: leen miembros, escriben R4/R5
do $$
declare t text;
begin
  foreach t in array array['guides','events','announcements'] loop
    execute format('drop policy if exists %I on public.%I', 'p_'||t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', 'p_'||t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', 'p_'||t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_officer())', 'p_'||t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', 'p_'||t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_officer()) with check (public.is_officer())', 'p_'||t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', 'p_'||t||'_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_officer())', 'p_'||t||'_del', t);
  end loop;
end $$;

-- filas propias
drop policy if exists p_mutes_all on public.event_mutes;
create policy p_mutes_all on public.event_mutes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists p_rem_all on public.reminders;
create policy p_rem_all on public.reminders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists p_push_all on public.push_subscriptions;
create policy p_push_all on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- chat
drop policy if exists p_msg_sel on public.messages;
create policy p_msg_sel on public.messages for select to authenticated using (
  (channel in ('general','discord') and public.is_member())
  or (channel = 'officers' and public.is_officer())
);
drop policy if exists p_msg_ins on public.messages;
create policy p_msg_ins on public.messages for insert to authenticated with check (
  source = 'app' and (
    (channel = 'general' and public.is_member())
    or (channel = 'officers' and public.is_officer())
  )
);
drop policy if exists p_msg_del on public.messages;
create policy p_msg_del on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.is_officer());

-- traducciones en caché: lectura para miembros (las escriben las funciones)
drop policy if exists p_tr_sel on public.translations;
create policy p_tr_sel on public.translations for select to authenticated using (public.is_member());

-- ---------------------------------------------------------------------
-- Tiempo real para el chat y las noticias
-- ---------------------------------------------------------------------
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.messages'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.announcements'; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Programación del "tick" (lo llama la función api → setup, desde la app)
-- ---------------------------------------------------------------------
create or replace function public.admin_schedule_tick(p_url text, p_secret text) returns void
language plpgsql security definer set search_path = public, cron as $$
begin
  if exists (select 1 from cron.job where jobname = 'la-tick') then
    perform cron.unschedule('la-tick');
  end if;
  perform cron.schedule(
    'la-tick',
    '* * * * *',
    format(
      $f$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 55000)$f$,
      p_url, p_secret
    )
  );
  if exists (select 1 from cron.job where jobname = 'la-cleanup') then
    perform cron.unschedule('la-cleanup');
  end if;
  perform cron.schedule('la-cleanup', '17 4 * * *',
    $c$delete from public.notification_log where created_at < now() - interval '14 days';
       delete from public.reminders where sent and created_at < now() - interval '30 days';$c$);
end $$;

revoke all on function public.admin_schedule_tick(text, text) from public, anon, authenticated;
grant execute on function public.admin_schedule_tick(text, text) to service_role;
