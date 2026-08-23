'use strict';
/**
 * Attachments (#358): the store, the record, the preview seam.
 *
 * Sandboxed under a temp data root before the module is required (it
 * resolves its root through engine/store at require time). The PDF preview
 * shells out to qlmanage on a real Mac; here the renderer seam writes the PNG
 * itself, so the test measures this module and not Quick Look.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-attach-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const attachments = require('./attachments');

test('kind is decided by type first and extension second, and an unknown file is other, never a guess', () => {
  assert.equal(attachments.kindOf('image/png', 'x.bin'), 'image');
  assert.equal(attachments.kindOf('application/octet-stream', 'photo.JPG'), 'image');
  assert.equal(attachments.kindOf('application/pdf', 'deck'), 'pdf');
  assert.equal(attachments.kindOf('', 'notes.md'), 'text');
  assert.equal(attachments.kindOf('text/csv', 'data'), 'text');
  assert.equal(attachments.kindOf('application/zip', 'bundle.zip'), 'other');
  assert.equal(attachments.kindOf('', ''), 'other');
});

test('a file name becomes one path segment: no separators, no leading dots, never empty', () => {
  assert.equal(attachments.safeName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(attachments.safeName('record.json'), 'file-record.json', 'a file named like the metadata would overwrite it');
  assert.equal(attachments.safeName('Preview.PNG'), 'file-Preview.PNG');
  assert.equal(attachments.safeName('a\u001bb\u0007.txt'), 'ab.txt', 'control characters reach the pane');
  assert.equal(Array.from(attachments.safeName('😀'.repeat(200))).length, 160, 'a surrogate pair was halved');
  assert.equal(attachments.safeName('.hidden'), 'hidden');
  assert.equal(attachments.safeName(''), 'file');
  assert.equal(attachments.safeName('a/b\\c\0d.txt'), 'a_b_c_d.txt');
  assert.ok(attachments.safeName('x'.repeat(400)).length <= 160);
});

test('save writes the bytes under the owner\'s folder, records the shape the page draws, and read finds it by id', () => {
  const rec = attachments.save('agent', 'april', { name: 'lease.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 fake') });
  assert.match(rec.id, /^[0-9a-f]{24}$/);
  assert.ok(rec.file.startsWith(path.join(SANDBOX)), 'the file was written outside the sandbox: ' + rec.file);
  assert.ok(rec.file.includes(path.join('attachments', 'agent', 'april', rec.id)), rec.file);
  assert.equal(fs.readFileSync(rec.file, 'utf8'), '%PDF-1.4 fake');
  const back = attachments.read(rec.id);
  assert.equal(back.name, 'lease.pdf');
  assert.equal(back.kind, 'pdf');
  assert.equal(back.scope, 'agent');
  assert.equal(back.owner, 'april');
  const row = attachments.rowField(back);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'kind', 'name', 'preview', 'size', 'type', 'url']);
  assert.equal(row.url, '/api/attachment/' + rec.id);
  assert.equal(row.preview, '/api/attachment/' + rec.id + '/preview');
  assert.equal(row.size, 13);
  /* The project folder is NOT where this went: the card's second ruling. */
  assert.ok(!rec.file.includes('kosmos-projects'), 'the attachment landed in a project folder');
});

test('a text file\'s preview is the text itself, capped; an unknown kind has preview null, not absent', () => {
  const txt = attachments.save('project', 'p1', { name: 'notes.md', type: 'text/markdown', bytes: Buffer.from('# Notes\n' + 'x'.repeat(5000)) });
  const row = attachments.rowField(attachments.read(txt.id));
  assert.equal(row.kind, 'text');
  assert.ok(row.preview.startsWith('# Notes'));
  assert.equal(row.preview.length, 2000);
  const zip = attachments.save('project', 'p1', { name: 'bundle.zip', type: 'application/zip', bytes: Buffer.from([1, 2, 3]) });
  const zrow = attachments.rowField(attachments.read(zip.id));
  assert.equal(zrow.kind, 'other');
  assert.ok('preview' in zrow, 'preview is absent');
  assert.equal(zrow.preview, null);
});

test('the preview: an image is itself, a PDF goes through the renderer seam and is cached, a failure is a sentence', async () => {
  const png = attachments.save('agent', 'april', { name: 'a.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const got = await attachments.preview(attachments.read(png.id));
  assert.equal(got.ok, true);
  assert.equal(got.type, 'image/png');
  assert.equal(got.bytes.length, 4);

  let renders = 0;
  attachments.setRenderer((file, dir) => { renders += 1; fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.from('PNG!')); });
  try {
    const pdf = attachments.save('agent', 'april', { name: 'deck.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF') });
    const first = await attachments.preview(attachments.read(pdf.id));
    assert.equal(first.ok, true);
    assert.equal(first.bytes.toString(), 'PNG!');
    const second = await attachments.preview(attachments.read(pdf.id));
    assert.equal(second.ok, true);
    assert.equal(renders, 1, 'the preview was rendered again instead of read from beside the file');

    attachments.setRenderer(() => { throw new Error('no Quick Look here'); });
    const bad = attachments.save('agent', 'april', { name: 'broken.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF') });
    const failed = await attachments.preview(attachments.read(bad.id));
    assert.equal(failed.ok, false);
    assert.match(failed.because, /could not draw the first page/);
  } finally {
    attachments.setRenderer(null);
  }
  const other = attachments.save('agent', 'april', { name: 'x.zip', type: 'application/zip', bytes: Buffer.from([1]) });
  assert.match((await attachments.preview(attachments.read(other.id))).because, /no preview for this kind/);
  /* The type an image preview is served as comes from the IMAGE set, never
     the uploader's header: a .png uploaded as text/html must not draw as HTML. */
  const lied = attachments.save('agent', 'april', { name: 'lie.png', type: 'text/html', bytes: Buffer.from('<h1>log in again</h1>') });
  const served = await attachments.preview(attachments.read(lied.id));
  assert.equal(served.ok, true);
  assert.equal(served.type, 'image/png', 'the preview took the uploader\'s content-type');
});

test('too large, empty, and a bad id are refused in words, and read never walks a path the id built', () => {
  assert.throws(() => attachments.save('agent', 'april', { name: 'big', type: 'x', bytes: Buffer.alloc(attachments.MAX_BYTES + 1) }), /25 MB/);
  assert.throws(() => attachments.save('agent', 'april', { name: 'empty', type: 'x', bytes: Buffer.alloc(0) }), /nothing in that file/);
  assert.equal(attachments.read('../../etc'), null);
  assert.equal(attachments.read('zzzzzzzzzzzzzzzzzzzzzzzz'), null);
  assert.equal(attachments.read(''), null);
});

test('the wire note carries the absolute path of the stored file, so the agent can open it', () => {
  const rec = attachments.save('agent', 'april', { name: 'brief.txt', type: 'text/plain', bytes: Buffer.from('hi') });
  const note = attachments.wireNote(attachments.read(rec.id));
  assert.match(note, /^ \[attached file: \/.+\/brief\.txt\]$/, note);
  assert.equal(attachments.wireNote(null), '');
});
