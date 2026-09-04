'use strict';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstNumber(row, fields) {
  for (const field of fields) {
    const value = number(row && row[field]);
    if (value !== null) return value;
  }
  return null;
}

function intervalValues(interval) {
  const duration = firstNumber(interval, ['moving_time', 'elapsed_time', 'duration', 'duration_seconds']);
  const speed = firstNumber(interval, ['average_speed', 'avg_speed']);
  const sourceDistance = firstNumber(interval, ['distance', 'distance_m']);
  const distance = sourceDistance || (duration && speed ? duration * speed : null);
  const pace = duration && distance ? duration / (distance / 1000) : speed ? 1000 / speed : null;
  const hr = firstNumber(interval, ['average_heartrate', 'avg_hr', 'average_hr']);
  return { duration, distance, pace, hr };
}

function intervalKind(interval) {
  const text = normalise([interval && interval.type, interval && interval.name, interval && interval.description].filter(Boolean).join(' '));
  if (/\b(recovery|recover|rest|recuperacion|descanso|pause|pausa)\b/.test(text)) return 'recovery';
  if (/\b(warmup|warm up|calentamiento|cooldown|cool down|vuelta a la calma)\b/.test(text)) return 'transition';
  if (/\b(work|trabajo|interval|intervalo|serie|repeticion|repeat|tempo|threshold|umbral|vo2|max|z3|z4|z5)\b/.test(text)) return 'work';
  return 'unknown';
}

function activityIntervals(activity) {
  const raw = activity && activity.raw_summary && typeof activity.raw_summary === 'object' ? activity.raw_summary : {};
  const candidates = [raw.icu_intervals, raw.intervals, raw.activity && raw.activity.icu_intervals];
  return candidates.find(Array.isArray) || [];
}

function looksLikeBlockSession(workout, intervals) {
  const blocks = Array.isArray(workout && workout.blocks) ? workout.blocks : [];
  if (blocks.some(block => ['central', 'activation'].includes(String(block && block.type || '').toLowerCase()))) return true;
  const text = normalise([
    workout && workout.title,
    workout && workout.summary,
    workout && workout.structured_description,
    workout && workout.session_objective,
    workout && workout.adaptation_target,
  ].filter(Boolean).join(' '));
  if (/\b(series|serie|intervalos|intervalo|repeticiones|repeticion|fartlek|vo2|max|umbral|threshold)\b/.test(text)) return true;
  const kinds = (intervals || []).map(intervalKind);
  return kinds.includes('work') && (kinds.includes('recovery') || kinds.includes('transition'));
}

function selectWorkIntervals(intervals) {
  const valid = (intervals || []).map(interval => ({ interval, values: intervalValues(interval), kind: intervalKind(interval) }))
    .filter(row => row.values.pace && row.values.hr);
  const explicit = valid.filter(row => row.kind === 'work');
  if (explicit.length) return explicit;
  const nonRecovery = valid.filter(row => !['recovery', 'transition'].includes(row.kind));
  return nonRecovery.length && nonRecovery.length < valid.length ? nonRecovery : [];
}

function aggregateIntervals(rows) {
  if (!rows.length) return null;
  let totalDuration = 0;
  let totalDistance = 0;
  let weightedHr = 0;
  let hrWeight = 0;
  const paces = [];
  const hrs = [];
  for (const row of rows) {
    const values = row.values || intervalValues(row.interval || row);
    if (values.pace) paces.push(values.pace);
    if (values.hr) hrs.push(values.hr);
    if (values.duration && values.distance) {
      totalDuration += values.duration;
      totalDistance += values.distance;
    }
    if (values.hr && values.duration) {
      weightedHr += values.hr * values.duration;
      hrWeight += values.duration;
    }
  }
  const pace = totalDuration > 0 && totalDistance > 0
    ? totalDuration / (totalDistance / 1000)
    : paces.reduce((sum, value) => sum + value, 0) / paces.length;
  const hr = hrWeight > 0 ? weightedHr / hrWeight : hrs.reduce((sum, value) => sum + value, 0) / hrs.length;
  if (!number(pace) || !number(hr)) return null;
  return {
    pace_sec_per_km: Math.round(pace * 10) / 10,
    avg_hr: Math.round(hr * 10) / 10,
    ratio: Math.round((pace / hr) * 10000) / 10000,
    work_blocks: rows.length,
  };
}

function metricForSession(activity, workout) {
  const intervals = activityIntervals(activity);
  const blockSession = looksLikeBlockSession(workout, intervals);
  if (blockSession) {
    const work = selectWorkIntervals(intervals);
    const aggregate = aggregateIntervals(work);
    if (!aggregate) return { available: false, scope: 'work_blocks', reason: 'work_blocks_missing' };
    return { available: true, scope: 'work_blocks', ...aggregate };
  }
  const pace = number(activity && activity.avg_pace_sec_per_km);
  const hr = number(activity && activity.avg_hr);
  if (!pace || !hr) return { available: false, scope: 'whole_activity', reason: 'pace_or_hr_missing' };
  return {
    available: true,
    scope: 'whole_activity',
    pace_sec_per_km: Math.round(pace * 10) / 10,
    avg_hr: Math.round(hr * 10) / 10,
    ratio: Math.round((pace / hr) * 10000) / 10000,
    work_blocks: 0,
  };
}

function libraryMeta(workout) {
  const blocks = Array.isArray(workout && workout.blocks) ? workout.blocks : [];
  return blocks.find(block => block && (block.library_id || block.comparison_group || ['runflow_library_meta', 'runflow_meta'].includes(block.type))) || {};
}

function sessionType(workout) {
  const meta = libraryMeta(workout);
  const text = normalise([
    meta.comparison_group,
    meta.family,
    workout && workout.adaptation_target,
    workout && workout.session_objective,
    workout && workout.title,
    workout && workout.sport,
  ].filter(Boolean).join(' '));
  if (/\btrail|montana|mountain\b/.test(text)) return 'trail';
  if (/\bvo2|maxima potencia aerobica|max aerobi/.test(text)) return 'vo2max';
  if (/\bumbral|threshold|tempo\b/.test(text)) return 'umbral';
  if (/\bz2|zona 2|aerobico|aerobica|rodaje suave|endurance\b/.test(text)) return 'z2';
  return normalise(meta.comparison_group || workout && (workout.adaptation_target || workout.session_objective)) || null;
}

function identity(workout) {
  const meta = libraryMeta(workout);
  return {
    library_id: String(meta.library_id || workout && workout.runflow_library_id || '').trim() || null,
    name: normalise(workout && workout.title) || null,
    comparison_group: normalise(meta.comparison_group) || null,
    type: sessionType(workout),
  };
}

function matchLevel(current, previous) {
  if (current.library_id && current.library_id === previous.library_id) return 'library_session';
  if (current.name && current.name === previous.name) return 'same_name';
  if (current.comparison_group && current.comparison_group === previous.comparison_group) return 'comparison_group';
  if (current.type && current.type === previous.type) return 'session_type';
  return null;
}

function findPreviousComparable(rows, currentIndex) {
  const current = rows[currentIndex];
  const tiers = ['library_session', 'same_name', 'comparison_group', 'session_type'];
  for (const tier of tiers) {
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (matchLevel(current.identity, rows[index].identity) === tier) return { row: rows[index], match: tier };
    }
  }
  return null;
}

module.exports = {
  activityIntervals,
  findPreviousComparable,
  identity,
  intervalKind,
  metricForSession,
  normalise,
  sessionType,
};
