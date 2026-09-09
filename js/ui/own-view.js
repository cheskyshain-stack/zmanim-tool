// The editor for a sheet the shul writes itself. See posters/own.js for what a sheet is.
//
// Pickers rather than a page of empty boxes, which is what was asked for: the block's day,
// its heading, every row's name, and the זמן a row hangs off are all chosen from a list, and
// anything the list has not got is typed instead. Nothing here is free text that has to be
// spelled a particular way to work.
//
// It writes straight into the sheet in state and hands back to the Posters tab, which redraws
// the paper underneath: the chart on screen is the sheet as it will print, at every keystroke,
// so there is nothing to preview and nothing to save.
import { newId } from '../storage.js';
import { escText } from '../util.js';
import {
  OWN_MONTHS, OWN_ZMANIM, OWN_ROUNDING, OWN_LABELS, OWN_HEADINGS,
  ownBlankBlock, ownBlankRow, ownRuleText,
} from '../posters/own.js';

/** A fresh sheet, under the occasion the picker is on. */
export function newOwnSheet(group) {
  return { id: newId('own'), name: group || '', group, blocks: [ownBlankBlock()] };
}

/** A select whose list is a set of words, with "Other" at the foot for anything else.
 *
 *  Two controls in one: the list, and a box that appears beside it holding whatever was
 *  typed. The box is not hidden when the value is off the list, which is the whole point of
 *  it: a sheet imported from another shul, or a name typed once and picked again later, has
 *  to be editable without being retyped. */
function wordPicker(cls, value, words, placeholder) {
  const known = words.includes(value);
  return `<span class="own-word">
      <select class="${cls}-pick" aria-label="${escText(placeholder)}">
        ${words.map((w) => `<option value="${escText(w)}" ${known && w === value ? 'selected' : ''}>${escText(w)}</option>`).join('')}
        <option value="" ${known ? '' : 'selected'}>Something else…</option>
      </select>
      <input class="${cls}-text" value="${escText(value)}" placeholder="${escText(placeholder)}"
        ${known ? 'hidden' : ''} aria-label="${escText(placeholder)}">
    </span>`;
}

/** One row: its name, then either what to type or what to hang it off. */
function rowHtml(row, bi, ri) {
  const zman = row.mode === 'zman';
  return `<div class="own-row" data-block="${bi}" data-row="${ri}">
      ${wordPicker('own-label', row.label || '', OWN_LABELS, 'Name of the line')}
      <select class="own-mode" aria-label="Where the time comes from">
        <option value="typed" ${zman ? '' : 'selected'}>Times I type</option>
        <option value="zman" ${zman ? 'selected' : ''}>Off a זמן</option>
      </select>
      <input class="own-text" value="${escText(row.text || '')}" ${zman ? 'hidden' : ''}
        placeholder="7:00, 7:20*, &lt;u&gt;7:35&lt;/u&gt;" aria-label="The times">
      <span class="own-rule" ${zman ? '' : 'hidden'}>
        <input class="own-offset" type="number" step="1" value="${Number(row.offset) || 0}" aria-label="Minutes">
        <select class="own-side" aria-label="Before or after">
          <option value="before" ${(Number(row.offset) || 0) <= 0 ? 'selected' : ''}>minutes before</option>
          <option value="after" ${(Number(row.offset) || 0) > 0 ? 'selected' : ''}>minutes after</option>
        </select>
        <select class="own-zman" aria-label="Which זמן">
          ${OWN_ZMANIM.map((z) => `<option value="${z.key}" ${row.zman === z.key ? 'selected' : ''}>${escText(z.label)}</option>`).join('')}
        </select>
        <select class="own-round" aria-label="Rounding">
          ${OWN_ROUNDING.map((r) => `<option value="${r.key}" ${row.round === r.key ? 'selected' : ''}>${escText(r.label)}</option>`).join('')}
        </select>
      </span>
      <button type="button" class="own-del-row" title="Take this line off">&times;</button>
    </div>`;
}

/** One block: the day it is, what it is called, and its lines. */
function blockHtml(block, bi) {
  return `<fieldset class="own-block" data-block="${bi}">
      <legend>Block ${bi + 1}</legend>
      <div class="own-block-head">
        ${wordPicker('own-head', block.heading || '', OWN_HEADINGS, 'Heading over the block')}
        <span class="own-date">
          <select class="own-day" aria-label="Day of the month">
            ${Array.from({ length: 30 }, (_, i) => i + 1).map((d) =>
              `<option value="${d}" ${Number(block.day) === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <select class="own-month" aria-label="Month">
            ${OWN_MONTHS.map((m) => `<option value="${m.value}" ${Number(block.month) === m.value ? 'selected' : ''}>${escText(m.name)}</option>`).join('')}
          </select>
        </span>
        <button type="button" class="own-del-block" title="Take this block off">Remove block</button>
      </div>
      <div class="own-rows">${(block.rows || []).map((r, ri) => rowHtml(r, bi, ri)).join('')}</div>
      <div class="own-block-foot">
        <button type="button" class="own-add-row">+ Add a line</button>
        <span class="hint own-when"></span>
      </div>
    </fieldset>`;
}

/** The editor for one sheet.
 *
 *  `onChange` saves and redraws the paper. `onDelete` takes the whole sheet away. Both are
 *  the Posters tab's, because this panel knows about a sheet and not about the tab it is on.
 */
export function renderOwnEditor(container, sheet, occasions, { onChange, onDelete }) {
  container.innerHTML = `
    <details class="own-editor panel no-print" open>
      <summary>Writing this sheet</summary>
      <p class="hint">A block is a day and its lines. The day is a Hebrew date, so the sheet is for the occasion and not for one year: step the year above and every block moves with it. A line's times are either typed the way a chart writes them (commas between מנינים, <code>*</code> for בעזרת נשים, <code>&lt;u&gt;</code> for למטה) or hung off a זמן, which is worked out from the same calculations the boards use.</p>
      <div class="own-top">
        <label>What the sheet is called<input class="own-name" value="${escText(sheet.name || '')}" placeholder="e.g. חנוכה"></label>
        <label>Where it sits in the year<select class="own-group">
          ${occasions.map((o) => `<option value="${escText(o)}" ${sheet.group === o ? 'selected' : ''}>${escText(o)}</option>`).join('')}
        </select></label>
      </div>
      <div class="own-blocks">${(sheet.blocks || []).map(blockHtml).join('')}</div>
      <div class="actions">
        <button type="button" class="own-add-block btn-primary">+ Add a block</button>
        <button type="button" class="own-delete secondary-btn">Delete this sheet</button>
      </div>
    </details>`;

  const at = (el) => {
    const b = Number(el.closest('.own-block').dataset.block);
    const rowEl = el.closest('.own-row');
    return { block: sheet.blocks[b], row: rowEl ? sheet.blocks[b].rows[Number(rowEl.dataset.row)] : null };
  };
  /* Two ways back from a change. `soft` writes the value and redraws the paper, leaving this
     panel exactly as it is, which is what typing into a box needs: a redraw of the editor
     would take the caret with it. `hard` redraws the panel too, for the changes that alter
     what controls are on it. */
  const soft = () => { refreshWhen(); onChange(false); };
  const hard = () => onChange(true);

  /* What each block's rule rows come to, said in words under the block. It is the one thing
     on this panel that is not a control: a row reading "20 minutes before שקיעה" is easy to
     get the wrong way round, and the sheet beside it only shows the answer.
     Written again on every change, including the ones that leave the panel standing: minutes
     are typed into a box, which is a soft change, and this line saying 15 while the box said
     20 would be worse than not having it. */
  const refreshWhen = () => {
    container.querySelectorAll('.own-block').forEach((el, bi) => {
      const rules = (sheet.blocks[bi]?.rows || []).filter((r) => r.mode === 'zman');
      el.querySelector('.own-when').textContent = rules.length
        ? rules.map((r) => `${r.label}: ${ownRuleText(r)}`).join(' · ') : '';
    });
  };

  const on = (sel, event, fn) => container.querySelectorAll(sel).forEach((el) => el.addEventListener(event, () => fn(el)));

  on('.own-name', 'input', (el) => { sheet.name = el.value; soft(); });
  on('.own-group', 'change', (el) => { sheet.group = el.value; hard(); });

  // A word picker: choosing a word off the list writes it and hides the box; choosing
  // "Something else…" opens the box on what is there and puts the caret in it.
  const wordPair = (pickSel, textSel, write) => {
    on(pickSel, 'change', (el) => {
      const box = el.parentElement.querySelector(textSel);
      if (el.value) { box.value = el.value; box.hidden = true; } else { box.hidden = false; box.focus(); }
      write(el, box.value);
      soft();
    });
    on(textSel, 'input', (el) => { write(el, el.value); soft(); });
  };
  wordPair('.own-head-pick', '.own-head-text', (el, value) => { at(el).block.heading = value; });
  wordPair('.own-label-pick', '.own-label-text', (el, value) => { at(el).row.label = value; });

  on('.own-day', 'change', (el) => { at(el).block.day = Number(el.value); soft(); });
  on('.own-month', 'change', (el) => { at(el).block.month = Number(el.value); soft(); });
  on('.own-mode', 'change', (el) => { at(el).row.mode = el.value; hard(); });
  on('.own-text', 'input', (el) => { at(el).row.text = el.value; soft(); });
  on('.own-zman', 'change', (el) => { at(el).row.zman = el.value; soft(); });
  on('.own-round', 'change', (el) => { at(el).row.round = el.value; soft(); });
  // The minutes and the side of the זמן are one number here and two controls on screen, which
  // is the way round that reads: nobody writes "minus twenty minutes before שקיעה".
  const setOffset = (el) => {
    const box = el.closest('.own-rule');
    const mins = Math.abs(Number(box.querySelector('.own-offset').value) || 0);
    at(el).row.offset = box.querySelector('.own-side').value === 'before' ? -mins : mins;
    soft();
  };
  on('.own-offset', 'input', setOffset);
  on('.own-side', 'change', setOffset);

  on('.own-add-row', 'click', (el) => { at(el).block.rows.push(ownBlankRow()); hard(); });
  on('.own-del-row', 'click', (el) => {
    const b = Number(el.closest('.own-block').dataset.block);
    sheet.blocks[b].rows.splice(Number(el.closest('.own-row').dataset.row), 1);
    hard();
  });
  on('.own-add-block', 'click', () => { sheet.blocks.push(ownBlankBlock()); hard(); });
  on('.own-del-block', 'click', (el) => {
    sheet.blocks.splice(Number(el.closest('.own-block').dataset.block), 1);
    hard();
  });
  on('.own-delete', 'click', () => {
    if (confirm('Delete this sheet? Everything typed on it goes with it.')) onDelete();
  });

  refreshWhen();
}
