(function(){
  function $(sel, root=document) { return root.querySelector(sel); }

  const notAuth = $('#notAuth');
  const auth = $('#auth');
  const admin = $('#admin');
  const curUsername = $('#curUsername');
  const notAuthMsg = $('#notAuthMsg');
  const authMsg = $('#authMsg');
  const adminMsg = $('#adminMsg');

  async function whoami() {
    try {
      const r = await window.api.get('/auth/whoami');
      if (!r || !r.success) throw new Error('failed');
      return r.data;
    } catch (e) { return null; }
  }

  async function refresh() {
    const user = await whoami();
    if (!user) {
      notAuth.style.display = '';
      auth.style.display = 'none';
      admin.style.display = 'none';
    } else {
      notAuth.style.display = 'none';
      auth.style.display = '';
      curUsername.textContent = user.username;
      authMsg.textContent = '';
      if (user.isAdmin) admin.style.display = ''; else admin.style.display = 'none';
    }
  }

  // login
  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    notAuthMsg.textContent = '';
    const form = ev.target;
    const data = { username: form.username.value.trim(), password: form.password.value };
    try {
      const r = await window.api.post('/auth/login', data);
      if (!r.success) { notAuthMsg.textContent = (r.error && r.error.message) || 'Login failed'; return; }
      await refresh();
    } catch (e) { notAuthMsg.textContent = e.message || 'Network error'; }
  });

  // register
  $('#registerForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    notAuthMsg.textContent = '';
    const form = ev.target;
    const data = { username: form.username.value.trim(), password: form.password.value };
    try {
      const r = await window.api.post('/auth/register', data);
      if (!r.success) { notAuthMsg.textContent = (r.error && r.error.message) || 'Register failed'; return; }
      await refresh();
    } catch (e) { notAuthMsg.textContent = e.message || 'Network error'; }
  });

  // logout
  $('#logoutBtn').addEventListener('click', async () => {
    try {
      await window.api.post('/auth/logout');
    } catch (e) {}
    await refresh();
  });

  // change password
  $('#changePasswordForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    authMsg.textContent = '';
    const form = ev.target;
    const np = form.newPassword.value;
    const cp = form.confirmPassword.value;
    if (np !== cp) { authMsg.textContent = 'Passwords do not match'; return; }
    if (np.length < 8) { authMsg.textContent = 'Password must be at least 8 characters'; return; }
    try {
      const username = curUsername.textContent;
      const r = await window.api.post('/auth/resetPassword', { username, newPassword: np });
      if (!r.success) { authMsg.textContent = (r.error && r.error.message) || 'Failed to change password'; return; }
      authMsg.textContent = 'Password changed';
      form.reset();
    } catch (e) { authMsg.textContent = e.message || 'Network error'; }
  });

  // admin enable reset
  $('#enableResetBtn').addEventListener('click', async () => {
    adminMsg.textContent = '';
    const target = $('#adminTarget').value.trim();
    if (!target) { adminMsg.textContent = 'Enter username'; return; }
    try {
      // fetch users and find id
      const r = await window.api.get('/admin/users');
      if (!r.success) { adminMsg.textContent = 'Failed to fetch users'; return; }
      const user = (r.data || []).find(u => u.username === target);
      if (!user) { adminMsg.textContent = 'User not found'; return; }
      const rr = await window.api.post(`/admin/enableReset/${user.id}`);
      if (!rr.success) { adminMsg.textContent = (rr.error && rr.error.message) || 'Failed'; return; }
      adminMsg.textContent = 'Reset enabled for ' + target;
    } catch (e) { adminMsg.textContent = e.message || 'Network error'; }
  });

  // init
  document.addEventListener('DOMContentLoaded', refresh);
})();
