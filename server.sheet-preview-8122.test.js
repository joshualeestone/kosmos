'use strict';
/**
 * kosmos#8122 (parser half): the board's routes that give the file viewer a spreadsheet's read-only grid, through a
 * real board. Three surfaces, one shape: an attachment (/api/attachment/<id>/sheet), an agent's Files list
 * (/api/agent/<name>/files/sheet?name=) and a project's files (/api/project/<id>/file-sheet?name=). A file the list
 * does not show is a 404 (the list's own rules), a link is never followed, a cross-site read is refused, and a file the
 * list shows but cannot be drawn is a 200 refusal in words, so the viewer can still put the gold button under it.
 *
 *   node --test server.sheet-preview-8122.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheet-8122-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheet-8122-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheet-8122-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheet-8122-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheet-8122-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const projects = require('./engine/projects');
const dmfiles = require('./engine/dmfiles');
const attachments = require('./engine/attachments');
const fx = require('./test-support/xlsxfixture');

const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheet-8122-outside-'));
fs.writeFileSync(path.join(OUTSIDE, 'secret.csv'), 'never,served\n');
let PROJECT = null;
const base = () => `http://127.0.0.1:${server.address().port}`;

function fill(dir) {
  fs.writeFileSync(path.join(dir, 'plan.xlsx'), fx.SIMPLE());
  fs.writeFileSync(path.join(dir, 'totals.xlsx'), fx.SCRIPTED());
  fs.writeFileSync(path.join(dir, 'people.csv'), 'Name,Age\nAda,36\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, 'broken.xlsx'), 'PK this is not a workbook');
  fs.writeFileSync(path.join(dir, '.hidden.csv'), 'hidden,file\n');
  fs.symlinkSync(path.join(OUTSIDE, 'secret.csv'), path.join(dir, 'link.csv'));
}

test.before(async () => {
  await start(0);
  const files = dmfiles.filesDir('ava');
  fs.mkdirSync(files, { recursive: true });
  fill(files);
  const folder = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'sheet-'));
  fill(folder);
  PROJECT = projects.create({ name: 'Sheet Room 8122', folder });
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const SURFACES = [
  ['agent Files', () => '/api/agent/ava/files/sheet'],
  ['project', () => '/api/project/' + encodeURIComponent(PROJECT.id) + '/file-sheet'],
];
const listed = async (route, name, headers) => {
  const r = await fetch(base() + route + '?name=' + encodeURIComponent(name), { headers: headers || {} });
  return { status: r.status, body: await r.json().catch(() => null), type: r.headers.get('content-type') || '' };
};

for (const [label, route] of SURFACES) {
  test(`#8122 ${label}: a workbook's grid, a CSV's grid, and a script-written workbook said as having no saved values`, async () => {
    const plan = await listed(route(), 'plan.xlsx');
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.match(plan.type, /application\/json/);
    assert.deepEqual(plan.body.sheets, [{ name: 'Plan', rows: [['Name', '42']], cut: false }]);
    assert.equal(plan.body.ok, true);
    const csv = await listed(route(), 'people.csv');
    assert.deepEqual(csv.body.sheets[0].rows, [['Name', 'Age'], ['Ada', '36']]);
    const scripted = await listed(route(), 'totals.xlsx');
    assert.equal(scripted.body.ok, true);
    assert.equal(scripted.body.noValues, true, 'a script-written workbook would show an empty grid');
  });

  test(`#8122 ${label}: a file it shows but cannot draw is a 200 refusal in words (the button still goes under it)`, async () => {
    const broken = await listed(route(), 'broken.xlsx');
    assert.equal(broken.status, 200);
    assert.deepEqual(broken.body, { ok: false, because: 'This file could not be read as a spreadsheet.' });
    const text = await listed(route(), 'notes.txt');
    assert.equal(text.status, 200);
    assert.match(text.body.because, /no spreadsheet preview for this kind of file/);
  });

  test(`#8122 ${label}: the list's own rules: a hidden file, a link and a missing file are 404 with no grid`, async () => {
    for (const name of ['.hidden.csv', 'link.csv', 'missing.csv', '../secret.csv']) {
      const r = await listed(route(), name);
      assert.equal(r.status, 404, name + ' was answered: ' + JSON.stringify(r.body));
      assert.equal(r.body.ok, false);
      assert.ok(!r.body.sheets, name + ' carried a grid');
    }
    // CONTROL: the same route answers a listed file, so the 404s are the rules, not a broken route.
    assert.equal((await listed(route(), 'people.csv')).status, 200);
  });

  test(`#8122 ${label}: a read from another website is refused`, async () => {
    const r = await listed(route(), 'plan.xlsx', { 'sec-fetch-site': 'cross-site' });
    assert.equal(r.status, 403);
    assert.ok(!r.body.sheets);
  });
}

test('#8122 attachment: an attached workbook\'s grid at /sheet; cross-site refused; a non-spreadsheet refused in words', async () => {
  const rec = attachments.save('agent', 'ava', { name: 'plan.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: fx.SIMPLE() });
  const r = await fetch(base() + '/api/attachment/' + rec.id + '/sheet');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.sheets, [{ name: 'Plan', rows: [['Name', '42']], cut: false }]);
  const cross = await fetch(base() + '/api/attachment/' + rec.id + '/sheet', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  const png = attachments.save('agent', 'ava', { name: 'shot.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const pr = await (await fetch(base() + '/api/attachment/' + png.id + '/sheet')).json();
  assert.equal(pr.ok, false);
  assert.match(pr.because, /no spreadsheet preview for this kind of file/);
  // CONTROL: the plain attachment route is unchanged (a download, not JSON).
  const dl = await fetch(base() + '/api/attachment/' + rec.id);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);
  assert.equal((await fetch(base() + '/api/attachment/' + 'f'.repeat(24) + '/sheet')).status, 404, 'a missing attachment is a 404');
});
