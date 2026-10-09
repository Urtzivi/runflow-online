const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sessionBlockAnalysis,resolveBlockTarget,segmentBlocks}=require('../session-comparison-metrics');

// Umbral 5 × 6 min con recuperación de 2 min. Plan: calentamiento 12 min; real: 15:20.
const workout={title:'Umbral 5 × 6 min',blocks:[
  {type:'warmup',duration_min:12,target:'Z1-Z2'},
  {type:'central',name:'Umbral',repetitions:5,work_value:6,work_unit:'m',target:'3:50-3:55',recovery_value:2,recovery_unit:'m',recovery_target:'Z1'},
  {type:'cooldown',duration_min:10,target:'Z1'},
]};
const zones={hr:[{zone_order:1,min_value:95,max_value:125},{zone_order:2,min_value:126,max_value:145},{zone_order:3,min_value:146,max_value:162},{zone_order:4,min_value:163,max_value:172},{zone_order:5,min_value:173,max_value:190}],
  pace:[{zone_order:1,slow_pace:'6:30',fast_pace:'5:30'},{zone_order:2,slow_pace:'5:29',fast_pace:'4:50'},{zone_order:3,slow_pace:'4:49',fast_pace:'4:10'},{zone_order:4,slow_pace:'4:09',fast_pace:'3:50'},{zone_order:5,slow_pace:'3:49',fast_pace:'3:20'}]};
const repPace=[231,232,230,234,238], repHr=[164,167,169,171,174];
const warmup=920, total=warmup+5*360+4*120+600;
function buildActivity({withIntervals=true}={}){
  const time=[],hr=[],speed=[],distance=[];let dist=0;
  const intervals=[];
  for(let t=0;t<=total;t+=1){
    let pace=330,h=130;
    const k=t-warmup;
    if(k>=0&&k<5*480-120){const rep=Math.floor(k/480),inRep=k%480;if(inRep<360){pace=repPace[rep];h=repHr[rep];}else{pace=345;h=135-rep*3;}}
    else if(k>=5*480-120){pace=320;h=125;}
    time.push(t);hr.push(h);speed.push(1000/pace);dist+=1000/pace;distance.push(dist);
  }
  if(withIntervals){
    for(let rep=0;rep<5;rep+=1){
      const s=warmup+rep*480;
      intervals.push({type:'WORK',start_index:s,end_index:s+360,moving_time:360,distance:360*1000/repPace[rep],average_speed:1000/repPace[rep],average_heartrate:repHr[rep]});
      if(rep<4)intervals.push({type:'RECOVERY',start_index:s+360,end_index:s+480,moving_time:120,average_speed:1000/345,average_heartrate:140});
    }
  }
  return {duration_sec:total,raw_summary:{icu_intervals:intervals},streams:[{type:'time',data:time},{type:'heartrate',data:hr},{type:'velocity_smooth',data:speed},{type:'distance',data:distance}]};
}

test('cuts blocks at the Intervals laps, not at planned durations',()=>{
  const analysis=sessionBlockAnalysis(buildActivity(),workout,zones);
  assert.equal(analysis.segmentation,'intervals');
  const work=analysis.blocks.filter(b=>b.main_work);
  assert.equal(work.length,5);
  assert.equal(work[0].start_second,warmup);
  work.forEach((block,i)=>{
    assert.ok(Math.abs(block.pace_sec_per_km-repPace[i])<=1,`pace rep ${i+1}: ${block.pace_sec_per_km}`);
    assert.ok(Math.abs(block.average_hr-repHr[i])<=0.5,`hr rep ${i+1}: ${block.average_hr}`);
    assert.equal(block.repetition,i+1);
  });
  const first=analysis.blocks[0];
  assert.equal(first.phase,'warmup');assert.equal(first.duration_seconds,warmup);
  assert.equal(analysis.blocks.at(-1).phase,'cooldown');
});

test('marks each rep against its target and summarises the session',()=>{
  const analysis=sessionBlockAnalysis(buildActivity(),workout,zones);
  const status=analysis.blocks.filter(b=>b.main_work).map(b=>b.status);
  assert.deepEqual(status,['good','good','good','good','warn']);
  assert.equal(analysis.summary.in_target,4);
  assert.equal(analysis.summary.with_target,5);
  assert.equal(analysis.summary.hr_rise,10);
  assert.ok(analysis.summary.avg_recovery_hr_drop>0);
  assert.ok(analysis.reading.length>=2);
  assert.match(analysis.reading[0].title,/4 de 5/);
});

test('falls back to planned durations when Intervals has no laps',()=>{
  const {segmentation,rows}=segmentBlocks(buildActivity({withIntervals:false}),workout);
  assert.equal(segmentation,'plan');
  assert.ok(rows.length>0);
});

test('resolves zone and explicit targets',()=>{
  assert.deepEqual(resolveBlockTarget('3:50-3:55',zones).pace,{min:230,max:235});
  assert.deepEqual(resolveBlockTarget('160-170 ppm',zones).hr,{min:160,max:170});
  const z4=resolveBlockTarget('Z4 / umbral',zones);
  assert.deepEqual(z4.hr,{min:163,max:172});assert.deepEqual(z4.pace,{min:230,max:249});
  assert.equal(resolveBlockTarget('Z4 HR',zones).pace,null);
  assert.equal(resolveBlockTarget('Progresivo',zones),null);
});
