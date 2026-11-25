-- Starter content. R4/R5 can edit or delete it from the app.

insert into public.guides (title, category, pinned, sort, lang, body)
select * from (values
(
  'How to use this app', 'basicos', true, 0, 'en',
$md$## Welcome to the Asylum
This app is the alliance's headquarters: **guides**, an **event calendar in your local time**, **chat**, **news** and **reminders** that reach your phone.

## First steps
1. Install it: on Android, browser menu → *Install app*. On iPhone, Safari → *Share* → *Add to Home Screen* (on iPhone notifications **only** work when installed).
2. Go to **More → Settings** and tap **Enable notifications**. Use *Send test* to check.
3. Check your **time zone** in Settings. Every event is shown in your own time.
4. Prefer another language? Change it in Settings, and use the 🌐 button to translate guides and chat.

## Alerts
Each event alerts you before it starts, while it runs and before it ends, as configured by R4/R5. Not interested in an event? Mute it from its page.
$md$
),
(
  'Shields: when and how', 'trucos', true, 1, 'en',
$md$## Activating a shield
Tap your base → **Shield** → pick the duration.

## Tips
- Avoid spending gems on shields: check the **alliance shop** first.
- Before logging off on war days or PvP events, **shield up**.
- Use **Reminders → Shield timer** so the app warns you before it expires.
$md$
),
(
  'Alliance Duel', 'eventos', false, 2, 'en',
$md$## What it is
A recurring event in phases: each day scores a different category.

## Key points
- Save speed-ups and resources for the phase that scores them.
- Check the app calendar: R4/R5 note what each day is about.
- The last phase is usually combat: **shield up** if you are not taking part.

*(R4/R5: complete this guide with your alliance's phases and priorities.)*
$md$
),
(
  'Hunt Battle', 'eventos', false, 3, 'en',
$md$## What it is
An alliance wave event started by an **R4 or R5**. It needs a minimum number of members.

## Key points
- Be online at the time shown in the calendar.
- Have your troops healed and marches ready before it starts.

*(R4/R5: add your usual time and chosen difficulty.)*
$md$
),
(
  'Upgrade priorities', 'mejoras', false, 4, 'en',
$md$## Suggested order (editable by R4/R5)
1. Main building / Sanctuary.
2. Resource and speed research.
3. Hospital and walls.
4. Your main heroes.
$md$
)
) as v(title, category, pinned, sort, lang, body)
where not exists (select 1 from public.guides);

-- Example event (inactive): shield window at 02:00 server time
insert into public.events (title, description, checklist, start_time, duration_min, recurrence, weekdays,
                           remind_before, remind_during_every, remind_end_before, shield, active, color)
select 'Example: shield window', 'Example event. Edit or delete it.',
       E'Shield up\nCollect resources\nHeal troops in the hospital',
       '02:00', 120, 'weekly', '{6}', '{180,60,15}', 60, 15, true, false, '#3e63dd'
where not exists (select 1 from public.events);
