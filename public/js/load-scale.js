/*
 * RunFlow · Escala de carga única: la de Intervals.icu.
 *
 * Intervals da a cada actividad una carga en la que una hora al umbral vale unos 100
 * (rodaje suave de 45' ≈ 40, tirada de trail de 47' ≈ 60). Antes, parte de la carga
 * planificada de RunFlow venía en otra escala, la sRPE (minutos × RPE): 60' de fuerza = 300,
 * 30' de trote = 60. Al sumarla con la de Intervals la fuerza pesaba como 6 rodajes y el
 * cumplimiento salía bajo. Aquí está la regla única para pasar todo a la escala de Intervals:
 *
 *   carga = horas × IF² × 100, con IF (intensidad relativa al umbral) sacado del RPE;
 *   en fuerza × 0,7 (es un esfuerzo a ratos, con pausas entre series).
 *
 * Una carga planificada que da 1,9 o más por minuto no puede ser de Intervals (eso es ir
 * por encima del umbral todo el rato): se toma como sRPE, su RPE es carga / minutos y se
 * pasa con la regla. Así se puede aplicar las veces que haga falta sin cambiar lo ya pasado.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunFlowLoadScale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // RPE 0-10 → intensidad relativa al umbral (IF). Ajustado con actividades reales de Intervals.
  const IF_BY_RPE = [0.45, 0.55, 0.62, 0.70, 0.76, 0.81, 0.86, 0.90, 0.94, 0.98, 1.03];
  const STRENGTH_FACTOR = 0.7;
  const SRPE_MIN_PER_MIN = 1.9;

  const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const isStrength = sport => /strength|fuerza|weight|gym|gimnasio|rehab|movilidad/i.test(String(sport || ''));

  function intensityFromRpe(rpe) {
    const r = Math.max(0, Math.min(10, Number(rpe) || 0));
    const lo = Math.floor(r), hi = Math.min(10, lo + 1);
    return IF_BY_RPE[lo] + (IF_BY_RPE[hi] - IF_BY_RPE[lo]) * (r - lo);
  }

  // Carga en escala Intervals de una sesión de `minutes` minutos a un RPE dado.
  function fromRpe(minutes, rpe, sport) {
    const m = num(minutes), r = num(rpe);
    if (!(m > 0) || !(r > 0)) return null;
    const f = intensityFromRpe(r);
    return Math.max(1, Math.round(m / 60 * f * f * 100 * (isStrength(sport) ? STRENGTH_FACTOR : 1)));
  }

  const looksLikeSrpe = (load, minutes) => {
    const l = num(load), m = num(minutes);
    return l > 0 && m > 0 && l / m >= SRPE_MIN_PER_MIN;
  };

  // Deja una carga planificada en escala Intervals. Si ya lo está (o no hay minutos), no la toca.
  function toIntervals(load, minutes, sport) {
    const l = num(load);
    if (l === null) return load;
    if (!looksLikeSrpe(l, minutes)) return l;
    return fromRpe(minutes, Math.min(10, l / num(minutes)), sport);
  }

  return { IF_BY_RPE, STRENGTH_FACTOR, SRPE_MIN_PER_MIN, intensityFromRpe, fromRpe, looksLikeSrpe, toIntervals, isStrength };
});
