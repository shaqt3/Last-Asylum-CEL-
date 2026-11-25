import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from './webpush.js';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

export async function loadSettings(admin) {
  const [{ data: pub }, { data: priv }] = await Promise.all([
    admin.from('app_settings').select('*').eq('id', 1).single(),
    admin.from('private_settings').select('*').eq('id', 1).single(),
  ]);
  return { pub: pub || {}, priv: priv || {} };
}

export function vapidFrom(pub, priv) {
  if (!pub.vapid_public_key || !priv.vapid_private_jwk) return null;
  return { publicKey: pub.vapid_public_key, privateJwk: priv.vapid_private_jwk, subject: priv.contact_email || 'mailto:admin@example.com' };
}

/**
 * Envía a una lista de suscripciones (con .lang y .tz del perfil).
 * `build(sub)` devuelve el payload de cada persona (para traducir el texto).
 */
export async function pushMany(admin, subs, vapid, build, opts) {
  let sent = 0;
  const gone = [];
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await sendPush(s, build(s), vapid, opts);
      if (r.ok) sent++;
      else if (r.gone) gone.push(s.id);
      else console.warn('push', r.status, s.endpoint.slice(0, 40));
    } catch (e) {
      console.warn('push error', e?.message);
    }
  }));
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);
  return sent;
}

/** Suscripciones de miembros aprobados, con idioma y zona horaria. */
export async function memberSubs(admin, { userIds = null, excludeUserIds = [] } = {}) {
  let q = admin.from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, profiles!inner(role, lang, tz)')
    .in('profiles.role', ['member', 'r4', 'r5']);
  if (userIds) q = q.in('user_id', userIds);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  const ex = new Set(excludeUserIds);
  return (data || []).filter((s) => !ex.has(s.user_id)).map((s) => ({
    ...s, lang: s.profiles?.lang || 'es', tz: s.profiles?.tz || 'UTC',
  }));
}

export async function postDiscord(webhookUrl, payload) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
    });
    if (!res.ok) console.warn('discord webhook', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.warn('discord webhook error', e?.message);
    return false;
  }
}

// ---------------------------------------------------------------------
// Traducción con caché (Google Cloud → DeepL → MyMemory gratis)
// ---------------------------------------------------------------------
async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DEEPL_TARGET = { en: 'EN-GB', pt: 'PT-PT' };

async function providerTranslate(texts, target, priv) {
  if (priv.google_translate_key) {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(priv.google_translate_key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target, format: 'text' }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || 'Google Translate error');
    return j.data.translations.map((t) => t.translatedText);
  }
  if (priv.deepl_key) {
    const host = priv.deepl_key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const res = await fetch(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${priv.deepl_key}` },
      body: JSON.stringify({ text: texts, target_lang: DEEPL_TARGET[target] || target.toUpperCase() }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.message || 'DeepL error');
    return j.translations.map((t) => t.text);
  }
  // Gratis, sin clave (límite diario). Mejor configurar Google o DeepL en Admin.
  const email = String(priv.contact_email || '').replace('mailto:', '');
  return Promise.all(texts.map(async (t) => {
    const u = new URL('https://api.mymemory.translated.net/get');
    u.searchParams.set('q', t.slice(0, 500));
    u.searchParams.set('langpair', `Autodetect|${target}`);
    if (email.includes('@') && !email.endsWith('example.com')) u.searchParams.set('de', email);
    const res = await fetch(u);
    const j = await res.json();
    return j?.responseData?.translatedText || t;
  }));
}

export async function translateTexts(admin, priv, texts, target) {
  const clean = texts.map((t) => String(t || '').slice(0, 4000));
  const hashes = await Promise.all(clean.map(sha));
  const { data: cached } = await admin.from('translations').select('hash, translated')
    .eq('target', target).in('hash', hashes);
  const map = new Map((cached || []).map((c) => [c.hash, c.translated]));
  const missingIdx = clean.map((_, i) => i).filter((i) => !map.has(hashes[i]) && clean[i].trim());
  if (missingIdx.length) {
    const out = await providerTranslate(missingIdx.map((i) => clean[i]), target, priv);
    const rows = missingIdx.map((i, k) => ({ hash: hashes[i], target, translated: out[k] }));
    rows.forEach((r) => map.set(r.hash, r.translated));
    await admin.from('translations').upsert(rows, { onConflict: 'hash,target', ignoreDuplicates: true });
  }
  return clean.map((t, i) => map.get(hashes[i]) ?? t);
}
