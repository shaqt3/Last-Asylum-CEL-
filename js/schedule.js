// Cálculo de horarios: hora del servidor → UTC → hora local de cada miembro.
// Este archivo se usa igual en la app (navegador) y en el servidor (Deno).
// Si lo cambias, copia el mismo contenido en supabase/functions/_shared/schedule.js

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Diferencia (ms) entre la hora de pared en `tz` y UTC en el instante `date`. */
export function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una fecha+hora de pared en `tz` a un Date (UTC). */
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/** Fecha de pared {y,m,d,dow} en `tz` para un instante. */
export function wallDate(date, tz) {
  const off = tzOffsetMs(date, tz);
  const w = new Date(date.getTime() + off);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth() + 1, d: w.getUTCDate(), dow: w.getUTCDay() };
}

function ymdKey(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/**
 * Ocurrencias de un evento que se solapan con [fromUtc, toUtc].
 * Devuelve [{ start: Date, end: Date }]
 */
export function occurrences(ev, fromUtc, toUtc, serverTz) {
  const out = [];
  if (!ev || ev.active === false) return out;
  const [hh, mm] = String(ev.start_time || '00:00').split(':').map(Number);
  const dur = Math.max(1, Number(ev.duration_min) || 1) * MIN;
  const startDate = parseYmd(ev.start_date || '1970-01-01');
  const startKey = ymdKey(startDate.y, startDate.m, startDate.d);
  const endKey = ev.end_date ? String(ev.end_date).slice(0, 10) : null;
  const weekdays = (ev.weekdays || []).map(Number);

  // Recorre días de calendario (en hora del servidor) desde un poco antes de `from`.
  const first = wallDate(new Date(fromUtc.getTime() - dur - DAY), serverTz);
  let cursor = Date.UTC(first.y, first.m - 1, first.d);
  const last = wallDate(new Date(toUtc.getTime() + DAY), serverTz);
  const lastCursor = Date.UTC(last.y, last.m - 1, last.d);

  for (let i = 0; cursor <= lastCursor && i < 800; i++, cursor += DAY) {
    const c = new Date(cursor);
    const y = c.getUTCFullYear(), m = c.getUTCMonth() + 1, d = c.getUTCDate(), dow = c.getUTCDay();
    const key = ymdKey(y, m, d);
    if (ev.recurrence === 'once') {
      if (key !== startKey) continue;
    } else {
      if (key < startKey) continue;
      if (endKey && key > endKey) continue;
      if (ev.recurrence === 'weekly' && !weekdays.includes(dow)) continue;
    }
    const start = zonedToUtc(y, m, d, hh, mm, serverTz);
    const end = new Date(start.getTime() + dur);
    if (end >= fromUtc && start <= toUtc) out.push({ start, end });
  }
  return out;
}

/**
 * Momentos de aviso de una ocurrencia.
 * Devuelve [{ at: Date, kind: 'before'|'start'|'during'|'ending', minutes }]
 */
export function triggersFor(ev, occ) {
  const list = [];
  const s = occ.start.getTime();
  const e = occ.end.getTime();
  for (const m of ev.remind_before || []) {
    const n = Number(m);
    if (n > 0) list.push({ at: new Date(s - n * MIN), kind: 'before', minutes: n });
  }
  list.push({ at: new Date(s), kind: 'start', minutes: 0 });
  const every = Number(ev.remind_during_every) || 0;
  if (every > 0) {
    for (let t = s + every * MIN, k = 1; t < e - MIN; t += every * MIN, k++) {
      list.push({ at: new Date(t), kind: 'during', minutes: k * every });
    }
  }
  const endBefore = Number(ev.remind_end_before) || 0;
  if (endBefore > 0 && e - endBefore * MIN > s) {
    list.push({ at: new Date(e - endBefore * MIN), kind: 'ending', minutes: endBefore });
  }
  return list;
}

/** Formatea un instante en la zona y el idioma indicados. */
export function fmt(date, tz, lang, opts = {}) {
  return new Intl.DateTimeFormat(lang || 'es', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...opts,
  }).format(date);
}

export function fmtTime(date, tz, lang) {
  return new Intl.DateTimeFormat(lang || 'es', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}
