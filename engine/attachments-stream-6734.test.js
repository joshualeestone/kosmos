'use strict';
/**
 * #6734: the attachment store's stream lifecycle, with no /dev/fd and no board, so it also runs on Windows (where a
 * file cannot be renamed or removed while it is open). saveStream keeps the file whole, refuses past the cap and when
 * the source stops, and leaves nothing behind in either case.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-attach-stream-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const attachments = require('./attachments');

const ownerDir = () => path.join(attachments.ROOT, 'agent', 'lifecycle');
const folders = () => { try { return fs.readdirSync(ownerDir()); } catch { return []; } };

test('#6734: a streamed file is stored whole and renamed into place, with no part file left', async () => {
  const src = new PassThrough();
  const kept = attachments.saveStream('agent', 'lifecycle', { name: 'whole.bin', type: 'application/octet-stream' }, src);
  for (let i = 0; i < 4; i++) src.write(Buffer.alloc(64 * 1024, i));
  src.end();
  const rec = await kept;
  assert.equal(rec.size, 4 * 64 * 1024);
  assert.equal(fs.statSync(rec.file).size, rec.size);
  assert.ok(!fs.existsSync(path.join(rec.dir, attachments.PART)), 'the part file was left beside the stored file');
  assert.ok(attachments.read(rec.id), 'the stored file cannot be read back');
});

test('#6734: a stream past the cap is refused and its folder removed once the part file is closed', async () => {
  const before = folders().length;
  const src = new PassThrough();
  const kept = attachments.saveStream('agent', 'lifecycle', { name: 'big.bin', type: 'application/octet-stream' }, src)
    .then(() => 'stored', (e) => e.message);
  const block = Buffer.alloc(1024 * 1024);
  for (let sent = 0; sent <= attachments.MAX_BYTES; sent += block.length) {
    if (!src.write(block)) await new Promise((r) => src.once('drain', r));
  }
  src.end();
  assert.equal(await kept, attachments.TOO_LARGE);
  assert.equal(folders().length, before, 'a refused upload left its folder');
});

test('#6734: a stream that stops before it is whole is refused and leaves nothing', async () => {
  const before = folders().length;
  const src = new PassThrough();
  const kept = attachments.saveStream('agent', 'lifecycle', { name: 'cut.bin', type: 'application/octet-stream' }, src)
    .then(() => 'stored', (e) => e.message);
  src.write(Buffer.alloc(64 * 1024));
  await new Promise((r) => setImmediate(r));
  assert.equal(folders().length, before + 1, 'CONTROL: the upload had started (its folder exists)');
  src.destroy(new Error('connection lost'));
  assert.equal(await kept, 'the file stopped arriving before it was whole');
  assert.equal(folders().length, before, 'a cut-off upload left its folder');
});

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
