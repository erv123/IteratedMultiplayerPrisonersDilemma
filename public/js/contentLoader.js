async function loadContentFragment(fragmentId, containerId) {
  try {
    const resp = await fetch('/content/gameinfo.html');
    if (!resp.ok) throw new Error('Failed to fetch content');
    const text = await resp.text();
    const tmpl = document.createElement('div');
    tmpl.innerHTML = text;
    const frag = tmpl.querySelector('#' + fragmentId);
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!frag) {
      container.innerHTML = '';
      return;
    }
    // copy children to container
    container.innerHTML = '';
    Array.from(frag.childNodes).forEach(n => container.appendChild(n.cloneNode(true)));
  } catch (e) {
    console.error('loadContentFragment error', e);
  }
}

window.ContentLoader = { loadContentFragment };
