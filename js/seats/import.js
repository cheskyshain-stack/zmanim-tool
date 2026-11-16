export function seatsParseDelimited(text, keepBlankRows = false) {
  const input = String(text).replace(/^\uFEFF/, '');
  const line = input.split(/\r?\n/)[0];
  const delimiter = ['\t', ';', ','].sort((a, b) => line.split(b).length - line.split(a).length)[0];
  const rows = [], row = [];
  let cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push([...row]); row.length = 0; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('The CSV has an unclosed quote. Check the file and try again.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return keepBlankRows ? rows : rows.filter(cells => cells.some(value => String(value).trim()));
}

export function seatsNamesFromRows(rows) {
  if (!rows.length) return [];
  let full = -1, first = -1, last = -1, headerRow = -1;
  for (let index = 0; index < Math.min(rows.length, 50); index++) {
    const header = rows[index].map(value => String(value).toLowerCase().replace(/[\s_.-]/g, ''));
    const find = choices => header.findIndex(value => choices.includes(value));
    full = find(['name', 'fullname', 'displayname', 'hebrewname', 'שם', 'שםמלא']);
    first = find(['first', 'firstname', 'givenname', 'שםפרטי']);
    last = find(['last', 'lastname', 'surname', 'familyname', 'שםמשפחה']);
    if (full >= 0 || first >= 0 || last >= 0) { headerRow = index; break; }
  }
  return rows.slice(headerRow + 1).map(row => {
    if (full >= 0) return String(row[full] ?? '').trim();
    if (first >= 0 || last >= 0) return [first >= 0 ? row[first] : '', last >= 0 ? row[last] : ''].filter(Boolean).join(' ').trim();
    return String(row[0] ?? '').trim();
  }).filter(name => /\p{L}/u.test(name));
}

let seatsSpreadsheetLoader;
export function seatsLoadSpreadsheet() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  seatsSpreadsheetLoader ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/xlsx-0.20.3.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => {
      script.remove();
      seatsSpreadsheetLoader = null;
      reject(new Error('Excel support could not load. Try again.'));
    };
    document.head.appendChild(script);
  });
  return seatsSpreadsheetLoader;
}

export async function seatsReadSpreadsheetRows(file, { keepBlankRows = false } = {}) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file smaller than 5 MB.');
  const ext = file.name.split('.').pop().toLowerCase();
  let rows;
  if (['xlsx', 'xls'].includes(ext)) {
    const xlsx = await seatsLoadSpreadsheet().catch(() => {
      throw new Error('Excel import could not load. Try again, or save the spreadsheet as CSV.');
    });
    const book = xlsx.read(await file.arrayBuffer(), { type: 'array', cellHTML: false, cellFormula: false, sheetRows: 2052 });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error('The workbook has no sheets.');
    rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: keepBlankRows });
  } else if (ext === 'txt') rows = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).map(line => [line]);
  else if (['csv', 'tsv'].includes(ext)) rows = seatsParseDelimited(await file.text(), keepBlankRows);
  else throw new Error('Choose an Excel, CSV, TSV, or text file.');
  return rows;
}

export async function seatsReadNames(file) {
  const names = seatsNamesFromRows(await seatsReadSpreadsheetRows(file));
  if (names.length > 2000) throw new Error('Import up to 2,000 names at a time.');
  if (!names.length) throw new Error('No names found. Use a Name column, or First name and Last name columns.');
  return names;
}

export function seatsCsvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
