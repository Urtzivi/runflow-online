(function(root) {
  'use strict';
  const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const sport = value => {
    const s = String(value || '').toLowerCase();
    if (/ride|bike|cycl|cicl|bici/.test(s)) return 'ride';
    if (/run|trail|carrera/.test(s)) return 'run';
    if (/strength|fuerza/.test(s)) return 'strength';
    return s;
  };
  const mismatch = (planned, actual) => Boolean(sport(planned) && sport(actual) && sport(planned) !== sport(actual));
  const published = week => (week.publication_status || week.status) === 'published';
  function records(result) {
    const rows = [], seen = new Set();
    for (const week of result.weeks || []) {
      for (const workout of week.workouts || []) {
        for (const activity of workout.activities || []) addActivity(activity, workout);
        const log = workout.manual_log;
        if (!(workout.activities || []).length && log && ['completed', 'partial'].includes(log.status)) {
          const planned = number(workout.planned_load), minutes = number(workout.planned_duration_min), actual = number(log.actual_duration_min);
          const load = planned !== null && minutes > 0 && actual > 0 ? planned * actual / minutes : log.status === 'completed' ? planned : null;
          rows.push({athlete:result.athlete, workout, type:'manual', date:workout.workout_date, load, estimated:true});
        }
      }
      for (const activity of week.unplanned_activities || []) addActivity(activity, null);
    }
    function addActivity(activity, workout) {
      const key = String(activity.id || activity.intervals_activity_id);
      if (seen.has(key)) return;
      seen.add(key);
      const date = String(activity.activity_date || workout?.workout_date || '').slice(0,10);
      const expected = workout || (result.weeks || []).filter(published).flatMap(w=>w.workouts || []).find(w=>w.workout_date===date && mismatch(w.sport,activity.sport));
      rows.push({athlete:result.athlete, workout:expected || {}, activity, type:'intervals', date, load:number(activity.load), linked:Boolean(workout), estimated:false});
    }
    return rows;
  }
  function total(rows) {
    return {load:rows.reduce((sum,row)=>sum+(row.load ?? 0),0), missing:rows.filter(row=>row.load===null).length, estimated:rows.filter(row=>row.estimated).length};
  }
  const model = {number, sport, mismatch, published, records, total};
  if (typeof module !== 'undefined') module.exports = model;
  else root.RunFlowTraining = model;
})(typeof window === 'undefined' ? globalThis : window);
