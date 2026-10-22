/* RunFlow · las ventanas superpuestas solo se cierran con su botón de cerrar.
   Muchas pantallas cierran el modal al tocar el fondo oscuro (event.target === backdrop).
   Este guardia, en fase de captura, corta ese clic antes de que llegue al fondo. */
(function () {
  if (window.__runflowModalGuard) return;
  window.__runflowModalGuard = true;
  const NAME = /backdrop|overlay|modal|dialog|sheet|drawer|lightbox/i;

  function isBackdrop(el) {
    if (!(el instanceof Element) || el === document.body || el === document.documentElement) return false;
    if (el.closest('[data-allow-outside-close]')) return false;
    if (el.tagName === 'DIALOG') return true;
    if (!NAME.test(`${el.id} ${typeof el.className === 'string' ? el.className : ''}`)) return false;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed') return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
  }

  function guard(event) {
    if (isBackdrop(event.target)) event.stopImmediatePropagation();
  }

  window.addEventListener('click', guard, true);
  window.RunFlowModalGuard = { isBackdrop };
})();
