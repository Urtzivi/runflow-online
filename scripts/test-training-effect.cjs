const {test}=require('node:test');
const assert=require('node:assert/strict');
const TE=require('../public/js/training-effect.js');

const thr=1000/240; // ritmo umbral 4:00/km
const raw={lthr:170,threshold_pace:thr,type:'Run'};
function streams(segs){const t=[],hr=[],v=[];let s=0,h=110;for(const [dur,pct,hrT] of segs){for(let i=0;i<dur;i++){h+=(hrT-h)/40;t.push(s++);hr.push(Math.round(h));v.push(thr*pct);}}return [{type:'time',data:t},{type:'heartrate',data:hr},{type:'velocity_smooth',data:v}];}
const run=(segs,plannedKey)=>TE.analyse({activity:{sport:'Run',raw_summary:raw,streams:streams(segs)},plannedKey});
const reps=(n,work,rec)=>Array.from({length:n},()=>[work,rec]).flat();

test('6 × 3 min a ritmo de 5K trabaja VO2máx',()=>{
  const r=run([[900,0.8,140],...reps(6,[180,1.08,178],[120,0.7,140]),[600,0.78,135]],'vo2');
  assert.equal(r.kind,'vo2');
  assert.ok(r.plan.ok);
});

test('3 × 10 min a umbral trabaja el umbral',()=>{
  assert.equal(run([[900,0.8,140],...reps(3,[600,0.99,166],[120,0.7,140]),[600,0.78,135]]).kind,'thr');
});

test('rodaje suave suma base y tirada larga desarrolla resistencia',()=>{
  const easy=run([[3600,0.82,145]],'easy');
  assert.equal(easy.kind,'aer'); assert.ok(easy.plan.ok);
  assert.equal(run([[6000,0.82,148]]).headline,'Resistencia aeróbica');
});

test('trote corto muy suave es recuperación',()=>{
  assert.equal(run([[1500,0.7,128]]).kind,'rec');
});

test('rodaje planificado suave que sale a tempo avisa',()=>{
  const r=run([[3000,0.91,158]],'easy');
  assert.equal(r.kind,'tempo'); assert.equal(r.plan.ok,false);
});

test('sin streams usa el tiempo en zonas de Intervals',()=>{
  const r=TE.analyse({activity:{sport:'Run',raw_summary:{icu_hr_zone_times:[300,1800,300,300,300,0,0]}}});
  assert.equal(r.method,'hr-zones');
  assert.equal(r.kind,'aer'); assert.equal(r.stimuli.find(s=>s.key==='thr').levelLabel,'Mantiene');
});

test('sin pulso ni ritmo no inventa',()=>{
  assert.equal(TE.analyse({activity:{sport:'Run',raw_summary:{}}}).available,false);
});
