# Agente Prepartido (fútbol)

Ayuda al entrenador con las comidas prepartido de un futbolista. Funciona en Claude con el conector del Asistente RunFlow, igual que el Analista y el Planificador.

## Herramienta

`get_football_matches` (solo lectura): partidos de los próximos días (por defecto 10) desde el programa de fútbol del atleta (Coach › Fútbol › Semana). Para cada partido: fecha, día, `hora` y `hora_metida`, rival, casa/fuera, lugar, nota, y lo que tiene el día anterior (`dia_anterior`) y el mismo día (`mismo_dia`).

## Tareas programadas

1. **Miércoles 10:00 (Madrid):** mira el próximo partido. Si no hay partido metido para los próximos días o no tiene hora, avisa al entrenador.
2. **Cada día 17:00 (Madrid):** si hay partido mañana, manda al entrenador el plan: cena de la noche anterior, desayuno, comidas y tentempiés del día del partido, con horas calculadas desde la hora del partido, e hidratación. Si no hay partido mañana, no escribe nada.

Pautas de horas: comida principal 3–4 h antes del partido (rica en hidratos, poca grasa y fibra), tentempié ligero 60–90 min antes, agua a sorbos. Nada nuevo el día del partido. Si el partido es por la mañana, el desayuno hace de comida principal.

## Después del partido

`get_football_feedback` (solo lectura): lo que el futbolista escribe en RunFlow Fútbol después de partidos, entrenos y fuerza (minutos, RPE, dolor y zona, cuerpo, ánimo, comentario; en partidos resultado, nota, lo mejor, a mejorar, su relato, esfuerzo, piernas y "Mi partido por dentro") y su bienestar. Devuelve `partidos_sin_valorar` y `alertas` (dolor ≥ 4).

Tareas: la noche del partido resume la valoración para el entrenador con un borrador de respuesta; a la mañana siguiente avisa si el partido sigue sin valorar.
