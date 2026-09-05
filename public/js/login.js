const $ = id => document.getElementById(id);
const athleteMode = new URLSearchParams(location.search).get('mode') === 'athlete';

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

function configureAthleteView() {
  if (!athleteMode) return;
  localStorage.setItem('runflow_client', 'athlete');
  document.title = 'Acceso deportista · RunFlow';
  const story = document.querySelector('.login-story');
  if (story) story.innerHTML = `
    <p class="eyebrow" style="color:#bfe8df">RunFlow Athlete</p>
    <h1>Tu semana, tu carga y tus objetivos en un solo lugar.</h1>
    <p>Consulta lo que ha planificado tu entrenador, entiende tu estado para entrenar y registra cómo ha ido cada sesión.</p>
    <div class="grid grid-2" style="margin-top:28px">
      <div class="metric" style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:white"><span style="color:#d8f1eb">Semana</span><strong>Plan claro</strong><small style="color:#d8f1eb">Sesiones y objetivos</small></div>
      <div class="metric" style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:white"><span style="color:#d8f1eb">Estado</span><strong>Con contexto</strong><small style="color:#d8f1eb">Carga y recuperación</small></div>
    </div>`;
  const brandStrong = document.querySelector('.login-form .brand strong');
  const brandSmall = document.querySelector('.login-form .brand small');
  const eyebrow = document.querySelector('.login-form > .eyebrow');
  const heading = document.querySelector('.login-form > h2');
  const helper = document.querySelector('.login-form > .muted');
  if (brandStrong) brandStrong.textContent = 'RunFlow Athlete';
  if (brandSmall) brandSmall.textContent = 'Acceso deportista';
  if (eyebrow) eyebrow.textContent = 'Deportista';
  if (heading) heading.textContent = 'Entra en tu app';
  if (helper) helper.textContent = 'Escribe el correo configurado en tu ficha. Te enviaremos un enlace seguro para entrar, sin contraseña.';
  $('passwordField').classList.add('hidden');
  $('forgotPassword').classList.add('hidden');
  $('loginButton').textContent = 'Enviarme enlace de acceso';
  $('email').value = '';
}

async function routeUser(user) {
  if (athleteMode) {
    if (!user.roles.includes('athlete')) {
      await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
      throw new Error('Este usuario no tiene acceso como deportista.');
    }
    localStorage.setItem('runflow_client', 'athlete');
    location.href = '/athlete';
    return;
  }
  localStorage.removeItem('runflow_client');
  if (!user.roles.includes('coach')) {
    await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
    throw new Error('Esta web está reservada al entrenador. El deportista accede desde la APK.');
  }
  location.href = '/coach';
}

async function login(email, password) {
  const data = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  await routeUser(data.user);
}

async function requestAthleteAccess() {
  const email = $('email').value.trim();
  if (!email) throw new Error('Introduce el correo configurado en la ficha del deportista.');
  const data = await json('/api/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) });
  if (data.demo && data.user) return routeUser(data.user);
  message(data.message || 'Revisa tu correo para entrar en RunFlow Athlete.', 'success');
}

async function acceptMagicLink() {
  if (!athleteMode || !location.hash) return false;
  const hash = new URLSearchParams(location.hash.slice(1));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (!accessToken || !refreshToken) return false;
  history.replaceState(null, '', `${location.pathname}?mode=athlete`);
  const data = await json('/api/auth/session', { method: 'POST', body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: hash.get('expires_in') }) });
  await routeUser(data.user);
  return true;
}

async function recoverPassword() {
  const email = $('email').value.trim();
  if (!email) throw new Error('Introduce primero el correo de tu cuenta.');
  const data = await json('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email }) });
  message(data.message || 'Si existe una cuenta con ese correo, recibirás un enlace de recuperación.', 'success');
}

async function init() {
  configureAthleteView();
  if (await acceptMagicLink()) return;
  const config = await json('/api/config');
  if (config.demo && !athleteMode) {
    $('demoHelp').classList.remove('hidden');
    $('demoButton').classList.remove('hidden');
  }
  try {
    const session = await json('/api/auth/me');
    await routeUser(session.user);
  } catch (error) {
    if (error.message.includes('reservada') || error.message.includes('deportista')) message(error.message, 'error');
  }
}

$('loginButton').addEventListener('click', async () => {
  $('loginButton').disabled = true;
  try { athleteMode ? await requestAthleteAccess() : await login($('email').value, $('password').value); }
  catch (error) { message(error.message, 'error'); }
  finally { $('loginButton').disabled = false; }
});
$('forgotPassword').addEventListener('click', async () => {
  $('forgotPassword').disabled = true;
  try { await recoverPassword(); }
  catch (error) { message(error.message, 'error'); }
  finally { $('forgotPassword').disabled = false; }
});
$('demoButton').addEventListener('click', async () => {
  $('demoButton').disabled = true;
  try { await login('urtzi@suibroker.es', 'runflow'); }
  catch (error) { message(error.message, 'error'); }
  finally { $('demoButton').disabled = false; }
});
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('loginButton').click(); });
$('email').addEventListener('keydown', event => { if (athleteMode && event.key === 'Enter') $('loginButton').click(); });
init().catch(error => message(error.message, 'error'));
