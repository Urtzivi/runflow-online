(() => {
  document.documentElement.dataset.runflowAthleteVersion='2-beta';
  const badge=document.createElement('div');
  badge.className='athlete-v2-beta-chip';
  badge.textContent='V2 beta';
  const style=document.createElement('style');
  style.textContent='.athlete-v2-beta-chip{position:fixed;right:12px;bottom:84px;z-index:9999;background:#b9f34d;color:#20251f;padding:7px 10px;border-radius:999px;font:800 11px/1 system-ui;box-shadow:0 8px 20px rgba(0,0,0,.15)}';
  document.head.appendChild(style);
  document.body.appendChild(badge);
})();
