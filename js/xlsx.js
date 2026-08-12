// A minimal .xlsx writer, so the Weekday chart can be handed to someone who doesn't have
// this app: they open it in Excel, type the מנחה and שחרית times into the cells, and
// print. Machines that block browsers almost always still allow Office.
//
// Written by hand rather than with a library because the app has no build step and no
// dependencies, and the offline copy has to keep working from a USB stick with no
// network. An .xlsx is a ZIP of XML parts, and only a handful of those parts are
// actually required, so this comes to less code than pulling in a bundler would.
//
// The ZIP entries are stored uncompressed (method 0), which the format allows and every
// reader accepts. That removes the need for a deflate implementation; these files are a
// few KB either way.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (str) => new TextEncoder().encode(str);

/** Builds a ZIP from [{name, text}] entries. */
function zip(entries) {
  const files = entries.map((e) => {
    const name = utf8(e.name);
    const data = utf8(e.text);
    return { name, data, crc: crc32(data) };
  });
  const chunks = [];
  let offset = 0;
  const central = [];

  const num = (n, bytes) => {
    const out = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) out[i] = (n >>> (i * 8)) & 0xff;
    return out;
  };
  const push = (arr) => {
    chunks.push(arr);
    offset += arr.length;
  };

  for (const f of files) {
    const localOffset = offset;
    // Bit 11 of the flags marks the name as UTF-8. Date/time are left at zero; readers
    // show an epoch timestamp for the entries, which nothing here cares about.
    push(num(0x04034b50, 4));
    push(num(20, 2));
    push(num(0x0800, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(f.crc, 4));
    push(num(f.data.length, 4));
    push(num(f.data.length, 4));
    push(num(f.name.length, 2));
    push(num(0, 2));
    push(f.name);
    push(f.data);
    central.push({ ...f, localOffset });
  }

  const cdStart = offset;
  for (const f of central) {
    push(num(0x02014b50, 4));
    push(num(20, 2));
    push(num(20, 2));
    push(num(0x0800, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(f.crc, 4));
    push(num(f.data.length, 4));
    push(num(f.data.length, 4));
    push(num(f.name.length, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(0, 2));
    push(num(0, 4));
    push(num(f.localOffset, 4));
    push(f.name);
  }
  const cdSize = offset - cdStart;

  push(num(0x06054b50, 4));
  push(num(0, 2));
  push(num(0, 2));
  push(num(files.length, 2));
  push(num(files.length, 2));
  push(num(cdSize, 4));
  push(num(cdStart, 4));
  push(num(0, 2));

  return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** XML text escaping. Named xmlEsc rather than esc because the offline build flattens
 *  every module into one shared scope. */
function xmlEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel rejects the control characters XML forbids outright. Tab and newline stay:
    // a cell's line breaks are how the שחרית schedule keeps its shape.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Plain text out of the app's stored rich text, keeping the line breaks. */
export function htmlToText(html) {
  const el = document.createElement('div');
  el.innerHTML = String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n');
  return el.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const colName = (i) => String.fromCharCode(65 + i);

/** Style ids, matching the cellXfs order in STYLES below. */
const S = { plain: 0, title: 1, subtitle: 2, header: 3, cell: 4, week: 5, tall: 6, note: 7 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Arial"/></font>
<font><b/><sz val="18"/><name val="Arial"/></font>
<font><sz val="12"/><name val="Arial"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><b/><sz val="11"/><name val="Arial"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF54595F"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F2F5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
</styleSheet>`;

/** One worksheet. `rows` is [[{v, s, merge}]] where merge is a column span, and
 *  `downMerges` are extra vertical merges given as {col, row, span} in 1-based terms. */
function sheetXml(rows, widths, downMerges) {
  const merges = [];
  const body = rows
    .map((cells, r) => {
      const rowNum = r + 1;
      const xml = cells
        .map((cell, c) => {
          if (!cell) return '';
          const ref = colName(c) + rowNum;
          if (cell.merge > 1) merges.push(`${ref}:${colName(c + cell.merge - 1)}${rowNum}`);
          const style = cell.s ?? S.plain;
          if (cell.v === '' || cell.v == null) return `<c r="${ref}" s="${style}"/>`;
          return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
        })
        .join('');
      const h = cells.height ? ` ht="${cells.height}" customHeight="1"` : '';
      return `<row r="${rowNum}"${h}>${xml}</row>`;
    })
    .join('');

  for (const m of downMerges) merges.push(`${colName(m.col)}${m.row}:${colName(m.col)}${m.row + m.span - 1}`);

  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '';

  // rightToLeft puts column A on the right, so the sheet reads the way the printed board
  // does. fitToWidth keeps a page on one sheet of paper across.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
${mergeXml}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="1"/>
</worksheet>`;
}

/** Assembles the workbook parts around the given worksheets and returns a Blob. */
function workbook(sheets) {
  const n = sheets.length;
  const parts = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', text: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
  ];
  return zip(parts);
}

/** The Weekday chart as a workbook: one worksheet per printed page, laid out like the
 *  board, with the מנחה and מעריב cells empty and שחרית as one merged block, so whoever
 *  receives it types the times straight in. */
export function weekdayWorkbookBlob(sheet, settings, pages) {
  const shacharis = htmlToText(settings.weekdayShacharis);
  const sheets = pages.map((weeks, pageIndex) => {
    const rows = [];
    const wide = (v, s) => [{ v, s, merge: 4 }, null, null, null];

    rows.push(Object.assign(wide(settings.shulName, S.title), { height: 30 }));
    rows.push(wide(settings.headerSubtitle, S.subtitle));
    rows.push([]);
    rows.push(
      Object.assign(
        [
          { v: 'Weekday זמנים', s: S.header },
          { v: 'שחרית', s: S.header },
          { v: 'מנחה', s: S.header },
          { v: 'מעריב', s: S.header },
        ],
        { height: 30 }
      )
    );

    const firstWeekRow = rows.length + 1;
    weeks.forEach((week, i) => {
      const name = week.parsha + (week.specialParsha ? '\n' + week.specialParsha : '');
      rows.push(
        Object.assign(
          [
            { v: name, s: S.week },
            // Only the first row carries the value; the rest are the merged block's
            // covered cells and must still exist so the borders draw.
            { v: i === 0 ? shacharis : '', s: S.tall },
            { v: '', s: S.cell },
            { v: '', s: S.cell },
          ],
          { height: 26 }
        )
      );
    });

    rows.push([]);
    rows.push(wide(htmlToText(settings.weekdayFooterNote).replace(/\n/g, '  '), S.note));
    rows.push(wide(settings.footerAddress, S.note));

    const downMerges = weeks.length > 1 ? [{ col: 1, row: firstWeekRow, span: weeks.length }] : [];
    return {
      name: pages.length > 1 ? `Page ${pageIndex + 1}` : 'Weekday',
      xml: sheetXml(rows, [22, 30, 22, 22], downMerges),
    };
  });
  return workbook(sheets);
}

/** Triggers the download. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
