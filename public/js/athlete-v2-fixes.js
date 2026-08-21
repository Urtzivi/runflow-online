(() => {
  const STORAGE_KEY='runflow_v2_manual_activities';
  const q=(s,r=document)=>r.querySelector(s);
  const currentAthlete=()=>{try{return state?.athlete?.id||state?.user?.athlete_id||'athlete'}catch{return'athlete'}};
  function read(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return[]}}
  function write(rows){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(rows))}catch{}}
  async function api(url,options={}){const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo migrar la actividad.');return d;}

  async function migrateLegacy(){
    const rows=read();const key=currentAthlete();let changed=false,migrated=0;
    for(const row of rows){
      if(row.athlete_key!==key||row.migrated_v2_server)continue;
      if(!row.activity_date||!row.duration_min||!row.rpe)continue;
      try{
        await api('/api/v2/athlete/manual-activities',{method:'POST',body:JSON.stringify({sport:row.sport||'other',activity_date:row.activity_date,duration_min:Number(row.duration_min),rpe:Number(row.rpe),distance_km:row.distance_km??null,elevation_m:row.elevation_m??null,pain:row.pain??0,feeling:row.feeling??null,comment:row.comment||'Migrada desde Athlete V2 beta'})});
        row.migrated_v2_server=true;row.migrated_at=new Date().toISOString();changed=true;migrated++;
      }catch(error){console.warn('[Athlete V2 legacy migration]',error.message);}
    }
    if(changed){write(rows);document.querySelectorAll('[data-v2-manual-card]').forEach(node=>node.remove());if(migrated)setTimeout(()=>location.reload(),300);}
  }
  function cleanMigratedCards(){const rows=read(),key=currentAthlete();if(rows.filter(x=>x.athlete_key===key&&!x.migrated_v2_server).length===0)document.querySelectorAll('[data-v2-manual-card]').forEach(node=>node.remove());}
  function updateManualCopy(){
    const modal=document.getElementById('v2ManualActivityModal');if(!modal)return;
    const help=modal.querySelector('.v2-manual-help');
    if(help)help.textContent='Registra una actividad que RunFlow no haya recibido de Intervals. RunFlow estimará su carga con tu historial cuando sea posible y marcará siempre las estimaciones como tales.';
    const preview=document.getElementById('v2LoadPreview');
    if(preview){const label=preview.querySelector('span');if(label)label.textContent='Referencia interna sRPE';const small=preview.querySelector('small');if(small)small.textContent='La carga RunFlow final se calcula al guardar';}
  }
  const observer=new MutationObserver(()=>{cleanMigratedCards();updateManualCopy();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(()=>{updateManualCopy();migrateLegacy().then(cleanMigratedCards);},900);
})();
