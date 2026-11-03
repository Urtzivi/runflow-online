# Sistema multi-agente RunFlow — "El domingo por la noche, todo listo"

Diseño resultante de ejecutar el prompt "arquitecto de agentes" sobre RunFlow (3/11/2026).
Estado: **Día 1 hecho** (borradores de feedback + herramientas MCP). Siguiente: Día 2, Verificador.

---

## 1. Resumen ejecutivo

- **Objetivo:** que cada domingo por la noche cada atleta tenga su semana planificada y sus valoraciones (por sesión y semanal) listas, y que el entrenador solo valide.
- **Cuello de botella:** el tiempo del entrenador por atleta (analizar, redactar, planificar) crece en línea recta: con 3 atletas se puede, con 50 no.
- **Equipo:** 3 agentes (Analista, Planificador, Verificador) + el entrenador como único aprobador. El motor de reglas que ya tiene RunFlow hace los números (0 €); la IA solo redacta, usando tu suscripción de Claude (0 € extra).

---

## 0. Asunciones (decláralas falsas si no lo son)

| # | Asunción | Si es falsa… |
|---|----------|--------------|
| A1 | Ya pagas una suscripción de Claude (la usas para este código). "0 €" = **0 € adicionales**. | Plan B: modo solo reglas (sin IA). Funciona, pero los mensajes son más genéricos. |
| A2 | Los atletas suben sus actividades (sincronización/manual) antes del domingo por la tarde. | Lo que falte, el Analista lo marca como "sin datos" en vez de inventarlo. |
| A3 | El análisis por reglas (`ruleBasedAnalysis` en `server.js`), el plan guiado y `planned-load-hook.js` son la fuente de verdad de números y cargas. | Si no te fías de ellos, ese es el primer trabajo antes de automatizar. |
| A4 | Ningún mensaje ni plan llega al atleta sin tu "Aprobar". | — (es una regla, no una asunción) |
| A5 | La OpenAI key actual (`OPENAI_API_KEY`) cuesta dinero → se deja **opcional y apagada** en este sistema. | Si tienes crédito gratis, puede ser plan C para redactar. |

---

## 2. Equipo de agentes

> Regla aplicada: cada agente tiene una salida verificable. Se descartaron "Agente de mensajería" (enviar es un botón, no un agente), "Agente de comunicación semanal" (lo hace el Analista) y "Orquestador LLM" (lo hace un cron + código).

### Agente 1 — Analista

| Campo | Detalle |
|---|---|
| Propósito | Convertir sesiones realizadas en análisis + borrador de mensaje al atleta. Dos modos: **sesión** (diario) y **semana** (domingo). |
| Inputs | Sesión planificada vs. realizada, análisis por reglas ya calculado, RPE/comentarios/audio transcrito del atleta, últimas 4 semanas de carga. |
| Outputs | JSON `{athlete_id, scope: "session"\|"week", hechos[], alertas[], semaforo: verde\|ambar\|rojo, mensaje_atleta (≤120 palabras), notas_para_coach}` |
| Herramientas | MCP RunFlow: `list_athletes`, `get_daily_report`, *(nuevo)* `get_week_review`, *(nuevo)* `create_feedback_draft`. |
| Criterios de éxito | Cada número del mensaje existe en el input; semáforo coherente con alertas; tasa de aprobación sin editar ≥ 70 % a la semana 4. |
| Modos de fallo | Inventar datos (ritmos, FC); tono genérico; ignorar dolor/lesión mencionado por el atleta; analizar una sesión sin datos. |
| Modelo | Sonnet (repetitivo, alto volumen). |

**System prompt (copiar):**
```
Eres el Analista de RunFlow, asistente de un entrenador de running y trail.
Recibes datos de sesiones (plan vs. realizado) y un análisis por reglas ya calculado.
REGLAS:
1. Usa SOLO números presentes en el input. Si falta un dato, escribe "sin datos", nunca lo estimes.
2. Si el atleta menciona dolor, molestia, lesión, enfermedad o cansancio extremo: semaforo="rojo" y añade alerta "REVISIÓN COACH".
3. El mensaje al atleta: español, tuteo, cercano, máx. 120 palabras, 1 cosa bien hecha + 1 cosa a mejorar + 1 indicación concreta para la próxima sesión. Sin emojis salvo 1 al final si encaja.
4. En modo "week": compara carga planificada vs. realizada, cumplimiento (%), tendencia de 4 semanas y 1-3 conclusiones para el Planificador.
5. Nunca prometas cambios en el plan: eso lo decide el entrenador.
Devuelve EXCLUSIVAMENTE el JSON del esquema, y guárdalo con create_feedback_draft (estado "borrador").
```

### Agente 2 — Planificador

| Campo | Detalle |
|---|---|
| Propósito | Proponer la semana siguiente de cada atleta, partiendo del motor de plan guiado y ajustándola con el análisis semanal. |
| Inputs | Análisis semanal del Analista, fase/objetivo de temporada, disponibilidad del atleta, plan base generado por el motor (plan guiado / V9). |
| Outputs | Propuesta vía `create_week_proposal` (ya existe, solo borrador) + `justificacion` de ≤5 líneas para el coach. |
| Herramientas | MCP RunFlow: `create_week_proposal`, *(nuevo)* `get_athlete_context`. |
| Criterios de éxito | Pasa el Verificador a la primera ≥ 90 %; el coach aprueba sin editar ≥ 60 % a la semana 4. |
| Modos de fallo | Subir carga tras semana "roja"; poner 2 días duros seguidos; programar en días no disponibles; reescribir el plan entero en vez de ajustarlo. |
| Modelo | Opus (razonamiento; solo 1 llamada/atleta/semana). |

**System prompt (copiar):**
```
Eres el Planificador de RunFlow. Tu punto de partida es SIEMPRE el plan base que genera el motor de RunFlow; solo lo AJUSTAS, no lo reinventas.
Ajustes permitidos: mover sesiones de día, cambiar volumen ±15 %, cambiar intensidad de una sesión, convertir sesión en descanso/recuperación.
REGLAS DURAS:
- Semana anterior "rojo" → carga ≤ 90 % de la realizada y 0 sesiones de alta intensidad hasta que el coach diga lo contrario.
- Subida de carga semanal ≤ 10 % sobre la media de las últimas 3 semanas.
- Nunca 2 días de alta intensidad consecutivos. Respeta los días no disponibles.
- Fechas solo de lunes a domingo de la semana objetivo.
Llama a create_week_proposal y escribe una justificación de máx. 5 líneas: qué cambiaste respecto al plan base y por qué (citando el análisis semanal).
Si no tienes datos suficientes, propone el plan base sin cambios y dilo.
```

### Agente 3 — Verificador (código, no LLM)

| Campo | Detalle |
|---|---|
| Propósito | Bloquear cualquier borrador que rompa una regla dura antes de que llegue a tu bandeja. |
| Inputs | Borradores del Analista y propuestas del Planificador + datos fuente. |
| Outputs | `{draft_id, ok: bool, fallos[]}`; marca el borrador como `listo` o `revisar`. |
| Herramientas | Funciones JS en el servidor (sin coste, deterministas). |
| Comprobaciones | Números del mensaje ⊂ números del input · longitud ≤120 palabras · alerta de dolor ⇒ rojo · rampa ≤10 % · no 2 duros seguidos · días disponibles · fechas dentro de semana · sin duplicados (1 borrador por sesión/semana, clave idempotente). |
| Modos de fallo | Reglas demasiado estrictas (todo a "revisar") → ajustar umbrales la semana 2. |

**Humano — Entrenador (tú):** única persona que aprueba. Ve una **Bandeja del domingo** por atleta: semáforo, mensaje(s), semana propuesta, justificación, fallos del Verificador. Botones: *Aprobar y enviar*, *Editar*, *Rechazar*. "Aprobar todos los verdes" disponible a partir de la semana 3.

---

## 3. Mapa del flujo

```
DIARIO (cuando entra una actividad)                     coste IA
  actividad sincronizada
   → motor reglas: ruleBasedAnalysis (ya existe)          0
   → [Analista modo sesión] → borrador mensaje           (lote nocturno)
   → [Verificador] → ok / revisar
   → Bandeja (pendiente)

DOMINGO 18:00 (tarea programada)
  para cada atleta (lotes de 10):
   1. [Analista modo semana] → análisis semanal + mensaje semanal
   2. [Verificador]
   3. motor plan guiado → plan base semana siguiente       0
   4. [Planificador] ajusta → create_week_proposal (borrador)
   5. [Verificador]
  → resumen: "N atletas listos, M para revisar, K sin datos"

DOMINGO 20:00–22:00  ✋ TÚ apruebas en la Bandeja
  Aprobar → plan publicado + mensajes enviados (/api/athlete/messages)
```

- **Condiciones de parada:** atleta sin actividades en 7 días → no se planifica, aparece como "sin datos / contactar". Semáforo rojo → nunca entra en "Aprobar todos".
- **Reintentos:** si el Verificador falla, 1 reintento del agente con la lista de fallos; si vuelve a fallar → "revisar" (a mano). Si la IA no responde (límite de uso) → borrador solo con reglas + aviso.
- **Puntos de aprobación humana:** 1) todo mensaje al atleta, 2) toda semana publicada, 3) cualquier rojo.

---

## 4. Herramientas y stack

| Pieza | Propuesta | Por qué |
|---|---|---|
| Dónde vive la lógica | **Dentro de RunFlow** (Node en Render + Supabase) | Ya tienes datos, motor y API de asistente. Nada nuevo que pagar. |
| Quién "piensa" | **Tarea programada de Claude** (domingo 18:00) conectada al **MCP de RunFlow** (`/api/assistant/…`, credencial con scopes `read`+`draft`) | Usa tu suscripción actual → 0 € extra. El MCP ya existe y solo puede crear borradores: seguro por diseño. |
| Feedback diario de sesión | Reglas + plantilla en el servidor (0 €); Claude lo pule en el lote del domingo o en una tarea nocturna | No depende de IA para funcionar. |
| Verificador | Funciones JS nuevas en `assistant-api-hook.js` | Determinista, gratis, testeable con `scripts/test-*.cjs`. |
| Memoria / contexto | **Supabase**: análisis semanales y borradores en tablas propias (`assistant_drafts`, `assistant_weekly_reviews`). El "aprendizaje" del coach ya se captura en Learning V1 (`learning-api-hook.js`). | Los agentes no recuerdan nada entre ejecuciones: todo contexto sale de la base de datos. |
| Envío al atleta | Endpoint existente `/api/athlete/messages` + notificaciones push ya montadas | Solo se llama tras tu "Aprobar". |

**Trabajo de código necesario (mínimo):**
1. MCP: añadir `get_week_review`, `get_athlete_context`, `create_feedback_draft`, `list_pending_drafts`.
2. Tabla de borradores con estado `borrador → listo|revisar → aprobado|rechazado → enviado` y clave idempotente.
3. Verificador (funciones + test).
4. Pantalla "Bandeja del domingo" en `coach.html`.

**Escalado a 50 atletas con 0 €:** el motor de reglas no tiene límite. La parte IA son ~50 análisis semanales + 50 planes + ~200 mensajes de sesión. En lotes de 10 atletas eso cabe razonablemente en una suscripción, pero **no está garantizado** (A1): si se alcanza el límite, el sistema degrada a "solo reglas" y te avisa, nunca se queda a medias sin decirlo.

---

## 5. Plan de lanzamiento de 7 días

| Día | Entregable | Prueba |
|---|---|---|
| 1 ✅ | Borradores + `create_feedback_draft` + `list_pending_drafts` en el MCP | `scripts/test-assistant-drafts.cjs` |
| 2 | Verificador (reglas duras) + tests en `scripts/` | Tests en verde con casos buenos y malos |
| 3 | Bandeja del domingo en Coach (aprobar / editar / rechazar / enviar) | Aprobar un mensaje y verlo en la app del atleta |
| 4 | Analista: modo sesión y modo semana; prueba manual desde Claude con 1 atleta | Comparar con lo que tú habrías escrito |
| 5 | Planificador sobre el plan base + `get_athlete_context` | Propuesta de 1 atleta pasa el Verificador |
| 6 | Tarea programada domingo 18:00 para los 3 atletas | Ensayo completo un día cualquiera |
| 7 | **Domingo real** con 3 atletas: tú solo apruebas. Anota cada edición que hagas. | Medición (sección 6) |

**Después:** semanas 2-3 ajustar prompts con tus ediciones; semana 4 activar "Aprobar todos los verdes"; subir a 10 → 25 → 50 atletas solo si la tasa de aprobación sin editar se mantiene ≥ 70 %.

---

## 6. Medición

| Métrica | Cómo | Objetivo |
|---|---|---|
| **Éxito principal** | Domingo 22:00: % atletas con semana publicada + valoración enviada | 100 % |
| Calidad | % borradores aprobados sin editar (guardar diff edición vs. borrador) | ≥ 70 % semana 4 |
| Seguridad | Nº borradores con dato inventado o rojo no detectado | 0 |
| Velocidad | Minutos que pasas en la Bandeja / nº atletas | < 3 min/atleta |
| Consistencia | % que pasa el Verificador a la primera | ≥ 90 % |
| Coste | € extra (debe ser 0) + nº ejecuciones que cayeron a "solo reglas" | 0 € / < 10 % |
| ROI | Horas/semana antes vs. después y nº de atletas que puedes llevar | 50 atletas en < 2,5 h el domingo |

Todo se registra en la tabla de auditoría que ya usa el asistente (`AUDIT`).

---

## 7. Errores a evitar

1. **Enviar sin aprobar "porque ya funciona bien".** Un mensaje equivocado sobre una lesión cuesta un atleta.
2. **Dejar que la IA haga cálculos.** Ritmos, cargas y % los calcula el código; la IA solo redacta e interpreta.
3. **Reinventar el plan cada semana.** El Planificador ajusta el plan del motor; si no, pierdes la periodización.
4. **Duplicados** (dos mensajes por la misma sesión tras un reintento). Clave idempotente por `atleta+sesión` / `atleta+semana`.
5. **Escalar antes de medir.** No pases de 3 a 50 atletas hasta tener 3 domingos buenos seguidos.
6. **Fallos silenciosos.** Si un atleta no tiene borrador el domingo, debe aparecer en rojo, no desaparecer.
7. **Prompts sin ejemplos reales.** Tras 2 semanas, pega 3 mensajes tuyos aprobados como ejemplo de estilo en el prompt del Analista.

---

## Comprobaciones finales

- **¿Cada agente es necesario?** Sí: Analista (redacción), Planificador (ajuste razonado), Verificador (seguridad, sin coste). Se eliminaron 3 candidatos sin salida propia.
- **¿Transferencias limpias?** Todas pasan por la tabla de borradores con estado; ningún agente llama a otro directamente.
- **¿Dónde puede haber duplicación o alucinaciones?** Reintentos (→ clave idempotente) y números en mensajes (→ Verificador).
- **¿Qué sigue necesitando revisión humana?** Todo envío, todo plan publicado, todo semáforo rojo.
- **¿Puedes empezar hoy?** Sí: Día 1 = tabla de borradores + 2 herramientas MCP. Dime "adelante" y lo construyo.

---

## Registro de implementación

### Día 1 — Borradores de feedback (hecho)

- **Almacenamiento:** igual que las propuestas y credenciales del asistente, en `workout_templates` con `category = '__runflow_assistant_draft__'`. **No hace falta migración SQL.**
- **Estados:** `draft → ready | needs_review` (Verificador, día 2) `→ approved | rejected` (coach, día 3) `→ sent`.
- **Sin duplicados:** clave `session:<atleta>:<actividad>` o `week:<atleta>:<lunes>`. Un reintento reemplaza el borrador pendiente (guarda las 5 versiones anteriores en `history`); si ya está `approved`/`sent` responde 409 y no lo toca.
- **MCP (`/mcp`):** `create_feedback_draft` (scope `draft`), `list_pending_drafts` (scope `read`).
- **REST asistente:** `POST /api/assistant/athletes/:id/drafts`, `GET /api/assistant/drafts?status=&kind=&athlete_id=`.
- **REST coach:** `GET /api/coach/assistant-drafts` (base para la Bandeja del día 3).
- Todo queda en la auditoría (`draft_created`, `draft_replaced`, `drafts_read`).
