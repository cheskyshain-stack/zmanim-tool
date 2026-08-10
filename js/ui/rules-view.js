import { newId } from '../storage.js';
import { KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { CHOREF_COLUMNS } from '../sheets/choref.js';

export function renderRules(container, state, onChange) {
  container.innerHTML = `
    <h2>Rules</h2>
    <p class="hint">Reusable, recurring overrides — they apply automatically every time a sheet is generated (unlike per-cell overrides on a generated sheet, which are one-off). Match on the special-Shabbos name (e.g. שובה / הגדול), the parsha name, or "always", and replace one or more cells' text — pick any column from either chart, so a single rule can cover both שבת קיץ and שבת חורף at once.</p>
    <div id="rules-list"></div>
    <h3>Add a rule</h3>
    <form id="rule-form" class="form-grid">
      <label>Name<input name="name" required placeholder="e.g. שבת נחמו — מנחה"></label>
      <fieldset>
        <legend>When does this apply?</legend>
        <label><input type="checkbox" name="always"> Always (every week)</label>
        <label>Special-Shabbos name(s), comma-separated<input name="specialParsha" placeholder="e.g. שובה, הגדול"></label>
        <label>Or parsha name(s), comma-separated<input name="parsha" placeholder="optional"></label>
      </fieldset>
      <fieldset>
        <legend>Which cell(s) to replace</legend>
        <p class="hint">Check the equivalent cell on both charts if it's the same real-world minyan (e.g. "Mincha Erev Shabbos" is column L on קיץ and column I on חורף) — one rule then covers both, without touching any other cell.</p>
        ${columnChecklist('שבת קיץ', 'kayitz', KAYITZ_COLUMNS)}
        ${columnChecklist('שבת חורף', 'choref', CHOREF_COLUMNS)}
      </fieldset>
      <fieldset>
        <legend>What to do to the cell</legend>
        <label><input type="radio" name="mode" value="append" checked> Add this text onto the computed value (e.g. add the word "דרשה" without losing the times)</label>
        <label><input type="radio" name="mode" value="replace"> Replace the cell's computed value entirely with this text</label>
        <label>Text<textarea name="value" rows="2" placeholder="דרשה" required></textarea></label>
      </fieldset>
      <div class="actions"><button type="submit">Add rule</button></div>
    </form>
  `;

  const list = container.querySelector('#rules-list');
  list.innerHTML = state.rules.length
    ? state.rules
        .map(
          (r) => `
      <div class="rule-row" data-id="${r.id}">
        <label><input type="checkbox" class="rule-enabled" ${r.enabled ? 'checked' : ''}></label>
        <div class="rule-summary">
          <strong>${esc(r.name)}</strong> — columns <code>${esc(columnsOf(r).map(prettyColumn).join(', '))}</code>
          <div class="hint">${conditionSummary(r.condition)} → ${r.mode === 'replace' ? 'replace with' : 'add'} "${esc(r.value)}"</div>
        </div>
        <button class="rule-delete" title="Delete rule">Delete</button>
      </div>`
        )
        .join('')
    : '<p class="hint">No rules yet.</p>';

  list.querySelectorAll('.rule-enabled').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.rule-row').dataset.id;
      state.rules.find((r) => r.id === id).enabled = e.target.checked;
      onChange();
    });
  });
  list.querySelectorAll('.rule-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('.rule-row').dataset.id;
      state.rules = state.rules.filter((r) => r.id !== id);
      onChange();
      renderRules(container, state, onChange);
    });
  });

  container.querySelector('#rule-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const condition = {};
    if (fd.get('always') === 'on') condition.always = true;
    const specialParsha = splitCsv(fd.get('specialParsha'));
    const parsha = splitCsv(fd.get('parsha'));
    if (specialParsha.length) condition.specialParsha = specialParsha;
    if (parsha.length) condition.parsha = parsha;
    const columnKeys = fd.getAll('columnKeys');
    if (!columnKeys.length) {
      alert('Pick at least one cell/column for this rule to affect.');
      return;
    }
    state.rules.push({
      id: newId('rule'),
      name: fd.get('name'),
      enabled: true,
      condition,
      columnKeys,
      mode: fd.get('mode') || 'append',
      value: fd.get('value'),
    });
    onChange();
    renderRules(container, state, onChange);
  });
}

function columnChecklist(sheetLabel, seasonKey, columns) {
  return `
    <div class="col-group">
      <div class="col-group-title">${sheetLabel}</div>
      ${columns
        .map(
          (c) =>
            `<label class="col-check"><input type="checkbox" name="columnKeys" value="${seasonKey}:${c.key}"> ${esc(c.header.replace(/\n/g, ' '))} <span class="hint">(${c.key})</span></label>`
        )
        .join('')}
    </div>
  `;
}
function columnsOf(rule) {
  return Array.isArray(rule.columnKeys) ? rule.columnKeys : rule.columnKey ? [rule.columnKey] : [];
}
function prettyColumn(entry) {
  if (!entry.includes(':')) return entry;
  const [season, key] = entry.split(':');
  return (season === 'kayitz' ? 'קיץ' : 'חורף') + ' ' + key;
}
function splitCsv(str) {
  return (str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function conditionSummary(c) {
  const parts = [];
  if (c.always) parts.push('always');
  if (c.specialParsha) parts.push('special Shabbos: ' + c.specialParsha.join(', '));
  if (c.parsha) parts.push('parsha: ' + c.parsha.join(', '));
  if (c.dateISO) parts.push('date: ' + c.dateISO.join(', '));
  return parts.join(' or ') || '(no condition — never matches)';
}
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
