'use strict';
/**
 * #6734: the attachment store's stream lifecycle, with no /dev/fd and no board, so it also runs on Windows: a file is
 * stored whole, a stream past the cap or one that stops is refused, and nothing is left behind. It shows the lifecycle
 * runs and passes there; it does not prove close-before-rename on Windows (Node opens files there with share-delete,
 * so renaming an open file succeeds anyway).
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

test('#6734: a rename that fails once as a Windows scanner makes it fail (EBUSY) is retried and the file is stored', async () => {
  const real = fs.renameSync;
  let failed = 0;
  fs.renameSync = function (from) {
    if (String(from).endsWith(attachments.PART) && failed === 0) {
      failed += 1;
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    }
    return real.apply(this, arguments);
  };
  let rec;
  try {
    const src = new PassThrough();
    const kept = attachments.saveStream('agent', 'lifecycle', { name: 'busy.bin', type: 'application/octet-stream' }, src);
    src.end(Buffer.from('held'));
    rec = await kept;
  } finally { fs.renameSync = real; }
  assert.equal(failed, 1, 'the first rename was never made to fail, so this tested nothing');
  assert.equal(fs.readFileSync(rec.file, 'utf8'), 'held');
});
