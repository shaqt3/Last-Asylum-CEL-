// Textos de las notificaciones en cada idioma.
const T = {
  es: {
    before: (t, n, time) => `${t} empieza en ${n} (${time})`,
    start: (t, time) => `¡${t} empieza ya! (${time})`,
    during: (t, end) => `${t} sigue en marcha — termina a las ${end}`,
    ending: (t, n) => `${t} termina en ${n}`,
    shield: '🛡️ Recuerda: ESCUDO',
    reminder: 'Recordatorio',
    news: 'Noticia de la alianza',
    test: 'Las notificaciones funcionan ✅',
    h: 'h', m: 'min',
  },
  en: {
    before: (t, n, time) => `${t} starts in ${n} (${time})`,
    start: (t, time) => `${t} is starting now! (${time})`,
    during: (t, end) => `${t} is running — ends at ${end}`,
    ending: (t, n) => `${t} ends in ${n}`,
    shield: '🛡️ Remember: SHIELD',
    reminder: 'Reminder',
    news: 'Alliance news',
    test: 'Notifications are working ✅',
    h: 'h', m: 'min',
  },
  tr: {
    before: (t, n, time) => `${t} ${n} sonra başlıyor (${time})`,
    start: (t, time) => `${t} şimdi başlıyor! (${time})`,
    during: (t, end) => `${t} devam ediyor — ${end} saatinde bitiyor`,
    ending: (t, n) => `${t} ${n} sonra bitiyor`,
    shield: '🛡️ Unutma: KALKAN',
    reminder: 'Hatırlatma',
    news: 'İttifak haberi',
    test: 'Bildirimler çalışıyor ✅',
    h: 'sa', m: 'dk',
  },
  de: {
    before: (t, n, time) => `${t} beginnt in ${n} (${time})`,
    start: (t, time) => `${t} beginnt jetzt! (${time})`,
    during: (t, end) => `${t} läuft — endet um ${end}`,
    ending: (t, n) => `${t} endet in ${n}`,
    shield: '🛡️ Denk dran: SCHILD',
    reminder: 'Erinnerung',
    news: 'Allianz-News',
    test: 'Benachrichtigungen funktionieren ✅',
    h: 'Std', m: 'Min',
  },
  fr: {
    before: (t, n, time) => `${t} commence dans ${n} (${time})`,
    start: (t, time) => `${t} commence maintenant ! (${time})`,
    during: (t, end) => `${t} est en cours — fin à ${end}`,
    ending: (t, n) => `${t} se termine dans ${n}`,
    shield: '🛡️ Rappel : BOUCLIER',
    reminder: 'Rappel',
    news: "Actu de l'alliance",
    test: 'Les notifications fonctionnent ✅',
    h: 'h', m: 'min',
  },
  pt: {
    before: (t, n, time) => `${t} começa em ${n} (${time})`,
    start: (t, time) => `${t} começa agora! (${time})`,
    during: (t, end) => `${t} em andamento — termina às ${end}`,
    ending: (t, n) => `${t} termina em ${n}`,
    shield: '🛡️ Lembrete: ESCUDO',
    reminder: 'Lembrete',
    news: 'Notícia da aliança',
    test: 'As notificações funcionam ✅',
    h: 'h', m: 'min',
  },
  ru: {
    before: (t, n, time) => `${t} начнётся через ${n} (${time})`,
    start: (t, time) => `${t} начинается! (${time})`,
    during: (t, end) => `${t} идёт — закончится в ${end}`,
    ending: (t, n) => `${t} закончится через ${n}`,
    shield: '🛡️ Не забудь: ЩИТ',
    reminder: 'Напоминание',
    news: 'Новости альянса',
    test: 'Уведомления работают ✅',
    h: 'ч', m: 'мин',
  },
};

export function tx(lang) {
  return T[lang] || T.en;
}

export function dur(minutes, lang) {
  const t = tx(lang);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ${t.h} ${m} ${t.m}`;
  if (h) return `${h} ${t.h}`;
  return `${m} ${t.m}`;
}
