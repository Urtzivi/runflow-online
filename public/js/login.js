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
  if (helper) helper.textContent = 'Escribe el correo configurado en tu ficha. No necesitas contraseña.';
  $('passwordField').classList.add('hidden');
  $('forgotPassword').classList.add('hidden');
  $('loginButton').textContent = 'Entrar';
  $('email').value = '';
}

async function routeUser(user) {
  if (athleteMode) {
    if (!user.roles.includes('athlete')) {
      await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
      throw new Error('Este usuario no tiene acceso como deportista.');
    }
    localStorage.setItem('runflow_client', 'athlete');
    markSessionChosen();
    location.href = '/athlete';
    return;
  }
  localStorage.removeItem('runflow_client');
  if (!user.roles.includes('coach')) {
    await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
    throw new Error('Esta web está reservada al entrenador. El deportista accede desde la APK.');
  }
  markSessionChosen();
  location.href = '/coach';
}

function markSessionChosen() {
  try { sessionStorage.setItem('runflow_session_chosen', '1'); } catch {}
}

function userLabel(user) {
  return user.display_name || user.email || 'tu cuenta';
}

// Si ya hay una sesión abierta no se entra automáticamente: se ofrece continuar o cambiar de usuario.
function showSessionChooser(user) {
  const card = document.createElement('div');
  card.id = 'sessionChooser';
  card.className = 'login-help';
  card.style.marginTop = '0';
  card.style.marginBottom = '16px';
  const text = document.createElement('p');
  text.style.margin = '0 0 12px';
  text.append('Sesión abierta como ');
  const name = document.createElement('strong');
  name.textContent = userLabel(user);
  text.append(name);
  if (user.email && user.display_name) text.append(` (${user.email})`);
  const continueButton = document.createElement('button');
  continueButton.id = 'continueSession';
  continueButton.className = 'btn primary';
  continueButton.type = 'button';
  continueButton.style.width = '100%';
  continueButton.textContent = `Continuar como ${userLabel(user)}`;
  const switchButton = document.createElement('button');
  switchButton.id = 'switchUser';
  switchButton.className = 'btn secondary';
  switchButton.type = 'button';
  switchButton.style.width = '100%';
  switchButton.style.marginTop = '10px';
  switchButton.textContent = 'Cambiar de usuario';
  card.append(text, continueButton, switchButton);
  $('loginMessage').before(card);

  continueButton.addEventListener('click', async () => {
    continueButton.disabled = true;
    try { await routeUser(user); }
    catch (error) { card.remove(); message(error.message, 'error'); }
    finally { continueButton.disabled = false; }
  });
  switchButton.addEventListener('click', async () => {
    switchButton.disabled = true;
    await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
    try { sessionStorage.removeItem('runflow_session_chosen'); } catch {}
    card.remove();
    $('email').value = '';
    $('password').value = '';
    $('email').focus();
  });
}

async function login(email, password) {
  const data = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  await routeUser(data.user);
}

async function requestAthleteAccess() {
  const email = $('email').value.trim();
  if (!email) throw new Error('Introduce el correo configurado en la ficha del deportista.');
  const data = await json('/api/auth/athlete-email', { method: 'POST', body: JSON.stringify({ email }) });
  await routeUser(data.user);
}

async function recoverPassword() {
  const email = $('email').value.trim();
  if (!email) throw new Error('Introduce primero el correo de tu cuenta.');
  const data = await json('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email }) });
  message(data.message || 'Si existe una cuenta con ese correo, recibirás un enlace de recuperación.', 'success');
}

async function init() {
  configureAthleteView();
  const config = await json('/api/config');
  if (config.demo && !athleteMode) {
    $('demoHelp').classList.remove('hidden');
    $('demoButton').classList.remove('hidden');
  }
  try {
    const session = await json('/api/auth/me');
    if (session?.user) showSessionChooser(session.user);
  } catch {}
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
