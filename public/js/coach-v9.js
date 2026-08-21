(() => {
  document.documentElement.dataset.runflowCoachVersion='9-beta';
  const mark=()=>{
    const brand=document.querySelector('.brand, .sidebar-brand, .v8-brand');
    if(brand && !brand.querySelector('.v9-beta-tag')){
      const tag=document.createElement('span');tag.className='v9-beta-tag';tag.textContent='V9 beta';brand.appendChild(tag);
    }
  };
  document.addEventListener('DOMContentLoaded',()=>setTimeout(mark,700),{once:true});
  setTimeout(mark,1400);
})();
