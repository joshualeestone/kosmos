'use strict';
/**
 * #6063: an account move carries the person's own answer to Claude Code's "allow external imports?" question.
 *
 * Claude Code asks it once per folder PER ACCOUNT, so an agent moved to another account came up waiting on it with
 * nobody watching. The answer lives in two keys of projects[<folder>] in the account's .claude.json. The rule under
 * test: copy the old account's answer as it was, and never make one up.
 *
 *   node --test engine/trust.imports-6063.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'imports6063-')));
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
const trust = require('./trust');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const A = trust.IMPORTS_KEY;
const S = trust.IMPORTS_SHOWN_KEY;
let n = 0;

function acct(projects) {
  const dir = nodePath.join(SANDBOX, 'acct-' + (++n));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ projects: projects || {} }), 'utf8');
  return dir;
}
function folder() {
  const d = nodePath.join(SANDBOX, 'worker-' + (++n));
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync.native(d).split(nodePath.sep).join('/');
}
const entryOf = (dir, key) => (JSON.parse(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8')).projects || {})[key];
const bytesOf = (dir) => fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8');

test('#6063: a Yes on the old account is carried to the new one, beside what the entry already held', () => {
  const work = folder();
  const from = acct({ [work]: { [A]: true, [S]: true, hasTrustDialogAccepted: true } });
  const to = acct({ [work]: { hasTrustDialogAccepted: true, allowedTools: ['Read'] } });

  const r = trust.carryExternalImports(work, { fromConfigDir: from, configDir: to });
  assert.deepEqual(r, { ok: true, carried: true, approved: true });
  assert.deepEqual(entryOf(to, work), { hasTrustDialogAccepted: true, allowedTools: ['Read'], [A]: true, [S]: true },
    'the answer was not merged into the entry as it stood');
});

test('#6063 CONTROL: no answer on the old account writes nothing, so Kosmos never answers for the person', () => {
  const work = folder();
  const cases = [
    ['both false, what Claude Code records before it asks', { [A]: false, [S]: false }],
    ['no keys at all', { hasTrustDialogAccepted: true }],
    ['no entry for the folder', null],
  ];
  for (const [what, old] of cases) {
    const from = acct(old ? { [work]: old } : {});
    const to = acct({ [work]: { hasTrustDialogAccepted: true } });
    const before = bytesOf(to);
    const r = trust.carryExternalImports(work, { fromConfigDir: from, configDir: to });
    assert.equal(r.ok, true, what);
    assert.equal(r.carried, false, `${what}: an answer was carried that the person never gave`);
    assert.equal(bytesOf(to), before, `${what}: the new account's file was rewritten`);
  }
});

test('#6063: a No is carried as a No: the question stays answered and the imports stay off', () => {
  const work = folder();
  const from = acct({ [work]: { [A]: false, [S]: true } });
  const to = acct({ [work]: { hasTrustDialogAccepted: true } });

  const r = trust.carryExternalImports(work, { fromConfigDir: from, configDir: to });
  assert.deepEqual(r, { ok: true, carried: true, approved: false });
  assert.equal(entryOf(to, work)[A], false, 'a No on the old account became a Yes on the new one');
  assert.equal(entryOf(to, work)[S], true);
});

test('#6063: an answer already on the new account wins, in both directions', () => {
  const work = folder();
  for (const [oldAns, newAns] of [[{ [A]: true, [S]: true }, { [A]: false, [S]: true }], [{ [A]: false, [S]: true }, { [A]: true, [S]: true }]]) {
    const from = acct({ [work]: oldAns });
    const to = acct({ [work]: newAns });
    const before = bytesOf(to);
    const r = trust.carryExternalImports(work, { fromConfigDir: from, configDir: to });
    assert.equal(r.ok, true);
    assert.equal(r.carried, false, 'the new account\'s own answer was overwritten');
    assert.equal(bytesOf(to), before);
  }
});

test('#6063: both keys false on the new account is not an answer there, so the old answer is carried', () => {
  /* false/false is what Claude Code records for a folder before it asks. Reading it as an answer would leave the
     agent on the question. */
  const work = folder();
  const from = acct({ [work]: { [A]: true, [S]: true } });
  const to = acct({ [work]: { [A]: false, [S]: false, hasTrustDialogAccepted: true } });

  const r = trust.carryExternalImports(work, { fromConfigDir: from, configDir: to });
  assert.deepEqual(r, { ok: true, carried: true, approved: true });
  assert.deepEqual(entryOf(to, work), { [A]: true, [S]: true, hasTrustDialogAccepted: true });
});

test('#6063: the entry is made when the new account has none for the folder', () => {
  const work = folder();
  const from = acct({ [work]: { [A]: true, [S]: true } });
  const to = acct({ '/some/other/folder': { hasTrustDialogAccepted: true } });

  const r = trust.carryExternalImports(work, { fromConfigDir: from, configDir: to });
  assert.equal(r.carried, true, r.because);
  assert.deepEqual(entryOf(to, work), { [A]: true, [S]: true });
  assert.deepEqual(entryOf(to, '/some/other/folder'), { hasTrustDialogAccepted: true }, 'another folder\'s entry changed');
});

test('#6063: null means the default account, read where a default-account agent reads it', () => {
  const work = folder();
  const def = acct({ [work]: { [A]: true, [S]: true } });
  const to = acct({});
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(def, '.claude.json');
  try {
    const out = trust.carryExternalImports(work, { fromConfigDir: null, configDir: to });
    assert.equal(out.carried, true, out.because);
    assert.equal(entryOf(to, work)[A], true);

    /* And the way back: from an account to the default one. */
    const work2 = folder();
    const from2 = acct({ [work2]: { [A]: true, [S]: true } });
    const back = trust.carryExternalImports(work2, { fromConfigDir: from2, configDir: null });
    assert.equal(back.carried, true, back.because);
    assert.equal(entryOf(def, work2)[A], true);

    const same = trust.carryExternalImports(work, { fromConfigDir: null, configDir: null });
    assert.deepEqual(same, { ok: true, carried: false, because: 'the account did not change' });
  } finally { delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG; }
});

test('#6063: it refuses without writing when the new account\'s file is missing, a link, or not readable as config', () => {
  const work = folder();
  const from = acct({ [work]: { [A]: true, [S]: true } });

  const missing = nodePath.join(SANDBOX, 'acct-missing');
  fs.mkdirSync(missing, { recursive: true });
  const r1 = trust.carryExternalImports(work, { fromConfigDir: from, configDir: missing });
  assert.equal(r1.ok, false);
  assert.equal(fs.existsSync(nodePath.join(missing, '.claude.json')), false, 'it created another tool\'s config file');

  const real = acct({});
  const linked = nodePath.join(SANDBOX, 'acct-linked');
  fs.mkdirSync(linked, { recursive: true });
  fs.symlinkSync(nodePath.join(real, '.claude.json'), nodePath.join(linked, '.claude.json'));
  const r2 = trust.carryExternalImports(work, { fromConfigDir: from, configDir: linked });
  assert.deepEqual(r2, { ok: false, because: 'their config file is a symlink' });
  assert.equal(entryOf(real, work), undefined, 'it wrote through the link');

  const broken = acct({});
  fs.writeFileSync(nodePath.join(broken, '.claude.json'), '{ not json', 'utf8');
  const r3 = trust.carryExternalImports(work, { fromConfigDir: from, configDir: broken });
  assert.equal(r3.ok, false);
  assert.equal(bytesOf(broken), '{ not json');

  const gone = trust.carryExternalImports(nodePath.join(SANDBOX, 'no-such-folder'), { fromConfigDir: from, configDir: real });
  assert.deepEqual(gone, { ok: false, because: 'that folder is not there' });
});
