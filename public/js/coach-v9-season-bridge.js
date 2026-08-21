(() => {
  'use strict';
  const q=s=>document.querySelector(s);
  const activeStep=()=>Number(q('#v8GuidedSteps .v8-guided-step-pill.active')?.dataset.guideStep||0);
  const openSeason=()=>q('[data-v9-season]')?.click();
  function relabel(){
    const button=q('#v8GuidedAction');
    if(button&&activeStep()===5)button.textContent='Volver a la visión de temporada';
    const inline=q('#gfOpenSeasonMap');
    if(inline)inline.textContent='Ver visión estratégica de temporada';
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('#gfOpenSeasonMap');
    if(target){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openSeason();return;}
    const footer=event.target.closest('#v8GuidedAction');
    if(footer&&activeStep()===5){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openSeason();return;}
    if(event.target.closest('#v8GuidedSteps,[data-guide-step]'))setTimeout(relabel,20);
    if(event.target.closest('[data-athlete-action="open"]'))setTimeout(()=>window.dispatchEvent(new CustomEvent('runflow:v9-view',{detail:{view:'profile'}})),500);
  },true);
  window.addEventListener('runflow:v9-library-ready',()=>{
    const f=q('#librarySearch');
    if(f&&f.value)f.dispatchEvent(new Event('input',{bubbles:true}));
  });
  setInterval(()=>{if(q('#v8GuidedPlanner.open'))relabel()},1200);
})();
