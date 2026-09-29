const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../public/js/coach-training-model.js');
const athlete={id:'a',display_name:'Atleta'};
test('loads include extra activities, exclude future prescriptions and never count linked activities twice',()=>{
  const activity={id:'ride',load:40,sport:'Ride',activity_date:'2026-09-29'};
  const result={athlete,weeks:[{status:'draft',workouts:[{id:'draft',planned_load:300,workout_date:'2026-09-30'}]},{status:'published',workouts:[{id:'run',sport:'TrailRun',planned_load:90,activities:[activity]}],unplanned_activities:[activity,{id:'unknown',load:null,activity_date:'2026-09-29'},{id:'zero',load:0,activity_date:'2026-09-29'}]}]};
  const rows=model.records(result);
  assert.equal(rows.length,3);
  assert.deepEqual(model.total(rows),{load:40,missing:1,estimated:0});
  assert.equal(model.mismatch(rows[0].workout.sport,rows[0].activity.sport),true);
  assert.equal(model.published(result.weeks[0]),false);
});
test('manual activity estimate is distinct from measured load; a missing load remains missing',()=>{
  const rows=model.records({athlete,weeks:[{workouts:[{id:'manual',planned_load:60,planned_duration_min:60,manual_log:{status:'partial',actual_duration_min:30}},{id:'no-load',planned_load:null,manual_log:{status:'completed',actual_duration_min:50}}]}]});
  assert.deepEqual(model.total(rows),{load:30,missing:1,estimated:2});
});
test('an unlinked ride can reference a published run without silently linking it or using a draft',()=>{
  const draft={id:'draft',sport:'Run',workout_date:'2026-09-29'};
  const run={id:'run',sport:'TrailRun',workout_date:'2026-09-29'};
  const rows=model.records({athlete,weeks:[{status:'draft',workouts:[draft]},{status:'published',workouts:[run],unplanned_activities:[{id:'ride',sport:'Ride',activity_date:'2026-09-29',load:35}]}]});
  assert.equal(rows[0].workout.id,'run');assert.equal(rows[0].linked,false);
  assert.equal(model.mismatch('Run','TrailRun'),false);
  assert.equal(model.mismatch('Run',null),false);
});
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
function extract(name){const start=source.indexOf('function '+name+'(');const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}
const context=vm.createContext({roundOrNull:(n,d)=>Number(n.toFixed(d)),addDays:()=> '2026-10-04',microcycleTypeLabel:()=>'',publicActivitySummary:x=>x});
for(const name of ['sportKey','aggregateActivityMetrics','calculateExecutionMetrics','decorateCalendarWeeks'])vm.runInContext(extract(name),context);
test('server does not mark a planned run complete when its linked activity is cycling; load is still counted',()=>{
  const workout={id:'w',training_week_id:'week',sport:'TrailRun',workout_date:'2026-09-29',planned_load:90};
  const ride={id:'a',workout_id:'w',sport:'Ride',activity_date:'2026-09-29',load:40,duration_sec:3600};
  const weeks=context.decorateCalendarWeeks([{id:'week',week_start:'2026-09-28'}],[workout],[ride],[]);
  assert.equal(weeks[0].workouts[0].execution_status,'changed');
  assert.equal(weeks[0].execution.completed_sessions,0);
  assert.equal(weeks[0].execution.load,40);
  const running=context.calculateExecutionMetrics([workout],[{...ride,sport:'Run'}],[]);
  assert.equal(running.completed_sessions,1);
});
