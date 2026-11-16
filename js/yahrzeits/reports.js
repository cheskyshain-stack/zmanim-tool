import { calendarISO } from '../calendar/model.js';
import { jewishDateString } from '../hebrew-calendar.js';
import { seatsLoadSpreadsheet } from '../seats/import.js';
import { escAttr, escText } from '../util.js';
import { yahrzeitListDays, yahrzeitListRange, yahrzeitRangeOptions } from './list.js';
import { yahrzeitMonthLabel, yahrzeitRelationship } from './model.js';

const rangeColumns = ['English date', 'Hebrew date', 'Congregation member', 'Relationship', 'Name of the deceased'];
const excelMaxRows = 1_048_576;

function reportRows(members, range) {
  const rows = [];
  for (const { serial, entries } of yahrzeitListDays(members, range)) {
    const date = calendarISO(serial);
    const hebrew = jewishDateString(serial, false);
    for (const { member, entry } of entries) {
      if (rows.length === excelMaxRows - 1) throw new Error('This range has too many entries for one report. Choose a shorter range.');
      rows.push([date, hebrew, member.name, yahrzeitRelationship(entry), entry.deceasedName]);
    }
  }
  return rows;
}

async function downloadWorkbook(filename, sheets) {
  const xlsx = await seatsLoadSpreadsheet();
  const book = xlsx.utils.book_new();
  for (const [name, widths, rows] of sheets) {
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet['!cols'] = widths.map(wch => ({ wch }));
    xlsx.utils.book_append_sheet(book, sheet, name);
  }
  xlsx.writeFile(book, filename, { compression: true });
}

export async function exportYahrzeitMembers(members, button, status) {
  button.disabled = true;
  status.textContent = '';
  try {
    const directory = [['Congregation member', 'Address'], ...members.map(member => [member.name, member.address])];
    const observances = [['Congregation member', 'Address', 'Relationship', 'Name of the deceased', 'Hebrew day', 'Hebrew month', 'Adar preference', 'When the month has only 29 days']];
    for (const member of members) {
      for (const entry of member.observances) {
        observances.push([member.name, member.address, yahrzeitRelationship(entry), entry.deceasedName,
          entry.day, yahrzeitMonthLabel(entry.month), entry.adar, entry.shortMonth]);
      }
    }
    await downloadWorkbook('yahrzeit-members.xlsx', [
      ['Members', [28, 40], directory],
      ['Yahrzeits by member', [28, 40, 20, 34, 13, 24, 18, 35], observances],
    ]);
  } catch (error) {
    status.textContent = error.message || 'The member export could not be created.';
  } finally {
    button.disabled = false;
  }
}

function printReport(root, rows, start, end) {
  root.querySelector('.yr-print-sheet')?.remove();
  const sheet = document.createElement('section');
  sheet.className = 'yr-print-sheet';
  sheet.innerHTML = `<h1>Yahrzeits</h1><p>${start === end ? start : start + ' to ' + end}</p>
    ${rows.length ? `<table><thead><tr>${rangeColumns.map(col => `<th scope="col">${col}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(value => `<td dir="auto">${escText(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p>No yahrzeits in this date range.</p>'}`;
  root.append(sheet);
  window.addEventListener('afterprint', () => sheet.remove(), { once: true });
  window.print();
}

export function openYahrzeitReports({ show, dialog, members, today, tables, selection }) {
  const options = yahrzeitRangeOptions(today(), tables).filter(([value]) => value !== 'today');
  const preset = options.some(([value]) => value === selection?.preset) ? selection.preset : 'hebrew-year';
  show('Print or export', `<form class="yr-import-controls">
    <label>Date range<select name="preset">${options.map(([value, text]) => `<option value="${value}" ${value === preset ? 'selected' : ''}>${escText(text)}</option>`).join('')}</select></label>
    <div class="yr-report-dates" data-yr-report-dates hidden>
      <label>From<input name="from" type="date" min="1900-01-01" max="2299-12-31" value="${escAttr(selection?.from || today())}" required></label>
      <label>To<input name="to" type="date" min="1900-01-01" max="2299-12-31" value="${escAttr(selection?.to || today())}" required></label>
    </div>
    <div class="yr-dialog-actions">
      <button class="cal-primary" type="submit" value="print">Print</button>
      <button type="submit" value="excel">Export dates to Excel</button>
    </div>
    <div class="yr-report-member-export"><button type="button" data-yr-directory>Export all members</button></div>
    <p class="yr-status" role="status"></p>
  </form>`);
  const form = dialog.querySelector('form'), dates = form.querySelector('[data-yr-report-dates]'), status = form.querySelector('[role=status]');
  const directory = form.querySelector('[data-yr-directory]');
  directory.addEventListener('click', () => exportYahrzeitMembers(members, directory, status));
  function updateRange() {
    const custom = form.elements.preset.value === 'custom';
    dates.hidden = !custom;
    form.elements.from.disabled = form.elements.to.disabled = !custom;
    status.textContent = '';
  }
  form.elements.preset.addEventListener('change', updateRange);
  updateRange();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const range = yahrzeitListRange(form.elements.preset.value, today(), form.elements.from.value, form.elements.to.value);
    if (!range) { status.textContent = 'Choose a From date and a To date in order.'; return; }
    const button = event.submitter;
    if (button) button.disabled = true;
    status.textContent = '';
    try {
      const start = calendarISO(range.start), end = calendarISO(range.end);
      const rows = reportRows(members, range);
      if (button?.value === 'excel') {
        await downloadWorkbook(`yahrzeits-${start}-to-${end}.xlsx`, [
          ['By date', [14, 22, 28, 20, 34], [rangeColumns, ...rows]],
          ['By member', [14, 22, 28, 20, 34], [rangeColumns, ...rows.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]))]],
        ]);
      } else {
        printReport(dialog.parentElement, rows, start, end);
      }
    } catch (error) {
      status.textContent = error.message || 'The yahrzeit report could not be created.';
    } finally {
      if (button) button.disabled = false;
    }
  });
}
