/* Навигация по меню геймпадом.

   На Steam Deck мышь есть только на тачпаде, поэтому экраны «В БОЙ», «ЕЩЁ РАЗ», пауза и хаб
   должны листаться крестовиной и нажиматься кнопкой A. Модуль держит выбранный элемент,
   подсвечивает его классом `padsel` и жмёт по menuOk.

   Использование: `const menu = makePadMenu();` и в кадре `menu(gamepad, видимыйЭкранИлиNull)`. */

const FOCUSABLE = 'button, a[href], select, input:not([type=hidden]), textarea, .btn';

const shown = el => {
  if (el.hidden || el.disabled) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export function makePadMenu() {
  let sel = null;

  const mark = el => {
    if (sel === el) return;
    if (sel) sel.classList.remove('padsel');
    sel = el;
    if (sel) {
      sel.classList.add('padsel');
      try { sel.focus({ preventScroll: false }); } catch (e) { /* input может не принимать фокус */ }
      sel.scrollIntoView?.({ block: 'nearest' });
    }
  };

  return function update(gp, root) {
    if (!root || !gp.connected) { if (sel) mark(null); return; }
    const items = Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), shown);
    if (!items.length) { mark(null); return; }

    let i = items.indexOf(sel);
    if (i < 0) { mark(items[0]); i = 0; }

    const step = (gp.menuDown ? 1 : 0) - (gp.menuUp ? 1 : 0);
    if (step) mark(items[(i + step + items.length) % items.length]);

    // левый/правый на ползунке и выпадающем списке меняют значение, а не выбор
    const horiz = (gp.menuRight ? 1 : 0) - (gp.menuLeft ? 1 : 0);
    if (horiz && sel) {
      const t = sel.tagName === 'INPUT' ? sel.type : sel.tagName === 'SELECT' ? 'select' : '';
      if (t === 'range') {
        const stepV = +sel.step || 1;
        sel.value = String(Math.min(+sel.max || 100, Math.max(+sel.min || 0, +sel.value + horiz * stepV)));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (t === 'select') {
        const n = sel.options.length;
        if (n) { sel.selectedIndex = (sel.selectedIndex + horiz + n) % n; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    }

    if (gp.menuOk && sel) {
      const t = sel.tagName === 'INPUT' ? sel.type : '';
      if (t === 'checkbox') { sel.checked = !sel.checked; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      else sel.click();
    }
  };
}
