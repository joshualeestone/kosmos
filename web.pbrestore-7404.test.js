'use strict';
/* kosmos#7404: the restore-from-a-backup screen's words, in Mona Lisa's design review (fleetbuilders m2528). The end of
   a restore says what happened and where the copy is; a stop says the copy's place in words, because a stopped restore's
   answer names no copy; files left out when the backup was made are said as not in it; failed files are counted and,
   at the computer, named. Lifted from the page, so the test cannot drift from what ships. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const { pbfLastWords, pbfBackupWhen, pbfStartedWhen } = new Function(
  page.liftAll(SCRIPT, ['asSentence', 'pbfWhen', 'pbfStartedWhen', 'pbfBackupWhen', 'pbfLastWords']) + '\nreturn { pbfLastWords, pbfBackupWhen, pbfStartedWhen };')();

const WORLD = { id: 'w-restored', name: 'Restored: Josh, 2 Nov' };

test('a restore that finished says how many files and which copy, and offers to open it', () => {
  const w = pbfLastWords({ ok: true, restored: 1204, failed: 0, world: WORLD, details: { failed: [], leftOutAtBackup: 0 } });
  assert.equal(w.line, 'Restored ' + (1204).toLocaleString() + ' files into Restored: Josh, 2 Nov.');
  assert.deepEqual(w.world, WORLD, 'Open the copy needs the copy');
  assert.equal(w.failedSum, '');
  assert.equal(pbfLastWords({ ok: true, restored: 1, world: WORLD }).line, 'Restored 1 file into Restored: Josh, 2 Nov.');
});

test('failed files are counted, and named only when the answer names them', () => {
  const here = pbfLastWords({ ok: true, restored: 10, failed: 2, world: WORLD, details: { failed: [{ path: 'a/b.txt', why: 'x' }, { path: 'c.txt', why: 'y' }], leftOutAtBackup: 0 } });
  assert.equal(here.failedSum, '2 files could not be restored');
  assert.deepEqual(here.failedPaths, ['a/b.txt', 'c.txt']);
  // A remote session gets counts, not names (personalrestorejob.status namesHidden).
  const remote = pbfLastWords({ ok: true, restored: 10, failed: 2, world: WORLD, details: { failedCount: 2, leftOutAtBackup: 0 } });
  assert.equal(remote.failedSum, '', 'no names to open, so no disclosure');
  assert.match(remote.line, / 2 files could not be restored\.$/, 'the count is a plain line');
  // More failed than named (FAILED_KEPT): the summary says how many are named.
  const capped = pbfLastWords({ ok: true, restored: 10, failed: 250, world: WORLD, details: { failed: [{ path: 'a', why: '' }, { path: 'b', why: '' }] } });
  assert.equal(capped.failedSum, (250).toLocaleString() + ' files could not be restored (the first 2 are named)');
});

test('files left out when the backup was made are said as never in it', () => {
  const w = pbfLastWords({ ok: true, restored: 5, world: WORLD, details: { failed: [], leftOutAtBackup: 12 } });
  assert.match(w.line, /12 files were not in this backup \(they were left out when it was made\)\.$/);
  assert.match(pbfLastWords({ ok: true, restored: 5, world: WORLD, details: { leftOutAtBackup: 1 } }).line, /1 file was not in this backup \(it was left out when it was made\)\.$/);
});

test('a stop says where the copy is in words, and offers no button it cannot back', () => {
  const w = pbfLastWords({ ok: false, code: 'stopped', stoppedByPerson: true, because: 'You stopped this restore. The files it had already restored stay in its new Kosmos.' });
  assert.equal(w.line, 'You stopped the restore. If it had already restored any files, they are in a copy you can open from the Kosmos menu at the top.');
  assert.doesNotMatch(w.line, /What it restored so far is in/, 'a Stop before the copy was made leaves none, so the line must not say one exists');
  assert.equal(w.world, null);
  assert.doesNotMatch(w.line, /new Kosmos/, 'the engine\'s words, which Mona Lisa replaced with "copy"');
  // Turned off while it ran: the engine's own sentence, which is about the switch.
  const off = pbfLastWords({ ok: false, code: 'stopped', stoppedByPerson: true, because: 'Personal backup was turned off, so this restore was stopped.' });
  assert.equal(off.line, 'Personal backup was turned off, so this restore was stopped.');
});

test('a restore that failed says the engine\'s reason, and names its copy when there is one', () => {
  const w = pbfLastWords({ ok: false, because: 'the restore stopped on this computer before it finished', world: WORLD });
  assert.equal(w.line, 'The restore stopped on this computer before it finished. Its copy is Restored: Josh, 2 Nov.');
  assert.deepEqual(w.world, WORLD);
  assert.equal(pbfLastWords({ ok: false, because: 'the restore could not start on this computer' }).world, null, 'no copy, no button');
  assert.equal(pbfLastWords({ ok: false, because: 'the restore stopped on this computer before it finished (it exited with code 1)' }).line,
    'The restore stopped on this computer before it finished.', 'how the child ended is engineer words');
  assert.equal(pbfLastWords({ ok: false, because: 'the restore stopped on this computer before it finished (it was ended by SIGKILL)' }).line,
    'The restore stopped on this computer before it finished.');
  assert.equal(pbfLastWords(null), null, 'nothing restored yet: no line');
});

test('a backup is named by its time in the person\'s own clock format, from Unix seconds', () => {
  const sec = Date.UTC(2026, 10, 2, 16, 15) / 1000;
  assert.equal(pbfBackupWhen({ takenAt: sec }), new Date(sec * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
  assert.equal(pbfBackupWhen({ takenAt: null }), 'A backup with no date');
});

test('a restore that started today says the time alone; another day keeps the date', () => {
  const now = new Date(2026, 10, 2, 14, 0).getTime();
  const today = new Date(2026, 10, 2, 13, 55).getTime();
  assert.equal(pbfStartedWhen(today, now), new Date(today).toLocaleTimeString([], { timeStyle: 'short' }));
  const yesterday = new Date(2026, 10, 1, 23, 50).getTime();
  assert.equal(pbfStartedWhen(yesterday, now), new Date(yesterday).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
});

test('Open the copy is the primary, in one row with See your backups', () => {
  assert.match(PAGE, /<div class="frow" id="pb-files-end-row"><button class="btn uprime" type="button" id="pb-files-open" hidden>Open the copy<\/button><button class="btn" type="button" id="pb-files-see">See your backups<\/button><\/div>/);
});

test('the screen says the words Mona Lisa approved', () => {
  assert.match(PAGE, /It goes into a separate copy, so nothing here changes\./);
  assert.match(SCRIPT, /This can take a while, and you can keep using Kosmos\./);
  assert.match(PAGE, /Stop now\? What is restored so far stays in the copy\./);
  assert.match(PAGE, />See your backups</);
  assert.match(PAGE, />Open the copy</);
  assert.doesNotMatch(SCRIPT, /'Backed up ' \+ pbfBackupWhen/, 'review item 1: the heading already says it');
});

/* The paint, on a small stand-in document: which parts show in each state. Review 1 found the focus and Off gaps here. */
function fakeDoc() {
  const els = {};
  const make = (id) => {
    const el = { id, hidden: false, disabled: false, textContent: '', dataset: {}, children: [], className: '', type: '', attrs: {},
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, focus() { doc.focused = this; },
      querySelectorAll(sel) { return sel === 'button' ? this.children.flatMap((li) => li.children.filter((c) => c.tag === 'button')) : []; } };
    Object.defineProperty(el, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
    return el;
  };
  const doc = { focused: null, body: { id: 'body' }, getElementById(id) { return els[id] || (els[id] = make(id)); }, createElement(tag) { const e = make(''); e.tag = tag; return e; },
    get activeElement() { return this.focused || this.body; } };
  // Every stand-in element is inside the section for contains(), except the body and an element named 'outside'.
  doc.getElementById('pb-files').contains = (x) => !!x && x !== doc.body && x.id !== 'outside';
  return doc;
}
function pbfState() {
  const m = SCRIPT.match(/\nvar PBF = \{[^\n]*\};\n/);
  assert.ok(m, 'CONTROL: var PBF was not found in the page');
  return m[0];
}
function painter(doc, fetchImpl, extra = {}) {
  const src = page.liftAll(SCRIPT, ['asSentence', 'pbfWhen', 'pbfStartedWhen', 'pbfBackupWhen', 'pbfMsg', 'pbfFocus', 'pbfLastWords', 'pbfShow', 'pbfRead', 'pbfPaint', 'pbfRowButton', 'pbfSee', 'pbfStart', 'pbfStop', 'pbfOpen', 'pbPost'])
    + '\n' + pbfState();
  const names = Object.keys(extra);
  return new Function('document', 'fetch', ...names, src + '\nreturn { PBF, pbfShow, pbfPaint, pbfSee, pbfStart, pbfStop, pbfRead, pbfOpen };')(
    doc, fetchImpl || (() => new Promise(() => {})), ...names.map((k) => extra[k]));
}
const vis = (doc, id) => !doc.getElementById(id).hidden;

test('the paint: idle, listed, asked, running, stop asked, ended', () => {
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.status = { running: false, startedAt: null, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  assert.ok(vis(doc, 'pb-files-see') && vis(doc, 'pb-files-end-row'), 'idle: See your backups');
  assert.ok(!vis(doc, 'pb-files-list') && !vis(doc, 'pb-files-run') && !vis(doc, 'pb-files-open'));
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.pbfPaint();
  assert.ok(vis(doc, 'pb-files-list') && !vis(doc, 'pb-files-see'), 'listed: the rows, See hidden');
  assert.ok(!vis(doc, 'pb-files-end-row'), 'nothing left in the end row');
  p.PBF.asked = p.PBF.list[0]; p.pbfPaint();
  assert.ok(vis(doc, 'pb-files-ask') && !vis(doc, 'pb-files-list'), 'asked: the confirm, not the list');
  p.PBF.busy = true; p.pbfPaint();
  assert.ok(doc.getElementById('pb-files-yes').disabled && doc.getElementById('pb-files-no').disabled, 'Cancel cannot take back a start already sent');
  p.PBF.busy = false; p.PBF.asked = null; p.PBF.status = { running: true, startedAt: Date.now(), last: null }; p.pbfPaint();
  assert.ok(vis(doc, 'pb-files-run') && vis(doc, 'pb-files-stop-row') && !vis(doc, 'pb-files-list') && !vis(doc, 'pb-files-see'), 'running');
  p.PBF.stopAsk = true; p.pbfPaint();
  assert.ok(vis(doc, 'pb-files-stop-ask') && !vis(doc, 'pb-files-stop-row'), 'stop asked');
  p.PBF.stopAsk = false; p.PBF.list = null; p.PBF.status = { running: false, startedAt: null, last: { ok: true, restored: 3, world: WORLD } }; p.pbfPaint();
  assert.ok(/^Restored 3 files/.test(doc.getElementById('pb-files-last').textContent) && vis(doc, 'pb-files-open') && vis(doc, 'pb-files-see') && vis(doc, 'pb-files-end-row'), 'ended: the line, Open the copy and See');
});

test('keyMissing: said, and never "no backups yet"', async () => {
  const doc = fakeDoc();
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, more: false, keyMissing: true, backups: [] }) }));
  p.PBF.status = { running: false, startedAt: null, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  await p.pbfSee();
  assert.ok(vis(doc, 'pb-files-keymissing'), 'the line for backups under another key');
  assert.equal(doc.getElementById('pb-files-msg').textContent, '', 'no "none yet" when some exist under another key');
  assert.equal(doc.focused && doc.focused.id, 'pb-files-see', 'focus stays on a control on screen');
});

test('turning personal backup off drops the list and the last restore, names and all', () => {
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }];
  p.PBF.status = { running: false, last: { ok: true, restored: 1, world: WORLD, details: { failed: [{ path: 'secret/plan.md', why: '' }] } } };
  p.pbfShow(false, true);
  assert.equal(p.PBF.list, null);
  assert.equal(p.PBF.status, null);
  assert.equal(p.PBF.at, 0, 'the next show reads at once');
});

const answer = (body, status = 200) => () => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const tick = () => new Promise((r) => setImmediate(r));

test('Restore: a start that answers shows the running line and puts focus on Stop', async () => {
  const doc = fakeDoc();
  const p = painter(doc, answer({ ok: true, startedAt: 99 }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart();
  assert.ok(vis(doc, 'pb-files-run') && !vis(doc, 'pb-files-ask'));
  assert.equal(doc.focused && doc.focused.id, 'pb-files-stop');
  assert.match(doc.getElementById('pb-files-run').textContent, new RegExp('^Restoring ' + new Date(1e9 * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Another restore (another tab, a phone) with a different start: not named as this one.
  p.PBF.status = { running: true, startedAt: 12345, last: null }; p.pbfPaint();
  assert.match(doc.getElementById('pb-files-run').textContent, /^Restoring a backup, started /);
});

test('Off while a list is on its way: its answer writes nothing back', async () => {
  const doc = fakeDoc();
  let release;
  const p = painter(doc, () => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve({ ok: true, more: false, keyMissing: false, backups: [{ key: 'old', takenAt: 1e9, problem: null }] }) }); }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  const pending = p.pbfSee();
  p.pbfShow(false, true);
  release(); await pending;
  assert.equal(p.PBF.list, null, 'the old list came back after Off');
});

test('a Stop confirm left open when a restore ends does not come back for the next one', () => {
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.status = { running: true, startedAt: Date.now(), last: null }; p.PBF.at = Date.now();
  p.PBF.stopAsk = true; p.pbfShow(true);
  assert.ok(vis(doc, 'pb-files-stop-ask'), 'CONTROL: the confirm is up');
  p.PBF.status = { running: false, last: { ok: true, restored: 1, world: WORLD } }; p.pbfPaint();
  p.PBF.status = { running: true, startedAt: Date.now(), last: null }; p.pbfPaint();
  assert.ok(!vis(doc, 'pb-files-stop-ask') && vis(doc, 'pb-files-stop-row'), 'the next restore opened with "Stop now?" already up');
});

test('when a restore ends with focus on Stop, focus moves to Open the copy', async () => {
  const doc = fakeDoc();
  const p = painter(doc, answer({ running: false, startedAt: null, last: { ok: true, restored: 4, world: WORLD } }));
  p.PBF.status = { running: true, startedAt: Date.now(), last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  doc.getElementById('pb-files-stop').focus();
  p.pbfRead(); await tick(); await tick();
  assert.ok(vis(doc, 'pb-files-open'));
  assert.equal(doc.focused && doc.focused.id, 'pb-files-open');
});

test('Stop: a stop that was accepted says so and keeps Stop away until the restore ends; a second press sends nothing', async () => {
  const doc = fakeDoc();
  let calls = 0;
  const p = painter(doc, (url) => { if (url === '/api/personal-backup/stop') calls++; return new Promise((r) => setImmediate(() => r({ ok: true, json: () => Promise.resolve(url === '/api/personal-backup/stop' ? { ok: true } : { running: true, startedAt: 5, last: null }) }))); });
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true); p.PBF.stopAsk = true; p.pbfPaint();
  const a = p.pbfStop(); const b = p.pbfStop();
  await a; await b;
  assert.equal(calls, 1, 'a second press sent a second stop');
  assert.equal(doc.getElementById('pb-files-run').textContent, 'Stopping the restore.');
  assert.ok(!vis(doc, 'pb-files-stop-row') && !vis(doc, 'pb-files-stop-ask'), 'Stop came back before the restore ended');
  assert.equal(doc.focused && doc.focused.id, 'pb-files-run');
  p.PBF.status = { running: false, last: { ok: false, code: 'stopped', stoppedByPerson: true } }; p.pbfPaint();
  assert.equal(p.PBF.stopSent, false, 'the next restore would open as stopping');
});

test('Open the copy reads the switcher first, then opens its confirm for the copy the restore answered', async () => {
  const doc = fakeDoc();
  const order = [];
  const p = painter(doc, null, {
    worldsFetch: () => { order.push('fetch'); return Promise.resolve(); },
    worldswOpen: () => order.push('open'),
    worldswConfirmSwitch: (id, name) => order.push('confirm ' + id + ' ' + name),
  });
  p.PBF.status = { running: false, last: { ok: true, restored: 1, world: WORLD } };
  await p.pbfOpen();
  assert.deepEqual(order, ['fetch', 'open', 'confirm ' + WORLD.id + ' ' + WORLD.name]);
  order.length = 0;
  p.PBF.status = { running: false, last: { ok: false, code: 'stopped' } };
  await p.pbfOpen();
  assert.deepEqual(order, [], 'no copy, nothing opened');
});

test('a restore that ends while the person is elsewhere does not move their focus', async () => {
  const doc = fakeDoc();
  const p = painter(doc, answer({ running: false, startedAt: null, last: { ok: true, restored: 4, world: WORLD } }));
  p.PBF.status = { running: true, startedAt: Date.now(), last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  const outside = doc.getElementById('outside');
  outside.focus();   // a control elsewhere on the page
  p.pbfRead(); await tick(); await tick();
  assert.equal(doc.focused, outside, 'the end of a restore took focus from a control outside the section');
});

test('a list where no backup can be restored keeps See your backups, and focus lands on it', async () => {
  const doc = fakeDoc();
  const p = painter(doc, answer({ ok: true, more: false, keyMissing: false, backups: [{ key: 'k1', takenAt: 1e9, problem: 'this backup could not be opened with your key' }] }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  await p.pbfSee();
  assert.ok(vis(doc, 'pb-files-list') && vis(doc, 'pb-files-see'), 'rows with no action and no way to read the list again');
  assert.equal(doc.focused && doc.focused.id, 'pb-files-see');
});

test('refusals: a remote session gets the board\'s step-up instruction, never a "Try again" that cannot work', async () => {
  for (const step of ['see', 'start', 'stop']) {
    const doc = fakeDoc();
    const p = painter(doc, answer({ code: 'remote_step_up_needed', error: 'confirm it is you on this device first' }, 403));
    p.PBF.status = { running: step === 'stop', startedAt: 1, last: null }; p.PBF.at = Date.now();
    p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; if (step === 'start') p.PBF.asked = p.PBF.list[0];
    p.pbfShow(true);
    await (step === 'see' ? p.pbfSee() : step === 'start' ? p.pbfStart() : p.pbfStop());
    assert.equal(doc.getElementById('pb-files-msg').textContent, 'Confirm it is you on this device first.', step);
  }
});

test('refusals: an answer that says why is shown as it says, and nothing starts', async () => {
  const doc = fakeDoc();
  const p = painter(doc, answer({ ok: false, code: 'restore_running', because: 'A restore is already running on this computer.' }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart();
  assert.equal(doc.getElementById('pb-files-msg').textContent, 'A restore is already running on this computer.');
  assert.ok(vis(doc, 'pb-files-ask') && !vis(doc, 'pb-files-run'), 'the confirm stays; no running line');
});

test('the turned-off stop reads as the engine words it, so a rewording there cannot make it "You stopped"', () => {
  const ENGINE = fs.readFileSync(path.join(__dirname, 'engine', 'personalrestorejob.js'), 'utf8');
  const m = ENGINE.match(/because: '(Personal backup was turned off[^']*)'/);
  assert.ok(m, 'CONTROL: the engine\'s turned-off sentence was not found; this test must follow it');
  const w = pbfLastWords({ ok: false, code: 'stopped', stoppedByPerson: true, because: m[1] });
  assert.equal(w.line, m[1], 'the page treated a turned-off stop as the person\'s own Stop');
});

test('a remote session\'s failed restore: the job\'s fixed line, and the copy when there is one', () => {
  const ENGINE = fs.readFileSync(path.join(__dirname, 'engine', 'personalrestorejob.js'), 'utf8');
  const m = ENGINE.match(/const REMOTE_BECAUSE = '([^']*)'/);
  assert.ok(m, 'CONTROL: REMOTE_BECAUSE was not found');
  const w = pbfLastWords({ ok: false, because: m[1], world: WORLD, details: { failedCount: 0, leftOutAtBackup: 0 } });
  assert.equal(w.line, m[1] + ' Its copy is ' + WORLD.name + '.');
  assert.deepEqual(w.world, WORLD, 'Open the copy, from a phone too');
});

test('another view (checking, needs a key) only hides the section: a running restore is still this page\'s', () => {
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.status = { running: true, startedAt: 7, last: null }; p.PBF.startedFor = { backup: { key: 'k1', takenAt: 1e9 }, at: 7 }; p.PBF.at = Date.now();
  p.pbfShow(false, false);
  assert.ok(!vis(doc, 'pb-files'), 'hidden');
  assert.ok(p.PBF.status && p.PBF.status.running && p.PBF.startedFor, 'the running restore was forgotten on a view change');
  p.pbfShow(true);
  assert.match(doc.getElementById('pb-files-run').textContent, /^Restoring (?!a backup)/, 'named again when it shows');
});

test('the panel hiding drops the section\'s state, as Off does (pbPaint\'s early return calls it)', () => {
  const m = SCRIPT.match(/\n  if \(box\.hidden\) \{ [^\n]*\n/);
  assert.ok(m, 'CONTROL: pbPaint\'s hidden branch was not found');
  assert.match(m[0], /pbfShow\(false, true\)/, 'a hidden panel kept the last restore\'s file names');
});

test('a refused Stop puts focus back on Stop', async () => {
  const doc = fakeDoc();
  const p = painter(doc, answer({ ok: false, code: 'not_running', because: 'No restore is running on this computer.' }));
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true); p.PBF.stopAsk = true; p.pbfPaint();
  await p.pbfStop();
  assert.equal(doc.focused && doc.focused.id, 'pb-files-stop');
});

test('a read still out is not thrown away by the next repaint: a slow board still shows the end', async () => {
  const doc = fakeDoc();
  let release; let calls = 0;
  const p = painter(doc, () => { calls++; return new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve({ running: false, last: { ok: true, restored: 2, world: WORLD } }) }); }); });
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = 0;
  p.pbfShow(true);                      // the first read goes out
  p.PBF.at = 0; p.pbfShow(true);        // a repaint 5 s later, the first still out
  assert.equal(calls, 1, 'a second read went out over the first');
  release(); await tick(); await tick();
  assert.match(doc.getElementById('pb-files-last').textContent, /^Restored 2 files/, 'the slow answer was dropped and the end never showed');
});

test('the end line, a live region, is written only when it changes', () => {
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.status = { running: false, last: { ok: true, restored: 3, world: WORLD } }; p.PBF.at = Date.now();
  p.pbfShow(true);
  const el = doc.getElementById('pb-files-last');
  let writes = 0; let t = el.textContent;
  Object.defineProperty(el, 'textContent', { get() { return t; }, set(v) { writes++; t = v; } });
  p.pbfPaint(); p.pbfPaint();
  assert.equal(writes, 0, 'the repaint rewrote an unchanged live region');
});

test('a start refused because another restore runs: focus leaves the hidden confirm for the running line', async () => {
  const doc = fakeDoc();
  const p = painter(doc, (url, init) => Promise.resolve({ ok: true, json: () => Promise.resolve(init && init.method === 'POST'
    ? { ok: false, code: 'restore_running', because: 'A restore is already running on this computer.' }
    : { running: true, startedAt: 9, last: null }) }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart(); await tick(); await tick();
  assert.ok(!vis(doc, 'pb-files-ask') && vis(doc, 'pb-files-run'), 'CONTROL: the read showed the other restore');
  assert.equal(doc.focused && doc.focused.id, 'pb-files-run');
});

/* kosmos#7801: a refusal outlives its state. */
test('a refusal is cleared when a later read sees the restore end, and when one sees a restore start', async () => {
  for (const [from, to] of [[{ running: true, startedAt: 5, last: null }, { running: false, last: { ok: true, restored: 2, world: WORLD } }],
    [{ running: false, last: null }, { running: true, startedAt: 9, last: null }]]) {
    const doc = fakeDoc();
    const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve(to) }));
    p.PBF.status = from; p.PBF.at = Date.now();
    p.pbfShow(true);
    doc.getElementById('pb-files-msg').textContent = 'Confirm it is you on this device first.';
    p.pbfRead(); await tick(); await tick();
    assert.equal(p.PBF.status, to, 'CONTROL: the read did not land');
    assert.equal(doc.getElementById('pb-files-msg').textContent, '', (from.running ? 'end' : 'start') + ': the old refusal stayed');
  }
});

test('a read that sees no change keeps the refusal', async () => {
  const doc = fakeDoc();
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, startedAt: 5, last: null }) }));
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  doc.getElementById('pb-files-msg').textContent = 'Confirm it is you on this device first.';
  p.pbfRead(); await tick(); await tick();
  assert.equal(doc.getElementById('pb-files-msg').textContent, 'Confirm it is you on this device first.');
});

test('a start refused because another restore runs keeps its reason, though its own read sees that restore begin', async () => {
  const doc = fakeDoc();
  const p = painter(doc, (url, init) => Promise.resolve({ ok: true, json: () => Promise.resolve(init && init.method === 'POST'
    ? { ok: false, code: 'restore_running', because: 'A restore is already running on this computer.' }
    : { running: true, startedAt: 9, last: null }) }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart(); await tick(); await tick();
  assert.ok(vis(doc, 'pb-files-run'), 'CONTROL: the read showed the other restore');
  assert.equal(doc.getElementById('pb-files-msg').textContent, 'A restore is already running on this computer.');
});

/* kosmos#7801: the end line is a polite live region, so it stays in the tree, shown and empty, and only its text fills. */
test('the end line is never hidden, in the markup, the CSS or the paint', () => {
  const tag = PAGE.match(/<p [^>]*id="pb-files-last"[^>]*>/);
  assert.ok(tag, 'CONTROL: the end line was not found');
  assert.doesNotMatch(tag[0], /\shidden\b/, 'the region starts hidden, so it appears already filled');
  assert.match(PAGE, /#pb-files-last:empty \{ display: block;/, '.fhint:empty would display:none the empty region');
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  assert.ok(vis(doc, 'pb-files-last') && doc.getElementById('pb-files-last').textContent === '', 'running: shown and empty');
  p.PBF.status = { running: false, last: { ok: true, restored: 3, world: WORLD } }; p.pbfPaint();
  assert.ok(vis(doc, 'pb-files-last') && /^Restored 3 files/.test(doc.getElementById('pb-files-last').textContent), 'ended: filled');
});

test('a start refused because another restore runs keeps its reason when only a later read sees that restore', async () => {
  const doc = fakeDoc();
  let gets = 0;
  const p = painter(doc, (url, init) => {
    if (init && init.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, code: 'restore_running', because: 'A restore is already running on this computer.' }) });
    gets++;
    return gets === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, startedAt: 9, last: null }) });
  });
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart(); await tick(); await tick();
  p.pbfRead(); await tick(); await tick();
  assert.ok(vis(doc, 'pb-files-run'), 'CONTROL: the second read showed the other restore');
  assert.equal(doc.getElementById('pb-files-msg').textContent, 'A restore is already running on this computer.');
});

test('a refused Stop whose own read sees the restore end loses its message to the end line', async () => {
  const doc = fakeDoc();
  const p = painter(doc, (url, init) => Promise.resolve({ ok: true, json: () => Promise.resolve(init && init.method === 'POST'
    ? { ok: false, because: 'The restore could not be stopped just now.' }
    : { running: false, last: { ok: true, restored: 4, world: WORLD } }) }));
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true); p.PBF.stopAsk = true; p.pbfPaint();
  await p.pbfStop(); await tick(); await tick();
  assert.match(doc.getElementById('pb-files-last').textContent, /^Restored 4 files/, 'CONTROL: the read showed the end');
  assert.equal(doc.getElementById('pb-files-msg').textContent, '');
});

test('a start refused for another reason is cleared when a restore then begins', async () => {
  const doc = fakeDoc();
  let gets = 0;
  const p = painter(doc, (url, init) => {
    if (init && init.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, because: 'The restore did not start. Nothing was restored.' }) });
    gets++;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(gets === 1 ? { running: false, last: null } : { running: true, startedAt: 9, last: null }) });
  });
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart(); await tick(); await tick();
  assert.equal(doc.getElementById('pb-files-msg').textContent, 'The restore did not start. Nothing was restored.', 'CONTROL: the refusal showed');
  p.pbfRead(); await tick(); await tick();
  assert.ok(vis(doc, 'pb-files-run'), 'CONTROL: the read showed a restore');
  assert.equal(doc.getElementById('pb-files-msg').textContent, '');
});

test('a restore that ends with no answer to show moves focus to See your backups, not an empty end line', async () => {
  const doc = fakeDoc();
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false, last: null }) }));
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  doc.getElementById('pb-files-stop').focus();
  p.pbfRead(); await tick(); await tick();
  assert.equal(doc.getElementById('pb-files-last').textContent, '', 'CONTROL: no end line');
  assert.equal(doc.focused && doc.focused.id, 'pb-files-see');
});

test('a kept "already running" refusal is cleared by a read that sees nothing running, whether or not it saw the restore', async () => {
  for (const sawIt of [true, false]) {
    const doc = fakeDoc();
    let gets = 0;
    const p = painter(doc, (url, init) => {
      if (init && init.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, code: 'restore_running', because: 'A restore is already running on this computer.' }) });
      gets++;
      const running = sawIt && gets === 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(running ? { running: true, startedAt: 9, last: null } : { running: false, last: null }) });
    });
    p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
    p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
    p.pbfShow(true);
    await p.pbfStart(); await tick(); await tick();
    if (sawIt) assert.equal(doc.getElementById('pb-files-msg').textContent, 'A restore is already running on this computer.', 'CONTROL: kept while it ran');
    p.pbfRead(); await tick(); await tick();
    assert.ok(!vis(doc, 'pb-files-run'), 'CONTROL: the read saw nothing running');
    assert.equal(doc.getElementById('pb-files-msg').textContent, '', sawIt ? 'the restore ended' : 'no read ever saw it');
  }
});

test('a stopped restore, with no copy to open, moves focus to its end line', async () => {
  const doc = fakeDoc();
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false, last: { ok: false, code: 'stopped', stoppedByPerson: true, because: 'You stopped this restore.' } }) }));
  p.PBF.status = { running: true, startedAt: 5, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  doc.getElementById('pb-files-stop').focus();
  p.pbfRead(); await tick(); await tick();
  assert.ok(!vis(doc, 'pb-files-open') && /^You stopped the restore/.test(doc.getElementById('pb-files-last').textContent), 'CONTROL: a stop line, no copy');
  assert.equal(doc.focused && doc.focused.id, 'pb-files-last');
});

test('turning personal backup off drops a kept refusal and its flag', () => {
  const doc = fakeDoc();
  const p = painter(doc);
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.pbfShow(true);
  doc.getElementById('pb-files-msg').textContent = 'A restore is already running on this computer.'; p.PBF.msgRunning = true;
  p.pbfShow(false, true);
  assert.equal(doc.getElementById('pb-files-msg').textContent, '');
  assert.equal(p.PBF.msgRunning, false);
});

test('a non-ok answer that carries because and code keeps its code through pbPost (the board answers 200; a relay may not)', async () => {
  const doc = fakeDoc();
  const p = painter(doc, (url, init) => Promise.resolve(init && init.method === 'POST'
    ? { ok: false, status: 409, json: () => Promise.resolve({ ok: false, code: 'restore_running', because: 'A restore is already running on this computer.' }) }
    : { ok: true, json: () => Promise.resolve({ running: true, startedAt: 9, last: null }) }));
  p.PBF.status = { running: false, last: null }; p.PBF.at = Date.now();
  p.PBF.list = [{ key: 'k1', takenAt: 1e9, problem: null }]; p.PBF.asked = p.PBF.list[0];
  p.pbfShow(true);
  await p.pbfStart(); await tick(); await tick();
  assert.ok(vis(doc, 'pb-files-run'), 'CONTROL: the read showed the other restore');
  assert.equal(doc.getElementById('pb-files-msg').textContent, 'A restore is already running on this computer.');
});

/* kosmos#7801: the end line is quiet for the first fill after a show (an old end is not news), and live after. */
function liveAtWrite(doc) {
  const el = doc.getElementById('pb-files-last');
  const writes = []; let t = el.textContent;
  Object.defineProperty(el, 'textContent', { configurable: true, get() { return t; }, set(v) { if (v !== t) writes.push({ text: v, live: el.attrs['aria-live'] }); t = v; } });
  return writes;
}
/* kosmos#7816: the switch to polite waits for a timer of its own; these tests hold the timers and run them by hand. */
function timers() {
  const q = [];
  return { setTimeout: (fn) => { q.push(fn); return q.length; }, run: () => { const now = q.splice(0); for (const fn of now) fn(); return now.length; }, get size() { return q.length; } };
}
test('the first read after a show fills the end line with an old end quietly; an end seen later is read out', async () => {
  const doc = fakeDoc();
  const tm = timers();
  let answer = { running: false, last: { ok: true, restored: 3, world: WORLD } };
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer) }), { setTimeout: tm.setTimeout });
  const writes = liveAtWrite(doc);
  p.pbfShow(true); await tick(); await tick();
  assert.deepEqual(writes, [{ text: 'Restored 3 files into Restored: Josh, 2 Nov.', live: 'off' }], 'an end from before the page opened was announced');
  assert.equal(doc.getElementById('pb-files-last').attrs['aria-live'], 'off', 'polite in the same task as the quiet fill');
  assert.equal(tm.run(), 1, 'CONTROL: one switch was waiting');
  assert.equal(doc.getElementById('pb-files-last').attrs['aria-live'], 'polite', 'live after its own callback');
  answer = { running: true, startedAt: 9, last: null };
  p.PBF.at = 0; p.pbfShow(true); await tick(); await tick();
  answer = { running: false, last: { ok: true, restored: 7, world: WORLD } };
  p.PBF.at = 0; p.pbfShow(true); await tick(); await tick();
  assert.equal(writes[writes.length - 1].text, 'Restored 7 files into Restored: Josh, 2 Nov.', 'CONTROL: the new end was written');
  assert.equal(writes[writes.length - 1].live, 'polite', 'an end this tab saw happen was not announced');
  assert.equal(tm.size, 0, 'once live, no further switch is queued');
});

test('two reads with no paint between never switch to polite in the task of a write', async () => {
  const doc = fakeDoc();
  const tm = timers();
  let answer = { running: true, startedAt: 9, last: null };
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer) }), { setTimeout: tm.setTimeout });
  const writes = liveAtWrite(doc);
  p.pbfRead(); await tick(); await tick();
  answer = { running: false, last: { ok: true, restored: 7, world: WORLD } };
  p.pbfRead(true); await tick(); await tick();
  assert.equal(writes.length, 1, 'CONTROL: the second read wrote the end');
  assert.deepEqual(writes.map((x) => x.live), ['off'], 'the end was written into a region switched to polite in the same task');
  assert.equal(tm.run(), 1, 'CONTROL: the switch was waiting, once');
  assert.equal(doc.getElementById('pb-files-last').attrs['aria-live'], 'polite');
});

test('turning personal backup off makes the end line quiet and empty again for the next first fill', async () => {
  const doc = fakeDoc();
  const tm = timers();
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false, last: { ok: true, restored: 3, world: WORLD } }) }), { setTimeout: tm.setTimeout });
  p.pbfShow(true); await tick(); await tick(); tm.run();
  assert.equal(doc.getElementById('pb-files-last').attrs['aria-live'], 'polite', 'CONTROL: live before Off');
  p.pbfShow(false, true);
  assert.equal(doc.getElementById('pb-files-last').attrs['aria-live'], 'off', 'Off left the end line live');
  assert.equal(doc.getElementById('pb-files-last').textContent, '', 'Off left the old end in the line');
  const writes = liveAtWrite(doc);
  p.pbfShow(true); await tick(); await tick();
  assert.deepEqual(writes.map((x) => x.live), ['off']);
});

test('a switch still waiting when personal backup goes off is dropped', async () => {
  const doc = fakeDoc();
  const tm = timers();
  const p = painter(doc, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ running: false, last: { ok: true, restored: 3, world: WORLD } }) }), { setTimeout: tm.setTimeout });
  p.pbfShow(true); await tick(); await tick();
  assert.equal(tm.size, 1, 'CONTROL: a switch is waiting');
  p.pbfShow(false, true);
  tm.run();
  assert.equal(doc.getElementById('pb-files-last').attrs['aria-live'], 'off', 'a switch from before Off made the line live');
});

test('the end line starts quiet in the markup', () => {
  assert.match(PAGE, /<p [^>]*id="pb-files-last"[^>]*aria-live="off"/);
});
