(() => {
'use strict';
const q=(s,r=document)=>r.querySelector(s);
let busy=false;

function athleteId(){return q('#athleteSelect')?.value||''}
function storageKey(){const id=athleteId();return id?`runflow_plan_season_${id}`:''}
function rememberedSeason(){const key=storageKey();return key?localStorage.getItem(key)||'':''}

function revealBlocks(){
  try{
    if(typeof state!=='undefined'){
      state.planTab='blocks';
      state.selectedMicrocycleId=null;
    }
  }catch{}
  try{if(typeof setPlanTab==='function')setPlanTab('blocks')}catch{}
  const list=q('#macrocycleList');
  if(list)setTimeout(()=>list.scrollIntoView({behavior:'smooth',block:'start'}),80);
}

async function showRemembered({forceBlocks=false}={}){
  if(busy)return;
  const seasonId=rememberedSeason();
  if(!seasonId||typeof loadPlan!=='function')return;
  try{
    const current=typeof state!=='undefined'?state.selectedSeasonId:null;
    if(String(current||'')!==String(seasonId)){
      busy=true;
      await loadPlan(seasonId);
    }
    if(forceBlocks)revealBlocks();
  }catch(error){
    console.warn('[Plan V2 visibility]',error?.message||error);
  }finally{
    busy=false;
  }
}

function install(){
  document.addEventListener('change',event=>{
    const select=event.target.closest?.('#planSeasonSelect');
    if(select){
      const key=storageKey();
      if(key&&select.value)localStorage.setItem(key,select.value);
    }
    if(event.target.closest?.('#athleteSelect'))setTimeout(()=>showRemembered(),450);
  },true);

  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-view="plan"], [data-v8="plan"]'))setTimeout(()=>showRemembered(),180);
  },true);

  const message=q('#globalMessage');
  if(message){
    const observer=new MutationObserver(()=>{
      const text=String(message.textContent||'');
      if(/Plan V2 importado:/i.test(text))setTimeout(()=>showRemembered({forceBlocks:true}),80);
    });
    observer.observe(message,{childList:true,subtree:true,characterData:true});
  }

  let attempts=0;
  const boot=()=>{
    attempts++;
    const ready=athleteId()&&q('#planSeasonSelect')&&typeof loadPlan==='function';
    if(ready)showRemembered();
    else if(attempts<80)setTimeout(boot,150);
  };
  boot();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();
