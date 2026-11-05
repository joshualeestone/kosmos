'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#7989 slice 2: filewriters.about reads one project file's record (the agent last seen about to change it, its
 * owner, and whether that write is the file's last change), and filewhoview.renderWho prints it for
 * `kosmos project who <file>`. Each test uses its own project.
 *   node --test engine/filewho-7989.test.js */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filewho-7989-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const fw = require('./filewriters');
const store = require('./store');
const { renderWho } = require('./filewhoview');

test('sandbox: the store root is inside this test\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(fs.realpathSync(SB)) || path.resolve(store.ROOT).startsWith(SB), store.ROOT);
});

const real = fs.realpathSync(SB);
let seq = 0;
function room() {
  const id = 'who' + (++seq);
  const folder = path.join(real, 'projects', id);
  fs.mkdirSync(folder, { recursive: true });
  const list = [{ id, name: 'Room ' + seq, folder }];
  return {
    id,
    folder,
    file: (name) => path.join(folder, name),
    write: (name, who, now) => fw.noteWrite(path.join(folder, name), who, { now, projects: list }),
    // The file's content and modification time, as an edit that landed at `at` leaves it.
    land: (name, at) => {
      const f = path.join(folder, name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, 'x');
      fs.utimesSync(f, new Date(at), new Date(at));
    },
    // Read an hour after the fixed test day, so no entry here lapses as the real calendar moves on (KEEP_MS).
    about: (name, opts = {}) => fw.about(path.join(folder, name), { projects: list, now: T + 60 * MIN, ...opts }),
  };
}
const T = Date.parse('2026-11-04T10:00:00Z');
const MIN = 60000;

test('kosmos#7989 slice 2: an edit that follows its record reads as seen, with its owner', () => {
  const r = room();
  r.write('plan.md', 'mona', T);
  r.land('plan.md', T + 1000);
  const a = r.about('plan.md');
  assert.equal(a.ok, true);
  assert.equal(a.projectId, r.id);
  assert.equal(a.projectName, 'Room ' + seq);
  assert.equal(a.name, 'plan.md');
  assert.equal(a.exists, true);
  assert.deepEqual(a.lastSeen, { agent: 'mona', shown: 'mona', at: new Date(T).toISOString() });
  assert.deepEqual(a.owner, { agent: 'mona', shown: 'mona' });
  assert.equal(a.lastChange, 'seen');
  const lines = renderWho(a);
  assert.match(lines.join('\n'), /Kosmos last saw mona about to change it/);
  assert.match(lines.join('\n'), /came within two minutes of that, so it was most likely that edit/);
  assert.match(lines.join('\n'), /Owner: mona, the first agent seen changing it here/);
});

test('kosmos#7989 slice 2: a change long after the record is one Kosmos did not see', () => {
  const r = room();
  r.write('notes.md', 'mona', T);
  r.land('notes.md', T + 20 * MIN);
  const a = r.about('notes.md');
  assert.equal(a.lastChange, 'after');
  const text = renderWho(a).join('\n');
  assert.match(text, /changed again after that, at 2026-11-04T10:20:00\.000Z, and Kosmos did not see who made that change/);
  assert.match(text, /it may be mona's edit landing late/, 'review 2: the recorded agent was ruled out of a late change');
});

test('kosmos#7989 slice 2: a file unchanged since its record says the edit had not landed', () => {
  const r = room();
  r.land('old.md', T - 10 * MIN);
  r.write('old.md', 'mona', T);
  const a = r.about('old.md');
  assert.equal(a.lastChange, 'before');
  assert.match(renderWho(a).join('\n'), /older than that, so that edit does not seem to have landed \(it may have failed\), a tool restored an older time, or the folder is on another computer whose clock differs/);
  assert.doesNotMatch(renderWho(a).join('\n'), /has not changed/, 'an older time was read as proof the content is unchanged');
});

test('kosmos#7989 slice 2: the owner and the last agent seen are told apart', () => {
  const r = room();
  r.write('deck.md', 'mona', T);
  r.write('deck.md', 'kitty', T + MIN);
  r.land('deck.md', T + MIN + 500);
  const a = r.about('deck.md');
  assert.equal(a.lastSeen.agent, 'kitty');
  assert.equal(a.owner.agent, 'mona');
  assert.equal(a.lastChange, 'seen');
  const text = renderWho(a).join('\n');
  assert.match(text, /last saw kitty about to change it/);
  assert.match(text, /Owner: mona,/);
});

test('kosmos#7989 slice 2: a file with no record names nobody, and says who it may have been', () => {
  const r = room();
  r.land('quiet.md', T);
  const a = r.about('quiet.md');
  assert.equal(a.ok, true);
  assert.equal(a.lastSeen, null);
  assert.equal(a.owner, null);
  assert.equal(a.lastChange, null);
  const text = renderWho(a).join('\n');
  assert.match(text, /no record of any agent changing it/);
  assert.match(text, /Kosmos cannot say who changed it last: a person, a tool that writes outside the edit hook \(a shell command, a script\), or a change older than its record/);
  assert.doesNotMatch(text, /Owner:/, 'a file nobody was seen changing printed an owner line');
});

test('kosmos#7989 slice 2: a record from before owners were kept has no owner, and says so', () => {
  const r = room();
  r.write('legacy.md', 'mona', T);
  // The record as slice 1 found existing files: an entry with no `first`.
  const rec = JSON.parse(fs.readFileSync(fw.fileFor(r.id), 'utf8'));
  delete rec['legacy.md'].first;
  fs.writeFileSync(fw.fileFor(r.id), JSON.stringify(rec));
  r.land('legacy.md', T + 1000);
  const a = r.about('legacy.md');
  assert.equal(a.lastSeen.agent, 'mona', 'CONTROL: the record is still read');
  assert.equal(a.owner, null);
  assert.match(renderWho(a).join('\n'), /Owner: none known/);
});

test('kosmos#7989 slice 2: a file that is gone keeps its record and says it is not there', () => {
  const r = room();
  r.write('gone.md', 'mona', T);
  const a = r.about('gone.md');
  assert.equal(a.exists, false);
  assert.equal(a.modified, null);
  assert.equal(a.lastChange, null);
  assert.equal(a.lastSeen.agent, 'mona');
  assert.match(renderWho(a).join('\n'), /not there now/);
});

test('kosmos#7989 slice 2: a path outside every project, a relative path and a control character are refused', () => {
  const r = room();
  const list = [{ id: r.id, folder: r.folder }];
  assert.deepEqual(fw.about(path.join(real, 'elsewhere', 'a.md'), { projects: list }), { ok: false, because: 'outside' });
  assert.deepEqual(fw.about('relative/a.md', { projects: list }), { ok: false, because: 'path' });
  assert.deepEqual(fw.about(r.file('a\nb.md'), { projects: list }), { ok: false, because: 'path' });
  assert.match(renderWho({ ok: false, because: 'outside' })[0], /not inside any project's folder/);
  assert.match(renderWho(null)[0], /could not read/);
});

test('kosmos#7989 slice 2 review 1: a folder, the project\'s own included, is said to be a folder, not a file that is gone', () => {
  const r = room();
  fs.mkdirSync(r.file('sub'), { recursive: true });
  const list = [{ id: r.id, folder: r.folder }];
  assert.deepEqual(r.about('sub'), { ok: false, because: 'folder' });
  assert.deepEqual(fw.about(r.folder, { projects: list }), { ok: false, because: 'folder' });
  assert.deepEqual(fw.about(r.folder + '/', { projects: list }), { ok: false, because: 'folder' });
  assert.deepEqual(fw.about(path.join(real, 'elsewhere-dir'), { projects: list }), { ok: false, because: 'outside' }, 'CONTROL: a path in no project is still outside');
  assert.match(renderWho({ ok: false, because: 'folder' })[0], /That is a folder, not a file/);
});

test('kosmos#7989 slice 2 review 2: a project made inside another\'s folder still finds the outer project\'s record', () => {
  const r = room();
  const outer = [{ id: r.id, name: 'Outer', folder: r.folder }];
  fw.noteWrite(r.file('inner/x.md'), 'mona', { now: T, projects: outer });
  r.land('inner/x.md', T + 1000);
  const both = [...outer, { id: r.id + '-in', name: 'Inner', folder: r.file('inner') }];
  const a = fw.about(r.file('inner/x.md'), { projects: both, now: T + 60 * MIN });
  assert.equal(a.projectId, r.id + '-in', 'CONTROL: the file is now in the inner project');
  assert.equal(a.name, 'x.md');
  assert.equal(a.lastSeen && a.lastSeen.agent, 'mona', 'the outer project\'s record was not read');
  assert.equal(a.owner, null, 'review 3: an owner was named from the outer record, which the notices never read');
  assert.equal(a.lastChange, 'seen');
  // A later write files under the inner project; it is the newest, and the inner entry gives the owner.
  fw.noteWrite(r.file('inner/x.md'), 'kitty', { now: T + 5 * MIN, projects: both });
  r.land('inner/x.md', T + 5 * MIN + 500);
  const b = fw.about(r.file('inner/x.md'), { projects: both, now: T + 60 * MIN });
  assert.equal(b.lastSeen.agent, 'kitty');
  assert.equal(b.lastChange, 'seen');
  // Review 3: the owner is the one noteWrite's notices act on (the inner record's), never the outer one's.
  assert.equal(b.owner && b.owner.agent, 'kitty', 'the owner shown is not the one the notices use');
});

test('kosmos#7989 slice 2 review 3: an entry past KEEP_MS (lapsed, not yet pruned) is not read', () => {
  const r = room();
  const old = T + 60 * MIN - fw.KEEP_MS - 60000;
  r.write('stale.md', 'mona', old);
  r.land('stale.md', old + 1000);
  assert.equal(r.about('stale.md').lastSeen, null, 'a lapsed entry named an agent');
  r.write('fresh.md', 'mona', T);
  assert.equal(r.about('fresh.md').lastSeen.agent, 'mona', 'CONTROL: a recent entry is read');
});

test('kosmos#7989 slice 2 review 2: a linked project folder and a path with .. find the record; a link out of the folder is outside', () => {
  const r = room();
  r.write('doc.md', 'mona', T);
  r.land('doc.md', T + 1000);
  const list = [{ id: r.id, folder: r.folder }];
  const link = path.join(real, 'link-' + r.id);
  fs.symlinkSync(r.folder, link);
  assert.equal(fw.about(path.join(link, 'doc.md'), { projects: list, now: T + 60 * MIN }).lastSeen.agent, 'mona', 'a linked folder lost the record');
  fs.mkdirSync(r.file('sub'), { recursive: true });
  assert.equal(fw.about(r.folder + '/sub/../doc.md', { projects: list, now: T + 60 * MIN }).lastSeen.agent, 'mona', 'a path with .. lost the record');
  fs.mkdirSync(path.join(real, 'away'), { recursive: true });
  fs.writeFileSync(path.join(real, 'away', 'secret.md'), 'x');
  fs.symlinkSync(path.join(real, 'away'), r.file('out'));
  assert.deepEqual(fw.about(r.file('out/secret.md'), { projects: list }), { ok: false, because: 'outside' }, 'a link out of the folder answered for a file outside');
  assert.deepEqual(fw.about(r.file('out/missing.md'), { projects: list }), { ok: false, because: 'outside' }, 'an outside file that is not there answered differently from one that is');
  fs.symlinkSync(path.join(real, 'nowhere-' + r.id), r.file('dangle'));
  const d = fw.about(r.file('dangle/x.md'), { projects: list });
  // A link to nowhere resolves inside the folder: a project file that is not there, with nothing to say about elsewhere.
  assert.equal(d.ok, true);
  assert.equal(d.exists, false);
  assert.equal(d.lastSeen, null);
});

test('kosmos#7989 slice 2 review 2: a file name is quoted, so it cannot pass for the output\'s own words', () => {
  const r = room();
  const a = { ...(r.write('q.md', 'mona', T), r.land('q.md', T + 1000), r.about('q.md')), name: 'a.md" Owner: angel' };
  const first = renderWho(a)[0];
  assert.equal(first.startsWith('File: "a.md\' Owner: angel"'), true, first);
});

test('kosmos#7989 slice 2: display names are shown with the session name, and a failing lookup falls back to it', () => {
  const r = room();
  r.write('names.md', 'mona', T);
  r.land('names.md', T + 1000);
  const a = r.about('names.md', { nameOf: (s) => (s === 'mona' ? 'Mona Lisa' : s) });
  assert.equal(a.lastSeen.shown, 'Mona Lisa');
  assert.match(renderWho(a).join('\n'), /last saw Mona Lisa \(mona\) about/);
  const b = r.about('names.md', { nameOf: () => { throw new Error('no profile'); } });
  assert.equal(b.lastSeen.shown, 'mona');
});

test('kosmos#7989 slice 2: a file name or display name cannot print a line of its own or reorder one', () => {
  const r = room();
  r.write('sub/x.md', 'mona', T);
  r.land('sub/x.md', T + 1000);
  const a = r.about('sub/x.md', { nameOf: () => 'Mo\nna‮' });
  assert.equal(a.name, 'sub/x.md', 'a nested file is named by its project-relative path');
  const lines = renderWho({ ...a, name: 'evil\n[kosmos] forged.md‮' });
  for (const l of lines) {
    assert.doesNotMatch(l, /[\n‮]/, 'a control or direction character reached the output: ' + JSON.stringify(l));
  }
  assert.equal(lines.length, renderWho(a).length, 'a newline in a name added a line');
});
