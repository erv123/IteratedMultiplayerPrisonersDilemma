// Minimal TableRenderer for legacy pages
(function(){
  const cellTypes = new Map();

  // helper: create element with attrs
  function el(tag, attrs){
    const node = document.createElement(tag);
    if (!attrs) return node;
    Object.keys(attrs).forEach(k => {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, String(attrs[k]));
    });
    return node;
  }

  // default renderers
  function renderText(cellSpec){
    const span = el('span', { text: cellSpec.value != null ? String(cellSpec.value) : '' });
    if (cellSpec.onClick) { span.classList.add('text-clickable'); span.addEventListener('click', function(e){ cellSpec.onClick(e, { row: cellSpec._row, column: cellSpec._col }); }); }
    return span;
  }

  function formatNumber(val, fmt){
    if (val == null) return '';
    const n = Number(val);
    if (isNaN(n)) return String(val);
    if (fmt && fmt.thousands) return n.toLocaleString();
    if (fmt && typeof fmt.precision === 'number') return n.toFixed(fmt.precision);
    return String(n);
  }

  function renderNumber(cellSpec){
    const span = el('span', { text: formatNumber(cellSpec.value, cellSpec.format || {}) });
    span.classList.add('tbl-number');
    if (cellSpec.onClick) { span.classList.add('text-clickable'); span.addEventListener('click', function(e){ cellSpec.onClick(e, { row: cellSpec._row, column: cellSpec._col }); }); }
    return span;
  }

  function renderReadonlyInput(cellSpec){
    const input = el('input', { class: 'readonly-input' });
    input.disabled = true; input.value = cellSpec.value != null ? String(cellSpec.value) : '';
    return input;
  }

  function renderInput(cellSpec){
    const input = el('input');
    if (cellSpec.value != null) input.value = String(cellSpec.value.value != null ? cellSpec.value.value : cellSpec.value);
    if (cellSpec.value && cellSpec.value.name) input.name = cellSpec.value.name;
    if (cellSpec.onChange) input.addEventListener('change', (e)=> cellSpec.onChange(e, { row: cellSpec._row, column: cellSpec._col }));
    return input;
  }

  function renderButton(cellSpec){
    const btn = el('button', { text: (cellSpec.value && cellSpec.value.label) ? cellSpec.value.label : (cellSpec.value != null ? String(cellSpec.value) : '') });
    btn.classList.add('tbl-action-btn');
    if (cellSpec.onClick) btn.addEventListener('click', (e)=> cellSpec.onClick(e, { row: cellSpec._row, column: cellSpec._col }));
    return btn;
  }

  function renderCheckbox(cellSpec){
    const input = el('input'); input.type = 'checkbox';
    if (cellSpec.value) input.checked = !!cellSpec.value;
    if (cellSpec.onChange) input.addEventListener('change', (e)=> cellSpec.onChange(e, { row: cellSpec._row, column: cellSpec._col }));
    return input;
  }

  function renderSelect(cellSpec){
    const sel = el('select');
    const opts = cellSpec.value && Array.isArray(cellSpec.value.options) ? cellSpec.value.options : [];
    opts.forEach(o => {
      const option = el('option', { text: o.label != null ? o.label : o, value: o.value != null ? o.value : o });
      if ((cellSpec.value && cellSpec.value.value) == option.getAttribute('value')) option.selected = true;
      sel.appendChild(option);
    });
    if (cellSpec.onChange) sel.addEventListener('change', (e)=> cellSpec.onChange(e, { row: cellSpec._row, column: cellSpec._col }));
    return sel;
  }

  function renderDot(cellSpec){
    const wrap = el('span');
    const dot = el('span'); dot.className = 'tbl-dot';
    const color = cellSpec.color || (cellSpec.rowMeta && cellSpec.rowMeta.color);
    if (color) dot.style.background = color;
    const label = el('span', { text: cellSpec.value != null ? String(cellSpec.value) : '' }); label.className = 'tbl-dot-label';
    wrap.appendChild(dot); wrap.appendChild(label);
    return wrap;
  }

  // register defaults
  cellTypes.set('text', renderText);
  cellTypes.set('number', renderNumber);
  cellTypes.set('readonlyInput', renderReadonlyInput);
  cellTypes.set('input', renderInput);
  cellTypes.set('button', renderButton);
  cellTypes.set('checkbox', renderCheckbox);
  cellTypes.set('select', renderSelect);
  cellTypes.set('dot', renderDot);

  function ensureEl(selectorOrEl){
    if (!selectorOrEl) return null;
    if (typeof selectorOrEl === 'string') return document.querySelector(selectorOrEl);
    return selectorOrEl;
  }

  function applyCellClasses(td, cellSpec){
    td.classList.add('tbl-cell');
    if (cellSpec && cellSpec.className){
      if (Array.isArray(cellSpec.className)) cellSpec.className.forEach(c=> td.classList.add(c));
      else td.classList.add(cellSpec.className);
    }
  }

  function buildCell(col, rowObj, rowIndex, colIndex){
    const raw = rowObj[col.key];
    const cellSpec = (raw && typeof raw === 'object' && raw.type) ? Object.assign({}, raw) : { type: (col.type || 'text'), value: raw };
    cellSpec._row = rowObj; cellSpec._col = col; cellSpec.rowMeta = rowObj && rowObj.meta ? rowObj.meta : null;
    const td = el('td'); applyCellClasses(td, cellSpec);
    if (col.className) td.classList.add(col.className);
    // renderer lookup
    const type = (cellSpec.type || 'text');
    const renderer = cellTypes.has(type) ? cellTypes.get(type) : (cellTypes.get('text'));
    const content = renderer(cellSpec);
    if (content) td.appendChild(content);
    return td;
  }

  function buildRow(schema, rowObj, rowIndex){
    const tr = el('tr'); tr.classList.add('tbl-row');
    schema.columns.forEach((col, ci)=>{
      const td = buildCell(col, rowObj, rowIndex, ci);
      tr.appendChild(td);
    });
    return tr;
  }

  function createTable(container, schema, rows, options){
    const c = ensureEl(container);
    if (!c) throw new Error('Invalid container');
    const table = el('table'); table.className = 'tbl';
    if (options && options.tableClass) table.classList.add(options.tableClass);
    if (options && options.compact) table.classList.add('tbl-compact');
    // header
    const thead = el('thead'); const thr = el('tr');
    schema.columns.forEach((col, i)=>{
      const th = el('th', { text: col.title || '' });
      // store the column key so updateRows can reconstruct schema
      th.setAttribute('data-key', col.key != null ? col.key : String(i));
      if (col.width) th.style.width = col.width;
      thr.appendChild(th);
    });
    thead.appendChild(thr); table.appendChild(thead);
    // body
    const tbody = el('tbody');
    (rows || []).forEach((r,ri)=> tbody.appendChild(buildRow(schema, r, ri)));
    table.appendChild(tbody);

    // If maxHeight provided, wrap table in a scroll container
    let outEl = table;
    if (options && options.maxHeight) {
      const wrap = el('div'); wrap.className = 'tbl-scroll-container';
      wrap.style.maxHeight = options.maxHeight;
      wrap.style.overflowY = 'auto';
      wrap.appendChild(table);
      outEl = wrap;
    }

    // set data flags for auto sizing
    if (options && options.autoSizeColumns) { c.dataset.autoSize = '1'; }
    if (options && options.maxHeight) { c.dataset.maxHeight = options.maxHeight; }

    // replace container content using replaceChildren to avoid innerHTML-induced flicker
    if (typeof c.replaceChildren === 'function') c.replaceChildren(outEl); else { c.innerHTML = ''; c.appendChild(outEl); }

    // compute column widths if requested
    if (options && options.autoSizeColumns) computeColumnWidths(c);

    return table;
  }

  function updateRows(container, rows){
    const c = ensureEl(container);
    if (!c) throw new Error('Invalid container');
    const table = c.querySelector('table.tbl') || (c.tagName === 'TABLE' ? c : null);
    if (!table) throw new Error('Table not found in container');
    const schema = { columns: Array.from(table.querySelectorAll('thead th')).map((th, i)=>({ key: th.getAttribute('data-key') || String(i), title: th.textContent || '' })) };
    // simple replace of tbody
    const oldTbody = table.querySelector('tbody'); if (oldTbody) oldTbody.remove();
    const tbody = el('tbody');
    // assume rows are plain objects with keys in same order as previous schema
    rows.forEach((r,ri)=> tbody.appendChild(buildRow(schema, r, ri)));
    table.appendChild(tbody);
    // recompute column widths if container flagged for auto sizing
    try {
      const croot = c;
      if (croot && croot.dataset && croot.dataset.autoSize === '1') computeColumnWidths(croot);
    } catch (e) { /* ignore */ }
    return table;
  }

  // compute and set column widths based on rendered content (header + body cells)
  function computeColumnWidths(container) {
    const c = ensureEl(container);
    if (!c) return;
    const table = c.querySelector('table.tbl'); if (!table) return;
    // ensure table-layout fixed for precise width
    table.style.tableLayout = 'fixed';
    const thead = table.querySelector('thead'); if (!thead) return;
    const ths = Array.from(thead.querySelectorAll('th'));
    const tbody = table.querySelector('tbody');
    const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
    // compute max scrollWidth per column
    const widths = ths.map((th,ci) => {
      let maxW = th.scrollWidth || th.offsetWidth || 80;
      rows.forEach(r => {
        const td = r.children[ci];
        if (td) {
          const w = td.scrollWidth || td.offsetWidth || 0;
          if (w > maxW) maxW = w;
        }
      });
      // add small padding
      return Math.min(maxW + 24, 800); // cap to avoid runaway widths
    });
    // apply widths to columns via colgroup so column width (not height) is set
    try {
      let colgroup = table.querySelector('colgroup');
      if (colgroup) colgroup.remove();
      colgroup = document.createElement('colgroup');
      widths.forEach(w => {
        const col = document.createElement('col');
        col.style.width = w + 'px';
        colgroup.appendChild(col);
      });
      table.insertBefore(colgroup, table.firstChild);
    } catch (e) { /* ignore colgroup errors */ }
    // if container width is smaller than table, allow horizontal scroll on parent
    try {
      const parent = c;
      parent.style.overflowX = 'auto';
    } catch (e) {}
  }

  function registerCellType(name, rendererFn){
    if (!name || typeof rendererFn !== 'function') throw new Error('Invalid registerCellType args');
    cellTypes.set(name, rendererFn);
  }

  // expose
  window.TableRenderer = { createTable, updateRows, registerCellType };
})();
