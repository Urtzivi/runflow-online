(() => {
  const FIELD_LABEL='RF_V8_MANUAL_VALIDATIONS';
  const PREFIX='rf_v8_manual_validation:';
  const originalSetItem=Storage.prototype.setItem;
  const api=async(url,options={})=>{const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'No se pudo guardar la validación.');return data;};
  const compactFromKey=key=>{const parts=String(key).split(':');if(parts.length<5)return null;const athleteId=parts[1],workoutId=parts[2],createdAt=parts.slice(3).join(':');return {athleteId,compact:`${workoutId}|${createdAt}`};};
  const keyFromCompact=(athleteId,value)=>{const index=String(value).indexOf('|');if(index<0)return null;return `${PREFIX}${athleteId}:${value.slice(0,index)}:${value.slice(index+1)}`;};
  const fieldValues=profile=>{const field=(profile?.custom_fields||[]).find(item=>item.label===FIELD_LABEL);if(!field?.value)return[];try{const parsed=JSON.parse(field.value);return Array.isArray(parsed)?parsed:[]}catch{return[]}};
  async function saveMarker(key){
    const parsed=compactFromKey(key);if(!parsed)return;
    const bundle=await api(`/api/coach/athletes/${encodeURIComponent(parsed.athleteId)}`);const athlete=bundle.athlete||bundle;const profile={...(athlete.profile||{})};
    const custom=[...(profile.custom_fields||[])].filter(item=>item.label!==FIELD_LABEL);const values=fieldValues(profile).filter(Boolean);
    if(!values.includes(parsed.compact))values.push(parsed.compact);
    const recent=values.slice(-14);custom.push({label:FIELD_LABEL,value:JSON.stringify(recent)});
    await api(`/api/coach/athletes/${encodeURIComponent(parsed.athleteId)}/profile`,{method:'PUT',body:JSON.stringify({...profile,custom_fields:custom})});
  }
  Storage.prototype.setItem=function(key,value){originalSetItem.call(this,key,value);if(this===localStorage&&String(key).startsWith(PREFIX)&&String(value)==='1')saveMarker(String(key)).catch(error=>console.warn('[V8 validation persistence]',error.message));};
  async function hydrate(){
    try{
      const list=await api('/api/coach/athletes?include_inactive=0');const athletes=list.athletes||[];
      await Promise.all(athletes.map(async athlete=>{try{const bundle=await api(`/api/coach/athletes/${encodeURIComponent(athlete.id)}`);const full=bundle.athlete||bundle;for(const value of fieldValues(full.profile||{})){const key=keyFromCompact(athlete.id,value);if(key)originalSetItem.call(localStorage,key,'1');}}catch{}}));
      setTimeout(()=>document.querySelector('#v8RefreshDashboard')?.click(),300);
    }catch(error){console.warn('[V8 validation hydrate]',error.message);}
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(document.querySelector('#athleteSelect')){clearInterval(timer);hydrate();}else if(tries>100)clearInterval(timer);},100);
})();