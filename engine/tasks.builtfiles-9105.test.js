'use strict';
/**
 * kosmos#9105: a built mark carries every delivered file. builtFiles is the record, one entry per file name; the single-file
 * fields (builtFingerprint ...) describe its first current file. engine/tasks.js setBuilt and filesOf.
 *
 *   node --test engine/tasks.builtfiles-9105.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-builtfiles-9105-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const projects = require('./projects');
const tasks = require('./tasks');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);
const D = 'sha256:' + 'd'.repeat(64);
const P_REPORT = path.join(SANDBOX, 'report.md');
const P_DATA = path.join(SANDBOX, 'data.csv');
let pid;
let num = 0;
function freshTask() {
  if (!pid) pid = projects.create({ name: 'Files' }).id;
  const r = tasks.create(pid, { sentence: 'Deliver the report ' + (num += 1) });
  assert.ok(r && r.ok !== false, JSON.stringify(r));
  return (r.task || r).number;
}
const get = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === pid), n);
const mark = (n, opts) => { const r = tasks.setBuilt(pid, n, opts); assert.equal(r.ok, true, r.because); return r; };
const refused = (n, opts) => { const r = tasks.setBuilt(pid, n, opts); assert.equal(r.ok, false, 'expected a refusal'); return r.because; };
const two = () => [{ name: 'report.md', fingerprint: A, filePath: P_REPORT }, { name: 'data.csv', fingerprint: B, filePath: P_DATA }];
const byName = (n, name) => get(n).builtFiles.find((e) => e.name === name);

test('#9105: one mark with two files keeps both, and the single-file fields describe the first', () => {
  const n = freshTask();
  const r = mark(n, { by: 'mona', files: two(), note: 'both' });
  assert.equal(r.replaced, undefined, 'a first delivery was called a replacement');
  const t = get(n);
  assert.deepEqual(t.builtFiles.map((e) => [e.name, e.fingerprint, e.by, e.path]), [['report.md', A, 'mona', P_REPORT], ['data.csv', B, 'mona', P_DATA]]);
  assert.equal(t.builtFingerprint, A);
  assert.equal(t.builtFilePath, P_REPORT);
  assert.equal(t.builtFingerprintBy, 'mona');
  assert.equal(t.builtFingerprintAt, t.builtFiles[0].at);
  assert.equal(tasks.closedHowAt(t), 'change');
});

test('#9105: re-sending one changed file replaces only that file and keeps the other with its checks', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  mark(n, { by: 'zed', note: 'checked both' });
  assert.deepEqual(byName(n, 'report.md').checkedBy, ['zed']);
  assert.deepEqual(byName(n, 'data.csv').checkedBy, ['zed']);
  const r = mark(n, { by: 'mona', files: [{ name: 'data.csv', fingerprint: C, filePath: P_DATA }], note: 'new figures' });
  assert.equal(r.replacedFiles.length, 1);
  assert.equal(r.replacedFiles[0].name, 'data.csv');
  assert.equal(r.replacedFiles[0].kind, 'replaced');
  assert.equal(r.replacedFiles[0].fingerprint, B);
  assert.deepEqual(r.replacedFiles[0].checkedBy, ['zed'], 'the replaced file\'s checkers are not named, so nobody is told');
  assert.equal(r.replaced.kind, 'replaced');
  assert.equal('name' in r.replaced, false, 'the single notice changed shape for older readers');
  const report = byName(n, 'report.md');
  assert.equal(report.fingerprint, A, 'a file the mark did not send was changed');
  assert.deepEqual(report.checkedBy, ['zed'], 'a file the mark did not send lost its checks');
  const data = byName(n, 'data.csv');
  assert.equal(data.fingerprint, C);
  assert.deepEqual(data.checkedBy, [], 'the new file inherited the old one\'s checks');
  assert.equal(data.replaces.fingerprint, B);
  assert.equal(get(n).builtFingerprint, A, 'the single-file fields moved off the first file');
});

test('#9105: a new name is a new file beside the others (the weakest premise, pinned)', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'report.md', fingerprint: A }] });
  const r = mark(n, { by: 'mona', files: [{ name: 'report-v2.md', fingerprint: B }] });
  assert.equal(r.replaced, undefined);
  assert.deepEqual(get(n).builtFiles.map((e) => e.name), ['report.md', 'report-v2.md']);
});

test('#9105: a checker\'s mark checks every file; --check checks only the files named', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  mark(n, { by: 'zed', check: ['data.csv'], note: 'checked the data' });
  assert.deepEqual(byName(n, 'data.csv').checkedBy, ['zed']);
  assert.deepEqual(byName(n, 'report.md').checkedBy, [], 'a file not named was counted as checked');
  mark(n, { by: 'ivy', note: 'checked all' });
  assert.deepEqual(byName(n, 'data.csv').checkedBy, ['zed', 'ivy']);
  assert.deepEqual(byName(n, 'report.md').checkedBy, ['ivy']);
  assert.deepEqual(get(n).builtCheckedBy, ['ivy'], 'the single-file fields do not follow the first file');
});

test('#9105: a check is refused for a file not on the task, the checker\'s own file, or beside files', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  assert.match(refused(n, { by: 'zed', check: ['nope.txt'] }), /no file named 'nope.txt' is delivered/);
  assert.match(refused(n, { by: 'mona', check: ['report.md'] }), /yourself/);
  assert.match(refused(n, { by: 'zed', check: ['report.md'], files: [{ name: 'x', fingerprint: C }] }), /without files/);
  assert.match(refused(n, { person: true, check: ['report.md'] }), /without files/);
  assert.match(refused(n, { check: ['report.md'] }), /checker's name/);
  assert.match(refused(n, { by: 'zed', check: [] }), /names a file/);
  assert.deepEqual(byName(n, 'report.md').checkedBy, [], 'a refused check was recorded');
});

test('#9105: the sender\'s own mark with no files withdraws every file it sent', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  const r = mark(n, { by: 'mona', note: 'not ready after all' });
  assert.deepEqual(r.replacedFiles.map((e) => [e.name, e.kind]), [['report.md', 'withdrawn'], ['data.csv', 'withdrawn']]);
  const t = get(n);
  assert.equal(t.builtFingerprint, undefined);
  assert.equal(t.builtReplaces.fingerprint, A, 'the single-file fields do not show the first file as withdrawn');
  assert.deepEqual(t.builtFiles.map((e) => [e.name, 'fingerprint' in e, e.replaces.fingerprint]), [['report.md', false, A], ['data.csv', false, B]]);
  assert.equal(tasks.closedHowAt(t), 'note');
  // One sent back keeps its own checks state and is no replacement.
  const back = mark(n, { by: 'mona', files: [{ name: 'data.csv', fingerprint: B }] });
  assert.equal(back.replaced, undefined);
  assert.equal(get(n).builtFingerprint, B, 'the single-file fields do not describe the first CURRENT file');
  assert.equal(tasks.closedHowAt(get(n)), 'change');
});

test('#9105: files from two senders: a no-file mark withdraws its own and checks the other\'s', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'report.md', fingerprint: A }] });
  mark(n, { by: 'ivy', files: [{ name: 'data.csv', fingerprint: B }] });
  const r = mark(n, { by: 'mona', note: 'mine is not ready' });
  assert.deepEqual(r.replacedFiles.map((e) => [e.name, e.kind]), [['report.md', 'withdrawn']]);
  assert.deepEqual(byName(n, 'data.csv').checkedBy, ['mona']);
});

test('#9105: the person\'s mark keeps every file and checks each', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  mark(n, { person: true });
  assert.equal(byName(n, 'report.md').checkedByPerson, true);
  assert.equal(byName(n, 'data.csv').checkedByPerson, true);
  assert.equal(get(n).builtCheckedByPerson, true);
});

test('#9105: the same mark again records nothing', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two(), note: 'same' });
  const again = mark(n, { by: 'mona', files: two(), note: 'same' });
  assert.equal(again.changed, false);
  const check = mark(n, { by: 'zed', note: 'ok' });
  assert.equal(check.changed, true);
  assert.equal(mark(n, { by: 'zed', note: 'ok' }).changed, false, 'a repeated check wrote again');
});

test('#9105: a mark\'s files are checked before anything is written', () => {
  const n = freshTask();
  assert.match(refused(n, { by: 'mona', files: [] }), /at least one/);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'a', fingerprint: A }, { name: 'a', fingerprint: B }] }), /two files named 'a'/);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'dir/a', fingerprint: A }] }), /without its folder/);
  assert.match(refused(n, { by: 'mona', files: [{ name: '..', fingerprint: A }] }), /without its folder/);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'a', fingerprint: 'sha256:xyz' }] }), /fingerprint is/);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'a', fingerprint: A, filePath: 'relative/a' }] }), /absolute path/);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'a', fingerprint: A }], fingerprint: A }), /not both/);
  const many = Array.from({ length: tasks.BUILT_FILES_MAX + 1 }, (_, i) => ({ name: 'f' + i, fingerprint: A }));
  assert.match(refused(n, { by: 'mona', files: many }), /at most/);
  assert.equal(get(n).builtAt, undefined, 'a refused mark was written');
});

test('#9105: one fingerprint sent the older way is the first file, and the other files stay', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  const r = mark(n, { by: 'mona', fingerprint: D, filePath: P_REPORT });
  assert.equal(r.replaced.kind, 'replaced');
  assert.equal(r.replaced.fingerprint, A);
  assert.deepEqual(get(n).builtFiles.map((e) => [e.name, e.fingerprint]), [['report.md', D], ['data.csv', B]]);
});

test('#9105 review 3: a file from before #9105 with no name is taken over only by its own sender sending one file', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A });   // no path, so no name
  assert.deepEqual(get(n).builtFiles.map((e) => e.name), ['']);
  const both = mark(n, { by: 'mona', files: [{ name: 'report.md', fingerprint: B }, { name: 'data.csv', fingerprint: C }] });
  assert.equal(both.replacedFiles, undefined, 'an added file replaced the unnamed one');
  assert.deepEqual(get(n).builtFiles.map((e) => [e.name, e.fingerprint]), [['', A], ['report.md', B], ['data.csv', C]]);
  const m = freshTask();
  mark(m, { by: 'mona', fingerprint: A });
  mark(m, { by: 'zed', note: 'checked' });
  const other = mark(m, { by: 'ivy', files: [{ name: 'extra.csv', fingerprint: B }] });
  assert.equal(other.replacedFiles, undefined);
  assert.deepEqual(get(m).builtFiles.map((e) => [e.name, e.checkedBy]), [['', ['zed']], ['extra.csv', []]]);
  // CONTROL: its own sender re-sending one named file takes it over.
  const k = freshTask();
  mark(k, { by: 'mona', fingerprint: A });
  const own = mark(k, { by: 'mona', files: [{ name: 'report.md', fingerprint: B }] });
  assert.equal(own.replacedFiles[0].kind, 'replaced');
  assert.deepEqual(get(k).builtFiles.map((e) => [e.name, e.fingerprint]), [['report.md', B]]);
});

test('#9105 review 3: a fingerprint without a name on a several-file task is the sender\'s own file, never another sender\'s', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }] });
  mark(n, { by: 'bob', files: [{ name: 'b.md', fingerprint: B }] });
  mark(n, { by: 'mona', note: 'withdraw mine' });
  const r = mark(n, { by: 'mona', fingerprint: C });
  assert.deepEqual(get(n).builtFiles.map((e) => [e.name, e.fingerprint || null, e.by || null]), [['a.md', C, 'mona'], ['b.md', B, 'bob']]);
  assert.equal((r.replacedFiles || []).some((x) => x.name === 'b.md'), false, 'bob\'s checkers were told his file was replaced');
  mark(n, { by: 'ivy', fingerprint: D });
  assert.deepEqual(get(n).builtFiles.map((e) => e.fingerprint), [C, B, D]);
  // CONTROL: on a one-file task another sender's fingerprint replaces the file, as before #9105.
  const m = freshTask();
  mark(m, { by: 'mona', fingerprint: A });
  assert.equal(mark(m, { by: 'ivy', fingerprint: B }).replaced.kind, 'replaced');
});

test('#9105 review 3: --check takes a name as the readout shows it; a direction override never reaches a refusal', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'Résumé.pdf', fingerprint: A }, { name: 'report [v2].pdf', fingerprint: B }, { name: 'x‮fdp.exe', fingerprint: C }] });
  mark(n, { by: 'zed', check: ['Résumé.pdf', 'report (v2).pdf', 'xfdp.exe'], note: 'as shown' });
  assert.deepEqual(get(n).builtFiles.map((e) => e.checkedBy), [['zed'], ['zed'], ['zed']]);
  const why = refused(n, { by: 'zed', check: ['nope'] });
  assert.equal(/‮/.test(why), false, 'a direction override reached the refusal');
  assert.match(why, /'xfdp\.exe'/);
});

test('#9105: a task marked before #9105 (no builtFiles) reads as its one file, and a repeat writes nothing', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: P_REPORT, note: 'old' });
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => { if (x.number !== n) return x; const y = { ...x }; delete y.builtFiles; return y; }) }));
  assert.deepEqual(tasks.filesOf(get(n)).map((e) => [e.name, e.fingerprint, e.path]), [['report.md', A, P_REPORT]]);
  assert.equal(mark(n, { by: 'mona', fingerprint: A, filePath: P_REPORT, note: 'old' }).changed, false);
});

test('#9105: a hand-edited store (single-file fields changed, builtAt kept) is read from those fields, the other files kept', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  // As a board from before #9105 leaves it after a replacement: the fields changed, builtFiles untouched.
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.number === n ? { ...x, builtFingerprint: D, builtCheckedBy: [] } : x)) }));
  assert.deepEqual(tasks.filesOf(get(n)).map((e) => [e.name, e.fingerprint]), [['report.md', D], ['data.csv', B]]);
  // CONTROL: a builtFiles that agrees is read as stored.
  const m = freshTask();
  mark(m, { by: 'mona', files: two() });
  assert.deepEqual(tasks.filesOf(get(m)), get(m).builtFiles);
});

test('#9105: a view without local paths has no path in any file, and a clear drops the files', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  const v = tasks.withoutLocalPaths(get(n));
  assert.equal(v.builtFiles.length, 2);
  assert.equal(v.builtFiles.some((e) => 'path' in e), false, 'a file\'s path left this computer');
  assert.equal(get(n).builtFiles[0].path, P_REPORT, 'the stored task lost its path (it is a copy)');
  tasks.clearBuilt(pid, n, { by: 'mona' });
  assert.equal('builtFiles' in get(n), false);
});

test('#9105 review 1: a name holds no backslash (it could carry a Windows path); a Mac path with one goes without a name', () => {
  const n = freshTask();
  assert.match(refused(n, { by: 'mona', files: [{ name: 'C:\\Users\\josh\\secret.pdf', fingerprint: A }] }), /without its folder/);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'odd\\name.txt', fingerprint: A }] }), /without its folder/);
  const m = freshTask();
  mark(m, { by: 'mona', fingerprint: A, filePath: path.join(SANDBOX, 'odd\\name.txt') });
  assert.equal(get(m).builtFiles[0].name, '', 'a Mac path was named after a part of its file name');
  assert.equal(get(m).builtFilePath, path.join(SANDBOX, 'odd\\name.txt'), 'CONTROL: the path itself is still kept');
  const w = freshTask();
  mark(w, { by: 'mona', fingerprint: A });
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => { if (x.number !== w) return x; const y = { ...x, builtFilePath: 'C:\\Users\\me\\out\\deck.pdf' }; delete y.builtFiles; return y; }) }));
  assert.equal(tasks.filesOf(get(w))[0].name, 'deck.pdf', 'a Windows path was not split at its backslash');
});

test('#9105 review 1: an older CLI\'s one fingerprint for a file that is not the first replaces that file, never a second of its name', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }, { name: 'b.md', fingerprint: B }] });
  mark(n, { by: 'mona', fingerprint: C, filePath: path.join(SANDBOX, 'b.md') });
  assert.deepEqual(get(n).builtFiles.map((e) => [e.name, e.fingerprint]), [['a.md', A], ['b.md', C]]);
  // CONTROL: a path whose name is not on the task still replaces the first file, as before #9105.
  mark(n, { by: 'mona', fingerprint: D, filePath: path.join(SANDBOX, 'z.md') });
  assert.deepEqual(get(n).builtFiles.map((e) => [e.name, e.fingerprint]), [['z.md', D], ['b.md', C]]);
});

test('#9105 review 1: a list an older board left behind after its clear is not read back as current', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  // An older board's clear: it drops only the fields it knows, and builtFiles (with its stamp) stays.
  const OLD_FIELDS = ['builtAt', 'builtBy', 'builtByPerson', 'builtWho', 'builtFreesAll', 'builtNote', 'builtFingerprint',
    'builtFingerprintBy', 'builtFilePath', 'builtFingerprintAt', 'builtCheckedBy', 'builtCheckedByPerson', 'builtReplaces', 'builtWaitingOn'];
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => { if (x.number !== n) return x; const y = { ...x }; for (const k of OLD_FIELDS) delete y[k]; return y; }) }));
  assert.ok(Array.isArray(get(n).builtFiles), 'CONTROL: the older board left the list');
  // Then that board marks it again, with no file.
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.number === n ? { ...x, builtAt: new Date(Date.now() + 5).toISOString(), builtBy: 'zed', builtWho: ['zed'] } : x)) }));
  assert.deepEqual(tasks.filesOf(get(n)), [], 'a cleared file came back as delivered');
  // And this board's next mark writes a list of its own.
  mark(n, { by: 'zed', files: [{ name: 'new.md', fingerprint: C }] });
  assert.deepEqual(get(n).builtFiles.map((e) => e.name), ['new.md']);
  assert.equal(get(n).builtFilesAt, get(n).builtAt);
});

test('#9105 review 1: the task holds at most BUILT_FILES_MAX files across marks; a mark that does not add any still works', () => {
  const n = freshTask();
  const batch = (from) => Array.from({ length: 10 }, (_, i) => ({ name: 'f' + (from + i), fingerprint: A }));
  mark(n, { by: 'mona', files: batch(0) });
  mark(n, { by: 'mona', files: batch(10) });
  assert.equal(get(n).builtFiles.length, tasks.BUILT_FILES_MAX);
  assert.match(refused(n, { by: 'mona', files: [{ name: 'one-more', fingerprint: A }] }), /at most 20 delivered files/);
  assert.equal(get(n).builtFiles.length, tasks.BUILT_FILES_MAX, 'a refused mark was written');
  assert.equal(mark(n, { by: 'zed', note: 'checked them' }).changed, true, 'a check of a full task was refused');
  mark(n, { by: 'mona', files: [{ name: 'f3', fingerprint: B }] });
  assert.equal(get(n).builtFiles.find((e) => e.name === 'f3').fingerprint, B, 'a re-send on a full task was refused');
});

test('#9105 review 1: a --check from the task\'s own marker that also sends --waiting is a check, not a correction of the wait', () => {
  const n = freshTask();
  mark(n, { by: 'zed', files: [{ name: 'b.md', fingerprint: B }] });
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }] });
  const r = mark(n, { by: 'mona', check: ['b.md'], waitingOn: 'review' });
  assert.equal(r.ok, true);
  assert.deepEqual(byName(n, 'b.md').checkedBy, ['mona'], 'the check was answered ok and recorded nowhere');
  assert.equal(byName(n, 'a.md').fingerprint, A, 'a file not named changed');
});

test('#9105 review 1: the mark says which files it sent', () => {
  const n = freshTask();
  assert.deepEqual(mark(n, { by: 'mona', files: two() }).sentFiles, ['report.md', 'data.csv']);
  assert.deepEqual(mark(n, { by: 'ivy', files: [{ name: 'c.md', fingerprint: C }] }).sentFiles, ['c.md']);
  assert.equal(mark(n, { by: 'zed', note: 'checked' }).sentFiles, undefined);
  assert.deepEqual(mark(n, { by: 'mona', fingerprint: D, filePath: P_DATA }).sentFiles, ['data.csv']);
});

test('#9105 review 3: an older board\'s replacement (a new builtAt) leaves the one file it knows', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two() });
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.number === n ? { ...x, builtAt: new Date(Date.now() + 5).toISOString(), builtFingerprint: D, builtCheckedBy: [] } : x)) }));
  assert.deepEqual(tasks.filesOf(get(n)).map((e) => [e.name, e.fingerprint]), [['report.md', D]], 'a file the older board never knew was read as current');
});

test('#9105 review 5: a check of one file leaves the task waiting on a review while another file has none', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two(), waitingOn: 'review' });
  mark(n, { by: 'ivy', check: ['data.csv'], note: 'data checked' });
  assert.equal(get(n).builtWaitingOn, 'review', 'one checked file ended the review of both');
  mark(n, { by: 'mona', files: [{ name: 'report.md', fingerprint: C }], note: 'fixed report' });
  assert.equal(get(n).builtWaitingOn, 'review', 'a re-send dropped the wait');
  mark(n, { by: 'zed', check: ['report.md'], note: 'report checked' });
  assert.equal(get(n).builtWaitingOn, undefined, 'CONTROL: every file checked ends the review');
  // CONTROL: a one-file task's check ends it at once, as before #9105.
  const m = freshTask();
  mark(m, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }], waitingOn: 'review' });
  mark(m, { by: 'ivy', note: 'checked' });
  assert.equal(get(m).builtWaitingOn, undefined);
});

test('#9105 review 5: the single-file fields describe a named current file before an unnamed old one', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A });   // from before files had names
  mark(n, { by: 'mona', files: [{ name: 'report.md', fingerprint: B }, { name: 'data.csv', fingerprint: C }] });
  assert.equal(get(n).builtFingerprint, B, 'the unnamed, maybe superseded file is the task\'s headline file');
  assert.deepEqual(tasks.filesOf(get(n)).map((e) => e.name), ['', 'report.md', 'data.csv']);
});

test('#9105 review 5: diskName gives the name as the folder lists it', () => {
  const { diskName } = require('./builtfiles');
  assert.equal(diskName('Report.pdf', ['report.pdf', 'x']), 'report.pdf');
  assert.equal(diskName('report.pdf', ['report.pdf', 'Report.pdf']), 'report.pdf', 'an exact entry did not win');
  assert.equal(diskName('REPORT.PDF', ['report.pdf', 'Report.pdf']), 'REPORT.PDF', 'an ambiguous match was guessed');
  assert.equal(diskName('Résumé.pdf', ['Résumé.pdf']), 'Résumé.pdf');
  assert.equal(diskName('a.md', []), 'a.md');
});

test('#9105 review 6: one checker who checks the files over two marks ends the review', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: two(), waitingOn: 'review' });
  mark(n, { by: 'ivy', check: ['report.md'], note: 'one' });
  assert.equal(get(n).builtWaitingOn, 'review');
  mark(n, { by: 'ivy', check: ['data.csv'], note: 'two' });
  assert.equal(get(n).builtWaitingOn, undefined, 'the checker of every file could not end the review');
  // CONTROL: the files' own sender re-marking never ends it.
  const m = freshTask();
  mark(m, { by: 'mona', files: two(), waitingOn: 'review' });
  mark(m, { by: 'ivy', check: ['report.md', 'data.csv'], note: 'both' });
  assert.equal(get(m).builtWaitingOn, undefined);
  const k = freshTask();
  mark(k, { by: 'mona', files: two(), waitingOn: 'review' });
  mark(k, { by: 'mona', files: [{ name: 'report.md', fingerprint: C }], note: 'again' });
  assert.equal(get(k).builtWaitingOn, 'review', 'the sender\'s own re-send ended the review');
});

test('#9105 review 6: sentPrints tells two files without a name apart', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A });
  mark(n, { by: 'bob', files: [{ name: 'g.md', fingerprint: B }] });
  const r = mark(n, { by: 'cat', fingerprint: C });
  assert.deepEqual(r.sentPrints, [{ name: '', fingerprint: C }]);
  assert.deepEqual(get(n).builtFiles.map((e) => [e.name, e.fingerprint]), [['', A], ['g.md', B], ['', C]]);
});

test('#9105 review 7: withdrawing frees places under the cap, as the refusal says', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: Array.from({ length: 20 }, (_, i) => ({ name: 'f' + i, fingerprint: A })) });
  assert.match(refused(n, { by: 'mona', files: [{ name: 'new', fingerprint: B }] }), /withdraw yours first with a mark without --file/);
  mark(n, { by: 'mona', note: 'withdraw them all' });
  mark(n, { by: 'mona', files: [{ name: 'new', fingerprint: B }] });
  const t = get(n);
  assert.ok(t.builtFiles.length <= tasks.BUILT_FILES_MAX, 'the store grew past the cap: ' + t.builtFiles.length);
  assert.deepEqual(t.builtFiles.filter((e) => e.fingerprint).map((e) => e.name), ['new']);
  assert.equal(t.builtFiles.some((e) => e.name === 'f0'), false, 'the oldest withdrawn entry was not the one to go');
});

test('#9105 review 7: a sender\'s own re-mark never ends a review it asked for again', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }] });
  mark(n, { by: 'zed', files: [{ name: 'b.md', fingerprint: B }] });
  mark(n, { by: 'kit', note: 'checked all' });
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }], waitingOn: 'review' });
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A }], note: 'again' });
  assert.equal(get(n).builtWaitingOn, 'review', 'the sender ended its own review');
  // CONTROL: an agent who sent none of the files ends it.
  mark(n, { by: 'kit', note: 'looked again' });
  assert.equal(get(n).builtWaitingOn, undefined);
});

test('#9105 review 7: a rebuild from the single-file fields never makes two entries of one name', () => {
  const n = freshTask();
  mark(n, { by: 'mona', files: [{ name: 'a.md', fingerprint: A, filePath: path.join(SANDBOX, 'a.md') }, { name: 'b.md', fingerprint: B }] });
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.number === n ? { ...x, builtFingerprint: C, builtFilePath: path.join(SANDBOX, 'b.md') } : x)) }));
  const names = tasks.filesOf(get(n)).map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'two entries share a name: ' + JSON.stringify(names));
});

test('#9105 review 8: two senders checking each other\'s files end the review; a bare re-mark still does not', () => {
  const n = freshTask();
  mark(n, { by: 's1', files: [{ name: 'a.md', fingerprint: A }], waitingOn: 'review' });
  mark(n, { by: 's2', files: [{ name: 'b.md', fingerprint: B }] });
  mark(n, { by: 's1', check: ['b.md'], note: 'read b' });
  assert.equal(get(n).builtWaitingOn, 'review');
  mark(n, { by: 's2', check: ['a.md'], note: 'read a' });
  assert.equal(get(n).builtWaitingOn, undefined, 'a review checked both ways never ended');
  mark(n, { by: 's1', files: [{ name: 'a.md', fingerprint: A }], waitingOn: 'review' });
  mark(n, { by: 's1', files: [{ name: 'a.md', fingerprint: A }], note: 'again' });
  assert.equal(get(n).builtWaitingOn, 'review', 'CONTROL: a sender\'s bare re-mark ended the review');
});
