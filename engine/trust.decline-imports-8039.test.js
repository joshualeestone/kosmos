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
  assert.deepEqual(trust.declineExternalImports(f, { configDir: dir }), { ok: true, wrote: true });
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
  assert.deepEqual(trust.declineExternalImports(sub, { configDir: dir }), { ok: true, wrote: true });
  const projects = read(dir).projects;
  assert.equal(projects[root] && projects[root][S], true, 'not written under the root: ' + JSON.stringify(Object.keys(projects)));
  assert.equal(projects[sub], undefined, 'written under the subfolder, which Claude Code does not read');
  /* A second press finds it answered, and does not write again. */
  assert.equal(trust.declineExternalImports(sub, { configDir: dir }).wrote, false);
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
