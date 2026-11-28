'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8663: a BRIEF.md over 64 KB was refused and read exactly like a missing one, so `kosmos project show` said
 * "there is no readable BRIEF.md" and the Assigner lost the project's goal, while the file was there with both
 * sections. Now the limit is 256 KB (the one projects.readBriefSafely already used), and when a brief is not read
 * `project show` says why: too large (with its size and the limit), a link, not a file, or unreadable.
 *
 * Real files in a temp folder, read by the real engine/brief.js, rendered by the real engine/projectview.js.
 *
 *   node --test engine/briefsize-8663.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'briefsize-8663-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const ON_WINDOWS = process.platform === 'win32';   // kosmos#8378: one arm pins each platform's answer
const assert = require('node:assert/strict');
const brief = require('./brief');
const projects = require('./projects');
const view = require('./projectview');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

let seq = 0;
function folderWith(content) {
  const dir = path.join(SANDBOX, 'p' + (seq += 1));
  fs.mkdirSync(dir);
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'BRIEF.md'), content);
  return dir;
}
const HEAD = '# Lease\n\n## Goal\n\nSign the lease.\n\n## Done looks like\n\nThe lease is signed.\n\n## Notes\n\n';
/* A brief of exactly `bytes` bytes: the head, then whole lines of filler, then the last line padded to fit. */
function briefOf(bytes) {
  let s = HEAD;
  while (Buffer.byteLength(s) + 10 <= bytes) s += 'note line\n';
  return s + 'x'.repeat(bytes - Buffer.byteLength(s));
}

/* `project show` for a real folder: projects.describe and projectview.overviewOf with the real brief reader. */
function show(folder) {
  const raw = { id: 'lease', name: 'Lease', folder, agents: [], tasks: [] };
  const described = projects.describe(raw, [], [raw]);
  return view.renderShow({ project: view.overviewOf(described, [], { now: Date.now(), folderOf: () => null }), agentsUnreadable: false });
}
const line = (out, prefix) => out.find((l) => l.startsWith(prefix)) || '';

test('the size the report was about (over 64 KB) is read whole: goal and done, for project show and the Assigner', () => {
  const dir = folderWith(briefOf(100 * 1024));
  const b = brief.readBrief(dir);
  assert.equal(b.found, true, 'a 100 KB brief read as no brief');
  assert.equal(b.goal, 'Sign the lease.');
  assert.equal(b.done, 'The lease is signed.');
  assert.equal(brief.readGoal(dir), 'Sign the lease.', 'the Assigner\'s reader lost the goal');
  const out = show(dir);
  assert.equal(line(out, 'Brief:'), '', 'a brief that was read got a Brief line');
  assert.equal(line(out, 'Goal'), 'Goal (as written in BRIEF.md): "Sign the lease."');
  assert.equal(line(out, 'Done'), 'Done looks like (as written in BRIEF.md): "The lease is signed."');
});

test('one limit: brief.js reads exactly as far as projects.readBriefSafely, which decides whether Done is set', () => {
  const at = folderWith(briefOf(brief.MAX_BYTES));
  const over = folderWith(briefOf(brief.MAX_BYTES + 1));
  assert.equal(fs.statSync(path.join(at, 'BRIEF.md')).size, brief.MAX_BYTES, 'fixture');
  assert.equal(brief.readBrief(at).found, true, 'a brief of exactly the limit was refused');
  assert.equal(brief.readBrief(over).found, false, 'a brief one byte over the limit was read');
  // The other reader: doneSet is null only when it could not read the brief. Both readers must agree at both sizes.
  assert.notEqual(projects.describe({ id: 'a', name: 'A', folder: at, agents: [], tasks: [] }, [], []).doneSet, null, 'projects.js refused what brief.js read');
  assert.equal(projects.describe({ id: 'b', name: 'B', folder: over, agents: [], tasks: [] }, [], []).doneSet, null, 'projects.js read what brief.js refused');
});

test('too large: project show names the size and the limit, not "no readable BRIEF.md"', () => {
  const dir = folderWith(briefOf(brief.MAX_BYTES + 7 * 1024));
  const size = fs.statSync(path.join(dir, 'BRIEF.md')).size;
  const b = brief.readBrief(dir);
  assert.equal(b.why, 'too_large');
  assert.equal(b.size, size);
  assert.equal(brief.readGoal(dir), null, 'a brief over the limit was read for its goal');
  const out = show(dir);
  assert.equal(line(out, 'Brief:'), 'Brief: BRIEF.md is ' + Math.ceil(size / 1024) + ' KB, over the ' + (brief.MAX_BYTES / 1024)
    + ' KB Kosmos reads, so no goal or "done" is read. Shorten it, or move notes out of it into another file.', out.join('\n'));
  assert.equal(line(out, 'Goal'), '', 'a brief that was not read printed a Goal line');
});

test('nothing read: project show says which (missing, a link, not a file, unreadable)', () => {
  const missing = folderWith();
  assert.equal(brief.readBrief(missing).why, 'missing');
  assert.equal(line(show(missing), 'Brief:'), 'Brief: there is no readable BRIEF.md in the folder, so no goal or "done" is written down.');

  const linked = folderWith();
  const target = path.join(SANDBOX, 'elsewhere.md');
  fs.writeFileSync(target, HEAD);
  fs.symlinkSync(target, path.join(linked, 'BRIEF.md'));
  assert.equal(brief.readBrief(linked).why, 'symlink');
  assert.equal(brief.readBrief(linked).goal, null, 'a linked brief was followed');
  assert.match(line(show(linked), 'Brief:'), /is a link to another file/);

  const asDir = folderWith();
  fs.mkdirSync(path.join(asDir, 'BRIEF.md'));
  assert.equal(brief.readBrief(asDir).why, 'not_a_file');
  assert.match(line(show(asDir), 'Brief:'), /is not a file/);

});

/* kosmos#8378: its own test, so the link and not-a-file arms above still run on Windows. */
test('nothing read: a project folder that is a plain file says unreadable (POSIX) or missing (Windows)', () => {
  /* kosmos#8378: a path under a plain file is ENOTDIR on POSIX, which reads as unreadable; Windows answers ENOENT, which
     reads as missing. Both say nothing was read; this pins each platform's answer rather than skipping Windows. */
  const notDir = path.join(SANDBOX, 'plain-file');   // a project folder path that is a file
  fs.writeFileSync(notDir, 'not a folder');
  if (ON_WINDOWS) {
    assert.equal(brief.readBrief(notDir).why, 'missing');
    assert.equal(line(show(notDir), 'Brief:'), 'Brief: there is no readable BRIEF.md in the folder, so no goal or "done" is written down.');
    return;
  }
  assert.equal(brief.readBrief(notDir).why, 'unreadable');
  assert.equal(line(show(notDir), 'Brief:'), 'Brief: Kosmos could not read BRIEF.md just now, so no goal or "done" is read. Check that you can open it.');
});

test('an older board (no briefWhy or sizes in its answer) prints the old sentence', () => {
  const out = view.renderShow({ project: { id: 'pv', name: 'Shown', folder: '/x', briefFound: false, members: [], tasks: { total: 0 } } });
  assert.equal(line(out, 'Brief:'), 'Brief: there is no readable BRIEF.md in the folder, so no goal or "done" is written down.');
  // A too_large answer missing its sizes says the plain sentence rather than a sentence with no numbers in it.
  const partial = view.renderShow({ project: { id: 'pv', name: 'Shown', folder: '/x', briefFound: false, briefWhy: 'too_large', members: [], tasks: { total: 0 } } });
  assert.equal(line(partial, 'Brief:'), 'Brief: there is no readable BRIEF.md in the folder, so no goal or "done" is written down.');
});
