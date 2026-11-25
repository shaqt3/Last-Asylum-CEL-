# Last Asylum · App de alianza (PWA)

Guía, calendario de eventos **en la hora local de cada miembro**, avisos push al móvil (antes, durante y al terminar), chat con traducción, recordatorios personales (temporizador de escudo), noticias, roles **R4/R5** y conexión con **Discord** en los dos sentidos.

Diseño **steampunk oscuro** (hierro, latón y cobre), con modo claro opcional (botón ☀/☾). En la entrada, un **doctor de la peste** veneciano sale de la niebla, te sigue con la mirada mientras escribes el email y **se tapa los ojos** cuando escribes la contraseña (si pulsas 👁, espía con un ojo).

Idioma principal: **inglés**; cada miembro puede elegir otro en Ajustes.

Idiomas de la interfaz: español, inglés, turco, alemán, francés, portugués y ruso. Los textos (guías, chat, noticias) se traducen con un botón 🌐 o automáticamente en el chat.

Una vez instalado, **todo se gestiona desde la app** (Admin). Supabase solo se toca una vez, al principio.

---

## Cómo funciona la hora

- R4/R5 crean los eventos en **hora del servidor** o en **su hora local** (la app convierte).
- Cada miembro ve el evento y recibe los avisos **en su propia zona horaria** (se detecta sola al registrarse; se puede cambiar en Ajustes).
- Ejemplo: escudo a las 02:00 UTC del sábado → en Madrid se ve a las 03:00, en Estambul a las 05:00. Con "avisar antes 180, 60, 15" llegan avisos a las 00:00, 02:00 y 02:45 (hora de Madrid), uno al empezar, otro cada hora durante el evento y otro 15 min antes de que termine.
- En Discord los avisos usan marcas de tiempo de Discord, así que **cada uno también los ve en su hora**.

---

## Instalación (una sola vez, ~20 minutos)

### 1. Crear el proyecto en Supabase
1. Entra en [supabase.com](https://supabase.com) → **New project** (plan gratuito). Apunta la contraseña de la base de datos.
2. En **Project Settings → API** copia la **Project URL** y la **anon / publishable key**.
3. Edita `js/config.js` en GitHub y pega esos dos valores.
4. En **Authentication → URL Configuration** pon como *Site URL* la dirección de la app en Vercel (paso 3).
   - Si no quieres que la gente tenga que confirmar el email: **Authentication → Sign In / Providers → Email → desactiva "Confirm email"**.

### 2. Base de datos y funciones (automático con GitHub)
**Primero (solo una vez):** en GitHub → *Add file → Create new file*, escribe como nombre `.github/workflows/supabase.yml` y pega dentro el contenido de `setup/supabase-deploy.yml`. Guarda (*Commit changes*).

Después, en el repositorio de GitHub: **Settings → Secrets and variables → Actions → New repository secret** y crea:

| Secreto | Dónde se saca |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → avatar → **Access Tokens** → Generate |
| `SUPABASE_PROJECT_ID` | Supabase → Project Settings → General → **Project ID** |
| `SUPABASE_DB_PASSWORD` | La contraseña que pusiste al crear el proyecto |

Después: pestaña **Actions → Supabase deploy → Run workflow**. Crea las tablas, los permisos, las guías de ejemplo y las dos funciones (`api` y `tick`). Cada vez que cambie algo en `/supabase` se vuelve a desplegar solo.

> Alternativa manual: pega los dos archivos de `supabase/migrations/` en el **SQL Editor** de Supabase y despliega las funciones con `supabase functions deploy`.

### 3. Publicar la app en Vercel
**Vercel → Add New → Project →** elige `Last-Asylum-CEL-` → Framework: **Other**, sin comando de build → **Deploy**. Cada cambio en GitHub se publica solo.

### 4. Primer arranque (desde la app)
1. Abre la app y **crea tu cuenta** con `angeddgg@gmail.com` y tu contraseña: ese email entra **directamente como R5**.
   - Cuentas de prueba: regístrate también con `adminuser@admin.com` (entra como **R5**) y con `testuser@test.com` (entra **pendiente**, apruébala desde Admin → Miembros para probar el flujo de un miembro normal).
   - Para que estas cuentas de prueba funcionen sin email real, desactiva **Confirm email** (paso 1.4).
   - La lista de emails que entran como R5 está en la tabla `private_settings`, campo `owner_email` (separados por comas). Borra `adminuser@admin.com` de ahí cuando acabes las pruebas.
2. **Más → Admin → Sistema de avisos**: escribe tu email y pulsa **Activar sistema de avisos**. Esto genera las claves de notificación y la tarea que revisa los eventos cada minuto. Acepta el permiso de notificaciones.
3. **Admin → Alianza**: nombre, etiqueta, **zona horaria del servidor del juego** (normalmente UTC) y mensaje de bienvenida.
4. **Admin → Miembros**: cualquiera puede registrarse, pero entra **pendiente** hasta que tú o un R4/R5 lo aprobéis. Aquí también nombras a los R4.
5. **Ajustes → Enviar prueba** para comprobar que llegan las notificaciones.

---

## Discord

### App → Discord (avisos, noticias y chat General)
Discord → ajustes del canal → **Integraciones → Webhooks → Nuevo webhook → Copiar URL**. Pégala en **Admin → Discord → URL del webhook**.

### Discord → app (mensajes y novedades del juego)
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → **Bot** → *Reset Token* (cópialo) y activa **Message Content Intent**.
2. **OAuth2 → URL Generator**: marca `bot` y los permisos *View Channels* y *Read Message History*. Abre la URL generada e invita al bot a tu servidor.
3. En Discord activa **Ajustes → Avanzado → Modo desarrollador**, clic derecho en el canal → **Copiar ID del canal**.
4. En **Admin → Discord**: pega el token del bot y los IDs:
   - *Canales a mostrar*: aparecen en la pestaña **Chat → Discord**.
   - *Canales que además envían notificación*: igual, pero mandan push a todos (úsalo para anuncios).
5. **Novedades del juego automáticas**: en el Discord oficial de Last Asylum, en su canal de anuncios pulsa **Seguir** y elige un canal de tu servidor. Pon el ID de ese canal en "canales que envían notificación": cada anuncio oficial llegará a la app y al móvil.

Pulsa **Probar conexión** para comprobar que todo responde.

---

## Traducción
Sin configurar nada usa un traductor gratuito con límite diario. Para más volumen, en **Admin → Traducción**:
- **Google Cloud Translation**: crea una clave de API con la *Cloud Translation API* activada (500.000 caracteres gratis al mes).
- o **DeepL API Free** (500.000 caracteres/mes).

Las traducciones se guardan en caché: cada texto se traduce una vez por idioma.

---

## iPhone y Android
- **Android (Chrome)**: las notificaciones funcionan desde el navegador o instalada.
- **iPhone (iOS 16.4+)**: hay que **instalarla** (Safari → Compartir → *Añadir a pantalla de inicio*) y abrirla desde el icono; después activar notificaciones en Ajustes.
- Si alguien no recibe avisos: Ajustes → *Desactivar* y *Activar* otra vez, y que el móvil no tenga el ahorro de batería extremo para el navegador.

---

## Qué hay dentro

```
index.html, css/, js/           App (sin build, JavaScript plano)
  js/app.js                     Pantallas: inicio, eventos, guías, chat, recordatorios, ajustes, admin
  js/i18n.js                    Textos de la interfaz (añade idiomas copiando el bloque "en")
  js/schedule.js                Conversión hora servidor ↔ hora local (cambios de horario incluidos)
sw.js, manifest.webmanifest     PWA: instalación, modo sin conexión, notificaciones
supabase/migrations/            Tablas, roles R4/R5 y permisos (RLS), contenido de ejemplo
supabase/functions/tick         Cada minuto: avisos de eventos, recordatorios, noticias, Discord ⇄ app
supabase/functions/api          Activar avisos, prueba, aviso urgente, traducción, prueba de Discord
```

**Permisos**
| | Miembro | R4 | R5 |
|---|:-:|:-:|:-:|
| Ver guías, eventos, noticias, chat | ✓ | ✓ | ✓ |
| Recordatorios propios, silenciar eventos | ✓ | ✓ | ✓ |
| Crear/editar guías, eventos y noticias | | ✓ | ✓ |
| Aviso urgente a toda la alianza, chat R4/R5 | | ✓ | ✓ |
| Aprobar miembros | | ✓ | ✓ |
| Cambiar rangos, ajustes, Discord, traducción | | | ✓ |

Costes: todo cabe en los planes gratuitos de Supabase y Vercel para una alianza de 100 personas (la tarea de cada minuto son ~43.000 llamadas al mes de 500.000 incluidas).
