(() => {
  function cleanLegacyManualCards(){
    const holder=document.getElementById('athleteActivities');
    if(!holder)return;
    holder.querySelectorAll('[data-v2-manual-card]').forEach(node=>node.remove());
  }
  function updateManualCopy(){
    const modal=document.getElementById('v2ManualActivityModal');if(!modal)return;
    const help=modal.querySelector('.v2-manual-help');
    if(help)help.textContent='Registra una actividad que RunFlow no haya recibido de Intervals. RunFlow estimará su carga con tu historial cuando sea posible y marcará siempre las estimaciones como tales.';
    const preview=document.getElementById('v2LoadPreview');
    if(preview){const label=preview.querySelector('span');if(label)label.textContent='Referencia interna sRPE';const small=preview.querySelector('small');if(small)small.textContent='La carga RunFlow final se calcula al guardar';}
  }
  const observer=new MutationObserver(()=>{cleanLegacyManualCards();updateManualCopy();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(()=>{cleanLegacyManualCards();updateManualCopy();},700);
})();
