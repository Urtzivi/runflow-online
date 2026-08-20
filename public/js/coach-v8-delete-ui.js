(() => {
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];

  const athleteId=()=>q('#athleteSelect')?.value||q('#v8AthleteSelect')?.value||null;
  const stateSafe=()=>{try{return window.state||state}catch{return null}};
  const labels={goal:'objetivo',macro:'macrociclo',meso:'mesociclo',micro:'microciclo'};
  const routes={
    goal:id=>`goals/${encodeURIComponent(id)}`,
    macro:id=>`macrocycles/${encodeURIComponent(id)}`,
    meso:id=>`mesocycles/${encodeURIComponent(id)}`,
    micro:id=>`microcycles/${encodeURIComponent(id)}`,
  };

  async function requestDelete(path){
    const athlete=athleteId();
    if(!athlete)throw new Error('Selecciona un atleta.');
    const response=await fetch(`/api/coach/athletes/${encodeURIComponent(athlete)}/${path}`,{
      method:'DELETE',credentials:'same-origin',headers:{Accept:'application/json'}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo quitar el elemento de la planificación.');
    return data;
  }

  async function remove(type,id,name){
    if(!routes[type])return;
    const label=labels[type]||'elemento';
    const cascade=type==='macro'
      ? '\n\nTambién se quitarán sus mesociclos, microciclos y sesiones planificadas.'
      : type==='meso'
        ? '\n\nTambién se quitarán sus microciclos y sesiones planificadas.'
        : type==='micro'
          ? '\n\nTambién se quitarán sus sesiones planificadas.'
          : '';
    const history=type==='goal'
      ? '\n\nEl histórico deportivo del atleta no se borra.'
      : '\n\nLas actividades ya realizadas, su carga y su histórico se conservarán.';
    if(!window.confirm(`¿Quitar ${label} «${name||label}» de la planificación?${cascade}${history}`))return;

    await requestDelete(routes[type](id));
    showToast(`${capitalize(label)} eliminado. El histórico realizado se conserva.`,'ok');
    setTimeout(()=>window.location.reload(),650);
  }

  function capitalize(value){return value.charAt(0).toUpperCase()+value.slice(1)}
  function showToast(message,type='ok'){
    let toast=q('#v8DeleteToast');
    if(!toast){toast=document.createElement('div');toast.id='v8DeleteToast';toast.className='v8-delete-toast';document.body.appendChild(toast);}
    toast.textContent=message;toast.dataset.type=type;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200);
  }

  function installGuided(){
    qa('#v8GuidedBody [data-guide-edit]').forEach(edit=>{
      const type=edit.dataset.guideEdit,id=edit.dataset.id;
      if(!type||!id||edit.closest('.v8-guided-real-row')?.querySelector('[data-v8-remove]'))return;
      const row=edit.closest('.v8-guided-real-row');
      const name=row?.querySelector('b')?.textContent?.trim()||labels[type];
      const button=document.createElement('button');
      button.type='button';button.className='btn danger small v8-remove-btn';button.textContent='Eliminar';button.dataset.v8Remove=`${type}:${id}`;
      button.addEventListener('click',async event=>{
        event.stopPropagation();button.disabled=true;
        try{await remove(type,id,name)}catch(error){button.disabled=false;showToast(error.message,'error')}
      });
      const actions=edit.parentElement;
      if(actions&&actions.classList.contains('v8-guided-row-actions'))actions.appendChild(button);
      else if(actions){const wrap=document.createElement('div');wrap.className='v8-guided-row-actions';actions.insertBefore(wrap,edit);wrap.append(edit,button);}
    });
  }

  function installPlan(){
    const map={'edit-goal':'goal','edit-macro':'macro','edit-meso':'meso','edit-micro':'micro'};
    qa('main.shell [data-plan-action]').forEach(edit=>{
      const type=map[edit.dataset.planAction],id=edit.dataset.id;
      if(!type||!id)return;
      const parent=edit.parentElement;
      if(!parent||parent.querySelector('[data-v8-plan-remove]'))return;
      const container=edit.closest('.macro-card,.meso-card,.micro-card,.goal-card,[data-goal-id]');
      const name=container?.querySelector('h3,h4,strong')?.textContent?.trim()||labels[type];
      const button=document.createElement('button');
      button.type='button';button.className='btn danger small v8-remove-btn';button.textContent='Eliminar';button.dataset.v8PlanRemove=`${type}:${id}`;
      button.addEventListener('click',async event=>{
        event.preventDefault();event.stopPropagation();button.disabled=true;
        try{await remove(type,id,name)}catch(error){button.disabled=false;showToast(error.message,'error')}
      });
      parent.appendChild(button);
    });
  }

  function installSessionDelete(){
    const button=q('#deleteSessionModal');
    if(!button||button.dataset.v8SafeDelete==='1')return;
    button.dataset.v8SafeDelete='1';
    button.textContent='Eliminar sesión';
    button.title='Quita la sesión del plan y conserva cualquier actividad ya realizada en el histórico.';
    button.addEventListener('click',async event=>{
      const editing=stateSafe()?.editingSession;
      if(!editing?.workoutId)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!window.confirm('¿Eliminar esta sesión de la planificación?\n\nSi ya se realizó, la actividad, su carga y su análisis se conservarán en el histórico del atleta.'))return;
      button.disabled=true;
      try{
        await requestDelete(`workouts/${encodeURIComponent(editing.workoutId)}`);
        showToast('Sesión eliminada del plan. El histórico realizado se conserva.','ok');
        setTimeout(()=>window.location.reload(),650);
      }catch(error){button.disabled=false;showToast(error.message,'error')}
    },true);
  }

  function install(){installGuided();installPlan();installSessionDelete();}
  new MutationObserver(install).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',install,{once:true});
  setTimeout(install,800);
})();
