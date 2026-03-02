// Apply session theme (dark/light/auto) on page load
(function(){
  try {
    // Prefer localStorage (cross-page) then sessionStorage (per-tab)
    let stored = null;
    try { stored = localStorage.getItem('theme'); } catch(e) { stored = null; }
    if (!stored) {
      try { stored = sessionStorage.getItem('theme'); } catch(e) { stored = null; }
    }
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      document.documentElement.setAttribute('data-theme', 'auto');
    }
  } catch (e) { /* ignore */ }
})();

// Expose a helper for other scripts to apply theme programmatically
window.Theme = {
  apply: function(mode){
    try {
      if (mode !== 'dark' && mode !== 'light' && mode !== 'auto') mode = 'auto';
      document.documentElement.setAttribute('data-theme', mode);
      try { sessionStorage.setItem('theme', mode); } catch (e) {}
      try { localStorage.setItem('theme', mode); } catch (e) {}
    } catch(e){}
  }
};

// Initialize theme toggle wiring (merge of themeToggle.js)
(function(){
  try {
    const toggle = function(){ return document.getElementById('themeToggle'); };
    const setToggleChecked = (mode) => {
      try {
        const t = toggle(); if (!t) return;
        t.checked = (mode === 'dark');
      } catch(e){}
    };

    // ensure toggle reflects stored or system preference
    const stored = sessionStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') setToggleChecked(stored);
    else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      setToggleChecked(prefersDark ? 'dark' : 'light');
    }

    // when toggle exists, wire change handler
    const t = toggle();
    if (t) {
      t.addEventListener('change', (e) => {
        const chosen = e.target.checked ? 'dark' : 'light';
        try { sessionStorage.setItem('theme', chosen); } catch(_){}
        try { window.Theme.apply(chosen); } catch(_){}
      });
    }

    // wrap Theme.apply so it keeps toggle in sync when called programmatically
    const orig = window.Theme && window.Theme.apply ? window.Theme.apply : null;
    if (orig) {
      window.Theme.apply = function(mode){
        try {
          orig(mode);
        } catch(e){}
        try { setToggleChecked(mode); } catch(e){}
      };
    }
  } catch (e) { /* ignore */ }
})();

// Re-apply theme on pageshow (handles bfcache / back-forward navigation)
window.addEventListener('pageshow', function(ev){
  try {
    let stored = null;
    try { stored = localStorage.getItem('theme'); } catch(e) { stored = null; }
    if (!stored) {
      try { stored = sessionStorage.getItem('theme'); } catch(e) { stored = null; }
    }
    if (stored === 'dark' || stored === 'light') window.Theme.apply(stored); else window.Theme.apply('auto');
  } catch (e) { /* ignore */ }
});

// Also re-apply on visibilitychange to cover cases where pageshow isn't fired
document.addEventListener('visibilitychange', function(){
  try {
    if (document.visibilityState === 'visible') {
      let stored = null;
      try { stored = localStorage.getItem('theme'); } catch(e) { stored = null; }
      if (!stored) {
        try { stored = sessionStorage.getItem('theme'); } catch(e) { stored = null; }
      }
      if (stored === 'dark' || stored === 'light') window.Theme.apply(stored); else window.Theme.apply('auto');
    }
  } catch (e) {}
});

// Respond to storage events (other tabs/windows) so theme stays in sync
window.addEventListener('storage', function(ev){
  try {
    if (ev.key === 'theme') {
      const v = ev.newValue;
      if (v === 'dark' || v === 'light') window.Theme.apply(v);
      else window.Theme.apply('auto');
    }
  } catch (e) {}
});
