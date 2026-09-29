const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const start=source.indexOf('  const reviewActivityMatch =');
const end=source.indexOf('  const coachMessagesMatch =',start);
async function request(method, overrides={}) {
  const calls=[];
  const context=vm.createContext({method,pathname:'/api/coach/athletes/a/activities/external/review',session:{user:{id:'coach'}},req:{},res:{},
    ensureCoachAccess:async()=>{calls.push('access');},
    activityRowByExternalId:async(a,id)=>{assert.equal(a,'a');assert.equal(id,'external');calls.push('stored');return{id:'internal'};},
    activityReview:async()=>({id:'review',ai_analysis:{finding:'preserve'},decision:null}),
    readJson:async()=>({decision:'validated',coach_comment:'Revisada'}),
    saveReview:async(s,a,id,body)=>{assert.equal(id,'internal');calls.push('save');return body;},
    sendJson:(res,status,body)=>({status,body}),
    getActivityDetail:()=>{throw Error('Validation must not download Intervals data');},
    ...overrides});
  const result=await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
  return {result,calls};
}
test('validation only reads stored records and preserves existing analysis',async()=>{
 const {result,calls}=await request('PUT');
 assert.equal(result.status,200);assert.equal(result.body.review.decision,'validated');
 assert.equal(result.body.review.ai_analysis.finding,'preserve');assert.deepEqual(calls,['access','stored','save']);
});
test('pending review lookup has no sync or writes',async()=>{
 const {result,calls}=await request('GET');assert.equal(result.status,200);assert.deepEqual(calls,['access','stored']);
});
test('authorization and missing records still fail before any save',async()=>{
 await assert.rejects(request('PUT',{ensureCoachAccess:async()=>{throw Object.assign(Error('Forbidden'),{status:403});}}),e=>e.status===403);
 await assert.rejects(request('PUT',{activityRowByExternalId:async()=>null}),e=>e.status===404);
});
