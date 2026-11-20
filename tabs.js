// Ekphrasis — phone layout: each panel section becomes a tab in a bar directly
// under the view and piano roll (beside them in landscape). Desktop keeps the
// stacked sections. body.tabbed turns the layout on; the open section has .tabon.

const KEY = 'ekphrasis.tab';
const QUERY = '(max-width: 760px), (max-height: 500px) and (orientation: landscape)';

export function initPanelTabs(panel) {
  const mq = window.matchMedia(QUERY);
  const secs = [...panel.querySelectorAll(':scope > .sec')];
  const bar = document.createElement('nav');
  bar.id = 'tabbar';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Panel sections');
  panel.prepend(bar);
  const btns = secs.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.textContent = (s.querySelector(':scope > h3') || {}).textContent || 'Section';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => select(i));
    bar.appendChild(b);
    return b;
  });
  let cur = 0;
  try { const v = +localStorage.getItem(KEY); if (v >= 0 && v < secs.length) cur = v; } catch { /* storage unavailable */ }
  function select(i, scroll = true) {
    cur = i;
    secs.forEach((s, j) => {
      const on = j === i;
      s.classList.toggle('tabon', on);
      btns[j].classList.toggle('sel', on);
      btns[j].setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panel.scrollTop = 0;
    if (scroll) btns[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    try { localStorage.setItem(KEY, String(i)); } catch { /* storage unavailable */ }
  }
  const apply = () => document.body.classList.toggle('tabbed', mq.matches);
  if (mq.addEventListener) mq.addEventListener('change', apply); else mq.addListener(apply);
  select(cur, false);
  apply();
  return { select };
}
