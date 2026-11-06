'use strict';
/**
 * kosmos#8122: workbooks built byte for byte with the repo's own zip writer (engine/zipwrite.js), for the spreadsheet
 * preview's tests. The same builder as engine/xlsxpreview.test.js, shared so the route tests make the same files.
 */
const zlib = require('node:zlib');
const { localHeader, centralRecord, endRecord } = require('../engine/zipwrite');

/* A zip of { name: text } parts, stored. */
function zip(parts) {
  const chunks = [], central = [];
  let offset = 0;
  const mtime = new Date('2026-11-06T12:00:00Z');
  for (const [name, text] of Object.entries(parts)) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const entry = { name, isDir: false, size: data.length, crc: zlib.crc32(data) >>> 0, mtime, mode: 0o644 };
    const h = localHeader(entry);
    central.push(centralRecord(entry, offset));
    chunks.push(h, data);
    offset += h.length + data.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...chunks, cd, endRecord(central.length, cd.length, offset)]);
}
const WB = (sheets) => '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>'
  + sheets.map((s, i) => `<sheet name="${s}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>';
const RELS = (n) => '<Relationships>'
  + Array.from({ length: n }, (_, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join('') + '</Relationships>';
const SHEET = (rowsXml) => `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
/* A workbook of { sheetName: sheetXml }. */
function book(sheetsXml, extra = {}) {
  const names = Object.keys(sheetsXml);
  const parts = { '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': WB(names), 'xl/_rels/workbook.xml.rels': RELS(names.length) };
  names.forEach((n, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetsXml[n]; });
  return zip({ ...parts, ...extra });
}
/* A two-cell workbook with saved values: A1 "Name" (inline), B1 42. */
const SIMPLE = () => book({ Plan: SHEET('<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1"><v>42</v></c></row>') });
/* The card's weakest premise: a workbook a script wrote, with formulas and no saved values. */
const SCRIPTED = () => book({ Totals: SHEET('<row r="1"><c r="A1"><f>SUM(B1:B9)</f></c><c r="B1"><f>1+1</f></c></row>') });

module.exports = { zip, book, SHEET, SIMPLE, SCRIPTED };
