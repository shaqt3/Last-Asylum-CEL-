import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { t, setLang, getLang, detectLang, LANGS } from './i18n.js';
import { occurrences, triggersFor, fmt, fmtTime, zonedToUtc } from './schedule.js';
import { doctorSVG, attachDoctor } from './doctor.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// =====================================================================
// Utilidades
// =====================================================================
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const CATEGORIES = ['basicos', 'eventos', 'trucos', 'mejoras', 'heroes', 'alianza'];
const ROLES = ['member', 'r4', 'r5'];

const state = {
  session: null,
  me: null,
  settings: {},
  events: [],
  mutes: new Set(),
  deferredInstall: null,
  channels: [],
  autoTr: localStorage.getItem('la_autotr') === '1',
};

const myTz = () => state.me?.tz || deviceTz();
const serverTz = () => state.settings.server_tz || 'UTC';
const isOfficer = () => ['r4', 'r5'].includes(state.me?.role);
const isR5 = () => state.me?.role === 'r5';
const view = () => $('#view');

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function fail(e) {
  console.error(e);
  toast(`${t('error')}: ${e?.message || e}`, 4500);
}

function openModal(html) {
  $('#sheet').innerHTML = html;
  $('#modal').hidden = false;
  return $('#sheet');
}
function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(mi).padStart(2, '0')} min`;
  return `${mi} min`;
}

function wallParts(date, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date)) p[x.type] = x.value;
  return { y: p.year, m: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, mi: p.minute };
}

function dayLabel(date) {
  const tz = myTz();
  const key = (d) => { const p = wallParts(d, tz); return `${p.y}${p.m}${p.d}`; };
  if (key(date) === key(new Date())) return t('today');
  if (key(date) === key(new Date(Date.now() + DAY))) return t('tomorrow');
  return new Intl.DateTimeFormat(getLang(), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function weekdayNames() {
  const f = new Intl.DateTimeFormat(getLang(), { weekday: 'short', timeZone: 'UTC' });
  return [0, 1, 2, 3, 4, 5, 6].map((i) => f.format(new Date(Date.UTC(2023, 0, 1 + i))));
}

function timeZones() {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { list = [deviceTz()]; }
  return ['UTC', ...list.filter((z) => z !== 'UTC')];
}

function tzOptions(selected) {
  return timeZones().map((z) => `<option ${z === selected ? 'selected' : ''}>${esc(z)}</option>`).join('');
}

// Markdown sencillo y seguro (escapa primero el HTML).
function md(src) {
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html = '';
  let list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of esc(src).split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^###\s+(.*)/))) { closeList(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^#{1,2}\s+(.*)/))) { closeList(); html += `<h2>${inline(m[1])}</h2>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^&gt;\s?(.*)/))) { closeList(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (!line.trim()) { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

// =====================================================================
// Servidor (función "api")
// =====================================================================
async function api(action, payload = {}) {
  const { data, error } = await sb.functions.invoke('api', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { /* nada */ }
    throw new Error(msg);
  }
  return data;
}

// ---------- traducción ----------
const trCache = new Map();
async function translateMany(texts) {
  const lang = getLang();
  const need = [...new Set(texts.filter((x) => x && !trCache.has(`${lang}|${x}`)))];
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    const { translations } = await api('translate', { texts: chunk, target: lang });
    chunk.forEach((x, k) => trCache.set(`${lang}|${x}`, translations[k]));
  }
  return texts.map((x) => trCache.get(`${lang}|${x}`) ?? x);
}

// Bloque traducible: devuelve HTML con botón 🌐 que alterna original/traducción.
const trReg = new Map();
let trSeq = 0;
function translatable(text, render = md, { button = true, cls = '' } = {}) {
  const id = `tr${++trSeq}`;
  trReg.set(id, { text, render, shown: 'orig' });
  return `<div class="${cls}" id="${id}">${render(text)}</div>${button && text ? `<button class="btn small ghost" data-tr="${id}">🌐 ${t('translate')}</button>` : ''}`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tr]');
  if (!b) return;
  const id = b.dataset.tr;
  const reg = trReg.get(id);
  const box = document.getElementById(id);
  if (!reg || !box) return;
  try {
    if (reg.shown === 'orig') {
      b.disabled = true;
      const [tr] = await translateMany([reg.text]);
      box.innerHTML = reg.render(tr);
      reg.shown = 'tr';
      b.textContent = `↩ ${t('original')}`;
    } else {
      box.innerHTML = reg.render(reg.text);
      reg.shown = 'orig';
      b.textContent = `🌐 ${t('translate')}`;
    }
  } catch (err) { fail(err); } finally { b.disabled = false; }
});

// =====================================================================
// Notificaciones push
// =====================================================================
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function urlB64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function bufToB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub && state.settings.vapid_public_key) {
    const key = sub.options?.applicationServerKey ? bufToB64url(sub.options.applicationServerKey) : null;
    if (key && key !== state.settings.vapid_public_key) return 'off';
  }
  return sub ? 'on' : 'off';
}

async function enablePush({ silent = false } = {}) {
  const st = await pushStatus();
  if (st === 'unsupported') return toast(t('notif_ios'), 6000);
  if (!state.settings.vapid_public_key) return toast(t('notif_not_ready'), 5000);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast(t('notif_blocked'), 5000);
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const key = sub.options?.applicationServerKey ? bufToB64url(sub.options.applicationServerKey) : null;
    if (key !== state.settings.vapid_public_key) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(state.settings.vapid_public_key),
    });
  }
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert(
    { user_id: state.me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
  if (!silent) toast(t('notif_on'));
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

// =====================================================================
// Datos
// =====================================================================
async function loadSettings() {
  const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  state.settings = data || {};
  $('#brand-name').textContent = state.settings.alliance_tag
    ? `[${state.settings.alliance_tag}] ${state.settings.alliance_name}` : (state.settings.alliance_name || 'Last Asylum');
}

async function loadEvents() {
  const [{ data: ev }, { data: mu }] = await Promise.all([
    sb.from('events').select('*').order('start_time'),
    sb.from('event_mutes').select('event_id'),
  ]);
  state.events = ev || [];
  state.mutes = new Set((mu || []).map((m) => m.event_id));
}

function upcoming(fromMs, toMs, { includeInactive = false } = {}) {
  const out = [];
  for (const ev of state.events) {
    if (!includeInactive && !ev.active) continue;
    for (const o of occurrences(ev, new Date(fromMs), new Date(toMs), serverTz())) out.push({ ev, ...o });
  }
  return out.sort((a, b) => a.start - b.start);
}

// =====================================================================
// Reloj, cuentas atrás e idioma
// =====================================================================
function tickClock() {
  const now = new Date();
  $('#clock').innerHTML = `<b>${fmtTime(now, myTz(), getLang())}</b><br>${t('server_time')} ${fmtTime(now, serverTz(), getLang())}`;
  for (const el of $$('[data-cd]')) {
    const target = Number(el.dataset.cd);
    const end = Number(el.dataset.end || 0);
    const n = Date.now();
    if (end && n >= target && n < end) el.textContent = `${t('ends_in')} ${fmtDur(end - n)}`;
    else if (n < target) el.textContent = `${t('starts_in')} ${fmtDur(target - n)}`;
    else el.textContent = '';
  }
}

function applyStaticI18n() {
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

// =====================================================================
// Tema claro / oscuro
// =====================================================================
function currentTheme() {
  // Dark steampunk is the default; light (parchment) is optional.
  return localStorage.getItem('la_theme') === 'light' ? 'light' : 'dark';
}
function applyTheme(mode) {
  // mode: 'light' | 'dark'
  const m = mode === 'light' ? 'light' : 'dark';
  localStorage.setItem('la_theme', m);
  document.documentElement.setAttribute('data-theme', m);
  const eff = currentTheme();
  $('#theme-btn').textContent = eff === 'light' ? '☾' : '☀';
  $('#theme-btn').title = t('theme');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', eff === 'light' ? '#eadbb8' : '#0e0a07');
}
$('#theme-btn').addEventListener('click', () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light'));

// =====================================================================
// Router
// =====================================================================
const routes = {};
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

async function render() {
  if (!state.me || state.me.role === 'pending') return;
  const [, name = 'home', arg, arg2] = (location.hash || '#/home').split('/');
  const fn = routes[name] || routes.home;
  for (const a of $$('#tabbar a')) {
    const tab = a.dataset.tab;
    a.classList.toggle('on', tab === name || (tab === 'more' && ['reminders', 'settings', 'admin', 'more'].includes(name)));
  }
  if (name === 'chat') $('#chat-dot').hidden = true;
  window.scrollTo(0, 0);
  try { await fn(arg, arg2); } catch (e) { fail(e); }
  tickClock();
}
window.addEventListener('hashchange', render);

// =====================================================================
// Pantallas: acceso
// =====================================================================
const notConfigured = () => SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_ANON_KEY.includes('PEGA-AQUI');

function doctorLines() {
  return { idle: t('doc_idle'), email: t('doc_email'), pass: t('doc_pass'), peek: t('doc_peek'), error: t('doc_error') };
}

function renderAuth(mode = 'login', notice = '') {
  $('#tabbar').hidden = true;
  const reg = mode === 'register';
  view().innerHTML = `
    <div class="auth">
      <div class="auth-stage">${doctorSVG()}<div class="fog"></div></div>
      <div class="bubble" id="doc-bubble"></div>
      <h1 class="center" style="padding:0 0 12px">${esc(state.settings.alliance_name || 'Last Asylum')}</h1>
      <div class="row" style="justify-content:center;margin-bottom:14px">
        <select id="lang-pick" style="width:auto">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      ${notConfigured() ? `<div class="setup-warn">⚙ ${t('not_configured')}</div>` : ''}
      ${notice ? `<div class="banner info">${esc(notice)}</div>` : ''}
      <form class="card" id="auth-form">
        <h2>${reg ? t('register') : t('login')}</h2>
        ${reg ? `<div class="field"><label>${t('nick')}</label><input name="nick" required maxlength="40" autocomplete="nickname"></div>` : ''}
        <div class="field"><label>${t('email')}</label><input name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label>${t('password')}</label>
          <div class="pass-wrap"><input name="password" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}"><button type="button" data-show-pass aria-label="Show password">👁</button></div></div>
        ${reg ? `<p class="hint">${t('pending_text')}</p>` : ''}
        <button class="btn primary block" type="submit">${reg ? t('register') : t('login')}</button>
      </form>
      <p class="center" style="padding:8px"><a href="#" id="auth-switch">${reg ? t('have_account') : t('no_account')}</a></p>
    </div>`;
  const form = $('#auth-form');
  const doctor = attachDoctor(view(), form, doctorLines());
  $('#lang-pick').onchange = (e) => { setLang(e.target.value); applyStaticI18n(); renderAuth(mode); };
  $('#auth-switch').onclick = (e) => { e.preventDefault(); renderAuth(reg ? 'login' : 'register'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (reg) {
        const { data, error } = await sb.auth.signUp({
          email: f.email.trim(), password: f.password,
          options: {
            emailRedirectTo: location.origin,
            data: { nick: f.nick.trim(), lang: getLang(), tz: deviceTz() },
          },
        });
        if (error) throw error;
        if (!data.session) renderAuth('login', t('check_email'));
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw error;
      }
    } catch (err) { doctor.error(); fail(err); } finally { btn.disabled = false; }
  };
}

function renderPending() {
  $('#tabbar').hidden = true;
  view().innerHTML = `
    <div class="auth center">
      <div class="auth-stage">${doctorSVG()}<div class="fog"></div></div>
      <h1>${t('pending_title')}</h1>
      <p class="muted">${t('pending_text')}</p>
      <p><b>${esc(state.me?.nick || '')}</b></p>
      <button class="btn" id="pend-retry">↻</button>
      <button class="btn ghost" id="pend-out">${t('logout')}</button>
    </div>`;
  $('#pend-retry').onclick = () => start();
  $('#pend-out').onclick = () => sb.auth.signOut();
}

// =====================================================================
// Inicio
// =====================================================================
routes.home = async () => {
  const [{ data: news }] = await Promise.all([
    sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(15),
    loadEvents(),
  ]);
  const now = Date.now();
  const running = upcoming(now - DAY, now).filter((o) => o.end > now);
  const next = upcoming(now, now + 3 * DAY).filter((o) => o.start > now).slice(0, 6);
  const ps = await pushStatus().catch(() => 'unsupported');

  view().innerHTML = `
    ${ps !== 'on' ? `<div class="banner warn"><p>${t('notif_banner')}</p>
      ${isIOS() && !isStandalone() ? `<p class="hint">${t('notif_ios')}</p>` : `<button class="btn primary" id="home-push">${t('enable_notif')}</button>`}</div>` : ''}
    ${state.deferredInstall ? `<button class="btn block" id="home-install" style="margin-bottom:12px">⬇ ${t('install')}</button>` : ''}
    ${state.settings.welcome ? `<div class="card md">${translatable(state.settings.welcome)}</div>` : ''}

    ${running.length ? `<div class="section-title"><h2>🔴 ${t('running_now')}</h2></div>${running.map(evRow).join('')}` : ''}

    <div class="section-title"><h2>⚙ ${t('next_events')}</h2><a href="#/events">${t('all_events')} ›</a></div>
    ${next.length ? next.map(evRow).join('') : `<p class="muted">${t('no_events')}</p>`}

    <a class="card list-link" href="#/reminders"><span>🛡️ <b>${t('shield_timer')}</b></span></a>

    <div class="section-title"><h2>📣 ${t('news')}</h2>
      ${isOfficer() ? `<div class="row"><button class="btn small" id="news-bc">🚨</button><button class="btn small primary" id="news-new">＋ ${t('new_news')}</button></div>` : ''}
    </div>
    <div id="news">${(news || []).length ? news.map(newsCard).join('') : `<p class="muted">${t('no_news')}</p>`}</div>`;

  $('#home-push')?.addEventListener('click', () => enablePush().then(render).catch(fail));
  $('#home-install')?.addEventListener('click', doInstall);
  $('#news-new')?.addEventListener('click', () => editNews());
  $('#news-bc')?.addEventListener('click', broadcastModal);
  for (const b of $$('[data-del-news]')) {
    b.onclick = async () => {
      if (!confirm(t('confirm_delete'))) return;
      await sb.from('announcements').delete().eq('id', b.dataset.delNews);
      render();
    };
  }
};

function evRow(o) {
  const { ev, start, end } = o;
  const tz = myTz();
  const live = Date.now() >= start && Date.now() < end;
  return `
    <a class="card tight ev" href="#/events/${ev.id}">
      <span class="bar" style="background:${esc(ev.color)}"></span>
      <span class="when"><b>${fmtTime(start, tz, getLang())}</b><small>${fmtTime(end, tz, getLang())}</small></span>
      <span class="grow">
        <span class="title">${esc(ev.title)}</span>
        ${ev.shield ? ` <span class="badge shield">🛡️</span>` : ''}
        ${live ? ` <span class="badge live">LIVE</span>` : ''}
        ${state.mutes.has(ev.id) ? ` <span class="badge">🔕</span>` : ''}
        <br><span class="countdown" data-cd="${start.getTime()}" data-end="${end.getTime()}"></span>
        <small> · ${dayLabel(start)} · ${t('server_time')} ${fmtTime(start, serverTz(), getLang())}</small>
      </span>
    </a>`;
}

function newsCard(n) {
  return `
    <div class="card">
      <div class="row between"><h3>${esc(n.title)}</h3>
        ${isOfficer() ? `<button class="btn small ghost" data-del-news="${n.id}">✕</button>` : ''}</div>
      <small>${fmt(new Date(n.created_at), myTz(), getLang())}</small>
      <div class="md" style="margin-top:6px">${translatable(n.body)}</div>
    </div>`;
}

function editNews() {
  const s = openModal(`
    <h2>${t('new_news')}</h2>
    <form id="nf">
      <div class="field"><label>${t('title')}</label><input name="title" required maxlength="120"></div>
      <div class="field"><label>${t('body')}</label><textarea name="body"></textarea><div class="hint">${t('md_help')}</div></div>
      <label class="check"><input type="checkbox" name="to_discord" checked> ${t('send_discord')}</label>
      <div class="row" style="margin-top:12px"><button type="button" class="btn ghost grow" id="nf-x">${t('cancel')}</button><button class="btn primary grow">${t('save')}</button></div>
    </form>`);
  $('#nf-x', s).onclick = closeModal;
  $('#nf', s).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.from('announcements').insert({
      title: f.get('title'), body: f.get('body'), to_discord: f.get('to_discord') === 'on', created_by: state.me.id,
    });
    if (error) return fail(error);
    closeModal(); toast(t('saved')); render();
  };
}

function broadcastModal() {
  const s = openModal(`
    <h2>🚨 ${t('broadcast')}</h2>
    <form id="bf">
      <div class="field"><label>${t('title')}</label><input name="title" required maxlength="120" placeholder="¡Escudo YA! / Shield NOW!"></div>
      <div class="field"><label>${t('body')}</label><textarea name="body" style="min-height:70px"></textarea></div>
      <label class="check"><input type="checkbox" name="to_discord" checked> ${t('send_discord')}</label>
      <div class="row" style="margin-top:12px"><button type="button" class="btn ghost grow" id="bf-x">${t('cancel')}</button><button class="btn primary grow">${t('broadcast_send')}</button></div>
    </form>`);
  $('#bf-x', s).onclick = closeModal;
  $('#bf', s).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('broadcast', { title: f.get('title'), body: f.get('body'), to_discord: f.get('to_discord') === 'on' });
      closeModal(); toast(`✓ ${r.sent}`);
    } catch (err) { fail(err); }
  };
}

// =====================================================================
// Eventos
// =====================================================================
routes.events = async (id) => {
  await loadEvents();
  if (id && id !== 'all') return eventDetail(Number(id));
  const showAll = id === 'all';
  let html = `
    <div class="row between"><h1>${t('nav_events')}</h1>
      ${isOfficer() ? `<button class="btn primary small" id="ev-new">＋ ${t('new')}</button>` : ''}</div>
    <div class="chips" style="margin:8px 0 4px">
      <a class="chip ${showAll ? '' : 'on'}" href="#/events">7 d</a>
      <a class="chip ${showAll ? 'on' : ''}" href="#/events/all">${t('all_events')}</a>
    </div>
    <p class="hint">${t('your_time')}: ${esc(myTz())} · ${t('server_time')}: ${esc(serverTz())}</p>`;

  if (showAll) {
    html += state.events.length ? state.events.map((ev) => {
      const nxt = upcoming(Date.now(), Date.now() + 60 * DAY, { includeInactive: true }).find((o) => o.ev.id === ev.id);
      return `<a class="card tight ev" href="#/events/${ev.id}" style="${ev.active ? '' : 'opacity:.5'}">
        <span class="bar" style="background:${esc(ev.color)}"></span>
        <span class="grow"><span class="title">${esc(ev.title)}</span> ${ev.shield ? '<span class="badge shield">🛡️</span>' : ''}
        <br><small>${recurrenceText(ev)}${nxt ? ` · ${fmt(nxt.start, myTz(), getLang())}` : ''}</small></span></a>`;
    }).join('') : `<p class="muted">${t('no_events')}</p>`;
  } else {
    const now = Date.now();
    const list = upcoming(now - 6 * 3600_000, now + 7 * DAY).filter((o) => o.end > now);
    if (!list.length) html += `<p class="muted">${t('no_events')}</p>`;
    let lastDay = '';
    for (const o of list) {
      const dl = dayLabel(o.start);
      if (dl !== lastDay) { html += `<div class="day-label">${dl}</div>`; lastDay = dl; }
      html += evRow(o);
    }
  }
  view().innerHTML = html;
  $('#ev-new')?.addEventListener('click', () => editEvent(null));
};

function recurrenceText(ev) {
  const wd = weekdayNames();
  const time = `${ev.start_time} (${t('server_time')})`;
  if (ev.recurrence === 'daily') return `${t('daily')} · ${time}`;
  if (ev.recurrence === 'weekly') return `${(ev.weekdays || []).map((d) => wd[d]).join(', ')} · ${time}`;
  return `${ev.start_date} · ${time}`;
}

async function eventDetail(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) { view().innerHTML = `<p class="muted">404</p>`; return; }
  const now = Date.now();
  const occs = occurrences(ev, new Date(now - DAY), new Date(now + 60 * DAY), serverTz()).filter((o) => o.end > now).slice(0, 6);
  const tz = myTz();
  const lang = getLang();
  const nextOcc = occs[0];
  const kinds = { before: t('kind_before'), start: t('kind_start'), during: t('kind_during'), ending: t('kind_ending') };
  const checklist = String(ev.checklist || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const muted = state.mutes.has(ev.id);

  view().innerHTML = `
    <a href="#/events">‹ ${t('nav_events')}</a>
    <div class="card" style="border-left:4px solid ${esc(ev.color)};margin-top:10px">
      <div class="row between"><h1>${esc(ev.title)}</h1>${ev.shield ? '<span class="badge shield">🛡️</span>' : ''}</div>
      <small>${recurrenceText(ev)} · ${ev.duration_min} min</small>
      ${ev.description ? `<div class="md" style="margin-top:10px">${translatable(ev.description)}</div>` : ''}
      ${checklist.length ? `<h3 style="margin-top:12px">✔</h3><div class="md">${translatable(checklist.map((c) => `- ${c}`).join('\n'))}</div>` : ''}
    </div>

    <div class="section-title"><h2>${t('upcoming')}</h2></div>
    ${occs.length ? occs.map((o) => `
      <div class="card tight row between">
        <span><b>${fmt(o.start, tz, lang)}</b> – ${fmtTime(o.end, tz, lang)}<br>
        <small>${t('server_time')}: ${fmt(o.start, serverTz(), lang)}</small></span>
        <span class="countdown" data-cd="${o.start.getTime()}" data-end="${o.end.getTime()}"></span>
      </div>`).join('') : `<p class="muted">—</p>`}

    ${nextOcc ? `<div class="section-title"><h2>🔔 ${t('schedule')}</h2></div>
      <div class="card">${triggersFor(ev, nextOcc).map((tr) => `<div class="row between"><span>${kinds[tr.kind]}${tr.minutes && tr.kind !== 'during' ? ` (${fmtDur(tr.minutes * MIN)})` : ''}</span><b>${fmt(tr.at, tz, lang)}</b></div>`).join('')}</div>` : ''}

    <button class="btn block" id="ev-mute">${muted ? `🔔 ${t('unmute')}` : `🔕 ${t('mute')}`}</button>
    ${isOfficer() ? `<div class="row" style="margin-top:10px"><button class="btn grow" id="ev-edit">✎ ${t('edit')}</button><button class="btn danger" id="ev-del">${t('delete')}</button></div>` : ''}`;

  $('#ev-mute').onclick = async () => {
    const q = muted
      ? sb.from('event_mutes').delete().eq('event_id', ev.id).eq('user_id', state.me.id)
      : sb.from('event_mutes').insert({ event_id: ev.id, user_id: state.me.id });
    const { error } = await q;
    if (error) return fail(error);
    render();
  };
  $('#ev-edit')?.addEventListener('click', () => editEvent(ev));
  $('#ev-del')?.addEventListener('click', async () => {
    if (!confirm(t('confirm_delete'))) return;
    const { error } = await sb.from('events').delete().eq('id', ev.id);
    if (error) return fail(error);
    go('#/events');
  });
}

function editEvent(ev) {
  const isNew = !ev;
  const now = new Date(Date.now() + 3600_000);
  const p = wallParts(now, myTz());
  ev = ev || {
    title: '', description: '', checklist: '', recurrence: 'once', weekdays: [],
    start_date: `${p.y}-${p.m}-${p.d}`, start_time: `${p.h}:00`, duration_min: 60,
    remind_before: [180, 60, 15], remind_during_every: 0, remind_end_before: 0,
    shield: false, color: '#e5484d', to_discord: true, active: true,
  };
  const wd = weekdayNames();
  const s = openModal(`
    <h2>${isNew ? `＋ ${t('new')}` : `✎ ${esc(ev.title)}`}</h2>
    <form id="evf">
      <div class="field"><label>${t('title')}</label><input name="title" required value="${esc(ev.title)}" maxlength="80"></div>
      <div class="field"><label>${t('description')}</label><textarea name="description" style="min-height:70px">${esc(ev.description)}</textarea></div>
      <div class="field"><label>${t('checklist')}</label><textarea name="checklist" style="min-height:70px" placeholder="🛡️ ...">${esc(ev.checklist)}</textarea></div>

      <div class="field"><label>${t('repeat')}</label>
        <select name="recurrence">
          <option value="once" ${ev.recurrence === 'once' ? 'selected' : ''}>${t('once')}</option>
          <option value="daily" ${ev.recurrence === 'daily' ? 'selected' : ''}>${t('daily')}</option>
          <option value="weekly" ${ev.recurrence === 'weekly' ? 'selected' : ''}>${t('weekly')}</option>
        </select></div>
      <div class="field" id="wd-field"><label>${t('weekdays')}</label>
        <div class="chips" style="flex-wrap:wrap">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<button type="button" class="chip ${(ev.weekdays || []).includes(i) ? 'on' : ''}" data-wd="${i}">${wd[i]}</button>`).join('')}</div></div>

      <div class="field"><label>${t('time_zone_input')}</label>
        <select name="zone"><option value="server" ${isNew ? '' : 'selected'}>${t('tz_server')} (${esc(serverTz())})</option><option value="mine" ${isNew ? 'selected' : ''}>${t('tz_mine')} (${esc(myTz())})</option></select></div>
      <div class="grid2">
        <div class="field"><label>${t('start_date')}</label><input type="date" name="start_date" value="${esc(String(ev.start_date).slice(0, 10))}" required></div>
        <div class="field"><label>${t('start_time')}</label><input type="time" name="start_time" value="${esc(ev.start_time)}" required></div>
      </div>
      <div class="field"><label>${t('duration_min')}</label><input type="number" name="duration_min" min="1" max="10080" value="${ev.duration_min}"></div>

      <div class="field"><label>${t('remind_before')}</label><input name="remind_before" value="${esc((ev.remind_before || []).join(', '))}" placeholder="180, 60, 15"></div>
      <div class="grid2">
        <div class="field"><label>${t('remind_during')}</label><input type="number" name="remind_during_every" min="0" value="${ev.remind_during_every}"></div>
        <div class="field"><label>${t('remind_end')}</label><input type="number" name="remind_end_before" min="0" value="${ev.remind_end_before}"></div>
      </div>
      <label class="check"><input type="checkbox" name="shield" ${ev.shield ? 'checked' : ''}> ${t('shield_event')}</label>
      <label class="check"><input type="checkbox" name="to_discord" ${ev.to_discord ? 'checked' : ''}> ${t('send_discord')}</label>
      <label class="check"><input type="checkbox" name="active" ${ev.active ? 'checked' : ''}> ${t('active')}</label>
      <div class="field row"><label style="margin:0">${t('color')}</label><input type="color" name="color" value="${esc(ev.color)}" style="width:60px;padding:2px"></div>

      <div class="card tight" style="background:var(--bg)"><b>${t('preview_local')}</b><div id="ev-prev" class="hint"></div></div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn ghost grow" id="evf-x">${t('cancel')}</button><button class="btn primary grow">${t('save')}</button></div>
    </form>`);

  const form = $('#evf', s);
  const selectedWd = new Set(ev.weekdays || []);
  for (const c of $$('[data-wd]', s)) {
    c.onclick = () => {
      const d = Number(c.dataset.wd);
      if (selectedWd.has(d)) selectedWd.delete(d); else selectedWd.add(d);
      c.classList.toggle('on');
      preview();
    };
  }

  function collect() {
    const f = new FormData(form);
    let date = f.get('start_date');
    let time = f.get('start_time');
    let weekdays = [...selectedWd];
    if (f.get('zone') === 'mine' && date && time) {
      const [y, m, d] = date.split('-').map(Number);
      const [h, mi] = time.split(':').map(Number);
      const utc = zonedToUtc(y, m, d, h, mi, myTz());
      const sp = wallParts(utc, serverTz());
      const shift = Math.round((Date.UTC(+sp.y, +sp.m - 1, +sp.d) - Date.UTC(y, m - 1, d)) / DAY);
      date = `${sp.y}-${sp.m}-${sp.d}`;
      time = `${sp.h}:${sp.mi}`;
      weekdays = weekdays.map((w) => (w + shift + 7) % 7);
    }
    return {
      title: f.get('title').trim(),
      description: f.get('description'),
      checklist: f.get('checklist'),
      recurrence: f.get('recurrence'),
      weekdays,
      start_date: date,
      start_time: time,
      duration_min: Math.max(1, Number(f.get('duration_min')) || 60),
      remind_before: String(f.get('remind_before')).split(/[\s,;]+/).map(Number).filter((n) => n > 0 && n <= 2880),
      remind_during_every: Math.max(0, Number(f.get('remind_during_every')) || 0),
      remind_end_before: Math.max(0, Number(f.get('remind_end_before')) || 0),
      shield: f.get('shield') === 'on',
      to_discord: f.get('to_discord') === 'on',
      active: f.get('active') === 'on',
      color: f.get('color'),
    };
  }

  function preview() {
    $('#wd-field', s).hidden = form.recurrence.value !== 'weekly';
    try {
      const d = collect();
      const occ = occurrences({ ...d, active: true }, new Date(Date.now() - DAY), new Date(Date.now() + 30 * DAY), serverTz())
        .filter((o) => o.end > Date.now()).slice(0, 3);
      $('#ev-prev', s).innerHTML = occ.length ? occ.map((o) =>
        `${t('your_time')}: <b>${fmt(o.start, myTz(), getLang())}</b> · ${t('server_time')}: ${fmt(o.start, serverTz(), getLang())}`).join('<br>') : '—';
    } catch { $('#ev-prev', s).textContent = '—'; }
  }
  form.addEventListener('input', preview);
  form.addEventListener('change', (e) => {
    // Al cambiar de zona, convierte los campos para que la hora no "salte".
    if (e.target.name !== 'zone') return;
    const f = new FormData(form);
    const [y, m, d] = f.get('start_date').split('-').map(Number);
    const [h, mi] = f.get('start_time').split(':').map(Number);
    const fromTz = e.target.value === 'mine' ? serverTz() : myTz();
    const toTz = e.target.value === 'mine' ? myTz() : serverTz();
    const utc = zonedToUtc(y, m, d, h, mi, fromTz);
    const p2 = wallParts(utc, toTz);
    const shift = Math.round((Date.UTC(+p2.y, +p2.m - 1, +p2.d) - Date.UTC(y, m - 1, d)) / DAY);
    form.start_date.value = `${p2.y}-${p2.m}-${p2.d}`;
    form.start_time.value = `${p2.h}:${p2.mi}`;
    if (shift) {
      const moved = [...selectedWd].map((w) => (w + shift + 7) % 7);
      selectedWd.clear(); moved.forEach((w) => selectedWd.add(w));
      for (const c of $$('[data-wd]', s)) c.classList.toggle('on', selectedWd.has(Number(c.dataset.wd)));
    }
    preview();
  });
  preview();

  $('#evf-x', s).onclick = closeModal;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = collect();
    if (data.recurrence === 'weekly' && !data.weekdays.length) return toast(t('weekdays') + '?');
    data.updated_at = new Date().toISOString();
    const q = isNew
      ? sb.from('events').insert({ ...data, created_by: state.me.id }).select().single()
      : sb.from('events').update(data).eq('id', ev.id).select().single();
    const { data: saved, error } = await q;
    if (error) return fail(error);
    closeModal(); toast(t('saved'));
    go(`#/events/${saved.id}`);
  };
}

// =====================================================================
// Guías
// =====================================================================
routes.guides = async (id) => {
  if (id && id !== 'cat') return guideDetail(Number(id));
  const cat = sessionStorage.getItem('la_cat') || 'all';
  const { data } = await sb.from('guides').select('id,title,category,pinned,sort,body,updated_at')
    .order('pinned', { ascending: false }).order('sort').order('updated_at', { ascending: false });
  const guides = data || [];
  view().innerHTML = `
    <div class="row between"><h1>${t('nav_guides')}</h1>
      ${isOfficer() ? `<button class="btn primary small" id="g-new">＋ ${t('new')}</button>` : ''}</div>
    <input id="g-search" placeholder="${t('search')}" style="margin:8px 0">
    <div class="chips" style="margin-bottom:12px">
      <button class="chip ${cat === 'all' ? 'on' : ''}" data-cat="all">${t('all')}</button>
      ${CATEGORIES.map((c) => `<button class="chip ${cat === c ? 'on' : ''}" data-cat="${c}">${t(`cat_${c}`)}</button>`).join('')}
    </div>
    <div id="g-list"></div>`;

  const draw = () => {
    const q = $('#g-search').value.trim().toLowerCase();
    const list = guides.filter((g) => (cat === 'all' || g.category === cat)
      && (!q || g.title.toLowerCase().includes(q) || g.body.toLowerCase().includes(q)));
    $('#g-list').innerHTML = list.length ? list.map((g) => `
      <a class="card tight list-link" href="#/guides/${g.id}">
        <span class="grow">${g.pinned ? '📌 ' : ''}<b>${esc(g.title)}</b><br>
        <small>${t(`cat_${g.category}`)} · ${esc(g.body.replace(/[#*>\-\[\]()]/g, '').trim().slice(0, 90))}…</small></span>
      </a>`).join('') : `<p class="muted">${t('guides_empty')}</p>`;
  };
  draw();
  $('#g-search').oninput = draw;
  for (const c of $$('[data-cat]')) c.onclick = () => { sessionStorage.setItem('la_cat', c.dataset.cat); render(); };
  $('#g-new')?.addEventListener('click', () => editGuide(null));
};

async function guideDetail(id) {
  const { data: g, error } = await sb.from('guides').select('*').eq('id', id).single();
  if (error) throw error;
  view().innerHTML = `
    <a href="#/guides">‹ ${t('nav_guides')}</a>
    <div class="card" style="margin-top:10px">
      <span class="badge">${t(`cat_${g.category}`)}</span>
      <h1 style="margin-top:8px">${esc(g.title)}</h1>
      <small>${fmt(new Date(g.updated_at), myTz(), getLang())}</small>
      <div class="md" style="margin-top:12px">${translatable(g.body)}</div>
    </div>
    ${isOfficer() ? `<div class="row"><button class="btn grow" id="g-edit">✎ ${t('edit')}</button><button class="btn danger" id="g-del">${t('delete')}</button></div>` : ''}`;
  $('#g-edit')?.addEventListener('click', () => editGuide(g));
  $('#g-del')?.addEventListener('click', async () => {
    if (!confirm(t('confirm_delete'))) return;
    const { error: e2 } = await sb.from('guides').delete().eq('id', g.id);
    if (e2) return fail(e2);
    go('#/guides');
  });
}

function editGuide(g) {
  const isNew = !g;
  g = g || { title: '', category: 'eventos', body: '', pinned: false, sort: 0 };
  const s = openModal(`
    <h2>${isNew ? `＋ ${t('new')}` : `✎ ${esc(g.title)}`}</h2>
    <form id="gf">
      <div class="field"><label>${t('title')}</label><input name="title" required value="${esc(g.title)}" maxlength="120"></div>
      <div class="grid2">
        <div class="field"><label>${t('category')}</label><select name="category">${CATEGORIES.map((c) => `<option value="${c}" ${g.category === c ? 'selected' : ''}>${t(`cat_${c}`)}</option>`).join('')}</select></div>
        <div class="field"><label>#</label><input type="number" name="sort" value="${g.sort}"></div>
      </div>
      <label class="check"><input type="checkbox" name="pinned" ${g.pinned ? 'checked' : ''}> 📌 ${t('pinned')}</label>
      <div class="field"><label>${t('body')}</label><textarea name="body" style="min-height:260px">${esc(g.body)}</textarea><div class="hint">${t('md_help')}</div></div>
      <details><summary>${t('preview')}</summary><div class="md card" id="gf-prev"></div></details>
      <div class="row" style="margin-top:12px"><button type="button" class="btn ghost grow" id="gf-x">${t('cancel')}</button><button class="btn primary grow">${t('save')}</button></div>
    </form>`);
  const form = $('#gf', s);
  const prev = () => { $('#gf-prev', s).innerHTML = md(form.body.value); };
  form.body.addEventListener('input', prev); prev();
  $('#gf-x', s).onclick = closeModal;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const data = {
      title: f.get('title').trim(), category: f.get('category'), body: f.get('body'),
      pinned: f.get('pinned') === 'on', sort: Number(f.get('sort')) || 0, updated_at: new Date().toISOString(),
    };
    const q = isNew
      ? sb.from('guides').insert({ ...data, author_id: state.me.id }).select().single()
      : sb.from('guides').update(data).eq('id', g.id).select().single();
    const { data: saved, error } = await q;
    if (error) return fail(error);
    closeModal(); toast(t('saved')); go(`#/guides/${saved.id}`);
  };
}

// =====================================================================
// Chat
// =====================================================================
let chatChannel = null;
let chatSub = null;

routes.chat = async (channel = 'general') => {
  if (channel === 'officers' && !isOfficer()) channel = 'general';
  chatChannel = channel;
  const channels = ['general', ...(isOfficer() ? ['officers'] : []), 'discord'];
  view().innerHTML = `
    <div class="chat">
      <div class="row between">
        <div class="chips">${channels.map((c) => `<a class="chip ${c === channel ? 'on' : ''}" href="#/chat/${c}">${t(`chat_${c}`)}</a>`).join('')}</div>
      </div>
      <label class="check" style="font-size:13px"><input type="checkbox" id="c-auto" ${state.autoTr ? 'checked' : ''}> 🌐 ${t('auto_translate')} (${LANGS[getLang()]})</label>
      <div class="msgs" id="msgs"><div class="muted center">${t('loading')}</div></div>
      ${channel !== 'discord' ? `
      <form class="composer" id="c-form">
        <textarea id="c-text" placeholder="${t('write_message')}" maxlength="2000" rows="1"></textarea>
        <button class="btn primary">➤</button>
      </form>` : ''}
    </div>`;

  const { data } = await sb.from('messages').select('*').eq('channel', channel)
    .order('created_at', { ascending: false }).limit(120);
  const box = $('#msgs');
  box.innerHTML = '';
  for (const m of (data || []).reverse()) box.insertAdjacentHTML('beforeend', msgHtml(m));
  box.scrollTop = box.scrollHeight;
  autoTranslateVisible();

  $('#c-auto').onchange = (e) => {
    state.autoTr = e.target.checked;
    localStorage.setItem('la_autotr', state.autoTr ? '1' : '0');
    render();
  };
  box.onclick = async (e) => {
    const del = e.target.closest('[data-del-msg]');
    if (del && confirm(t('confirm_delete'))) {
      await sb.from('messages').delete().eq('id', del.dataset.delMsg);
      del.closest('.msg')?.remove();
    }
  };
  const form = $('#c-form');
  if (form) {
    const ta = $('#c-text');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      ta.value = '';
      const { error } = await sb.from('messages').insert({ channel, body, source: 'app' });
      if (error) { ta.value = body; fail(error); }
    };
  }
};

function msgHtml(m) {
  const mine = m.user_id && m.user_id === state.me.id;
  const canDel = mine || isOfficer();
  const tz = myTz();
  return `
    <div class="msg ${mine ? 'me' : ''} ${m.source === 'discord' ? 'dc' : ''}" data-id="${m.id}">
      <div class="meta"><b>${esc(m.author_name || '?')}</b><span>${fmt(new Date(m.created_at), tz, getLang(), { weekday: undefined })}</span>
        ${canDel && m.source !== 'discord' ? `<button class="tr" data-del-msg="${m.id}">✕</button>` : ''}</div>
      ${translatable(m.body, linkify, { button: !mine, cls: 'txt' })}
    </div>`.replace('class="btn small ghost"', 'class="tr"');
}

async function autoTranslateVisible() {
  if (!state.autoTr) return;
  const btns = $$('#msgs [data-tr]').filter((b) => trReg.get(b.dataset.tr)?.shown === 'orig');
  if (!btns.length) return;
  try {
    const regs = btns.map((b) => trReg.get(b.dataset.tr));
    const out = await translateMany(regs.map((r) => r.text));
    btns.forEach((b, i) => {
      const r = regs[i];
      const el = document.getElementById(b.dataset.tr);
      if (!el || out[i] === r.text) return;
      el.innerHTML = r.render(out[i]);
      r.shown = 'tr';
      b.textContent = `↩ ${t('original')}`;
    });
  } catch (e) { console.warn(e); }
}

function startRealtime() {
  if (chatSub) sb.removeChannel(chatSub);
  chatSub = sb.channel('la-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
      const m = p.new;
      const onChat = location.hash.startsWith('#/chat');
      if (onChat && m.channel === chatChannel) {
        const box = $('#msgs');
        if (!box) return;
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
        box.insertAdjacentHTML('beforeend', msgHtml(m));
        if (atBottom || m.user_id === state.me.id) box.scrollTop = box.scrollHeight;
        autoTranslateVisible();
      } else if (m.user_id !== state.me.id && m.channel !== 'discord') {
        $('#chat-dot').hidden = false;
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => {
      if ((location.hash || '#/home').startsWith('#/home')) render();
    })
    .subscribe();
}

// =====================================================================
// Recordatorios
// =====================================================================
routes.reminders = async () => {
  const { data } = await sb.from('reminders').select('*').eq('sent', false).order('fire_at');
  const tz = myTz();
  const p = wallParts(new Date(Date.now() + 3600_000), tz);
  const offsets = [120, 60, 30, 15, 5];
  view().innerHTML = `
    <a href="#/more">‹ ${t('nav_more')}</a>
    <h1 style="margin-top:10px">${t('reminders')}</h1>

    <form class="card" id="sh-form">
      <h2>🛡️ ${t('shield_timer')}</h2>
      <label>${t('shield_ends_in')}</label>
      <div class="grid2">
        <div><input type="number" name="h" min="0" max="720" value="8"><div class="hint">${t('hours')}</div></div>
        <div><input type="number" name="m" min="0" max="59" value="0"><div class="hint">${t('minutes')}</div></div>
      </div>
      <label style="margin-top:10px">${t('alert_before')}</label>
      <div class="chips" style="flex-wrap:wrap">${offsets.map((o) => `<button type="button" class="chip ${[60, 15].includes(o) ? 'on' : ''}" data-off="${o}">${fmtDur(o * MIN)}</button>`).join('')}</div>
      <button class="btn primary block" style="margin-top:12px">${t('create_alerts')}</button>
    </form>

    <form class="card" id="rm-form">
      <h2>＋ ${t('new_reminder')}</h2>
      <div class="field"><label>${t('title')}</label><input name="title" required maxlength="100"></div>
      <div class="field"><label>${t('description')}</label><input name="body" maxlength="300"></div>
      <div class="field"><label>${t('when')} (${esc(tz)})</label><input type="datetime-local" name="when" required value="${p.y}-${p.m}-${p.d}T${p.h}:${p.mi}"></div>
      <div class="grid2">
        <div class="field"><label>${t('repeat')}</label><select name="repeat"><option value="0">${t('none')}</option><option value="1440">${t('daily')}</option><option value="10080">${t('weekly')}</option><option value="h">${t('every_hours')}</option></select></div>
        <div class="field"><label>${t('hours')}</label><input type="number" name="every" min="1" max="168" value="4"></div>
      </div>
      <button class="btn primary block">${t('save')}</button>
    </form>

    <div class="section-title"><h2>${t('my_reminders')}</h2></div>
    ${(data || []).length ? data.map((r) => `
      <div class="card tight row between">
        <span class="grow"><b>${esc(r.title)}</b>${r.body ? `<br><small>${esc(r.body)}</small>` : ''}<br>
          <small>${fmt(new Date(r.fire_at), tz, getLang())}${r.repeat_min ? ` · ↻ ${fmtDur(r.repeat_min * MIN)}` : ''}</small></span>
        <button class="btn small ghost" data-del-rem="${r.id}">✕</button>
      </div>`).join('') : `<p class="muted">${t('no_reminders')}</p>`}`;

  const chosen = new Set([60, 15]);
  for (const c of $$('[data-off]')) {
    c.onclick = () => {
      const o = Number(c.dataset.off);
      if (chosen.has(o)) chosen.delete(o); else chosen.add(o);
      c.classList.toggle('on');
    };
  }
  $('#sh-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const end = Date.now() + ((Number(f.get('h')) || 0) * 60 + (Number(f.get('m')) || 0)) * MIN;
    const rows = [...chosen].map((o) => end - o * MIN).filter((at) => at > Date.now())
      .map((at) => ({ title: t('shield_title'), body: `🛡️ ${fmt(new Date(end), tz, getLang())}`, fire_at: new Date(at).toISOString(), user_id: state.me.id }));
    rows.push({ title: `🛡️ ${t('shield_title')}!`, body: '', fire_at: new Date(end).toISOString(), user_id: state.me.id });
    const { error } = await sb.from('reminders').insert(rows);
    if (error) return fail(error);
    toast(`${t('saved')} (${rows.length})`);
    render();
  };
  $('#rm-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const [date, time] = String(f.get('when')).split('T');
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const at = zonedToUtc(y, mo, d, h, mi, tz);
    const rep = f.get('repeat') === 'h' ? (Number(f.get('every')) || 1) * 60 : Number(f.get('repeat'));
    const { error } = await sb.from('reminders').insert({
      title: f.get('title'), body: f.get('body'), fire_at: at.toISOString(), repeat_min: rep, user_id: state.me.id,
    });
    if (error) return fail(error);
    toast(t('saved'));
    render();
  };
  for (const b of $$('[data-del-rem]')) {
    b.onclick = async () => { await sb.from('reminders').delete().eq('id', b.dataset.delRem); render(); };
  }
};

// =====================================================================
// Más / Ajustes
// =====================================================================
routes.more = async () => {
  view().innerHTML = `
    <div class="card row">
      <img src="/icons/doctor.svg" style="width:48px;height:48px" alt="">
      <span class="grow"><b>${esc(state.me.nick)}</b> ${roleBadge(state.me.role)}<br><small>${esc(myTz())} · ${LANGS[getLang()]}</small></span>
    </div>
    <a class="card list-link" href="#/reminders">🔔 ${t('reminders')}</a>
    <a class="card list-link" href="#/settings">⚙️ ${t('settings')}</a>
    ${isOfficer() ? `<a class="card list-link" href="#/admin/members">🛠️ ${t('admin')}</a>` : ''}
    ${state.deferredInstall ? `<button class="btn block" id="m-install">⬇ ${t('install')}</button>` : ''}
    <button class="btn ghost block" id="m-out" style="margin-top:14px">${t('logout')}</button>`;
  $('#m-install')?.addEventListener('click', doInstall);
  $('#m-out').onclick = () => sb.auth.signOut();
};

const roleBadge = (r) => (r === 'r5' ? '<span class="badge r5">R5</span>' : r === 'r4' ? '<span class="badge r4">R4</span>' : r === 'pending' ? '<span class="badge">…</span>' : '');

routes.settings = async () => {
  const ps = await pushStatus().catch(() => 'unsupported');
  view().innerHTML = `
    <a href="#/more">‹ ${t('nav_more')}</a>
    <h1 style="margin-top:10px">${t('settings')}</h1>
    <form class="card" id="pf">
      <h2>${t('profile')}</h2>
      <div class="field"><label>${t('nick')}</label><input name="nick" required value="${esc(state.me.nick)}" maxlength="40"></div>
      <div class="field"><label>${t('language')}</label><select name="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>${t('timezone')}</label><select name="tz">${tzOptions(myTz())}</select>
        ${deviceTz() !== myTz() ? `<div class="hint">📱 ${esc(deviceTz())} — <a href="#" id="tz-dev">✓</a></div>` : ''}</div>
      <div class="field"><label>${t('theme')}</label>
        <div class="chips">${['dark', 'light'].map((m) => `<button type="button" class="chip ${currentTheme() === m ? 'on' : ''}" data-theme-pick="${m}">${t(`theme_${m}`)}</button>`).join('')}</div></div>
      <button class="btn primary block">${t('save')}</button>
    </form>

    <div class="card">
      <h2>🔔 ${t('notifications_system')}</h2>
      ${ps === 'on' ? `<p>✅ ${t('notif_on')}</p>
        <div class="row"><button class="btn grow" id="n-test">${t('notif_test')}</button><button class="btn ghost" id="n-off">${t('notif_off')}</button></div>`
      : ps === 'blocked' ? `<p>${t('notif_blocked')}</p>`
      : ps === 'unsupported' || (isIOS() && !isStandalone()) ? `<p>${t('notif_ios')}</p>`
      : `<button class="btn primary block" id="n-on">${t('enable_notif')}</button>`}
      ${!state.settings.push_ready ? `<p class="hint">${t('notif_not_ready')}</p>` : ''}
    </div>`;

  for (const b of $$('[data-theme-pick]')) b.onclick = () => { applyTheme(b.dataset.themePick); render(); };
  $('#tz-dev')?.addEventListener('click', (e) => { e.preventDefault(); $('#pf').tz.value = deviceTz(); });
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const upd = { nick: f.get('nick').trim(), lang: f.get('lang'), tz: f.get('tz') };
    const { error } = await sb.from('profiles').update(upd).eq('id', state.me.id);
    if (error) return fail(error);
    Object.assign(state.me, upd);
    setLang(upd.lang); applyStaticI18n();
    toast(t('saved')); render();
  };
  $('#n-on')?.addEventListener('click', () => enablePush().then(render).catch(fail));
  $('#n-off')?.addEventListener('click', () => disablePush().then(render).catch(fail));
  $('#n-test')?.addEventListener('click', async () => {
    try { await api('test'); toast(t('notif_sent')); } catch (e) { fail(e); }
  });
};

// =====================================================================
// Admin (R4/R5)
// =====================================================================
routes.admin = async (tab = 'members') => {
  if (!isOfficer()) return go('#/home');
  const tabs = [['members', `👥 ${t('members')}`], ['alerts', `🔔 ${t('notifications_system')}`]];
  if (isR5()) tabs.push(['alliance', `🏰 ${t('alliance')}`], ['discord', `💬 ${t('discord')}`], ['translation', `🌐 ${t('translation')}`]);
  view().innerHTML = `
    <a href="#/more">‹ ${t('nav_more')}</a>
    <h1 style="margin-top:10px">${t('admin')}</h1>
    <div class="chips" style="margin-bottom:12px">${tabs.map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/admin/${k}">${l}</a>`).join('')}</div>
    <div id="admin-body"></div>`;
  const body = $('#admin-body');
  const priv = isR5() ? (await sb.from('private_settings').select('*').eq('id', 1).single()).data || {} : {};

  if (tab === 'members') {
    const { data } = await sb.from('profiles').select('*').order('created_at');
    const all = data || [];
    const pending = all.filter((p) => p.role === 'pending');
    const order = { r5: 0, r4: 1, member: 2 };
    const members = all.filter((p) => p.role !== 'pending').sort((a, b) => order[a.role] - order[b.role] || a.nick.localeCompare(b.nick));
    body.innerHTML = `
      ${pending.length ? `<h2>${t('pending_members')} (${pending.length})</h2>
        ${pending.map((p) => `<div class="card tight row between"><span><b>${esc(p.nick)}</b><br><small>${fmt(new Date(p.created_at), myTz(), getLang())}</small></span>
          <span class="row"><button class="btn small primary" data-approve="${p.id}">${t('approve')}</button><button class="btn small danger" data-kick="${p.id}">✕</button></span></div>`).join('')}` : ''}
      <h2 style="margin-top:16px">${t('members')} (${members.length})</h2>
      <table class="members">${members.map((p) => `
        <tr><td><b>${esc(p.nick)}</b> ${roleBadge(p.role)}<br><small>${esc(p.tz)} · ${esc(p.lang)}</small></td>
        <td style="width:110px">${isR5() && p.id !== state.me.id ? `<select data-role="${p.id}">${ROLES.map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}</select>` : ''}</td>
        <td style="width:44px">${p.id !== state.me.id && (isR5() || p.role === 'member') ? `<button class="btn small danger" data-kick="${p.id}" title="${t('remove')}">✕</button>` : ''}</td></tr>`).join('')}</table>
`;
    for (const b of $$('[data-approve]', body)) b.onclick = async () => { const { error } = await sb.from('profiles').update({ role: 'member' }).eq('id', b.dataset.approve); if (error) fail(error); else render(); };
    for (const b of $$('[data-kick]', body)) b.onclick = async () => { if (!confirm(t('confirm_delete'))) return; const { error } = await sb.from('profiles').delete().eq('id', b.dataset.kick); if (error) fail(error); else render(); };
    for (const sel of $$('[data-role]', body)) sel.onchange = async () => { const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.role); if (error) fail(error); else toast(t('saved')); };
  }

  if (tab === 'alerts') {
    body.innerHTML = `
      ${isR5() ? `<form class="card" id="setup-f">
        <h2>${t('notifications_system')}</h2>
        <p>${state.settings.push_ready ? `✅ ${t('system_active')}` : '⚠️'}</p>
        <p class="hint">${t('system_hint')}</p>
        <div class="field"><label>${t('contact_email')}</label><input name="contact_email" type="email" value="${esc(String(priv.contact_email || '').replace('mailto:', '').replace('admin@example.com', ''))}" required></div>
        <button class="btn primary block">${t('activate_system')}</button>
      </form>` : ''}
      <div class="card"><h2>🚨 ${t('broadcast')}</h2><button class="btn primary block" id="bc-open">${t('broadcast_send')}</button></div>`;
    $('#bc-open', body).onclick = broadcastModal;
    $('#setup-f', body)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        await api('setup', { contact_email: e.target.contact_email.value.trim() });
        await loadSettings();
        toast(`✅ ${t('system_active')}`);
        await enablePush().catch(() => {});
        render();
      } catch (err) { fail(err); } finally { btn.disabled = false; }
    });
  }

  if (tab === 'alliance' && isR5()) {
    const st = state.settings;
    body.innerHTML = `
      <form class="card" id="al-f">
        <div class="field"><label>${t('alliance_name')}</label><input name="alliance_name" value="${esc(st.alliance_name)}" maxlength="60"></div>
        <div class="field"><label>${t('alliance_tag')}</label><input name="alliance_tag" value="${esc(st.alliance_tag)}" maxlength="6"></div>
        <div class="field"><label>${t('server_tz')}</label><select name="server_tz">${tzOptions(st.server_tz || 'UTC')}</select><div class="hint">${t('server_tz_hint')}</div></div>
        <div class="field"><label>${t('welcome')}</label><textarea name="welcome">${esc(st.welcome)}</textarea><div class="hint">${t('md_help')}</div></div>
        <button class="btn primary block">${t('save')}</button>
      </form>`;
    $('#al-f', body).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const { error } = await sb.from('app_settings').update({ ...f, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return fail(error);
      await loadSettings(); toast(t('saved'));
    };
  }

  if (tab === 'discord' && isR5()) {
    body.innerHTML = `
      <form class="card" id="dc-f">
        <div class="field"><label>${t('webhook_url')}</label><input name="discord_webhook_url" value="${esc(priv.discord_webhook_url)}" placeholder="https://discord.com/api/webhooks/…" autocomplete="off"></div>
        <label class="check"><input type="checkbox" name="mirror_chat_to_discord" ${priv.mirror_chat_to_discord ? 'checked' : ''}> ${t('mirror_chat')}</label>
        <hr>
        <div class="field"><label>${t('bot_token')}</label><input name="discord_bot_token" type="password" placeholder="${priv.discord_bot_token ? t('secret_set') : ''}" autocomplete="off"></div>
        <div class="field"><label>${t('channel_ids')}</label><input name="discord_channel_ids" value="${esc(priv.discord_channel_ids)}" placeholder="123456789012345678, …"></div>
        <div class="field"><label>${t('push_channel_ids')}</label><input name="discord_push_channel_ids" value="${esc(priv.discord_push_channel_ids)}" placeholder="123456789012345678"></div>
        <div class="row"><button type="button" class="btn grow" id="dc-test">${t('test_connection')}</button><button class="btn primary grow">${t('save')}</button></div>
        <pre class="hint" id="dc-out" style="white-space:pre-wrap"></pre>
      </form>`;
    const form = $('#dc-f', body);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const upd = {
        discord_webhook_url: f.get('discord_webhook_url').trim(),
        mirror_chat_to_discord: f.get('mirror_chat_to_discord') === 'on',
        discord_channel_ids: f.get('discord_channel_ids').trim(),
        discord_push_channel_ids: f.get('discord_push_channel_ids').trim(),
      };
      if (f.get('discord_bot_token').trim()) upd.discord_bot_token = f.get('discord_bot_token').trim();
      const { error } = await sb.from('private_settings').update(upd).eq('id', 1);
      if (error) return fail(error);
      toast(t('saved')); render();
    };
    $('#dc-test', body).onclick = async () => {
      try { const r = await api('discord-test'); $('#dc-out', body).textContent = JSON.stringify(r, null, 2); } catch (e) { fail(e); }
    };
  }

  if (tab === 'translation' && isR5()) {
    body.innerHTML = `
      <form class="card" id="tr-f">
        <p class="hint">${t('translation_hint')}</p>
        <div class="field"><label>${t('google_key')}</label><input name="google_translate_key" type="password" placeholder="${priv.google_translate_key ? t('secret_set') : 'AIza…'}" autocomplete="off"></div>
        <div class="field"><label>${t('deepl_key')}</label><input name="deepl_key" type="password" placeholder="${priv.deepl_key ? t('secret_set') : '…:fx'}" autocomplete="off"></div>
        <button class="btn primary block">${t('save')}</button>
      </form>`;
    $('#tr-f', body).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const upd = {};
      for (const k of ['google_translate_key', 'deepl_key']) if (f.get(k).trim()) upd[k] = f.get(k).trim();
      if (!Object.keys(upd).length) return;
      const { error } = await sb.from('private_settings').update(upd).eq('id', 1);
      if (error) return fail(error);
      toast(t('saved')); render();
    };
  }
};

// =====================================================================
// Instalación y arranque
// =====================================================================
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; });
async function doInstall() {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  render();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) location.hash = new URL(e.data.url, location.origin).hash;
  });
}

async function start() {
  await loadSettings().catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  lastAuthUser = session?.user?.id || null;
  if (!session) { state.me = null; return renderAuth('login'); }

  let me = null;
  for (let i = 0; i < 4 && !me; i++) {
    const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    me = data;
    if (!me) await new Promise((r) => setTimeout(r, 700));
  }
  if (!me) { state.me = { nick: session.user.email, role: 'pending' }; return renderPending(); }
  state.me = me;

  // Primera vez: guarda la zona horaria del dispositivo y el idioma elegido.
  if (me.tz === 'UTC' && deviceTz() !== 'UTC') {
    await sb.from('profiles').update({ tz: deviceTz() }).eq('id', me.id);
    me.tz = deviceTz();
  }
  setLang(me.lang || detectLang());
  applyStaticI18n();
  if (me.role === 'pending') return renderPending();

  $('#tabbar').hidden = false;
  startRealtime();
  // Re-suscribe en silencio si ya había permiso (renueva suscripciones caducadas).
  if (state.settings.vapid_public_key && 'Notification' in window && Notification.permission === 'granted') {
    enablePush({ silent: true }).catch(() => {});
  }
  render();
}

setLang(detectLang());
applyStaticI18n();
applyTheme(localStorage.getItem('la_theme') || 'dark');
setInterval(tickClock, 30_000);
let lastAuthUser;
sb.auth.onAuthStateChange((event, session) => {
  const uid = session?.user?.id || null;
  if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && uid !== lastAuthUser)) {
    lastAuthUser = uid;
    start();
  }
});
start();
