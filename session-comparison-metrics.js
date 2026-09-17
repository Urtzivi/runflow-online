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

function paceText(seconds) {
  const value = number(seconds);
  if (!value) return null;
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/km`;
}

function secondsFor(value, unit) {
  const amount = number(value);
  if (!amount) return null;
  const normalisedUnit = normalise(unit);
  if (['s', 'sec', 'seg', 'second', 'seconds'].includes(normalisedUnit)) return amount;
  if (['m', 'min', 'minute', 'minutes'].includes(normalisedUnit)) return amount * 60;
  return null;
}

function plannedSteps(workout) {
  const result = [];
  const blocks = Array.isArray(workout && workout.blocks) ? workout.blocks : [];
  for (const block of blocks) {
    const type = String(block && block.type || '').toLowerCase();
    if (type === 'warmup' || type === 'cooldown') {
      result.push({
        phase: type,
        kind: 'transition',
        label: type === 'warmup' ? 'Calentamiento' : 'Vuelta a la calma',
        repetition: null,
        duration_seconds: secondsFor(block.duration_min, 'm'),
        distance_m: null,
        target: block.target || null,
      });
      continue;
    }
    if (type === 'activation') {
      const repetitions = Math.max(1, Math.round(number(block.repetitions) || 1));
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        result.push({ phase: 'activation', kind: 'work', label: 'Activación', repetition, duration_seconds: secondsFor(block.work_sec, 's'), distance_m: null, target: block.target || null });
        if (number(block.recovery_sec)) result.push({ phase: 'activation_recovery', kind: 'recovery', label: 'Recuperación activación', repetition, duration_seconds: secondsFor(block.recovery_sec, 's'), distance_m: null, target: block.recovery_target || null });
      }
      continue;
    }
    if (!['central', 'steady'].includes(type)) continue;
    const repetitions = Math.max(1, Math.round(number(block.repetitions) || 1));
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      result.push({
        phase: 'work', kind: 'work', label: block.name || 'Bloque de trabajo', repetition,
        duration_seconds: secondsFor(block.work_value || block.duration_min, block.work_unit || (block.duration_min ? 'm' : null)),
        distance_m: normalise(block.work_unit) === 'km' && number(block.work_value) ? number(block.work_value) * 1000 : null,
        target: block.target || null,
      });
      if (number(block.recovery_value)) result.push({
        phase: 'recovery', kind: 'recovery', label: 'Recuperación', repetition,
        duration_seconds: secondsFor(block.recovery_value, block.recovery_unit),
        distance_m: normalise(block.recovery_unit) === 'km' ? number(block.recovery_value) * 1000 : null,
        target: block.recovery_target || null,
      });
    }
  }
  return result;
}

function intervalDetail(interval, index, planned = null, source = 'intervals') {
  const values = intervalValues(interval);
  const maxHr = firstNumber(interval, ['max_heartrate', 'max_hr', 'maximum_hr']);
  const elevation = firstNumber(interval, ['total_elevation_gain', 'elevation_gain', 'icu_elevation_gain']);
  return {
    index: index + 1,
    source,
    phase: planned && planned.phase || intervalKind(interval),
    kind: planned && planned.kind || intervalKind(interval),
    label: planned && planned.label || String(interval && (interval.name || interval.type) || `Bloque ${index + 1}`),
    repetition: planned && planned.repetition || null,
    planned_duration_seconds: planned && planned.duration_seconds || null,
    planned_distance_m: planned && planned.distance_m || null,
    planned_target: planned && planned.target || null,
    duration_seconds: values.duration ? Math.round(values.duration) : null,
    distance_m: values.distance ? Math.round(values.distance) : null,
    pace_sec_per_km: values.pace ? Math.round(values.pace * 10) / 10 : null,
    pace: paceText(values.pace),
    average_hr: values.hr ? Math.round(values.hr * 10) / 10 : null,
    max_hr: maxHr ? Math.round(maxHr) : null,
    elevation_gain_m: elevation ? Math.round(elevation * 10) / 10 : null,
  };
}

function streamData(activity, type) {
  const raw = activity && activity.raw_summary && typeof activity.raw_summary === 'object' ? activity.raw_summary : {};
  const streams = Array.isArray(activity && activity.streams) ? activity.streams : Array.isArray(raw.streams) ? raw.streams : [];
  return streams.find(item => normalise(item && item.type) === normalise(type))?.data || [];
}

function averageValues(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function streamTotalDuration(activity, time) {
  const raw = activity && activity.raw_summary && typeof activity.raw_summary === 'object' ? activity.raw_summary : {};
  const declared = firstNumber(activity, ['duration_sec', 'moving_time', 'elapsed_time'])
    || firstNumber(raw, ['moving_time', 'elapsed_time', 'icu_recording_time']);
  if (declared) return declared;
  if (time.length < 2) return 0;
  const deltas = time.slice(1).map((value, index) => Number(value) - Number(time[index])).filter(value => value > 0 && value < 30);
  const sample = deltas.length ? averageValues(deltas) : 1;
  return Math.max(0, Number(time[time.length - 1]) - Number(time[0]) + (sample || 1));
}

function samplesBetween(time, start, end) {
  const indices = [];
  for (let index = 0; index < time.length; index += 1) {
    const second = Number(time[index]) - Number(time[0] || 0);
    if (second >= start && second < end) indices.push(index);
  }
  return indices;
}

function windowAverage(values, time, start, end) {
  return averageValues(samplesBetween(time, start, end).map(index => values[index]));
}

function streamRangeDetail(activity, step, index, start, end, totalDuration) {
  const time = streamData(activity, 'time');
  const distance = streamData(activity, 'distance');
  const hr = streamData(activity, 'heartrate');
  const speed = streamData(activity, 'velocity_smooth');
  const altitude = streamData(activity, 'altitude');
  const cadence = streamData(activity, 'cadence');
  const boundedStart = Math.max(0, Math.min(totalDuration, start));
  const boundedEnd = Math.max(boundedStart, Math.min(totalDuration, end));
  const indices = samplesBetween(time, boundedStart, boundedEnd);
  const plannedDuration = Number(step.duration_seconds || 0);
  const actualDuration = Math.max(0, boundedEnd - boundedStart);
  if (!indices.length || actualDuration <= 0) {
    return {
      ...intervalDetail({}, index, step, 'streams'),
      start_second: Math.round(boundedStart), end_second: Math.round(boundedStart),
      duration_seconds: 0, completion_ratio: 0, completion_status: 'not_started',
    };
  }
  const first = indices[0], last = indices[indices.length - 1];
  const metres = distance.length ? Math.max(0, Number(distance[last]) - Number(distance[first])) : null;
  const validHr = indices.map(i => Number(hr[i])).filter(value => Number.isFinite(value) && value > 0);
  const validSpeed = indices.map(i => Number(speed[i])).filter(value => Number.isFinite(value) && value > 0);
  const validCadence = indices.map(i => Number(cadence[i])).filter(value => Number.isFinite(value) && value > 0);
  const avgSpeed = averageValues(validSpeed);
  const avgHr = averageValues(validHr);
  const pace = metres && actualDuration ? actualDuration / (metres / 1000) : avgSpeed ? 1000 / avgSpeed : null;
  const midpoint = boundedStart + actualDuration / 2;
  const firstHalfSpeed = windowAverage(speed, time, boundedStart, midpoint);
  const secondHalfSpeed = windowAverage(speed, time, midpoint, boundedEnd);
  const firstHalfHr = windowAverage(hr, time, boundedStart, midpoint);
  const secondHalfHr = windowAverage(hr, time, midpoint, boundedEnd);
  const startHr = windowAverage(hr, time, boundedStart, Math.min(boundedEnd, boundedStart + 15));
  const endHr = windowAverage(hr, time, Math.max(boundedStart, boundedEnd - 15), boundedEnd);
  const startAltitude = altitude.length && Number.isFinite(Number(altitude[first])) ? Number(altitude[first]) : null;
  const endAltitude = altitude.length && Number.isFinite(Number(altitude[last])) ? Number(altitude[last]) : null;
  const netElevation = startAltitude !== null && endAltitude !== null ? endAltitude - startAltitude : null;
  const smoothedPaces = [];
  for (let second = boundedStart; second < boundedEnd; second += 15) {
    const sampleSpeed = windowAverage(speed, time, second, Math.min(boundedEnd, second + 15));
    if (sampleSpeed && sampleSpeed > 0) smoothedPaces.push(1000 / sampleSpeed);
  }
  const paceMean = averageValues(smoothedPaces);
  const paceVariance = paceMean && smoothedPaces.length > 1
    ? smoothedPaces.reduce((sum, value) => sum + ((value - paceMean) ** 2), 0) / smoothedPaces.length
    : null;
  const completionRatio = plannedDuration ? Math.min(1, actualDuration / plannedDuration) : 1;
  return {
    ...intervalDetail({
      moving_time: actualDuration,
      distance: metres,
      average_speed: avgSpeed,
      average_heartrate: avgHr,
      max_heartrate: validHr.length ? Math.max(...validHr) : null,
      elevation_gain: netElevation === null ? null : Math.max(0, netElevation),
    }, index, step, 'streams'),
    start_second: Math.round(boundedStart),
    end_second: Math.round(boundedEnd),
    duration_seconds: Math.round(actualDuration),
    completion_ratio: Math.round(completionRatio * 1000) / 1000,
    completion_status: completionRatio >= 0.98 ? 'complete' : 'partial',
    average_cadence: averageValues(validCadence) === null ? null : Math.round(averageValues(validCadence) * 10) / 10,
    start_hr: startHr === null ? null : Math.round(startHr * 10) / 10,
    end_hr: endHr === null ? null : Math.round(endHr * 10) / 10,
    hr_change: startHr === null || endHr === null ? null : Math.round((endHr - startHr) * 10) / 10,
    first_half_hr: firstHalfHr === null ? null : Math.round(firstHalfHr * 10) / 10,
    second_half_hr: secondHalfHr === null ? null : Math.round(secondHalfHr * 10) / 10,
    first_half_pace_sec_per_km: firstHalfSpeed ? Math.round((1000 / firstHalfSpeed) * 10) / 10 : null,
    second_half_pace_sec_per_km: secondHalfSpeed ? Math.round((1000 / secondHalfSpeed) * 10) / 10 : null,
    pace_variability_percent: paceVariance === null ? null : Math.round((Math.sqrt(paceVariance) / paceMean) * 1000) / 10,
    net_elevation_m: netElevation === null ? null : Math.round(netElevation * 10) / 10,
    average_gradient_percent: netElevation === null || !metres ? null : Math.round((netElevation / metres) * 1000) / 10,
  };
}

function reconstructFromStreams(activity, steps) {
  if (!steps.length || steps.some(step => !step.duration_seconds)) return [];
  const time = streamData(activity, 'time');
  if (!time.length) return [];
  const totalDuration = streamTotalDuration(activity, time);
  const cooldownIndex = steps.map(step => step.phase).lastIndexOf('cooldown');
  const cooldown = cooldownIndex >= 0 ? steps[cooldownIndex] : null;
  const prefix = cooldown ? steps.slice(0, cooldownIndex) : steps;
  const plannedBeforeCooldown = prefix.reduce((sum, step) => sum + Number(step.duration_seconds || 0), 0);
  const missingBeforeCooldown = Math.max(0, plannedBeforeCooldown + Number(cooldown && cooldown.duration_seconds || 0) - totalDuration);
  let remainingMissing = missingBeforeCooldown;
  const missing = new Set();
  for (let index = prefix.length - 1; index >= 0 && remainingMissing > 0; index -= 1) {
    const step = prefix[index];
    if (!['work', 'recovery'].includes(step.kind)) continue;
    if (remainingMissing >= Number(step.duration_seconds || 0) * 0.8) {
      missing.add(index);
      remainingMissing = Math.max(0, remainingMissing - Number(step.duration_seconds || 0));
    }
  }
  let cursor = 0;
  const result = [];
  prefix.forEach((step, index) => {
    if (missing.has(index)) {
      result.push(streamRangeDetail(activity, step, index, cursor, cursor, totalDuration));
      return;
    }
    const actual = Math.min(Number(step.duration_seconds || 0), Math.max(0, totalDuration - cursor));
    result.push(streamRangeDetail(activity, step, index, cursor, cursor + actual, totalDuration));
    cursor += actual;
  });
  if (cooldown) {
    const cooldownStart = Math.min(cursor, totalDuration);
    result.push(streamRangeDetail(activity, cooldown, cooldownIndex, cooldownStart, totalDuration, totalDuration));
  }
  return result;
}

function detailedBlocks(activity, workout) {
  const intervals = activityIntervals(activity);
  const steps = plannedSteps(workout);
  const streamed = reconstructFromStreams(activity, steps);
  if (streamed.length) return streamed;
  if (!intervals.length) return [];
  const rows = [];
  let plannedIndex = 0;
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    const kind = intervalKind(interval);
    let match = steps[plannedIndex] || null;
    if (match && kind !== 'unknown' && match.kind !== kind) {
      const candidate = steps.findIndex((step, stepIndex) => stepIndex >= plannedIndex && step.kind === kind);
      if (candidate >= 0) { plannedIndex = candidate; match = steps[plannedIndex]; }
    }
    rows.push(intervalDetail(interval, index, match, 'intervals'));
    if (match) plannedIndex += 1;
  }
  return rows;
}

function compareDetailedBlocks(currentRows, previousRows) {
  const current = (currentRows || []).filter(row => row.kind === 'work' && number(row.pace_sec_per_km));
  const previous = (previousRows || []).filter(row => row.kind === 'work' && number(row.pace_sec_per_km));
  const count = Math.min(current.length, previous.length);
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const now = current[index], before = previous[index];
    rows.push({
      repetition: now.repetition || index + 1,
      current_pace_sec_per_km: now.pace_sec_per_km,
      previous_pace_sec_per_km: before.pace_sec_per_km,
      pace_change_sec_per_km: Math.round((now.pace_sec_per_km - before.pace_sec_per_km) * 10) / 10,
      current_avg_hr: now.average_hr,
      previous_avg_hr: before.average_hr,
      hr_change: number(now.average_hr) && number(before.average_hr) ? Math.round((now.average_hr - before.average_hr) * 10) / 10 : null,
    });
  }
  return rows;
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
  compareDetailedBlocks,
  detailedBlocks,
  findPreviousComparable,
  identity,
  intervalKind,
  metricForSession,
  normalise,
  paceText,
  plannedSteps,
  sessionType,
};
