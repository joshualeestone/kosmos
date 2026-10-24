'use strict';
/* #6761 (a feedback report: a revised file handed over can be mistaken for an earlier version): every Files list row
 * carries its file's sha256 once the board has hashed it, in the background. Against a real sandboxed board:
 *   GET /api/agent/:name/files, GET /api/agent/:name/files/browse, GET /api/project/:id/documents.
 * A row never waits on a hash; the list's stamp moves when one arrives, so the page repaints; a changed file gets its
 * new fingerprint, never the old one; only the rows shown are hashed.
 *
 *   node --test server.fingerprints-6761.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fingerprints-'));
process.env.HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
for (const d of ['data', 'projects', 'workers', 'launch']) fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });

const { start, server } = require('./server');
const projects = require('./engine/projects');
const filehash = require('./engine/filehash');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; filehash._settleForTest(0); });   // the fixtures are written a moment before
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const get = async (u) => (await fetch(base + u)).json();
/* Poll as the page does, until every named row has a fingerprint (or give up). */
async function untilHashed(u, names, pick = (b) => b.files) {
  let body;
  for (let i = 0; i < 100; i++) {
    body = await get(u);
    const rows = pick(body) || [];
    if (names.every((n) => (rows.find((r) => r.name === n) || {}).sha256)) return body;
    await new Promise((r) => setTimeout(r, 30));
  }
  return body;
}
const filesOf = (name) => { const d = path.join(SANDBOX, 'workers', name, 'Files'); fs.mkdirSync(d, { recursive: true }); return d; };

test('the agent\'s Files list: each row gets its file\'s sha256 once hashed, and the stamp moves when it arrives', async () => {
  const dir = filesOf('ada');
  fs.writeFileSync(path.join(dir, 'report.txt'), 'the report');
  fs.writeFileSync(path.join(dir, 'deck.pptx'), Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff]));
  filehash._resetForTest();
  const first = await get('/api/agent/ada/files');
  assert.equal(first.ok, true);
  const later = await untilHashed('/api/agent/ada/files', ['report.txt', 'deck.pptx']);
  const row = (n) => later.files.find((r) => r.name === n);
  assert.equal(row('report.txt').sha256, sha('the report'));
  assert.equal(row('deck.pptx').sha256, sha(Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff])));
  if (!first.files.every((r) => r.sha256)) assert.notEqual(later.stamp, first.stamp, 'the stamp did not move when the fingerprints arrived, so the page would not repaint');
  assert.equal(Object.keys(row('report.txt')).sort().join(','), 'modified,name,sha256,size', 'a row carries more than its name, size, date and fingerprint');
});

test('a changed file gets its new fingerprint, never the old one', async () => {
  const dir = filesOf('bo');
  const p = path.join(dir, 'draft.txt');
  fs.writeFileSync(p, 'version one');
  await untilHashed('/api/agent/bo/files', ['draft.txt']);
  fs.writeFileSync(p, 'version two, revised');
  const now = await get('/api/agent/bo/files');
  const r = now.files.find((f) => f.name === 'draft.txt');
  assert.notEqual(r.sha256, sha('version one'), 'the old version\'s fingerprint was shown for the revised file');
  const later = await untilHashed('/api/agent/bo/files', ['draft.txt']);
  assert.equal(later.files.find((f) => f.name === 'draft.txt').sha256, sha('version two, revised'));
});

test('the Files browser and a project\'s documents carry fingerprints too', async () => {
  const dir = filesOf('cy');
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'q1.csv'), 'a,b\n');
  const browsed = await untilHashed('/api/agent/cy/files/browse?dir=reports', ['reports/q1.csv']);
  assert.equal(browsed.files[0].sha256, sha('a,b\n'));
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'projects', 'fp-'));
  fs.writeFileSync(path.join(folder, 'plan.md'), '# plan');
  const p = projects.create({ name: 'Fingerprints 6761', folder });
  const docs = await untilHashed('/api/project/' + encodeURIComponent(p.id) + '/documents', ['plan.md']);
  assert.equal(docs.files.find((f) => f.name === 'plan.md').sha256, sha('# plan'));
});

test('only the rows shown are hashed: a folder past the list\'s cap is not read whole for a list of ten', async () => {
  const dir = filesOf('dee');
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, 'f' + String(i).padStart(2, '0') + '.txt'), 'x' + i);
  filehash._resetForTest();
  const asked = [];
  const real = filehash.forRow;   // what the engine calls for each row it sends
  filehash.forRow = (p, st) => { asked.push(path.basename(p)); return real(p, st); };
  try {
    const r = await get('/api/agent/dee/files?limit=10');
    assert.equal(r.files.length, 10);
    assert.equal(r.total, 30);
    assert.equal(asked.length, 10, 'files beyond the rows shown were queued for hashing: ' + asked.length);
    assert.deepEqual(asked.sort(), r.files.map((f) => f.name).sort());
  } finally { filehash.forRow = real; }
});
