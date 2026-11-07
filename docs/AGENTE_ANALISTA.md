# Agente Analista de RunFlow (Claude)

El Analista trabaja en **Claude**, conectado a RunFlow por el conector MCP (igual que el Planificador). Hace dos informes:

1. **Informe de cada sesión** — dos veces al día (14:00 y 22:00, hora de Madrid) analiza las sesiones nuevas de todos los atletas.
2. **Informe de la semana** — el domingo a las 18:30, antes de que el Planificador prepare la semana siguiente (19:37).

Los números los calcula RunFlow (el mismo motor que la web del Coach: efecto del entrenamiento, bloques, cumplimiento). El Analista los interpreta y redacta; **nunca inventa un dato**: si falta, lo dice.

## Dónde llegan los informes

- **A Ur, en Claude:** cada ejecución de la tarea programada abre un hilo en el proyecto RunFlow con los informes completos (aviso en el móvil).
- **En RunFlow (Coach):**
  - el informe de una sesión aparece arriba del todo al abrir esa actividad para **validarla**;
  - el informe semanal aparece debajo de la **propuesta de la semana siguiente** (Ajustes › Conexiones › Propuestas pendientes).
- **Al atleta no le llega nada** del Analista. Su borrador de mensaje queda guardado para el entrenador.

## Lo que ve el atleta

Solo el **objetivo de la semana**, en una frase, que escribe el Planificador (`objetivo_atleta`, máx. 140 caracteres) y que la app enseña en *Mensaje de tu entrenador* y en *Tu semana*. Por ejemplo: «Esta semana buscamos mejorar la eficiencia en cuestas». La explicación larga (`objetivo_coach`) es solo para el entrenador.

## Herramientas del conector

| Herramienta | Qué hace |
|---|---|
| `list_sessions_to_analyze` | Actividades de los últimos días de todos los atletas, separando las que aún no tienen informe. |
| `get_session_analysis` | Todo lo de una sesión: actividad, sesión planificada (objetivo, estructura, para qué sirve, RPE esperado), objetivo de la semana, cumplimiento, efecto del entrenamiento (minutos por dominio, estímulos, si coincide con lo planificado), bloque a bloque, lectura automática, valoración del atleta, chequeo del día y recuperación de los últimos días. |
| `get_week_review` | La semana completa: objetivo, plan frente a hecho, totales, efecto acumulado, efecto e informe de cada sesión, sensaciones, chequeos diarios, recuperación frente a las 4 semanas anteriores y tendencia de 5 semanas. |
| `create_feedback_draft` | Guarda el informe (`informe_coach` en Markdown, `resumen`, `objetivo_cumplido` si/parcial/no/sin_plan, `efecto_principal`, `semaforo`, `alertas`) y un borrador de mensaje al atleta. Uno por sesión o semana: repetir lo sustituye. |
| `list_pending_drafts` | Informes ya guardados (`status=all` para todos). El Planificador lee aquí el informe semanal. |

## Estructura del informe de sesión

```
## En una frase
## Qué buscábamos
## Qué hizo
## Bloque a bloque
## Efecto del entrenamiento
## Cómo lo vivió
## ¿Hemos conseguido el objetivo?
## Qué me llevo para lo que viene
```

## Estructura del informe semanal

```
## La semana en una frase
## Qué buscábamos esta semana
## Qué se hizo
## Qué se ha trabajado
## Qué se ha conseguido
## Cómo lo ha llevado
## ¿Hemos cumplido los objetivos?
## Para la semana que viene
```

La última sección es la base del Planificador: subir, mantener o bajar, qué priorizar y qué vigilar.

## Reglas

- Solo números que vengan de `get_session_analysis` o `get_week_review`.
- Si el atleta habla de dolor, lesión, enfermedad o cansancio extremo: semáforo rojo y alerta «REVISIÓN COACH».
- `objetivo_cumplido`: `si` si el efecto principal coincide con lo planificado y se completó lo esencial; `parcial` si se hizo pero con menos estímulo, más intensidad de la debida o bloques incompletos; `no` si el efecto fue otro o no se hizo; `sin_plan` si no había sesión planificada.
- Español sencillo, para un entrenador que no es experto en fisiología: cada término técnico, explicado la primera vez.
- No promete cambios en el plan: eso lo decide el entrenador con el Planificador.
