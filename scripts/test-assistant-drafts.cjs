const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cleanDraft,saveDraft,filterDrafts,listDrafts,MCP_TOOLS}=require('../assistant-api-hook.js');

// Minimal in-memory stand-in for the Supabase REST helper used by the hook.
function fakeDb(){
  const rows=[];const calls=[];
  const db=async(table,query='',options={})=>{
    assert.equal(table,'workout_templates');calls.push({query,method:options.method||'GET'});
    const params=new URLSearchParams(query);
    if((options.method||'GET')==='GET'){
      const key=params.get('template_data->>idempotency_key');
      let out=rows.filter(r=>`eq.${r.coach_user_id}`===params.get('coach_user_id')&&`eq.${r.category}`===params.get('category'));
      if(key)out=out.filter(r=>`eq.${r.template_data.idempotency_key}`===key);
      return out.map(r=>structuredClone(r));
    }
    if(options.method==='POST'){rows.push(structuredClone(options.body));return[structuredClone(options.body)]}
    if(options.method==='PATCH'){const id=params.get('id').slice(3);const row=rows.find(r=>r.id===id);Object.assign(row,structuredClone(options.body));return[]}
    throw new Error('unexpected method');
  };
  return{db,rows,calls};
}
const session={kind:'session',activity_id:'act-1',date:'2026-11-02',semaforo:'verde',hechos:['10 km a 5:00/km'],mensaje_atleta:'¡Buen rodaje!'};
const week={kind:'week',week_start:'2026-11-02',semaforo:'ambar',mensaje_atleta:'Semana sólida.'};

test('cleanDraft builds stable idempotency keys',()=>{
  assert.equal(cleanDraft('ath',session).idempotency_key,'session:ath:act-1');
  assert.equal(cleanDraft('ath',week).idempotency_key,'week:ath:2026-11-02');
});

test('cleanDraft rejects incomplete or invalid drafts',()=>{
  const bad=[{...session,kind:'daily'},{...session,semaforo:'azul'},{...session,mensaje_atleta:' '},{...session,activity_id:''},{...session,date:'2/11/2026'},{...week,week_start:null}];
  for(const body of bad)assert.throws(()=>cleanDraft('ath',body),e=>e.status===400);
  assert.throws(()=>cleanDraft('',session),e=>e.status===400);
});

test('cleanDraft trims and caps lists and text',()=>{
  const d=cleanDraft('ath',{...session,semaforo:'ROJO',hechos:Array(30).fill('x'),alertas:['', ' dolor '],mensaje_atleta:'y'.repeat(5000)});
  assert.equal(d.semaforo,'rojo');assert.equal(d.hechos.length,20);assert.deepEqual(d.alertas,['dolor']);assert.equal(d.mensaje_atleta.length,2000);
});

test('saving twice for the same session replaces the draft instead of duplicating it',async()=>{
  const {db,rows}=fakeDb();
  const first=await saveDraft('coach','ath',session,db);
  assert.equal(first.created,true);assert.equal(first.draft.status,'draft');assert.equal(first.draft.version,1);
  const second=await saveDraft('coach','ath',{...session,mensaje_atleta:'Versión 2'},db);
  assert.equal(second.created,false);assert.equal(rows.length,1);
  assert.equal(second.draft.id,first.draft.id);assert.equal(second.draft.version,2);
  assert.equal(rows[0].template_data.mensaje_atleta,'Versión 2');
  assert.equal(rows[0].template_data.history[0].mensaje_atleta,'¡Buen rodaje!');
});

test('approved or sent drafts are never overwritten',async()=>{
  for(const status of ['approved','sent']){
    const {db,rows}=fakeDb();
    await saveDraft('coach','ath',session,db);rows[0].template_data.status=status;
    await assert.rejects(saveDraft('coach','ath',{...session,mensaje_atleta:'otro'},db),e=>e.status===409);
    assert.equal(rows[0].template_data.mensaje_atleta,'¡Buen rodaje!');
  }
});

test('different sessions, weeks and coaches stay separate',async()=>{
  const {db,rows}=fakeDb();
  await saveDraft('coach','ath',session,db);
  await saveDraft('coach','ath',{...session,activity_id:'act-2'},db);
  await saveDraft('coach','ath',week,db);
  await saveDraft('coach-2','ath',session,db);
  assert.equal(rows.length,4);
});

test('listDrafts returns pending drafts by default and supports filters',async()=>{
  const {db,rows}=fakeDb();
  await saveDraft('coach','ath',session,db);
  await saveDraft('coach','ath',week,db);
  await saveDraft('coach','other',{...session,activity_id:'act-9'},db);
  rows[2].template_data.status='sent';
  assert.equal((await listDrafts('coach',{},db)).length,2);
  assert.equal((await listDrafts('coach',{status:'all'},db)).length,3);
  assert.equal((await listDrafts('coach',{status:'sent'},db)).length,1);
  assert.equal((await listDrafts('coach',{kind:'week'},db)).length,1);
  assert.equal((await listDrafts('coach',{athlete_id:'other',status:'all'},db)).length,1);
  await assert.rejects(listDrafts('coach',{status:'whatever'},db),e=>e.status===400);
});

test('filterDrafts keeps only the newest record per idempotency key',()=>{
  const drafts=[{id:'new',idempotency_key:'k',status:'draft'},{id:'old',idempotency_key:'k',status:'draft'}];
  assert.deepEqual(filterDrafts(drafts).map(d=>d.id),['new']);
});

test('MCP exposes the new tools; only list is read-only',()=>{
  const byName=Object.fromEntries(MCP_TOOLS.map(t=>[t.name,t]));
  assert.equal(byName.create_feedback_draft.annotations.readOnlyHint,false);
  assert.equal(byName.list_pending_drafts.annotations.readOnlyHint,true);
  assert.deepEqual(byName.create_feedback_draft.inputSchema.required,['athlete_id','kind','semaforo','mensaje_atleta']);
});
