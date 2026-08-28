'use strict';
/**
 * kosmos#1199, the icon half. Josh: "for some reason PDFs are not displaying the
 * PDF icon. I got Word, Excel, and PowerPoint files to display the proper ones."
 *
 * 🛑 PDF WAS NEVER MISSING, and this suite pins that so nobody "fixes" it again.
 * `pdf` has been in FILE_TYPES since #536. The two iconless rows in his
 * screenshot are the McKinney and Honobia files, and the thread beside them says
 * what they are: both were written up and STUCK WAITING to be turned into PDFs,
 * because the converter on that machine does HTML to docx and not to PDF. They
 * were .html, which had no entry.
 *
 * ⇒ Adding `pdf` would have been a no-op that closed the card and changed
 *   nothing he could see.
 *
 *   node --test web.file-icons-1199.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

function table() {
  const m = PAGE.match(/const FILE_TYPES = \{[\s\S]*?\n\};/);
  assert.ok(m, 'FILE_TYPES is gone');
  const body = m[0].replace('const FILE_TYPES = ', '').replace(/;$/, '');
  return eval('(' + body + ')');           // eslint-disable-line no-eval
}
const tagFor = (T, name) => {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return Object.prototype.hasOwnProperty.call(T, ext) ? T[ext][0] : null;
};

test('the types on Josh\'s screen all resolve, including the ones that did not', () => {
  const T = table();
  const cases = [
    ['Weather Forecasts - McKinney, Honobia, Tulsa.pptx', 'PPT'],
    ['Weather Forecasts - McKinney, Honobia, Tulsa.xlsx', 'XLS'],
    ['Tulsa Weather Forecast.docx', 'DOC'],
    ['anything.pdf', 'PDF'],
    ['honobia-weather-forecast.html', 'WEB'],
    ['mckinney-weather-forecast.htm', 'WEB'],
  ];
  for (const [name, want] of cases) {
    assert.equal(tagFor(T, name), want, `${name} should carry ${want}`);
  }
});

test('an unknown type still falls back to the blank document, deliberately', () => {
  /* The table's own comment: "THE FALLBACK IS THE DEFAULT: an unknown type gets
     the blank document, so nothing can render brokenly." Adding types must not
     turn that into a lookup that can fail. */
  const T = table();
  for (const name of ['README', 'archive.tar.gz', 'thing.wibble']) {
    assert.equal(tagFor(T, name), null, `${name} should fall through to the blank document`);
  }
});

test('every tag fits the badge: two or three characters, never more', () => {
  /* 🔑 THE BADGE IS A 16-WIDE RECT AT font-size 5.4 AND NOTHING MEASURES IT. A
     four-character tag would overflow silently, and the first one added would be
     the one that found out. I nearly shipped "JSON" here. */
  const T = table();
  const over = Object.entries(T).filter(([, v]) => v[0].length > 3);
  assert.deepEqual(over, [], 'a tag longer than three characters will overflow the badge');
});

test('CONTROL: the extractor and the length check can both fail', () => {
  assert.equal(tagFor({ pdf: ['PDF'] }, 'x.doc'), null, 'the extractor must be able to miss');
  assert.equal(tagFor({ pdf: ['PDF'] }, 'x.pdf'), 'PDF', 'and be able to hit');
  const over = Object.entries({ j: ['JSON'] }).filter(([, v]) => v[0].length > 3);
  assert.equal(over.length, 1, 'the length check must catch a four-character tag');
});
