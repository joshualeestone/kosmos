'use strict';
/**
 * kosmos#8039: "Continue without them" writes what Claude Code's own "No, disable external imports" writes for one
 * folder on one account (measured on 2.1.318: approved false, shown true), so a person can answer the question from the
 * board. It never writes a Yes, and an answer already there is left alone.
 *
 *   node --test engine/trust.decline-imports-8039.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'decline8039-')));
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
const trust = require('./trust');
const status = require('./status');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const A = trust.IMPORTS_KEY;
const S = trust.IMPORTS_SHOWN_KEY;
let n = 0;
function acct(projects) {
  const dir = nodePath.join(SANDBOX, 'acct-' + (++n));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ keep: 'mine', projects: projects || {} }), 'utf8');
  return dir;
}
function folder() {
  const d = nodePath.join(SANDBOX, 'worker-' + (++n));
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync.native(d).split(nodePath.sep).join('/');
}
const read = (dir) => JSON.parse(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'));

test('it writes exactly what No writes, on that account and that folder', () => {
  const dir = acct();
  const other = acct();
  const before = fs.readFileSync(nodePath.join(other, '.claude.json'), 'utf8');
  const f = folder();
  assert.deepEqual(trust.declineExternalImports(f, { configDir: dir }), { ok: true, wrote: true, key: f });
  const got = read(dir);
  assert.equal(got.projects[f][A], false);
  assert.equal(got.projects[f][S], true);
  assert.equal(got.keep, 'mine', 'the rest of the config went');
  assert.equal(fs.readFileSync(nodePath.join(other, '.claude.json'), 'utf8'), before, 'another account changed');
});

test('it merges into the folder\'s entry, keeping what the person has there', () => {
  const f = folder();
  const dir = acct({ [f]: { allowedTools: ['Bash'], hasTrustDialogAccepted: true } });
  trust.declineExternalImports(f, { configDir: dir });
  const e = read(dir).projects[f];
  assert.deepEqual(e.allowedTools, ['Bash']);
  assert.equal(e.hasTrustDialogAccepted, true);
  assert.equal(e[S], true);
});

test('an answer already there stands: a Yes is never turned into a No', () => {
  const f = folder();
  const dir = acct({ [f]: { [A]: true, [S]: true } });
  const before = fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8');
  const r = trust.declineExternalImports(f, { configDir: dir });
  assert.equal(r.ok, true);
  assert.equal(r.wrote, false);
  assert.equal(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'), before);
});

test('it refuses what it cannot answer for, and writes nothing', () => {
  const dir = acct();
  const before = fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8');
  assert.equal(trust.declineExternalImports('relative/path', { configDir: dir }).ok, false);
  assert.equal(trust.declineExternalImports(nodePath.join(SANDBOX, 'no-such-folder'), { configDir: dir }).ok, false);
  assert.equal(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'), before);
  const empty = nodePath.join(SANDBOX, 'no-config');
  fs.mkdirSync(empty, { recursive: true });
  assert.equal(trust.declineExternalImports(folder(), { configDir: empty }).ok, false, 'made up a config file');
});

test('inside a git repository the answer goes under the repository root, as Claude Code reads it', () => {
  const dir = acct();
  const root = folder();
  fs.mkdirSync(nodePath.join(root, '.git'));
  const sub = nodePath.join(root, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  assert.deepEqual(trust.declineExternalImports(sub, { configDir: dir }), { ok: true, wrote: true, key: root });
  const projects = read(dir).projects;
  assert.equal(projects[root] && projects[root][S], true, 'not written under the root: ' + JSON.stringify(Object.keys(projects)));
  assert.equal(projects[sub], undefined, 'written under the subfolder, which Claude Code does not read');
  /* A second press finds it answered, and does not write again. */
  assert.equal(trust.declineExternalImports(sub, { configDir: dir }).wrote, false);
});

test('a linked worktree (.git is a file) is refused, and nothing is written', () => {
  const dir = acct();
  const before = fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8');
  const wt = folder();
  fs.writeFileSync(nodePath.join(wt, '.git'), 'gitdir: /somewhere/else/.git/worktrees/x\n');
  const r = trust.declineExternalImports(wt, { configDir: dir });
  assert.equal(r.ok, false);
  assert.match(r.because, /linked worktree/);
  assert.match(r.because, /in its terminal on the computer it runs on/);
  assert.equal(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'), before);
});

test('a repository at the home folder is refused: the answer would hold for nearly everything', () => {
  const dir = acct();
  const before = fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8');
  const home = folder();
  fs.mkdirSync(nodePath.join(home, '.git'));
  const agent = nodePath.join(home, 'work', 'workers', 'someone');
  fs.mkdirSync(agent, { recursive: true });
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    const r = trust.declineExternalImports(agent, { configDir: dir });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.because, /every folder under it/);
    assert.equal(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8'), before);
    /* CONTROL: the same layout with the repository below home is answered, under its root. */
    const repo = nodePath.join(home, 'work');
    fs.mkdirSync(nodePath.join(repo, '.git'));
    assert.deepEqual(trust.declineExternalImports(agent, { configDir: dir }), { ok: true, wrote: true, key: repo });
  } finally {
    process.env.HOME = saved;
  }
});

const DIALOG = [
  '────────────────────────────────',
  '  Allow external CLAUDE.md file imports?',
  '',
  '  External imports:',
  '    /Users/someone/.claude/NOTES.md',
  '',
  '  ❯ No, disable external imports',
  '    Yes, allow external imports',
  '',
  '  Enter to confirm · Esc to cancel',
].join('\n');

test('importsDialogIn reads the live dialog only', () => {
  assert.equal(status.importsDialogIn(DIALOG), true);
  assert.equal(status.importsDialogIn(DIALOG + '\n\n\n'), true, 'blank padding under a real pane');
  assert.equal(status.importsDialogIn('> talking about Allow external CLAUDE.md file imports? in prose\n'), false);
  assert.equal(status.importsDialogIn(''), false);
  assert.equal(status.importsDialogIn(null), false);
  /* Another confirm dialog is not this one. */
  const other = DIALOG.replace('Allow external CLAUDE.md file imports?', 'Something else entirely')
    .replace('Yes, allow external imports', 'Yes, go on');
  assert.equal(status.importsDialogIn(other), false);
  /* An answered copy above a different live dialog is not this one. */
  assert.equal(status.importsDialogIn(DIALOG + '\n\n' + other), false);
});

test('importsDialogIn keys on the answer rows, so a long import list that pushes the heading off still reads', () => {
  const files = Array.from({ length: 15 }, (_, i) => '    /Users/someone/.claude/notes-' + i + '.md');
  const long = ['  External imports:', ...files, '', '  ❯ No, disable external imports', '    Yes, allow external imports', '', '  Enter to confirm · Esc to cancel'].join('\n');
  assert.equal(long.includes('Allow external CLAUDE.md'), false, 'premise: the heading is out of this tail');
  assert.equal(status.importsDialogIn(long), true);
  /* CONTROL: the same tail without the No row is not this question. */
  assert.equal(status.importsDialogIn(long.replace('No, disable external imports', 'No, exit')), false);
});
