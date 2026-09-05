'use strict';
/* #2264: DELETE AND REMOVE an OpenAI account. forgetAccount renames it aside
 * (the sign-in survives, and it CAN forget the default); removeAccount DELETES
 * the directory and REFUSES the default, because deleting the default codex home
 * is not the recoverable act forgetting it is. These drive the real function.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-remove-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const openai = require('./openaiaccounts');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* An OpenAI account is a .codex-<label> dir (default: .codex) holding codex's
   auth.json with a key -- what identityOf reads. */
function acct(label) {
  const isDefault = label === 'default';
  const dir = nodePath.join(SANDBOX, isDefault ? '.codex' : '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-test' + label + 'testtesttesttest' }));
  return dir;
}

test('#2264: removeAccount DELETES a non-default OpenAI account (dir gone, not renamed)', () => {
  const dir = acct('deleteme');
  assert.ok(openai.list().some((a) => a.dir === dir), 'it must be listed FIRST, or the delete proves nothing');

  const got = openai.removeAccount(dir, []);
  assert.equal(got.ok, true, got.because);
  assert.equal(got.removed, true);
  assert.ok(!openai.list().some((a) => a.dir === dir), 'it is gone from the list');
  assert.ok(!fs.existsSync(dir), 'THE DIRECTORY IS DELETED -- this deletes, it does not rename');
  const leftovers = fs.readdirSync(SANDBOX).filter((n) => n.startsWith(openai.FORGOTTEN_PREFIX));
  assert.deepEqual(leftovers, [], 'a delete must not leave a renamed-aside copy');
});

test('#2264: the DEFAULT .codex is REFUSED for delete (unlike forget), and survives', () => {
  const dir = acct('default');
  assert.ok(openai.list().some((a) => a.dir === dir && a.isDefault), 'the default must be listed first');
  const got = openai.removeAccount(dir, []);
  assert.equal(got.ok, false);
  assert.equal(got.removed, false);
  assert.match(got.because, /default account cannot be deleted/);
  assert.ok(fs.existsSync(dir), 'the default codex home must survive the refusal');
});

test('#2264: a running agent refuses the delete, NAMED, and the account survives', () => {
  const dir = acct('busy');
  const got = openai.removeAccount(dir, ['Mona Lisa', 'Renet Tilley']);
  assert.equal(got.ok, false);
  assert.equal(got.removed, false);
  assert.deepEqual(got.usedBy, ['Mona Lisa', 'Renet Tilley']);
  assert.match(got.because, /2 agents are set up to run on this account/);
  assert.ok(fs.existsSync(dir), 'a refused delete must not touch the directory');
});

test('#2264: a name-shaped folder with no sign-in is never deleted', () => {
  const notAcct = nodePath.join(SANDBOX, '.codex-notanaccount');
  fs.mkdirSync(notAcct, { recursive: true });
  fs.writeFileSync(nodePath.join(notAcct, 'a-real-file.txt'), 'do not delete me');
  const got = openai.removeAccount(notAcct, []);
  assert.equal(got.ok, false);
  assert.equal(got.removed, false);
  assert.match(got.because, /not an OpenAI account/);
  assert.ok(fs.existsSync(nodePath.join(notAcct, 'a-real-file.txt')), 'a non-account folder must be left untouched');
});

test('#2264: a path outside home is refused, and an already-gone account is a quiet success', () => {
  assert.equal(openai.removeAccount('/etc', []).ok, false, 'a path outside home is refused');
  const dir = nodePath.join(SANDBOX, '.codex-neverexisted');
  const got = openai.removeAccount(dir, []);
  assert.equal(got.ok, true);
  assert.equal(got.removed, false);
  assert.match(got.because, /already gone/);
});

test('#2264: the ENV-MOVED default is refused too, not just the literal .codex', () => {
  /* The real default follows AGENT_WORKFORCE_CODEX_HOME. A basename check
     (base === '.codex') would MISS a moved `.codex-<label>` default and
     irreversibly delete the home other codex agents resolve to. Red-capable:
     with the old basename guard this deleted `.codex-work`. */
  const moved = nodePath.join(SANDBOX, '.codex-work');
  fs.mkdirSync(moved, { recursive: true });
  fs.writeFileSync(nodePath.join(moved, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-worktesttesttesttest' }));
  const prev = process.env.AGENT_WORKFORCE_CODEX_HOME;
  process.env.AGENT_WORKFORCE_CODEX_HOME = moved;
  try {
    assert.ok(openai.list().some((a) => a.dir === moved && a.isDefault),
      'with the env moved, .codex-work must be the default (or the arm is vacuous)');
    const got = openai.removeAccount(moved, []);
    assert.equal(got.ok, false, 'the env-moved default must be refused');
    assert.equal(got.removed, false);
    assert.match(got.because, /default account cannot be deleted/);
    assert.ok(fs.existsSync(moved), 'the env-moved default must survive the refusal');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_CODEX_HOME;
    else process.env.AGENT_WORKFORCE_CODEX_HOME = prev;
  }
});
