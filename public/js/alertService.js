(function(){
  // Simple UI Alert Service implementing Promise-based alert/confirm/prompt and toast
  const DEFAULT_TOAST_DURATION = 4000;
  let modalQueue = [];
  let isProcessing = false;
  let containers = { modal: null, toast: null };

  function ensureContainers() {
    if (!containers.modal) {
      containers.modal = document.createElement('div');
      containers.modal.id = 'ui-modal-root';
      document.body.appendChild(containers.modal);
    }
    if (!containers.toast) {
      containers.toast = document.createElement('div');
      containers.toast.className = 'ui-toast-container';
      document.body.appendChild(containers.toast);
    }
  }

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'ui-overlay';
    overlay.tabIndex = -1;
    return overlay;
  }

  function focusablesWithin(node) {
    const selectors = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.from(node.querySelectorAll(selectors)).filter(el => el.offsetParent !== null);
  }

  function trapFocus(container, onRelease) {
    const focusables = focusablesWithin(container);
    let first = focusables[0];
    let last = focusables[focusables.length - 1];
    function handleKey(e){
      if (e.key === 'Tab'){
        if (focusables.length === 0) { e.preventDefault(); return; }
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (e.key === 'Escape') {
        // signal cancel via dataset
        const cancelBtn = container.querySelector('[data-ui-cancel]');
        if (cancelBtn) cancelBtn.click();
      }
    }
    document.addEventListener('keydown', handleKey);
    return function release(){ document.removeEventListener('keydown', handleKey); if (typeof onRelease === 'function') onRelease(); };
  }

  function renderModal(opts) {
    ensureContainers();
    return new Promise((resolve) => {
      const overlay = createOverlay();
      const modal = document.createElement('div');
      modal.className = 'ui-modal';
      modal.setAttribute('role','dialog');
      modal.setAttribute('aria-modal','true');
      const titleId = 'ui-modal-title-'+Date.now();
      const bodyId = 'ui-modal-body-'+Date.now();
      if (opts.title) modal.setAttribute('aria-labelledby', titleId);
      modal.setAttribute('aria-describedby', bodyId);

      const header = document.createElement('div'); header.className = 'ui-modal__header';
      const h = document.createElement('h3'); h.className = 'ui-modal__title'; h.id = titleId; h.innerText = opts.title || '';
      const closeBtn = document.createElement('button'); closeBtn.className = 'ui-btn ui-btn--secondary'; closeBtn.innerText = '×'; closeBtn.title = 'Close';
      closeBtn.addEventListener('click', () => { cleanup(false); });
      header.appendChild(h);
      header.appendChild(closeBtn);

      const body = document.createElement('div'); body.className = 'ui-modal__body'; body.id = bodyId; body.innerHTML = opts.html || (opts.message ? String(opts.message) : '');

      let inputEl = null;
      if (opts.type === 'prompt'){
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = opts.placeholder || '';
        if (opts.defaultValue) inputEl.value = opts.defaultValue;
        inputEl.classList.add('ui-input');
        body.appendChild(inputEl);
      }

      const footer = document.createElement('div'); footer.className = 'ui-modal__footer';

      const cancelBtn = document.createElement('button'); cancelBtn.className = 'ui-btn ui-btn--secondary'; cancelBtn.innerText = opts.cancelText || 'Cancel'; cancelBtn.dataset.uiCancel = '1';
      cancelBtn.addEventListener('click', () => cleanup(false));

      const okBtn = document.createElement('button'); okBtn.className = 'ui-btn ui-btn--primary'; okBtn.innerText = opts.okText || 'OK';
      okBtn.addEventListener('click', () => cleanup(true));

      // Enter -> OK
      modal.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } });

      // assemble
      modal.appendChild(header);
      modal.appendChild(body);
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      const prevActive = document.activeElement;

      function cleanup(ok){
        const value = ok ? (inputEl ? inputEl.value : true) : (opts.type === 'prompt' ? null : false);
        const release = trapRelease();
        // small delay for animation if needed
        containers.modal.removeChild(overlay);
        // restore focus
        try { if (prevActive && typeof prevActive.focus === 'function') prevActive.focus(); }
        catch(e){}
        resolve(value);
        if (typeof release === 'function') release();
        isProcessing = false;
        setTimeout(processQueue, 0);
      }

      containers.modal.appendChild(overlay);
      // focus management
      const focusable = focusablesWithin(modal);
      if (inputEl) inputEl.focus(); else if (focusable.length) focusable[0].focus(); else modal.focus();
      const trapRelease = trapFocus(modal);

    });
  }

  function processQueue(){
    if (isProcessing) return;
    if (modalQueue.length === 0) return;
    isProcessing = true;
    const item = modalQueue.shift();
    renderModal(item.opts).then(item.resolve);
  }

  function showModal(opts){
    return new Promise((resolve) => {
      modalQueue.push({ opts, resolve });
      setTimeout(processQueue, 0);
    });
  }

  function alert(message, options={}){
    return showModal(Object.assign({ message, title: options.title || 'Alert', okText: options.okText || 'OK', cancelText: options.cancelText || 'Close', type: 'alert' }, options));
  }
  function confirm(message, options={}){
    return showModal(Object.assign({ message, title: options.title || 'Confirm', okText: options.okText || 'OK', cancelText: options.cancelText || 'Cancel', type: 'confirm' }, options));
  }
  function prompt(message, options={}){
    return showModal(Object.assign({ message, title: options.title || 'Prompt', okText: options.okText || 'OK', cancelText: options.cancelText || 'Cancel', placeholder: options.placeholder || '', defaultValue: options.defaultValue || '', type: 'prompt' }, options));
  }

  // Toasts
  function toast(message, { type = 'info', duration = DEFAULT_TOAST_DURATION } = {}){
    ensureContainers();
    const el = document.createElement('div');
    el.className = 'ui-toast ui-toast--' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.setAttribute('aria-hidden','false');
    el.innerText = message;
    containers.toast.appendChild(el);
    const hide = () => {
      el.setAttribute('aria-hidden','true');
      setTimeout(() => { try { containers.toast.removeChild(el); } catch(e){} }, 220);
    };
    const t = setTimeout(hide, duration);
    el.addEventListener('click', () => { clearTimeout(t); hide(); });
  }

  // expose
  const svc = { alert, confirm, prompt, toast };
  window.alertService = svc;
  // feature flag and compatibility shim
  window.uiAlertsEnabled = (typeof window.uiAlertsEnabled === 'boolean') ? window.uiAlertsEnabled : true;
  if (window.uiAlertsEnabled) {
    window._native_alert = window.alert;
    window._native_confirm = window.confirm;
    window._native_prompt = window.prompt;
    window.alert = function(msg){ return svc.alert(String(msg)); };
    window.confirm = function(msg){ return svc.confirm(String(msg)); };
    window.prompt = function(msg, defaultValue){ return svc.prompt(String(msg), { defaultValue }); };
  }
})();
