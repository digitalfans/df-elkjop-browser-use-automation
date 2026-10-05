// PROTOTYPE — injected into every frame of the work Chrome while recording.
// Captures what the Copywriter does, described semantically, and sends it to the recorder.
(() => {
  if (window.__recorderInstalled) return;
  window.__recorderInstalled = true;

  const send = (ev) => {
    try { window.__recordEvent?.(ev); } catch {}
  };
  const clean = (s, n = 80) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

  const TAG_ROLES = {
    BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'img', LI: 'listitem',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', TD: 'cell', TH: 'columnheader',
    NAV: 'navigation', DIALOG: 'dialog', OPTION: 'option', TR: 'row', TABLE: 'table',
  };
  const INPUT_ROLES = {
    checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button',
    range: 'slider', search: 'searchbox', number: 'spinbutton',
  };

  function role(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(' ')[0];
    if (el.tagName === 'INPUT') return INPUT_ROLES[el.type] ?? 'textbox';
    if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : null;
    if (el.isContentEditable) return 'textbox';
    return TAG_ROLES[el.tagName] ?? null;
  }

  // A <label> that wraps its control would otherwise include the control's own text (e.g. a select's options).
  function labelText(l) {
    const copy = l.cloneNode(true);
    copy.querySelectorAll('input,select,textarea,button').forEach((c) => c.remove());
    return copy.textContent;
  }

  function label(el) {
    if (el.labels?.length) return clean([...el.labels].map(labelText).join(' '));
    const by = el.getAttribute('aria-labelledby');
    if (by) return clean(by.split(' ').map((id) => document.getElementById(id)?.innerText ?? '').join(' '));
    return '';
  }

  function accessibleName(el, r) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const l = label(el);
    if (l) return l;
    if (el.alt) return clean(el.alt);
    if (['button', 'link', 'tab', 'menuitem', 'heading', 'option', 'cell', 'listitem', 'checkbox', 'radio'].includes(r)) {
      return clean(el.innerText);
    }
    return clean(el.title);
  }

  const q = (s) => `'${s.replace(/'/g, "\\'")}'`;

  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const r = role(el);
    const name = accessibleName(el, r);
    const lab = label(el);
    const placeholder = el.getAttribute('placeholder') || '';
    const text = clean(el.innerText, 120);
    const testId = el.getAttribute('data-testid') || '';
    let locator;
    if (testId) locator = `getByTestId(${q(testId)})`;
    else if (r && name) locator = `getByRole(${q(r)}, { name: ${q(name)} })`;
    else if (lab) locator = `getByLabel(${q(lab)})`;
    else if (placeholder) locator = `getByPlaceholder(${q(placeholder)})`;
    else if (text) locator = `getByText(${q(clean(text, 60))})`;
    else if (el.id) locator = `locator('#${el.id}')`;
    else locator = `locator('${el.tagName.toLowerCase()}')`;
    return { tag: el.tagName.toLowerCase(), role: r, name, label: lab, placeholder, text, id: el.id || '', testId, locator };
  }

  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role],[contenteditable="true"],[tabindex]';
  const realTarget = (e) => e.composedPath?.()[0] ?? e.target;
  const meaningful = (el) => (el?.closest ? el.closest(INTERACTIVE) ?? el : el);

  const sensitive = (el) =>
    el?.type === 'password' || /password|cc-/.test(el?.getAttribute?.('autocomplete') || '');
  const valueOf = (el) => {
    if (sensitive(el)) return '••••••';
    if (el.isContentEditable) return clean(el.innerText, 1000);
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value?.slice(0, 1000);
  };

  window.addEventListener('click', (e) => {
    send({ type: 'click', target: describe(meaningful(realTarget(e))) });
  }, true);

  window.addEventListener('change', (e) => {
    const el = realTarget(e);
    send({ type: 'change', target: describe(el), value: valueOf(el) });
  }, true);

  // Rich-text editors never fire `change`, so settle their content after a pause in typing.
  const editTimers = new WeakMap();
  window.addEventListener('input', (e) => {
    const el = meaningful(realTarget(e));
    if (!el?.isContentEditable) return;
    clearTimeout(editTimers.get(el));
    editTimers.set(el, setTimeout(() => send({ type: 'edit', target: describe(el), value: valueOf(el) }), 1000));
  }, true);

  window.addEventListener('keydown', (e) => {
    const special = ['Enter', 'Tab', 'Escape'].includes(e.key);
    if (!special && !e.metaKey && !e.ctrlKey) return;
    if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
    const combo = [e.metaKey && 'Meta', e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.key]
      .filter(Boolean).join('+');
    send({ type: 'key', key: combo, target: describe(meaningful(realTarget(e))) });
  }, true);

  for (const type of ['copy', 'cut']) {
    window.addEventListener(type, (e) => {
      send({ type, text: String(getSelection()).slice(0, 2000), target: describe(meaningful(realTarget(e))) });
    }, true);
  }

  window.addEventListener('paste', (e) => {
    send({ type: 'paste', text: e.clipboardData?.getData('text/plain')?.slice(0, 2000) ?? '', target: describe(meaningful(realTarget(e))) });
  }, true);
})();
