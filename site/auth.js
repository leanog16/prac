(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('auth-dialog'), form = $('auth-form'), account = $('account-btn');
  const username = $('auth-username'), password = $('auth-password'), confirm = $('auth-confirm');
  const error = $('auth-error');
  let mode = 'signin', user = null;
  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    $('auth-title').textContent = $('auth-submit').textContent = signup ? 'Sign up' : 'Sign in';
    $('auth-intro').textContent = signup ? 'Create your prac account.' : 'Welcome back to prac.';
    $('auth-confirm-wrap').hidden = !signup;
    confirm.required = signup;
    password.autocomplete = signup ? 'new-password' : 'current-password';
    $('auth-switch').textContent = signup ? 'Already have an account? Sign in' : 'Need an account? Sign up';
    error.hidden = true;
    password.value = confirm.value = '';
  }
  function setUser(name) { user = name; account.textContent = name ? `${name} · Sign out` : 'Sign in'; }
  async function api(path, options) {
    const response = await fetch('/api/' + path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.');
    return data;
  }
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  account.addEventListener('click', async () => {
    if (user) {
      try { await api('signout', post({})); setUser(null); }
      catch (_) { alert('Could not sign out. Please try again.'); }
    } else { setMode('signin'); form.reset(); dialog.showModal(); username.focus(); }
  });
  $('auth-cancel').addEventListener('click', () => dialog.close());
  $('auth-switch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    if (mode === 'signup' && password.value !== confirm.value) {
      error.textContent = 'Passwords do not match.'; error.hidden = false; return;
    }
    $('auth-submit').disabled = true;
    try {
      const data = await api(mode, post({ username: username.value, password: password.value, confirmPassword: confirm.value }));
      setUser(data.username); form.reset(); dialog.close();
    } catch (e) { error.textContent = e.message || 'Could not connect. Please try again.'; error.hidden = false; }
    finally { $('auth-submit').disabled = false; }
  });
  api('session').then(data => setUser(data.username)).catch(() => {});
})();
