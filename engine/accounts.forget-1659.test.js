'use strict';
/* #1659: the Claude half of account removal.
 *
 * Josh, 2026-08-31: "Right now it just gives me a message that says Disconnect
 * is not built." It was disabled honestly rather than forgotten, and these
 * drive the real function against real directories, the way the OpenAI half's
 * tests do.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-claude-forget-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const accounts = require('./accounts');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* A signed-in Claude account: the default keeps its config at ~/.claude.json,
   every other one inside its own directory. Mirrors configFile(). */
function acct(label) {
  const isDefault = label === 'default';
  const dir = nodePath.join(SANDBOX, isDefault ? '.claude' : '.claude-' + label);
  fs.mkdirSync(dir, { recursive: true });
  const cfg = isDefault ? nodePath.join(SANDBOX, '.claude.json') : nodePath.join(dir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ oauthAccount: { emailAddress: label + '@example.com' } }));
  return dir;
}

test('#1659: forgetting a Claude account hides it from list() and KEEPS the sign-in', () => {
  const dir = acct('forgetme');
  assert.ok(accounts.list().some((a) => a.dir === dir),
    'it must be listed FIRST, or the removal proves nothing');

  const got = accounts.forgetAccount(dir, []);
  assert.equal(got.ok, true);
  assert.equal(got.forgotten, true);

  assert.ok(!accounts.list().some((a) => a.dir === dir), 'it is gone from the list');
  assert.ok(fs.existsSync(nodePath.join(got.movedTo, '.claude.json')),
    'THE SIGN-IN SURVIVES: this forgets, it does not delete');
  assert.ok(nodePath.basename(got.movedTo).startsWith('.removed-claude-'));
});

/* 🛑 THE ONE PLACE THIS IS NOT A MIRROR OF THE OPENAI SIDE, and the reason is
   measured rather than assumed: prepare() symlinks every account Kosmos makes
   at ~/.claude/projects, so moving the default strands the history of accounts
   nobody asked to remove. */
test('#1659: the DEFAULT account is refused, and it is still there afterwards', () => {
  const dir = acct('default');
  assert.ok(accounts.list().some((a) => a.dir === dir && a.isDefault),
    'the default must be listed first, or the refusal proves nothing');

  const got = accounts.forgetAccount(dir, []);
  assert.equal(got.ok, false);
  assert.equal(got.forgotten, false);
  assert.match(got.because, /main Claude folder/);

  assert.ok(accounts.list().some((a) => a.dir === dir), 'IT IS STILL THERE: nothing was moved');
  assert.ok(fs.existsSync(dir), 'the directory itself is untouched');
});

test('#1659: a path that is not a Claude account on this computer is refused', () => {
  const outside = nodePath.join(SANDBOX, 'somewhere', '.claude-elsewhere');
  fs.mkdirSync(outside, { recursive: true });
  const got = accounts.forgetAccount(outside, []);
  assert.equal(got.ok, false);
  assert.match(got.because, /not a Claude account/);
  assert.ok(fs.existsSync(outside), 'a directory that is not ours is not moved');

  const notClaude = nodePath.join(SANDBOX, '.somethingelse');
  fs.mkdirSync(notClaude, { recursive: true });
  assert.equal(accounts.forgetAccount(notClaude, []).ok, false);
  assert.ok(fs.existsSync(notClaude));
});

/* A refusal a person cannot act on is the dead end this card came from: they
   need to know WHICH agents, not that there are some. */
test('#1659: refused while agents are on it, and the agents are NAMED', () => {
  const dir = acct('busy');

  const one = accounts.forgetAccount(dir, ['marlowe']);
  assert.equal(one.ok, false);
  assert.deepEqual(one.usedBy, ['marlowe']);
  assert.match(one.because, /marlowe is running on this account/);

  const many = accounts.forgetAccount(dir, ['marlowe', 'spade']);
  assert.equal(many.ok, false);
  assert.deepEqual(many.usedBy, ['marlowe', 'spade']);
  assert.match(many.because, /marlowe, spade/);
  assert.match(many.because, /2 agents/);

  assert.ok(accounts.list().some((a) => a.dir === dir), 'still listed: the refusal moved nothing');
  assert.ok(fs.existsSync(dir));
});

test('#1659: an account already gone answers ok WITHOUT claiming it forgot anything', () => {
  const missing = nodePath.join(SANDBOX, '.claude-neverexisted');
  assert.ok(!fs.existsSync(missing), 'the premise of this test is that it is absent');
  const got = accounts.forgetAccount(missing, []);
  assert.equal(got.ok, true);
  assert.equal(got.forgotten, false, 'ok, but it did not forget anything: those are different promises');
});

/* A second removal of the same label must not clobber the first one's
   credential, which would delete the thing this function exists not to delete. */
test('#1659: two removals of the same label keep BOTH sign-ins', () => {
  const first = accounts.forgetAccount(acct('twice'), []);
  assert.equal(first.forgotten, true);
  const second = accounts.forgetAccount(acct('twice'), []);
  assert.equal(second.forgotten, true);

  assert.notEqual(first.movedTo, second.movedTo, 'the second must not land on the first');
  assert.ok(fs.existsSync(nodePath.join(first.movedTo, '.claude.json')), 'the FIRST sign-in survives');
  assert.ok(fs.existsSync(nodePath.join(second.movedTo, '.claude.json')), 'the second sign-in survives');
});
