// Se ejecuta cada minuto (pg_cron). Envía:
//  1) avisos de eventos (antes / al empezar / durante / antes de terminar)
//  2) recordatorios personales
//  3) noticias de la alianza (push + Discord)
//  4) chat general → Discord
//  5) Discord → app (canales configurados)
import { adminClient, cors, json, loadSettings, vapidFrom, pushMany, memberSubs, postDiscord } from '../_shared/util.js';
import { occurrences, triggersFor, fmtTime } from '../_shared/schedule.js';
import { tx, dur } from '../_shared/texts.js';

const MIN = 60_000;
const WINDOW = 6 * MIN; // tolera ejecuciones perdidas sin mandar avisos viejos

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = adminClient();
  const { pub, priv } = await loadSettings(admin);
  if (!priv.cron_secret || req.headers.get('x-cron-secret') !== priv.cron_secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const report: Record<string, unknown> = {};
  const vapid = vapidFrom(pub, priv);
  const now = Date.now();
  const serverTz = pub.server_tz || 'UTC';

  // ---------------------------------------------------------------- 1) eventos
  try {
    const { data: events } = await admin.from('events').select('*').eq('active', true);
    let sent = 0;
    for (const ev of events || []) {
      const maxBefore = Math.max(0, ...(ev.remind_before || []).map(Number));
      const occs = occurrences(ev,
        new Date(now - WINDOW - (ev.duration_min || 0) * MIN),
        new Date(now + maxBefore * MIN + MIN), serverTz);
      for (const occ of occs) {
        for (const trg of triggersFor(ev, occ)) {
          const at = trg.at.getTime();
          if (at > now || at <= now - WINDOW) continue;
          const key = `ev:${ev.id}:${occ.start.toISOString()}:${trg.kind}:${trg.minutes}`;
          const { data: fresh } = await admin.from('notification_log')
            .upsert({ key }, { onConflict: 'key', ignoreDuplicates: true }).select();
          if (!fresh || !fresh.length) continue; // ya enviado

          if (vapid) {
            const { data: mutes } = await admin.from('event_mutes').select('user_id').eq('event_id', ev.id);
            const subs = await memberSubs(admin, { excludeUserIds: (mutes || []).map((m) => m.user_id) });
            sent += await pushMany(admin, subs, vapid, (s) => {
              const t = tx(s.lang);
              const startLocal = fmtTime(occ.start, s.tz, s.lang);
              const endLocal = fmtTime(occ.end, s.tz, s.lang);
              let body = '';
              if (trg.kind === 'before') body = t.before(ev.title, dur(trg.minutes, s.lang), startLocal);
              else if (trg.kind === 'start') body = t.start(ev.title, `${startLocal}–${endLocal}`);
              else if (trg.kind === 'during') body = t.during(ev.title, endLocal);
              else body = t.ending(ev.title, dur(trg.minutes, s.lang));
              const checklist = String(ev.checklist || '').split('\n').map((x) => x.trim()).filter(Boolean);
              const extra = checklist.length ? '\n• ' + checklist.slice(0, 4).join('\n• ') : '';
              return {
                title: ev.shield ? `${t.shield} · ${ev.title}` : ev.title,
                body: body + extra,
                tag: `ev-${ev.id}`,
                url: `/#/events/${ev.id}`,
                requireInteraction: ev.shield || trg.kind === 'start',
              };
            }, { ttl: Math.max(300, trg.kind === 'before' ? trg.minutes * 60 : 1800) });
          }

          if (ev.to_discord && priv.discord_webhook_url && trg.kind !== 'during') {
            const s = Math.floor(occ.start.getTime() / 1000);
            const e = Math.floor(occ.end.getTime() / 1000);
            const lines = {
              before: `⏰ **${ev.title}** — <t:${s}:R> · <t:${s}:t>–<t:${e}:t>`,
              start: `🚨 **${ev.title}** — ${ev.shield ? '🛡️ ' : ''}<t:${s}:t>–<t:${e}:t>`,
              ending: `⌛ **${ev.title}** — <t:${e}:R>`,
            } as Record<string, string>;
            const checklist = String(ev.checklist || '').split('\n').map((x) => x.trim()).filter(Boolean);
            await postDiscord(priv.discord_webhook_url, {
              username: pub.alliance_name || 'Alianza',
              content: lines[trg.kind] + (trg.kind === 'start' && checklist.length ? '\n' + checklist.map((c) => `• ${c}`).join('\n') : ''),
            });
          }
        }
      }
    }
    report.events = sent;
  } catch (e) {
    console.error('events', e);
    report.eventsError = String(e);
  }

  // ---------------------------------------------------- 2) recordatorios propios
  try {
    const { data: due } = await admin.from('reminders').select('*')
      .eq('sent', false).lte('fire_at', new Date(now).toISOString()).limit(200);
    let sent = 0;
    for (const r of due || []) {
      const stale = new Date(r.fire_at).getTime() < now - 60 * MIN;
      if (!stale && vapid) {
        const subs = await memberSubs(admin, { userIds: [r.user_id] });
        sent += await pushMany(admin, subs, vapid, (s) => ({
          title: `🔔 ${r.title || tx(s.lang).reminder}`,
          body: r.body || '',
          tag: `rem-${r.id}`,
          url: '/#/reminders',
          requireInteraction: true,
        }));
      }
      if (r.repeat_min > 0) {
        let next = new Date(r.fire_at).getTime();
        while (next <= now) next += r.repeat_min * MIN;
        await admin.from('reminders').update({ fire_at: new Date(next).toISOString() }).eq('id', r.id);
      } else {
        await admin.from('reminders').update({ sent: true }).eq('id', r.id);
      }
    }
    report.reminders = sent;
  } catch (e) {
    console.error('reminders', e);
  }

  // ---------------------------------------------------------- 3) noticias
  try {
    const { data: news } = await admin.from('announcements').select('*').eq('pushed', false).limit(10);
    for (const n of news || []) {
      await admin.from('announcements').update({ pushed: true }).eq('id', n.id);
      if (vapid) {
        const subs = await memberSubs(admin);
        await pushMany(admin, subs, vapid, (s) => ({
          title: `📣 ${n.title}`, body: String(n.body || tx(s.lang).news).slice(0, 300),
          tag: `news-${n.id}`, url: '/#/home',
        }), { ttl: 86400, urgency: 'normal' });
      }
      if (n.to_discord) {
        await postDiscord(priv.discord_webhook_url, {
          username: pub.alliance_name || 'Alianza',
          content: `📣 **${n.title}**\n${String(n.body || '').slice(0, 1800)}`,
        });
      }
    }
  } catch (e) {
    console.error('news', e);
  }

  // ------------------------------------------------- 4) chat general → Discord
  try {
    if (priv.discord_webhook_url && priv.mirror_chat_to_discord) {
      const { data: msgs } = await admin.from('messages').select('*')
        .eq('channel', 'general').eq('source', 'app').eq('mirrored', false)
        .gte('created_at', new Date(now - 10 * MIN).toISOString())
        .order('created_at').limit(20);
      for (const m of msgs || []) {
        await postDiscord(priv.discord_webhook_url, {
          username: `${m.author_name} (app)`.slice(0, 80),
          content: String(m.body).slice(0, 1900),
        });
      }
      if (msgs?.length) await admin.from('messages').update({ mirrored: true }).in('id', msgs.map((m) => m.id));
    }
  } catch (e) {
    console.error('mirror', e);
  }

  // ------------------------------------------------- 5) Discord → app
  try {
    const ids = String(priv.discord_channel_ids || '').split(/[\s,]+/).filter(Boolean);
    const pushIds = new Set(String(priv.discord_push_channel_ids || '').split(/[\s,]+/).filter(Boolean));
    const allIds = Array.from(new Set([...ids, ...pushIds]));
    if (priv.discord_bot_token && allIds.length) {
      const ownWebhookId = (String(priv.discord_webhook_url).match(/webhooks\/(\d+)\//) || [])[1];
      const state = { ...(priv.discord_state || {}) };
      let imported = 0;
      for (const ch of allIds) {
        const after = state[ch];
        const url = `https://discord.com/api/v10/channels/${ch}/messages?limit=${after ? 50 : 10}${after ? `&after=${after}` : ''}`;
        const res = await fetch(url, { headers: { Authorization: `Bot ${priv.discord_bot_token}` } });
        if (!res.ok) { console.warn('discord read', ch, res.status, await res.text()); continue; }
        const list = (await res.json()) as any[];
        list.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        const rows = [];
        for (const m of list) {
          state[ch] = m.id;
          if (ownWebhookId && m.webhook_id === ownWebhookId) continue; // lo que mandamos nosotros
          const parts = [m.content || ''];
          for (const e of m.embeds || []) parts.push([e.title, e.description].filter(Boolean).join('\n'));
          for (const a of m.attachments || []) parts.push(a.url);
          const body = parts.filter(Boolean).join('\n').trim();
          if (!body) continue;
          rows.push({
            channel: 'discord', source: 'discord', external_id: `dc:${m.id}`,
            author_name: m.author?.global_name || m.author?.username || 'Discord',
            body: body.slice(0, 4000), created_at: m.timestamp,
          });
        }
        if (rows.length) {
          const { data: ins } = await admin.from('messages')
            .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true }).select();
          imported += ins?.length || 0;
          if (after && pushIds.has(ch) && vapid && ins?.length) {
            const subs = await memberSubs(admin);
            const last = ins[ins.length - 1];
            await pushMany(admin, subs, vapid, () => ({
              title: `💬 Discord · ${last.author_name}`,
              body: String(last.body).slice(0, 250) + (ins.length > 1 ? ` (+${ins.length - 1})` : ''),
              tag: `dc-${ch}`, url: '/#/chat/discord',
            }), { urgency: 'normal' });
          }
        }
      }
      await admin.from('private_settings').update({ discord_state: state }).eq('id', 1);
      report.discordImported = imported;
    }
  } catch (e) {
    console.error('discord sync', e);
  }

  return json({ ok: true, ...report });
});
