export function seatsParseDelimited(text) {
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
  return rows.filter(cells => cells.some(value => String(value).trim()));
}

export function seatsNamesFromRows(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(value => String(value).toLowerCase().replace(/[\s_.-]/g, ''));
  const find = choices => header.findIndex(value => choices.includes(value));
  const full = find(['name', 'fullname', 'displayname', 'hebrewname', 'שם', 'שםמלא']);
  const first = find(['first', 'firstname', 'givenname', 'שםפרטי']);
  const last = find(['last', 'lastname', 'surname', 'familyname', 'שםמשפחה']);
  const hasHeader = full >= 0 || first >= 0 || last >= 0;
  return (hasHeader ? rows.slice(1) : rows).map(row => {
    if (full >= 0) return String(row[full] ?? '').trim();
    if (first >= 0 || last >= 0) return [first >= 0 ? row[first] : '', last >= 0 ? row[last] : ''].filter(Boolean).join(' ').trim();
    return String(row[0] ?? '').trim();
  }).filter(Boolean);
}

export async function seatsReadNames(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file smaller than 5 MB.');
  const ext = file.name.split('.').pop().toLowerCase();
  let rows;
  if (['xlsx', 'xls'].includes(ext)) {
    if (!window.XLSX) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/xlsx-0.20.3.min.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error('Excel import could not load. Try again, or save the spreadsheet as CSV.')); };
      document.head.appendChild(script);
    });
    const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellHTML: false, cellFormula: false, sheetRows: 2002 });
    rows = window.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '', blankrows: false });
  } else if (ext === 'txt') rows = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).map(line => [line]);
  else if (['csv', 'tsv'].includes(ext)) rows = seatsParseDelimited(await file.text());
  else throw new Error('Choose an Excel, CSV, TSV, or text file.');
  const names = seatsNamesFromRows(rows);
  if (names.length > 2000) throw new Error('Import up to 2,000 names at a time.');
  if (!names.length) throw new Error('No names found. Use a Name column, or First name and Last name columns.');
  return names;
}

export function seatsCsvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
