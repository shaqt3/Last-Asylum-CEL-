-- Contenido inicial de ejemplo. R4/R5 pueden editarlo o borrarlo desde la app.

insert into public.guides (title, category, pinned, sort, body)
select * from (values
(
  'Cómo usar esta app', 'basicos', true, 0,
$md$## Bienvenida
Esta app es la base de la alianza: **guías**, **calendario de eventos en tu hora local**, **chat**, **noticias** y **recordatorios** que llegan al móvil.

## Primeros pasos
1. Instálala: en Android, menú del navegador → *Instalar app*. En iPhone, Safari → *Compartir* → *Añadir a pantalla de inicio* (en iPhone las notificaciones **solo** funcionan instalada).
2. Ve a **Ajustes** y pulsa **Activar notificaciones**. Usa *Enviar prueba* para comprobarlo.
3. Revisa tu **zona horaria** en Ajustes. Todos los eventos se muestran en tu hora.

## Avisos
Cada evento avisa antes, durante y antes de terminar, según lo configuren R4/R5. Si un evento no te interesa, puedes silenciarlo en su ficha.
$md$
),
(
  'Escudos: cuándo y cómo', 'trucos', true, 1,
$md$## Activar un escudo
Toca tu base → **Escudo** → elige la duración.

## Consejos
- No gastes gemas en escudos si puedes evitarlo: mira primero la **tienda de la alianza**.
- Antes de desconectarte en días de guerra o eventos PvP, **pon escudo**.
- Usa **Recordatorios → Temporizador de escudo** para que la app te avise antes de que caduque.
$md$
),
(
  'Duelo de alianzas', 'eventos', false, 2,
$md$## Qué es
Evento recurrente por fases: cada día puntúa una categoría distinta.

## Claves
- Guarda aceleradores y recursos para la fase que los puntúa.
- Mira el calendario de la app: R4/R5 apuntan qué toca cada día.
- La última fase suele ser la de combate: **escudo** si no vas a participar.

*(R4/R5: completad esta guía con las fases y prioridades de vuestra alianza.)*
$md$
),
(
  'Caza / Hunt Battle', 'eventos', false, 3,
$md$## Qué es
Evento de alianza por oleadas que activa un **R4 o R5**. Hace falta un mínimo de miembros.

## Claves
- Conéctate a la hora que marque el calendario.
- Ten las tropas curadas y las marchas listas antes del inicio.

*(R4/R5: añadid la hora habitual y la dificultad que elegís.)*
$md$
),
(
  'Mejoras prioritarias', 'mejoras', false, 4,
$md$## Orden recomendado (editable por R4/R5)
1. Edificio principal / Santuario.
2. Investigación de recursos y velocidad.
3. Hospital y muralla.
4. Héroes principales del equipo.
$md$
)
) as v(title, category, pinned, sort, body)
where not exists (select 1 from public.guides);

-- Evento de ejemplo (desactivado): escudo a las 02:00 hora del servidor
insert into public.events (title, description, checklist, start_time, duration_min, recurrence, weekdays,
                           remind_before, remind_during_every, remind_end_before, shield, active, color)
select 'Ejemplo: ventana de escudo', 'Evento de ejemplo. Edítalo o bórralo.',
       E'Poner escudo\nRecoger recursos\nTropas en el hospital curadas',
       '02:00', 120, 'weekly', '{6}', '{180,60,15}', 60, 15, true, false, '#3e63dd'
where not exists (select 1 from public.events);
