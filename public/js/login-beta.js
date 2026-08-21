const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const target = params.get('target') === 'athlete-v2' ? 'athlete-v2' : 'coach-v9';
const athleteMode = target === 'athlete-v2';
const returnPath = athleteMode ? '/athlete-v2.html' : '/coach-v9.html';

function message(text, type = '') {
  const el = $('loginMessage');
  el.textContent = text;
  el.className = `notice ${type}`;
  el.classList.remove('hidden');
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}

function configure() {
  if (athleteMode) {
    document.title = 'Acceso Athlete V2 · RunFlow';
    $('betaEyebrow').textContent = 'RunFlow Athlete V2 · Beta';
    $('betaStoryTitle').textContent = 'Accede a la nueva versión del atleta.';
    $('betaStoryText').textContent = 'Este acceso vuelve a Athlete V2 y no modifica la app estable.';
    $('betaBrand').textContent = 'RunFlow Athlete V2';
    $('betaBrandSmall').textContent = 'Beta';
    $('betaRole').textContent = 'Deportista';
    $('betaHeading').textContent = 'Entra en Athlete V2';
    $('loginButton').textContent = 'Entrar en Athlete V2';
    localStorage.setItem('runflow_client', 'athlete');
  } else {
    document.title = 'Acceso Coach V9 · RunFlow';
    $('betaEyebrow').textContent = 'RunFlow Coach V9 · Beta';
    $('betaStoryTitle').textContent = 'Accede al nuevo entorno de Coach.';
    $('betaStoryText').textContent = 'Este acceso vuelve a Coach V9 y mantiene Coach V8 y Coach estable intactos.';
    $('betaBrand').textContent = 'RunFlow Coach V9';
    $('betaBrandSmall').textContent = 'Beta';
    $('betaRole').textContent = 'Entrenador';
    $('betaHeading').textContent = 'Entra en Coach V9';
    $('loginButton').textContent = 'Entrar en Coach V9';
    localStorage.removeItem('runflow_client');
  }
}

async function routeUser(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (athleteMode && !roles.includes('athlete')) {
    await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
    throw new Error('Este usuario no tiene acceso como deportista.');
  }
  if (!athleteMode && !roles.includes('coach')) {
    await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
    throw new Error('Este usuario no tiene acceso como entrenador.');
  }
  if (athleteMode) localStorage.setItem('runflow_client', 'athlete');
  else localStorage.removeItem('runflow_client');
  location.href = returnPath;
}

async function init() {
  configure();
  try {
    const session = await json('/api/auth/me');
    await routeUser(session.user);
  } catch (error) {
    if (!/401|autentic|sesión|session/i.test(error.message || '')) {
      // Si no hay sesión, simplemente mostramos el formulario. Los errores de rol sí se enseñan.
      if (/acceso/.test(error.message || '')) message(error.message, 'error');
    }
  }
}

$('loginButton').addEventListener('click', async () => {
  $('loginButton').disabled = true;
  try {
    const data = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value, password: $('password').value }) });
    await routeUser(data.user);
  } catch (error) {
    message(error.message, 'error');
  } finally {
    $('loginButton').disabled = false;
  }
});
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('loginButton').click(); });
init();
