# RunFlow V9 + Athlete V2 — alcance inicial

## Regla de seguridad
- No sobreescribir `/coach.html`, `/coach-v8.html` ni `/athlete.html` durante el desarrollo.
- Coach V9 vive en `/coach-v9.html`.
- Athlete V2 vive en `/athlete-v2.html`.
- Nuevas funcionalidades en JS/CSS propios siempre que sea posible.

## Coach V9
1. Motor RunFlow genera el plan completo hasta objetivo A: objetivo → macro → fases → mesos → micros → sesiones.
2. Sesiones futuras quedan PLANIFICADAS; el coach publica semana a semana.
3. Biblioteca oficial de sesiones v1 como catálogo del motor.
4. Perfil dinámico del atleta:
   - disponibilidad por día;
   - tiempo máximo;
   - terreno/material;
   - fuerza programada por RunFlow o fuerza externa;
   - si fuerza externa, días habituales conocidos por RunFlow;
   - carga máxima semanal vigente con histórico de cambios.
5. Replanificación hacia delante cuando cambie disponibilidad, carga máxima, fuerza, objetivos u otras variables relevantes.
6. Pasado realizado inmutable; presente revisable; futuro recalculable.
7. Motor propio de carga RunFlow:
   - contabiliza actividades importadas y manuales;
   - estima carga para actividades no importadas;
   - evita duplicados si luego aparece la actividad equivalente desde Intervals;
   - calcula Aptitud/Fatiga/Forma sobre la carga completa RunFlow.
8. Fuerza externa:
   - RunFlow reserva esos días como sesiones externas;
   - no prescribe contenido;
   - atleta informa duración real y RPE;
   - carga resultante entra en el motor RunFlow.

## Athlete V2
1. Mantener la UX actual como base, en ruta separada.
2. Permitir registrar sesiones/actividades no programadas.
3. Permitir modificar la fecha de una sesión publicada antes de realizarla.
4. El cambio de fecha debe conservar identidad, estructura, objetivo, carga y relación con macro/meso/micro.
5. Si la sesión está sincronizada con Intervals.icu, el cambio de fecha debe actualizar también la sesión correspondiente en Intervals para que llegue correctamente al reloj.
6. Antes de mover una sesión, avisar de conflictos relevantes con otras sesiones; no bloquear automáticamente salvo restricción técnica real.
7. Mostrar trazabilidad al coach: fecha original → nueva fecha, modificado por atleta.
8. Fuerza externa ya prevista: atleta solo completa duración real y RPE como datos obligatorios mínimos.

## Principios
- Intervals es fuente/sincronizador; RunFlow es el motor de decisión.
- No inventar reglas no validadas.
- Las funcionalidades validadas son acumulativas y no se eliminan.
