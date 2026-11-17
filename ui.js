// Ekphrasis — declarative control panel builder.

export const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export const setPath = (o, p, v) => {
  const ks = p.split('.'), last = ks.pop();
  const t = ks.reduce((a, k) => a[k], o);
  t[last] = v;
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function buildPanel(root, spec, state, onChange, onButton) {
  const ctrls = {}, syncers = [];
  let host = root;

  for (const it of spec) {
    if (it.sec) {
      host = el('section', 'sec');
      host.appendChild(el('h3', null, it.sec));
      root.appendChild(host);
      continue;
    }
    switch (it.type) {
      case 'buttons': {
        const row = el('div', 'btnrow');
        for (const [id, label] of it.items) {
          const b = el('button', 'btn', label);
          b.dataset.id = id;
          b.addEventListener('click', () => onButton(id, b));
          row.appendChild(b);
          ctrls['btn:' + id] = b;
        }
        host.appendChild(row);
        break;
      }
      case 'info': {
        const d = el('div', 'info'); d.id = it.id;
        host.appendChild(d);
        break;
      }
      case 'note': host.appendChild(el('p', 'note', it.text)); break;
      case 'select': {
        const w = el('label', 'row');
        w.appendChild(el('span', 'lbl', it.label));
        const s = el('select');
        for (const [v, l] of it.options) { const o = el('option', null, l); o.value = String(v); s.appendChild(o); }
        s.addEventListener('change', () => { setPath(state, it.key, it.num ? +s.value : s.value); onChange(it.key); });
        w.appendChild(s); host.appendChild(w);
        ctrls[it.key] = s;
        syncers.push(() => { s.value = String(getPath(state, it.key)); });
        break;
      }
      case 'range': {
        const w = el('label', 'row range');
        const top = el('span', 'lbl', it.label);
        const val = el('span', 'val');
        top.appendChild(val);
        const r = el('input');
        r.type = 'range'; r.min = it.min; r.max = it.max; r.step = it.step;
        const fmt = it.fmt || ((v) => String(v));
        r.addEventListener('input', () => { setPath(state, it.key, +r.value); val.textContent = fmt(+r.value); onChange(it.key); });
        w.appendChild(top); w.appendChild(r); host.appendChild(w);
        ctrls[it.key] = r; ctrls[it.key + ':val'] = val;
        syncers.push(() => { const v = getPath(state, it.key); r.value = v; val.textContent = fmt(v); });
        break;
      }
      case 'check': {
        const w = el('label', 'row check');
        const c = el('input'); c.type = 'checkbox';
        c.addEventListener('change', () => { setPath(state, it.key, c.checked); onChange(it.key); });
        w.appendChild(c); w.appendChild(el('span', 'lbl', it.label)); host.appendChild(w);
        ctrls[it.key] = c;
        syncers.push(() => { c.checked = !!getPath(state, it.key); });
        break;
      }
      case 'voice': {
        const base = 'voices.' + it.voice;
        const w = el('div', 'voice');
        const head = el('label', 'vhead');
        const c = el('input'); c.type = 'checkbox';
        const dot = el('span', 'dot'); dot.style.background = it.color;
        head.appendChild(c); head.appendChild(dot); head.appendChild(el('span', 'lbl', it.label));
        const r = el('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.01;
        c.addEventListener('change', () => { setPath(state, base + '.on', c.checked); w.classList.toggle('off', !c.checked); onChange(base + '.on'); });
        r.addEventListener('input', () => { setPath(state, base + '.vol', +r.value); onChange(base + '.vol'); });
        w.appendChild(head); w.appendChild(r);
        let s = null;
        if (it.insts) {
          s = el('select', 'wave');
          for (const [v, l] of it.insts) { const o = el('option', null, l); o.value = v; s.appendChild(o); }
          s.addEventListener('change', () => { setPath(state, base + '.inst', s.value); onChange(base + '.inst'); });
          w.appendChild(s);
        }
        host.appendChild(w);
        syncers.push(() => {
          const vs = getPath(state, base);
          c.checked = !!vs.on; r.value = vs.vol; w.classList.toggle('off', !vs.on);
          if (s) s.value = vs.inst;
        });
        break;
      }
    }
  }
  const sync = () => syncers.forEach((f) => f());
  sync();
  return { ctrls, sync };
}
