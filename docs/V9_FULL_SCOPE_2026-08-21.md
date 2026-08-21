# RunFlow V9 + Athlete V2 · alcance consolidado

Fecha: 2026-08-21

Este documento consolida los requisitos que deben aplicarse como un lote completo, evitando cambios parciales en producción.

## Coach V9

- Motor de planificación completo: OBJETIVO A → macro → fases → mesociclos → microciclos → sesiones.
- Objetivos B/C pueden modificar temporalmente el camino sin perjudicar A.
- Disponibilidad estructurada por día: entrenable, tiempo máximo, actividades/terreno/gimnasio/montaña/bici.
- Fuerza: `RunFlow la programa` o `fuerza externa`. Si es externa se indican días y RunFlow reserva esos huecos.
- Carga máxima actual del atleta como techo dinámico, con histórico de cambios.
- Replanificación desde una fecha efectiva por cambios de disponibilidad, carga máxima u objetivo. Pasado inmutable; futuro no publicado recalculable.
- Plan completo hasta A en estado planificado; publicación semanal manual del coach.
- Biblioteca oficial V1: 307 sesiones (207 running/trail + 100 fuerza), 33 cadenas de progresión, 6 objetivos y 5 fases.
- Planificador guiado operativo, conectado a datos reales.
- Motor de alertas: sesión prevista no realizada, fatiga/estado/RPE/dolor/tendencias y revisión previa a publicar.
- En Resumen, `Revisar` debe abrir la sesión/actividad concreta.
- Comparación automática de sesiones comparables y Puerta de Adaptación.
- Mensajes motivacionales tipo banner separados del chat.
- RunFlow calcula su propia carga completa y, a partir de ella, Aptitud/Fatiga/Forma; Intervals es una fuente de actividades, no la fuente de esas métricas.
- Actividades de Intervals con carga 0 reciben carga RunFlow estimada de forma conservadora usando historial comparable y contexto (duración, distancia, desnivel y velocidad media), con fuente/confianza visible.
- Deduplicación: si una actividad manual aparece posteriormente desde Intervals, se fusiona/reemplaza sin sumar dos veces.

## Athlete V2

- Añadir actividad manual desde Actividad y también desde la cabecera de Inicio, encima de Sesión de hoy.
- Actividad manual: tipo, fecha, duración y RPE obligatorios; distancia, D+, dolor, sensación y comentario opcionales.
- La actividad manual se guarda en RunFlow y recibe carga RunFlow estimada, no solo una copia local.
- Fuerza externa prevista: el atleta solo completa duración real + RPE.
- Reprogramar la fecha de una sesión publicada; el cambio debe sincronizarse con Intervals para que llegue al reloj.
- Mostrar aviso si el nuevo día genera conflicto relevante, sin bloquear necesariamente el cambio.
- Trazabilidad del cambio de fecha para el coach.
- Banner motivacional enviado por el coach, separado del chat.
- Aptitud/Fatiga/Forma mostradas desde el motor RunFlow cuando V9 esté activo.

## Regla de entrega

No modificar `/coach.html`, `/coach-v8.html` ni `/athlete.html`. Todo se desarrolla sobre `/coach-v9.html` y `/athlete-v2.html`, manteniendo las versiones estables como respaldo.
