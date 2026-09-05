'use strict';
/* #2264: DELETE AND REMOVE a Claude account -- the destructive sibling of
 * forgetAccount. forgetAccount renames the directory aside (the sign-in
 * survives); removeAccount DELETES it. These drive the real function against
 * real directories, and assert the guards that make deleting a credential safe:
 * the default is refused, a running agent refuses, and a name-shaped folder that
 * is NOT an account is never rm'd.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-claude-remove-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const accounts = require('./accounts');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function acct(label) {
  const isDefault = label === 'default';
  const dir = nodePath.join(SANDBOX, isDefault ? '.claude' : '.claude-' + label);
  fs.mkdirSync(dir, { recursive: true });
  const cfg = isDefault ? nodePath.join(SANDBOX, '.claude.json') : nodePath.join(dir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ oauthAccount: { emailAddress: label + '@example.com' } }));
  return dir;
}

test('#2264: removeAccount DELETES a non-default account (dir gone, not just hidden)', () => {
  const dir = acct('deleteme');
  assert.ok(accounts.list().some((a) => a.dir === dir), 'it must be listed FIRST, or the delete proves nothing');

  const got = accounts.removeAccount(dir, []);
  assert.equal(got.ok, true, got.because);
  assert.equal(got.removed, true);
  assert.ok(!accounts.list().some((a) => a.dir === dir), 'it is gone from the list');
  assert.ok(!fs.existsSync(dir), 'THE DIRECTORY IS DELETED -- this deletes, it does not rename');
  // And nothing was left under a .removed-* name either (that would be forget, not delete).
  const leftovers = fs.readdirSync(SANDBOX).filter((n) => n.startsWith(accounts.FORGOTTEN_PREFIX));
  assert.deepEqual(leftovers, [], 'a delete must not leave a renamed-aside copy');
});

test('#2264: the DEFAULT account is refused and is still there afterwards', () => {
  const dir = acct('default');
  assert.ok(accounts.list().some((a) => a.dir === dir && a.isDefault), 'the default must be listed first');
  const got = accounts.removeAccount(dir, []);
  assert.equal(got.ok, false);
  assert.equal(got.removed, false);
  assert.match(got.because, /main Claude folder/);
  assert.ok(fs.existsSync(dir), 'the default directory must survive the refusal');
});

test('#2264: a running agent refuses the delete, NAMED, and the account survives', () => {
  const dir = acct('busy');
  const got = accounts.removeAccount(dir, ['Splinter']);
  assert.equal(got.ok, false);
  assert.equal(got.removed, false);
  assert.deepEqual(got.usedBy, ['Splinter']);
  assert.match(got.because, /Splinter is set up to run on this account/);
  assert.ok(fs.existsSync(dir), 'a refused delete must not touch the directory');
});

test('#2264: a name-shaped folder that is NOT an account is never deleted', () => {
  // .claude-workers is the measured real-world example: a name-shaped tree that
  // carries no oauthAccount. The identity guard must refuse it.
  const notAcct = nodePath.join(SANDBOX, '.claude-notanaccount');
  fs.mkdirSync(notAcct, { recursive: true });
  fs.writeFileSync(nodePath.join(notAcct, 'a-real-file.txt'), 'do not delete me');
  const got = accounts.removeAccount(notAcct, []);
  assert.equal(got.ok, false);
  assert.equal(got.removed, false);
  assert.match(got.because, /not a Claude account/);
  assert.ok(fs.existsSync(nodePath.join(notAcct, 'a-real-file.txt')), 'a non-account folder must be left untouched');
});

test('#2264: a path outside home is refused, and an already-gone account is a quiet success', () => {
  assert.equal(accounts.removeAccount('/etc/passwd', []).ok, false, 'a path outside home is refused');
  const dir = nodePath.join(SANDBOX, '.claude-neverexisted');
  const got = accounts.removeAccount(dir, []);
  assert.equal(got.ok, true);
  assert.equal(got.removed, false);
  assert.match(got.because, /already gone/);
});
