// Botón visible de "Cerrar sesión" en la barra lateral del coach.
// La barra superior original (con #logout) queda oculta por el shell V8/V9,
// y la barra lateral se reconstruye varias veces, así que se reinyecta cuando falta.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let userName = '';

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    try { sessionStorage.removeItem('runflow_session_chosen'); } catch {}
    location.replace(localStorage.getItem('runflow_client') === 'athlete' ? '/login?mode=athlete' : '/login');
  }

  function inject() {
    const sidebar = document.querySelector('.v8-sidebar');
    if (!sidebar || sidebar.querySelector('#rfSessionLogout')) return;
    const box = document.createElement('div');
    box.className = 'rf-session-box';
    box.innerHTML = `<div class="rf-session-user" title="Sesión iniciada">${esc(userName)}</div>
      <button id="rfSessionLogout" class="rf-session-logout" type="button" title="Cerrar sesión"><span class="ico">⎋</span><span>Cerrar sesión</span></button>`;
    box.querySelector('button').addEventListener('click', logout);
    const team = sidebar.querySelector('.v8-team');
    if (team) team.after(box); else sidebar.prepend(box);
  }

  const style = document.createElement('style');
  style.textContent = `.rf-session-box{margin:-12px 0 18px;display:grid;gap:6px}
.rf-session-user{color:#899189;font-size:11px;padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rf-session-user:empty{display:none}
.rf-session-logout{width:100%;border:1px solid #2b332c;background:#171d18;color:#e7ece7;padding:8px 12px;border-radius:12px;display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:center;text-align:left;font-weight:760;cursor:pointer}
.rf-session-logout:hover{background:#2a1d1d;border-color:#5a2f2f;color:#fff}
.rf-session-logout .ico{text-align:center}
@media(max-width:1100px){.rf-session-user,.rf-session-logout span:not(.ico){display:none}.rf-session-logout{grid-template-columns:1fr;padding:12px 8px}}`;
  document.head.appendChild(style);

  fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      userName = data?.user?.display_name || data?.user?.email || '';
      const el = document.querySelector('.rf-session-user');
      if (el) el.textContent = userName;
    })
    .catch(() => {});

  inject();
  new MutationObserver(inject).observe(document.body, { childList: true });
})();
