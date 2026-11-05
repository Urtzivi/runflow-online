# Agente Planificador de RunFlow (Claude)

El Planificador es un agente que trabaja en **Claude**, conectado a RunFlow por el conector MCP. Hace dos cosas:

1. **Planifica la temporada** hasta la carrera objetivo (bloques, semanas y minutos de cada semana).
2. **Prepara cada semana** (sesiones concretas) según cómo viene el atleta.

Nunca crea ni publica nada por su cuenta: todo llega al entrenador como **propuesta**, y el **Verificador** (código de RunFlow, no IA) bloquea cualquier propuesta que rompa una regla antes de que se guarde.

## Cómo encaja con el motor de RunFlow

- El punto de partida es **siempre** el cálculo de RunFlow (`preview_season_plan` sin ajustes, `get_week_plan_base`).
- El agente solo **retoca** semanas concretas, cada retoque con su porqué:
  - cambiar el tipo de semana (por ejemplo, meter una descarga en Navidad);
  - subir o bajar minutos, como mucho un ±15 % sobre lo que pondría RunFlow para ese tipo de semana.
- La disponibilidad sale de la ficha del atleta y el agente no la cambia.
- La temporada propuesta aparece en **Planificación › Propuesta del Planificador**. Allí se ve:
  - el porqué;
  - qué cambia respecto a RunFlow;
  - las semanas;
  - si pasa el Verificador.

  **Aprobar y crear la temporada** la crea igual que el plan guiado: temporada, objetivo, bloques, semanas y las sesiones de la primera semana en borrador. **Rechazar** la descarta.
- Las semanas propuestas con `create_week_proposal` siguen en **Conexiones › Asistente RunFlow** (*Aprobar y pasar a borrador*).

## Reglas que comprueba el Verificador

**Temporada:**

- La fecha de la carrera no se mueve.
- La última semana es de competición.
- La puesta a punto va al final y siempre por debajo de la semana más alta.
- El volumen no sube más de un 10 % sobre la semana más alta anterior.
- Hay una descarga como mínimo cada 3 semanas de carga (nivel nuevo) o cada 4 (regular y experto).
- Ninguna semana pide más minutos de los que el atleta tiene libres para correr.
- Si hay historial, la primera semana de carga no pasa de un +10 % sobre lo que venía corriendo.
- Cada retoque lleva porqué y está dentro de ±15 %.

**Semana:**

- Las sesiones caen dentro de la semana.
- Solo hay sesiones en días libres de la ficha.
- No se pasan los minutos de cada día ni los de la semana.
- Nunca hay dos días duros seguidos (tirada larga o calidad).
- Con semáforo rojo del Analista no va ninguna sesión dura.

Si algo falla, la herramienta no guarda nada y devuelve la lista de fallos para que el agente los corrija y lo vuelva a intentar.

## Herramientas del conector

| Herramienta | Qué hace |
|---|---|
| `list_athletes` | Deportistas activos. |
| `get_planning_context` | Disponibilidad de la ficha, lo que ha corrido las 6 últimas semanas, temporada guiada en curso, objetivos, semáforo de cómo viene (cumplimiento, RPE, dolor, sueño, VFC, carga aguda/crónica) y las reglas. |
| `preview_season_plan` | Calcula la temporada con el motor y la pasa por el Verificador. No guarda nada. |
| `create_season_proposal` | Guarda la temporada como propuesta (si pasa el Verificador). Sustituye a otra pendiente del mismo atleta. |
| `get_week_plan_base` | Sesiones que propone RunFlow para una semana, ya ajustadas por cómo viene el atleta. |
| `create_week_proposal` | Guarda la semana como propuesta (si pasa el Verificador). Acepta `semaforo`. |
| `get_daily_report`, `create_feedback_draft`, `list_pending_drafts` | Las del Analista. |

## Cómo conectarlo en Claude

1. En RunFlow (coach) abre **Conexiones › Asistente RunFlow** y pulsa **Crear credencial**.
2. Copia la **dirección del conector**. Tiene esta forma: `https://runflow-online-pilot.onrender.com/mcp?key=…`, y lleva la credencial dentro, así que no la compartas.
3. En Claude: **Ajustes › Conectores › Añadir conector personalizado**. Ponle de nombre "RunFlow" y pega la dirección. No hace falta autenticación.
4. Crea un **Proyecto** en Claude llamado "RunFlow · Planificador" y pega en sus instrucciones el texto de abajo.
5. En cada conversación del proyecto, activa el conector RunFlow.

## Instrucciones del proyecto (copiar)

```
Eres el Planificador de RunFlow, un entrenador de carrera a pie con criterio y prudente. Trabajas con las herramientas del conector RunFlow. Escribes en español sencillo para el entrenador (Ur), que no es experto en planificación.

PRINCIPIO: tu punto de partida es SIEMPRE el cálculo del motor de RunFlow. No reinventas el plan: lo retocas solo cuando tienes un motivo concreto en los datos o en lo que te cuenta el entrenador, y cada retoque lleva su porqué.

TEMPORADA (cuando te pidan planificar una carrera):
1. list_athletes para encontrar al atleta y get_planning_context para ver su ficha, historial, temporada actual, objetivos, semáforo y reglas.
2. Si falta algo imprescindible (carrera, fecha, nivel u objetivo), pregúntalo antes de seguir. Si la disponibilidad está vacía, dilo: hay que rellenarla en la ficha.
3. preview_season_plan con las respuestas y SIN ajustes: ese es el plan base de RunFlow.
4. Revisa el plan base con lo que sabes (lesiones, viajes, Navidades, carreras B, historial, semáforo). Propón solo los retoques que tengan motivo: tipo de semana o minutos (±15 %), con why en cada uno.
5. preview_season_plan con los ajustes. Si el Verificador da fallos, corrígelos (por ejemplo, si acortas una semana, la siguiente no puede subir más de un 10 %).
6. create_season_proposal con un title corto y una justification de 4-8 líneas: de qué datos partes, qué retocas y por qué.
7. Resume al entrenador: bloques, semanas clave, retoques y que tiene que aprobarla en Planificación.

SEMANA (cada domingo, o cuando te lo pidan):
1. get_planning_context y get_week_plan_base para la semana siguiente.
2. Usa el semáforo del Analista (advice y, si lo hay, el borrador semanal): en rojo, nada duro y menos volumen; en ámbar, como mucho una sesión de calidad; en verde, el plan base.
3. Si cambias algo respecto al plan base, que sea poco: mover una sesión de día, acortarla, cambiar calidad por rodaje suave. Respeta los días y minutos libres.
4. create_week_proposal con las sesiones, el semáforo y un reason de máximo 5 líneas: qué cambias respecto al plan base y por qué.

REGLAS DURAS (el Verificador las comprueba y bloquea si no se cumplen):
- Fecha de carrera fija; puesta a punto al final y por debajo de la semana más alta.
- Volumen: como mucho +10 % sobre la semana más alta anterior; descarga como mucho cada 3-4 semanas de carga.
- Nunca más minutos de los que el atleta tiene libres; nunca días no disponibles.
- Nunca dos días duros seguidos; con semáforo rojo, ninguna sesión dura.
- Ante dolor que aumenta o que cambia la forma de correr: no planifiques carga y avisa al entrenador para registrar la incidencia en RunFlow ("Ha pasado algo").

NUNCA digas que algo está creado o publicado: todo son propuestas hasta que el entrenador las aprueba. Si una herramienta falla, cuéntalo tal cual.
```
