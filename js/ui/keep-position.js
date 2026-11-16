// Redraw controls in place, including their open panels and keyboard focus.
// Restore synchronously so a later user scroll or page navigation is never undone.
function findAgain(root, element) {
  if (!element || !root.contains(element)) return () => null;
  const tag = element.tagName.toLowerCase();
  const quote = value => CSS.escape(String(value));
  const row = element.closest('[data-id]');
  const rowId = row?.dataset.id;
  let selector;
  if (element.id) selector = `#${quote(element.id)}`;
  else if (element.name) selector = `${tag}[name="${quote(element.name)}"]`
    + (/^(radio|checkbox)$/.test(element.type) ? `[value="${quote(element.value)}"]` : '');
  else {
    const data = [...element.attributes].find(attr => attr.name.startsWith('data-'));
    const classes = [...element.classList].filter(name => !/^(is-|active$)/.test(name));
    selector = data ? `${tag}[${data.name}="${quote(data.value)}"]`
      : tag + classes.map(name => `.${quote(name)}`).join('');
  }
  const text = element.textContent;
  return () => {
    if (root.contains(element)) return element;
    const scope = rowId ? root.querySelector(`[data-id="${quote(rowId)}"]`) : root;
    const matches = [...(scope?.querySelectorAll(selector) || [])];
    return matches.length === 1 ? matches[0] : matches.find(el => el.textContent === text) || null;
  };
}

function visibleControl(root, control) {
  if (control?.matches('input[type=radio],input[type=checkbox]')) {
    return control.closest('label') || (control.id && root.querySelector(`label[for="${CSS.escape(control.id)}"]`)) || control;
  }
  return control;
}

export function keepPosition(root, draw, { panels = true, focus = true } = {}) {
  const x = window.scrollX, y = window.scrollY;
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const findControl = findAgain(root, active);
  const before = visibleControl(root, active)?.getBoundingClientRect();
  const anchored = before && before.height > 0 && before.top >= 0 && before.bottom <= window.innerHeight;
  const expanded = panels ? [...root.querySelectorAll('details')].map(el => ({
    find: findAgain(root, el), title: el.querySelector(':scope > summary')?.textContent, open: el.open,
  })) : [];
  const ancestors = [];
  for (let panel = root.parentElement?.closest('details'); panel; panel = panel.parentElement?.closest('details')) ancestors.push(panel);
  const stages = expanded.length || ancestors.length ? [root, ...ancestors].map(element => ({
    element, restoring: element.classList.contains('is-restoring-position'),
  })) : [];
  stages.forEach(({ element }) => element.classList.add('is-restoring-position'));
  try {
    return draw();
  } finally {
    if (root.isConnected) {
      // Some views replace className as well as their content. Restored open panels
      // must already have their full height when the position is measured.
      stages.forEach(({ element }) => element.classList.add('is-restoring-position'));
      for (const panel of expanded) {
        const same = panel.find() || [...root.querySelectorAll('details')]
          .find(el => el.querySelector(':scope > summary')?.textContent === panel.title);
        if (same) same.open = panel.open;
      }
      const same = findControl();
      if (focus) {
        const target = same?.disabled
          ? same.closest('.poster-year-step,.week-nav-row,[role=group]')?.querySelector('button:not(:disabled),select:not(:disabled)')
            || root.querySelector('button:not(:disabled),select:not(:disabled)')
          : same;
        target?.focus({ preventScroll: true });
      }
      const after = visibleControl(root, same)?.getBoundingClientRect();
      const nextY = anchored && after?.height ? window.scrollY + after.top - before.top : y;
      window.scrollTo({ left: x, top: nextY, behavior: 'instant' });
    }
    stages.forEach(({ element, restoring }) => element.classList.toggle('is-restoring-position', restoring));
  }
}
