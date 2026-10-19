(()=>{
  'use strict';
  // Idioma de RunFlow Fútbol (castellano / euskera). La app se escribe en castellano y, si el deportista
  // elige euskera, este módulo traduce lo que se pinta en pantalla: textos exactos, frases con datos
  // ({0}, {1}… se traducen también por dentro) y atributos visibles. Lo que el deportista escribe y los
  // valores que se guardan no se tocan, así el entrenador sigue viendo los datos igual.
  if(window.RunFlowI18n)return;
  const KEY='runflow_football_lang';
  const LANGS={es:{label:'Castellano',locale:'es-ES',speech:'es-ES'},eu:{label:'Euskara',locale:'eu-ES',speech:'eu-ES'}};
  let lang='es';
  try{const saved=localStorage.getItem(KEY);if(LANGS[saved])lang=saved;}catch{}

  const EU_DAYS=['Igandea','Astelehena','Asteartea','Asteazkena','Osteguna','Ostirala','Larunbata'];
  const EU_MONTHS=['urtarrila','otsaila','martxoa','apirila','maiatza','ekaina','uztaila','abuztua','iraila','urria','azaroa','abendua'];
  const dict=()=>window.RF_FOOTBALL_EU||{exact:{},patterns:[],fragments:[]};
  let compiled=null;
  function compile(){
    const d=dict();
    const exact=new Map(Object.entries(d.exact||{}).map(([es,eu])=>[norm(es),eu]));
    const patterns=(d.patterns||[]).map(([es,eu])=>{
      const names=[];
      // Un dato no se come un " · " salvo que la propia frase lo tenga: así "vs Getxo · hoy" se traduce por trozos.
      const any=norm(es).includes(' · ')?'(.+?)':'((?:(?! · ).)+?)';
      const source=norm(es).split(/(\{\d+\})/).map(part=>{const m=/^\{(\d+)\}$/.exec(part);if(m){names.push(m[1]);return any;}return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');
      return {re:new RegExp(`^${source}$`),names,eu};
    });
    const fragments=(d.fragments||[]).map(([es,eu])=>[new RegExp(es.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'),eu]);
    compiled={exact,patterns,fragments};
  }
  function norm(text){return String(text).replace(/\s+/g,' ').trim();}

  // Traduce una frase completa: exacta, por patrón (traduciendo cada dato) o, si no, por fragmentos conocidos.
  function translate(text,depth=0){
    if(lang==='es'||!text)return text;
    if(!compiled)compile();
    const clean=norm(text);
    if(!clean||!/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(clean))return text;
    const hit=compiled.exact.get(clean);
    if(hit!==undefined)return keepSpaces(text,hit);
    if(depth<3){
      for(const p of compiled.patterns){
        const m=p.re.exec(clean);if(!m)continue;
        const values={};p.names.forEach((name,i)=>{values[name]=translate(m[i+1],depth+1);});
        return keepSpaces(text,p.eu.replace(/\{(\d+)\}/g,(_,n)=>values[n]??''));
      }
    }
    // Listas numeradas ("3. Salto…") y textos unidos con " · ": se traduce cada trozo.
    const numbered=/^(\d+\.\s+)(.+)$/.exec(clean);
    if(numbered&&depth<3){const rest=translate(numbered[2],depth+1);if(rest!==numbered[2])return keepSpaces(text,numbered[1]+rest);}
    if(clean.includes(' · ')&&depth<3){
      const parts=clean.split(' · '),done=parts.map(part=>translate(part,depth+1));
      if(done.some((part,i)=>part!==parts[i]))return keepSpaces(text,done.join(' · '));
    }
    let out=clean;
    for(const [re,eu] of compiled.fragments)out=out.replace(re,eu);
    return out===clean?text:keepSpaces(text,out);
  }
  function keepSpaces(original,translated){
    const lead=/^\s*/.exec(original)[0],trail=/\s*$/.exec(original)[0];
    return lead+translated+trail;
  }

  const SKIP=new Set(['SCRIPT','STYLE','TEXTAREA','INPUT','SELECT','OPTION','CODE']);
  const ATTRS=['placeholder','aria-label','title','alt'];
  const original=new WeakMap();
  function translateNode(node){
    if(node.nodeType===3){
      const parent=node.parentNode;
      if(!parent||SKIP.has(parent.nodeName)||parent.closest?.('[data-i18n-skip]'))return;
      const source=original.get(node)?.text;
      const current=node.nodeValue;
      // Si el código ha cambiado el texto, el nuevo es el original en castellano.
      const base=source!==undefined&&current===original.get(node).shown?source:current;
      const shown=translate(base);
      original.set(node,{text:base,shown});
      if(shown!==current)node.nodeValue=shown;
      return;
    }
    if(node.nodeType!==1||SKIP.has(node.nodeName)&&node.nodeName!=='INPUT'&&node.nodeName!=='TEXTAREA')return;
    if(node.closest?.('[data-i18n-skip]'))return;
    ATTRS.forEach(attr=>{
      if(!node.hasAttribute?.(attr))return;
      const store=`i18n${attr.replace(/-./g,s=>s[1].toUpperCase())}`;
      const current=node.getAttribute(attr);
      const base=node.dataset[store]!==undefined&&current===node.dataset[`${store}Shown`]?node.dataset[store]:current;
      const shown=translate(base);
      node.dataset[store]=base;node.dataset[`${store}Shown`]=shown;
      if(shown!==current)node.setAttribute(attr,shown);
    });
    if(SKIP.has(node.nodeName))return;
    node.childNodes.forEach(translateNode);
  }
  let observer=null;
  function start(){
    if(!document.body)return;
    if(observer)observer.disconnect();
    if(lang!=='es'){
      translateNode(document.body);
      observer=new MutationObserver(records=>{
        observer.disconnect();
        records.forEach(r=>{
          if(r.type==='characterData')translateNode(r.target);
          else if(r.type==='attributes')translateNode(r.target);
          else r.addedNodes.forEach(translateNode);
        });
        observer.observe(document.body,OBSERVE);
      });
      observer.observe(document.body,OBSERVE);
    }
    document.documentElement.lang=lang;
    paintSwitch();
  }
  const OBSERVE={subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS};

  function set(next){
    if(!LANGS[next]||next===lang)return;
    lang=next;
    try{localStorage.setItem(KEY,lang);}catch{}
    // Recargar deja fechas, gráficos y textos generados directamente en el idioma nuevo.
    location.reload();
  }

  // Selector visible en la barra superior (ES / EU) y en Perfil.
  function paintSwitch(){
    document.querySelectorAll('[data-rf-lang]').forEach(b=>b.classList.toggle('active',b.dataset.rfLang===lang));
  }
  function injectSwitch(){
    if(document.getElementById('rfLangSwitch'))return;
    const style=document.createElement('style');
    style.textContent=`.rf-lang{display:inline-flex;border:1px solid var(--line,#26475c);border-radius:999px;overflow:hidden;margin-left:auto;margin-right:8px}
.rf-lang button{border:0;background:transparent;color:#8198a8;font-weight:900;font-size:11px;padding:7px 10px;min-height:32px;font-family:inherit}
.rf-lang button.active{background:var(--blue,#0c82ff);color:#fff}
.rf-lang-card{margin-top:10px;padding:14px}.rf-lang-card .rf-lang{margin:8px 0 0}.rf-lang-card .rf-lang button{font-size:13px;padding:9px 16px}`;
    document.head.appendChild(style);
    const html=`${Object.entries(LANGS).map(([code,l])=>`<button type="button" data-rf-lang="${code}" aria-label="${l.label}">${code.toUpperCase()}</button>`).join('')}`;
    const top=document.querySelector('.topbar');
    if(top){const box=document.createElement('div');box.className='rf-lang';box.id='rfLangSwitch';box.setAttribute('data-i18n-skip','');box.innerHTML=html;top.insertBefore(box,top.querySelector('#bell')||null);}
    const profile=document.querySelector('#profile .profile-card');
    if(profile){const card=document.createElement('div');card.className='card rf-lang-card';card.innerHTML=`<strong>Idioma</strong> · <span data-i18n-skip>Hizkuntza</span><div class="rf-lang" data-i18n-skip>${Object.entries(LANGS).map(([code,l])=>`<button type="button" data-rf-lang="${code}">${l.label}</button>`).join('')}</div>`;profile.after(card);}
    document.addEventListener('click',event=>{const b=event.target.closest('[data-rf-lang]');if(b)set(b.dataset.rfLang);});
  }

  // Diálogos del navegador.
  const nativeConfirm=window.confirm.bind(window),nativeAlert=window.alert.bind(window);
  window.confirm=message=>nativeConfirm(translate(message));
  window.alert=message=>nativeAlert(translate(message));

  window.RunFlowI18n={
    get lang(){return lang;},
    get locale(){return LANGS[lang].locale;},
    get speechLang(){return LANGS[lang].speech;},
    // Fechas en euskera sin depender de que el móvil traiga ese idioma en Intl.
    dayLong(iso){const d=new Date(`${iso}T12:00:00`);return `${EU_DAYS[d.getDay()]}, ${d.getDate()}`;},
    monthName(iso){return EU_MONTHS[new Date(`${iso}T12:00:00`).getMonth()];},
    get dayLetters(){return lang==='eu'?['Al','Ar','Az','Og','Or','Lr','Ig']:['L','M','X','J','V','S','D'];},
    t:text=>translate(text),
    set,
  };
  const boot=()=>{injectSwitch();start();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
