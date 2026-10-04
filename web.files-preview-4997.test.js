'use strict';
/**
 * #4997, the page half: a plain click on an image or PDF row in a Files list opens the full-page preview (pvOpen)
 * with a record whose picture and download are the board's Files routes, naming the file only by its listed name in
 * ?name=, and whose Open in Finder posts to the Files reveal route (never /api/attachment/). Any other row, and a
 * modifier-click, is left to the list's own open. The record uses one plain id, so pvClose's selector never carries
 * a file's name. The routes themselves (and every refusal) are server.files-preview-4997.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

function lift(win = false) {
  const opened = [];
  const fetches = [];
  const PV_ATTS = new Map();
  const msg = { textContent: 'stale' };
  // eslint-disable-next-line no-new-func
  const fn = new Function('PV_ATTS', 'pvOpen', 'fetch', 'document', 'asSentence', 'onWindows',
    "'use strict';\nconst FILES_PV_ID = " + JSON.stringify('files-preview') + ';\nlet FILES_PV_AT = null;\n' + page.lift(SCRIPT, 'filesPvOpen') + '\nreturn filesPvOpen;')(
    PV_ATTS, (id, from) => { opened.push([id, from]); return true; },
    async (url, init) => { fetches.push([url, init && init.method, init && JSON.parse(init.body)]); return { ok: false, status: 409, json: async () => ({ because: 'refused here' }) }; },
    { getElementById: (id) => (id === 'pv-msg' ? msg : null) }, (s) => s, () => win);
  return { fn, opened, fetches, PV_ATTS, msg };
}
const row = (doc, size) => ({ dataset: { doc }, closest: () => ({ id: 'd-files-list' }), querySelector: (sel) => (sel === '.pj-doc-w' ? { textContent: size || '12 KB' } : null) });
const plain = { button: 0 };

test('#4997: FILES_PV_ID is one plain id in the page (no file name can reach pvClose\'s selector)', () => {
  assert.match(SCRIPT, /const FILES_PV_ID = 'files-preview';/);
});

test('#4997: an image row in an agent\'s Files opens the preview with the Files routes, named only by ?name=', () => {
  const { fn, opened, PV_ATTS } = lift();
  const r = row('shot one.PNG');
  assert.equal(fn(r, { agent: 'ava b' }, plain), true);
  assert.deepEqual(opened, [['files-preview', r]]);
  const a = PV_ATTS.get('files-preview');
  assert.equal(a.kind, 'image');
  assert.equal(a.name, 'shot one.PNG');
  assert.equal(a.meta, '12 KB');
  assert.equal(a.preview, '/api/agent/ava%20b/files/preview?name=shot%20one.PNG');
  assert.equal(a.url, '/api/agent/ava%20b/files/download?name=shot%20one.PNG');
  assert.equal(typeof a.reveal, 'function');
});

test('#4997: a PDF in a project subfolder opens with the project routes; the shown name is the file\'s own', () => {
  const { fn, PV_ATTS } = lift();
  assert.equal(fn(row('reports/Q3.pdf'), { project: 'p-1' }, plain), true);
  const a = PV_ATTS.get('files-preview');
  assert.equal(a.kind, 'pdf');
  assert.equal(a.name, 'Q3.pdf');
  assert.equal(a.preview, '/api/project/p-1/file-preview?name=reports%2FQ3.pdf');
  assert.equal(a.url, '/api/project/p-1/file-download?name=reports%2FQ3.pdf');
});

test('#4997: a text file, a file with no extension, a modifier-click and a non-left click are left to the list\'s own open (CONTROL: the same row plain-clicked as a PNG opens)', () => {
  const { fn, opened } = lift();
  assert.equal(fn(row('notes.txt'), { agent: 'ava' }, plain), false);
  assert.equal(fn(row('Makefile'), { agent: 'ava' }, plain), false);
  for (const e of [{ button: 0, metaKey: true }, { button: 0, ctrlKey: true }, { button: 0, shiftKey: true }, { button: 0, altKey: true }, { button: 1 }]) {
    assert.equal(fn(row('shot.png'), { agent: 'ava' }, e), false, JSON.stringify(e));
  }
  assert.equal(opened.length, 0);
  assert.equal(fn(row('shot.png'), { agent: 'ava' }, plain), true, 'CONTROL');
});

test('#4997: Open in Finder posts the listed name to the Files reveal route, never /api/attachment/, and says a refusal', async () => {
  for (const [where, route] of [[{ agent: 'ava' }, '/api/agent/ava/files/reveal-file'], [{ project: 'p-1' }, '/api/project/p-1/reveal-file']]) {
    const { fn, fetches, PV_ATTS, msg } = lift();
    fn(row('a/b.png'), where, plain);
    await PV_ATTS.get('files-preview').reveal();
    assert.deepEqual(fetches, [[route, 'POST', { name: 'a/b.png' }]]);
    assert.ok(!fetches.some((f) => /\/api\/attachment\//.test(f[0])));
    assert.equal(msg.textContent, 'refused here', 'the refusal was not said (or the stale line stayed)');
  }
});

test('#4997 review 2: heic and avif (a browser may not decode them) and, on Windows, a PDF (its first page is drawn by macOS alone) keep the list\'s open (CONTROL: a PDF on a Mac and a jpeg on Windows open the preview)', () => {
  const mac = lift(false);
  assert.equal(mac.fn(row('a.heic'), { agent: 'ava' }, plain), false);
  assert.equal(mac.fn(row('a.AVIF'), { agent: 'ava' }, plain), false);
  assert.equal(mac.fn(row('a.pdf'), { agent: 'ava' }, plain), true, 'CONTROL: a PDF on a Mac');
  const win = lift(true);
  assert.equal(win.fn(row('a.pdf'), { agent: 'ava' }, plain), false);
  assert.equal(win.fn(row('a.jpeg'), { agent: 'ava' }, plain), true, 'CONTROL: a jpeg on Windows');
});
