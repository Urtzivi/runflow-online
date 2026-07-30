const $ = id => document.getElementById(id);

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

async function ensureCoach(user) {
  if (!user.roles.includes('coach')) {
    await json('/api/auth/logout', { method: 'POST' }).catch(() => {});
    throw new Error('Esta web está reservada al entrenador. El deportista accede desde la APK.');
  }
  location.href = '/coach';
}

async function login(email, password) {
  const data = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  await ensureCoach(data.user);
}

async function init() {
  const config = await json('/api/config');
  if (config.demo) {
    $('demoHelp').classList.remove('hidden');
    $('demoButton').classList.remove('hidden');
  }
  try {
    const session = await json('/api/auth/me');
    await ensureCoach(session.user);
  } catch (error) {
    if (error.message.includes('reservada')) message(error.message, 'error');
  }
}

$('loginButton').addEventListener('click', async () => {
  $('loginButton').disabled = true;
  try { await login($('email').value, $('password').value); }
  catch (error) { message(error.message, 'error'); }
  finally { $('loginButton').disabled = false; }
});
$('demoButton').addEventListener('click', async () => {
  $('demoButton').disabled = true;
  try { await login('urtzi@suibroker.es', 'runflow'); }
  catch (error) { message(error.message, 'error'); }
  finally { $('demoButton').disabled = false; }
});
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('loginButton').click(); });
init().catch(error => message(error.message, 'error'));
