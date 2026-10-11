(()=>{
  // Editor del contenido de RunFlow Fútbol: Entreno, Terraza y Retos del deportista seleccionado.
  const byId=id=>document.getElementById(id);
  const DEFAULTS=window.RF_FOOTBALL_DEFAULT_PROGRAM||{exercises:[],drills:[],challenges:{technical:[],quick:[]}};
  const state={athleteId:'',program:null,custom:false,tab:'exercises',dirty:false};
  const SECTIONS={
    exercises:{label:'Entreno',title:'name',empty:{group:'',name:'Nuevo ejercicio',detail:'',sub:'',steps:[],img:'',video:''},fields:[
      ['group','Bloque','text','Activación, Potencia, Fuerza…'],['name','Nombre','text'],['detail','Volumen','text','3 × 8'],['sub','Objetivo','text'],
      ['steps','Pasos (uno por línea)','steps'],['img','Imagen (URL)','url'],['video','Vídeo (URL)','url']]},
    drills:{label:'Terraza',title:'name',empty:{cat:'conduccion',name:'Nuevo ejercicio de Terraza',time:'',space:'',objective:'',steps:[],cues:'',volume:'',img:'',video:''},fields:[
      ['cat','Categoría','cat'],['name','Nombre','text'],['time','Tiempo','text','6 min'],['space','Espacio / material','text'],['volume','Volumen','text'],
      ['objective','Objetivo','text'],['steps','Pasos (uno por línea)','steps'],['cues','Claves','textarea'],['img','Imagen (URL)','url'],['video','Vídeo (URL)','url']]},
    technical:{label:'Retos técnicos',title:'title',empty:{title:'Nuevo reto técnico',time:'',material:'',objective:'',steps:[],cue:'',result:'',img:''},fields:[
      ['title','Título','text'],['time','Tiempo','text'],['material','Material','text'],['objective','Objetivo','text'],['steps','Pasos (uno por línea)','steps'],
      ['cue','Clave','textarea'],['result','Ejemplo de resultado','text','17/20'],['img','Imagen (URL)','url']]},
    quick:{label:'Retos rápidos',title:'title',empty:{title:'Nuevo reto rápido',time:'',material:'',objective:'',steps:[],cue:'',result:'',img:''},fields:null},
  };
  SECTIONS.quick.fields=SECTIONS.technical.fields;

  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo completar la operación.');return d;}
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function list(key){return key==='technical'||key==='quick'?state.program.challenges[key]:state.program[key];}
  function status(text){const el=byId('footballProgramStatus');if(el)el.textContent=text;}
  function markDirty(){state.dirty=true;status('Cambios sin guardar.');}

  function ensureStyles(){
    if(byId('footballProgramStyles'))return;
    const style=document.createElement('style');style.id='footballProgramStyles';
    style.textContent=`#footballProgramEditor{margin-top:16px;border-top:1px solid rgba(127,127,127,.25);padding-top:14px}
#footballProgramEditor .fp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
#footballProgramEditor .fp-tabs button.active{outline:2px solid currentColor}
#footballProgramEditor details{border:1px solid rgba(127,127,127,.3);border-radius:12px;padding:8px 12px;margin:8px 0}
#footballProgramEditor summary{cursor:pointer;font-weight:700}
#footballProgramEditor .fp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:10px}
#footballProgramEditor label{display:flex;flex-direction:column;gap:4px;font-size:12px}
#footballProgramEditor label.fp-wide{grid-column:1/-1}
#footballProgramEditor input,#footballProgramEditor select,#footballProgramEditor textarea{font:inherit;padding:7px 9px;border-radius:9px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit}
#footballProgramEditor textarea{min-height:76px;resize:vertical}
#footballProgramEditor .fp-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}`;
    document.head.appendChild(style);
  }

  function ensureEditor(){
    const panel=byId('footballCoachPanel');if(!panel)return false;
    if(byId('footballProgramEditor'))return true;
    ensureStyles();
    const body=panel.querySelector('.card-body')||panel;
    const editor=document.createElement('div');editor.id='footballProgramEditor';
    editor.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><p class="eyebrow">Contenido</p><h3 style="margin:2px 0">Programa de fútbol</h3><p class="muted small" style="margin:0">Lo que ve el deportista en Entreno, Terraza y Reto del día.</p></div><button id="footballProgramToggle" class="btn secondary" type="button">Editar contenido</button></div>
<div id="footballProgramBody" hidden><div class="fp-tabs" id="footballProgramTabs"></div><div id="footballProgramList"></div>
<div class="fp-row"><button id="footballProgramAdd" class="btn soft" type="button">+ Añadir</button><span style="flex:1"></span><button id="footballProgramReset" class="btn secondary" type="button">Volver al contenido por defecto</button><button id="footballProgramSave" class="btn primary" type="button">Guardar y publicar</button></div></div>
<p id="footballProgramStatus" class="muted small" style="margin:10px 0 0"></p>`;
    body.appendChild(editor);
    byId('footballProgramToggle').addEventListener('click',()=>{const b=byId('footballProgramBody');b.hidden=!b.hidden;byId('footballProgramToggle').textContent=b.hidden?'Editar contenido':'Cerrar editor';if(!b.hidden)render();});
    byId('footballProgramAdd').addEventListener('click',()=>{list(state.tab).push(clone(SECTIONS[state.tab].empty));markDirty();render(list(state.tab).length-1);});
    byId('footballProgramSave').addEventListener('click',save);
    byId('footballProgramReset').addEventListener('click',reset);
    return true;
  }

  function fieldHtml(item,index,[key,label,type,placeholder]){
    const attrs=`data-index="${index}" data-key="${key}" placeholder="${escapeHtml(placeholder||'')}"`;
    const wide=['steps','textarea','url'].includes(type)||key==='sub'||key==='objective';
    let input;
    if(type==='steps')input=`<textarea ${attrs}>${escapeHtml((item.steps||[]).join('\n'))}</textarea>`;
    else if(type==='textarea')input=`<textarea ${attrs}>${escapeHtml(item[key])}</textarea>`;
    else if(type==='cat')input=`<select ${attrs}>${[['conduccion','Conducción'],['control','Control'],['tiro','Tiro']].map(([v,l])=>`<option value="${v}"${item.cat===v?' selected':''}>${l}</option>`).join('')}</select>`;
    else input=`<input type="${type==='url'?'url':'text'}" ${attrs} value="${escapeHtml(item[key])}">`;
    return `<label class="${wide?'fp-wide':''}">${escapeHtml(label)}${input}</label>`;
  }

  function render(openIndex=-1){
    if(!state.program||!byId('footballProgramList'))return;
    byId('footballProgramTabs').innerHTML=Object.entries(SECTIONS).map(([key,s])=>`<button type="button" class="btn ${key===state.tab?'soft active':'secondary'}" data-tab="${key}">${s.label} (${list(key).length})</button>`).join('');
    byId('footballProgramTabs').querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.tab;render();}));
    const section=SECTIONS[state.tab],items=list(state.tab),root=byId('footballProgramList');
    const session=state.program.session;
    const sessionHtml=state.tab!=='exercises'?'':`<details open><summary>Sesión de hoy (cabecera)</summary><div class="fp-grid">
<label>Título<input type="text" data-session="title" value="${escapeHtml(session.title)}"></label>
<label>Duración (min)<input type="number" min="0" max="300" data-session="duration_min" value="${escapeHtml(session.duration_min)}"></label>
<label class="fp-wide">Enfoque<input type="text" data-session="focus" value="${escapeHtml(session.focus)}" placeholder="potencia + tren inferior"></label>
<label class="fp-wide">Nota para el deportista<input type="text" data-session="note" value="${escapeHtml(session.note)}"></label></div></details>`;
    if(!items.length){root.innerHTML=sessionHtml+'<p class="muted small">No hay elementos. Pulsa “Añadir”.</p>';bindSession(root);return;}
    root.innerHTML=sessionHtml+items.map((item,index)=>`<details${index===openIndex?' open':''}><summary>${index+1}. ${escapeHtml(item[section.title]||'Sin título')}${item.group?` <span class="muted small">· ${escapeHtml(item.group)}</span>`:''}</summary>
<div class="fp-grid">${section.fields.map(field=>fieldHtml(item,index,field)).join('')}</div>
<div class="fp-row"><button type="button" class="btn secondary" data-move="-1" data-index="${index}">↑ Subir</button><button type="button" class="btn secondary" data-move="1" data-index="${index}">↓ Bajar</button><span style="flex:1"></span><button type="button" class="btn secondary" data-remove="${index}">Eliminar</button></div></details>`).join('');
    bindSession(root);
    root.querySelectorAll('[data-key]').forEach(input=>input.addEventListener('input',()=>{
      const item=items[Number(input.dataset.index)],key=input.dataset.key;
      item[key]=key==='steps'?input.value.split('\n').map(x=>x.trim()).filter(Boolean):input.value;
      if(key===section.title)input.closest('details').querySelector('summary').firstChild.textContent=`${Number(input.dataset.index)+1}. ${input.value||'Sin título'}`;
      markDirty();
    }));
    root.querySelectorAll('[data-move]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.index),j=i+Number(b.dataset.move);if(j<0||j>=items.length)return;[items[i],items[j]]=[items[j],items[i]];markDirty();render(j);}));
    root.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.remove);if(!confirm(`¿Eliminar “${items[i][section.title]||'este elemento'}”?`))return;items.splice(i,1);markDirty();render();}));
  }

  function bindSession(root){
    root.querySelectorAll('[data-session]').forEach(input=>input.addEventListener('input',()=>{
      const key=input.dataset.session;state.program.session[key]=key==='duration_min'?(input.value===''?null:Number(input.value)):input.value;markDirty();
    }));
  }

  function describe(){status(state.custom?'Este deportista tiene un programa propio publicado.':'Este deportista ve el contenido por defecto de RunFlow Fútbol.');}

  async function load(athleteId){
    if(!ensureEditor())return;
    if(state.dirty&&state.athleteId&&state.athleteId!==athleteId&&!confirm('Hay cambios sin guardar en el programa de fútbol. ¿Descartarlos?'))return;
    state.athleteId=athleteId;state.dirty=false;state.program=null;
    if(!athleteId){status('Selecciona un deportista.');return;}
    status('Cargando programa…');
    try{
      const data=await api(`/api/coach/athletes/${encodeURIComponent(athleteId)}/football-program`);
      if(state.athleteId!==athleteId)return;
      state.custom=!!data.program;
      const base=clone(data.program||DEFAULTS);
      state.program={session:{...(DEFAULTS.session||{}),...(base.session||{})},exercises:base.exercises||[],drills:base.drills||[],challenges:{technical:base.challenges?.technical||[],quick:base.challenges?.quick||[]}};
      describe();render();
    }catch(error){status(error.message);}
  }

  async function save(){
    if(!state.athleteId||!state.program)return;
    const button=byId('footballProgramSave');button.disabled=true;status('Guardando…');
    try{
      const data=await api(`/api/coach/athletes/${encodeURIComponent(state.athleteId)}/football-program`,{method:'PUT',body:JSON.stringify({program:state.program})});
      state.program=clone(data.program);state.custom=true;state.dirty=false;render();
      status(`Publicado ✓ ${new Date(data.updated_at||Date.now()).toLocaleString('es-ES')}. El deportista lo verá al abrir RunFlow Fútbol.`);
    }catch(error){status(error.message);}finally{button.disabled=false;}
  }

  async function reset(){
    if(!state.athleteId||!confirm('¿Borrar el programa propio de este deportista y volver al contenido por defecto?'))return;
    try{
      await api(`/api/coach/athletes/${encodeURIComponent(state.athleteId)}/football-program`,{method:'DELETE'});
      state.dirty=false;await load(state.athleteId);
    }catch(error){status(error.message);}
  }

  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  const start=()=>{
    const select=byId('athleteSelect');
    if(!select||!ensureEditor())return setTimeout(start,400);
    select.addEventListener('change',()=>setTimeout(()=>load(select.value),250));
    load(select.value);
  };
  start();
})();
