// Zonas de carrera del asistente (get_run_zones / set_run_zones): validación y formato Intervals.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const z=require('../assistant-zones');

test('zonas de una prueba de esfuerzo pasan al formato de Intervals',()=>{
  const {patch,errors}=z.buildZonesPatch({lthr:169,max_hr:175,hr_zones:[123,150,157,169,175],threshold_pace:'5:21',pace_zones:['7:35','6:49','6:12','5:21']});
  assert.deepEqual(errors,[]);
  assert.equal(patch.lthr,169);
  assert.equal(patch.max_hr,175);
  assert.deepEqual(patch.hr_zones,[123,150,157,169,175]);
  assert.equal(patch.threshold_pace,3.1153);
  assert.deepEqual(patch.pace_zones,[70.5,78.5,86.3,100,999]);
});

test('solo pulso: no toca el ritmo',()=>{
  const {patch,errors}=z.buildZonesPatch({lthr:169,max_hr:175,hr_zones:[123,150,157,169,175]});
  assert.deepEqual(errors,[]);
  assert.equal('threshold_pace' in patch,false);
  assert.equal('pace_zones' in patch,false);
});

test('rechaza zonas desordenadas, por encima del máximo o vacías',()=>{
  assert.ok(z.buildZonesPatch({hr_zones:[150,123,157]}).errors.length);
  assert.ok(z.buildZonesPatch({max_hr:170,hr_zones:[120,140,160,180]}).errors.length);
  assert.ok(z.buildZonesPatch({lthr:180,max_hr:170}).errors.length);
  assert.ok(z.buildZonesPatch({pace_zones:['6:00','5:00']}).errors.length);
  assert.ok(z.buildZonesPatch({}).errors.length);
});

test('lectura sencilla de un perfil Run de Intervals',()=>{
  const r=z.readable({types:['Run'],lthr:169,max_hr:175,threshold_pace:3.1153,hr_zones:[123,150,157,169,175],pace_zones:[70.5,78.5,86.3,100,999]});
  assert.equal(r.ritmo_umbral,'5:21/km');
  assert.deepEqual(r.zonas_pulso[1],{zona:'Z2',desde:124,hasta:150});
  assert.equal(r.zonas_ritmo[0].hasta,'7:35');
  assert.equal(r.zonas_ritmo[4].hasta,'más rápido');
});

test('si cambia el número de zonas de pulso, manda nombres (Intervals los exige)',()=>{
  const p=z.withZoneNames({hr_zones:[123,150,157,169,175]},{hr_zone_names:['a','b','c','d','e','f','g']});
  assert.equal(p.hr_zone_names.length,5);
  const same=z.withZoneNames({hr_zones:[1,2,3]},{hr_zone_names:['a','b','c']});
  assert.equal('hr_zone_names' in same,false);
});
