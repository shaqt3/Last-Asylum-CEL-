// Acciones que la app pide al servidor.
//   setup        (R5)      activa el sistema de avisos (claves push + tarea cada minuto)
//   test         (miembro) te envía una notificación de prueba
//   broadcast    (R4/R5)   aviso inmediato a toda la alianza (+ Discord)
//   translate    (miembro) traduce textos (con caché)
//   discord-test (R5)      prueba webhook y bot de Discord
import { adminClient, cors, json, loadSettings, vapidFrom, pushMany, memberSubs, postDiscord, translateTexts } from '../_shared/util.js';
import { generateVapidKeys } from '../_shared/webpush.js';
import { tx } from '../_shared/texts.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = adminClient();
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'not_logged_in' }, 401);
    const { data: me } = await admin.from('profiles').select('*').eq('id', u.user.id).single();
    if (!me || me.role === 'pending') return json({ error: 'not_approved' }, 403);
    const isOfficer = me.role === 'r4' || me.role === 'r5';
    const isR5 = me.role === 'r5';

    const body = await req.json().catch(() => ({}));
    const { pub, priv } = await loadSettings(admin);

    switch (body.action) {
      case 'setup': {
        if (!isR5) return json({ error: 'forbidden' }, 403);
        const updPriv: Record<string, unknown> = {};
        let publicKey = pub.vapid_public_key;
        if (!priv.vapid_private_jwk || !publicKey) {
          const k = await generateVapidKeys();
          publicKey = k.publicKey;
          updPriv.vapid_private_jwk = k.privateJwk;
          // claves nuevas: las suscripciones antiguas dejan de valer
          await admin.from('push_subscriptions').delete().neq('id', 0);
        }
        const secret = priv.cron_secret || crypto.randomUUID() + crypto.randomUUID();
        updPriv.cron_secret = secret;
        if (body.contact_email) updPriv.contact_email = `mailto:${String(body.contact_email).replace('mailto:', '')}`;
        await admin.from('private_settings').update(updPriv).eq('id', 1);
        await admin.from('app_settings').update({ vapid_public_key: publicKey, push_ready: true }).eq('id', 1);
        const tickUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/tick`;
        const { error } = await admin.rpc('admin_schedule_tick', { p_url: tickUrl, p_secret: secret });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, publicKey });
      }

      case 'test': {
        const vapid = vapidFrom(pub, priv);
        if (!vapid) return json({ error: 'push_not_ready' }, 400);
        const subs = await memberSubs(admin, { userIds: [me.id] });
        if (!subs.length) return json({ error: 'no_subscription' }, 400);
        const sent = await pushMany(admin, subs, vapid, (s) => ({
          title: pub.alliance_name || 'Last Asylum', body: tx(s.lang).test, tag: 'test', url: '/#/settings',
        }));
        return json({ ok: true, sent, devices: subs.length });
      }

      case 'broadcast': {
        if (!isOfficer) return json({ error: 'forbidden' }, 403);
        const title = String(body.title || '').slice(0, 120);
        const text = String(body.body || '').slice(0, 1000);
        if (!title) return json({ error: 'missing_title' }, 400);
        const vapid = vapidFrom(pub, priv);
        let sent = 0;
        if (vapid) {
          const subs = await memberSubs(admin);
          sent = await pushMany(admin, subs, vapid, () => ({
            title: `🚨 ${title}`, body: `${text}\n— ${me.nick}`, tag: `bc-${Date.now()}`, url: '/#/home', requireInteraction: true,
          }));
        }
        if (body.to_discord) {
          await postDiscord(priv.discord_webhook_url, {
            username: pub.alliance_name || 'Alianza', content: `🚨 **${title}**\n${text}\n— ${me.nick}`,
          });
        }
        return json({ ok: true, sent });
      }

      case 'translate': {
        const texts = (Array.isArray(body.texts) ? body.texts : []).slice(0, 50);
        const target = String(body.target || 'en').slice(0, 5).toLowerCase();
        if (!texts.length) return json({ translations: [] });
        const translations = await translateTexts(admin, priv, texts, target);
        return json({ translations });
      }

      case 'discord-test': {
        if (!isR5) return json({ error: 'forbidden' }, 403);
        const result: Record<string, unknown> = {};
        if (priv.discord_webhook_url) {
          result.webhook = await postDiscord(priv.discord_webhook_url, {
            username: pub.alliance_name || 'Alianza', content: '✅ Conexión con la app OK / App connection OK',
          });
        }
        if (priv.discord_bot_token) {
          const ids = `${priv.discord_channel_ids},${priv.discord_push_channel_ids}`.split(/[\s,]+/).filter(Boolean);
          result.channels = {};
          for (const id of ids) {
            const r = await fetch(`https://discord.com/api/v10/channels/${id}`, { headers: { Authorization: `Bot ${priv.discord_bot_token}` } });
            const j = await r.json().catch(() => ({}));
            (result.channels as Record<string, string>)[id] = r.ok ? `#${j.name}` : `error ${r.status}`;
          }
        }
        return json({ ok: true, ...result });
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
