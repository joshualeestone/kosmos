'use strict';
/**
 * #2130 -- the global banner is a MACHINE-level fact and must agree with
 * Settings. checkCached() reads only the default ~/.claude.json, so a Claude
 * account signed in under its own CLAUDE_CONFIG_DIR (#1885) was invisible: the
 * banner said "we could not find a Claude account in the settings on this
 * computer" while Settings (accounts.list()) showed it connected. checkMachine()
 * aggregates across every signed-in account -- connected if any is.
 *
 * These tests build a sandbox HOME with a default config plus a non-default
 * account dir, and pin BOTH resolvers at it: AGENT_WORKFORCE_HOME steers
 * accounts.js, AGENT_WORKFORCE_CLAUDE_CONFIG steers subscription.js's default
 * file, and accounts.configFile(<default dir>) resolves to that same file, so
 * the two readers look at one place for the default and diverge only where the
 * bug lives -- the non-default dir.
 *
 *   node --test engine/subscription.machine-2130.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const HOME_SB = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sub-machine-2130-'));
const DEFAULT_CONFIG = nodePath.join(HOME_SB, '.claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME_SB;              // accounts.js homeDir()
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = DEFAULT_CONFIG; // subscription.js default file

const sub = require('./subscription');

function writeJSON(file, obj) {
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
// A non-default account dir: ~/.claude-<name>, credential inside it.
function acctFile(name) { return nodePath.join(HOME_SB, `.claude-${name}`, '.claude.json'); }
const CONNECTED = { oauthAccount: { emailAddress: 'her@example.com', organizationType: 'claude_max' } };
const FREE = { oauthAccount: { emailAddress: 'her@example.com', organizationType: 'claude_free' } };
const NO_ACCT = { someOtherKey: true };  // present file, no oauthAccount

function clean() {
  // Reset the sandbox to empty between cases (recursive+force handles both files
  // and account dirs), and drop the memo.
  for (const e of fs.readdirSync(HOME_SB)) fs.rmSync(nodePath.join(HOME_SB, e), { recursive: true, force: true });
  sub.resetCache();
}

test('#2130 core: default file has no account but a non-default dir is connected -> checkMachine CONNECTED (checkCached is NOT, which is the bug)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, NO_ACCT);        // default: present, no oauthAccount
  writeJSON(acctFile('work'), CONNECTED);    // signed in + subscribed, in its own dir
  // The default-only reader is what produced Josh's banner:
  assert.notEqual(sub.checkCached().state, sub.STATE.CONNECTED,
    'checkCached reads only the default file, so it must miss the non-default account (the #2130 bug)');
  // The machine reader agrees with Settings:
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED,
    'checkMachine must find the connected non-default account');
});

test('#2130: checkMachine(accountList) threaded in matches the self-fetched result (the production path passes the tick\'s known)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, NO_ACCT);
  writeJSON(acctFile('work'), CONNECTED);
  const accts = require('./accounts').list();
  sub.resetCache();
  const threaded = sub.checkMachine(accts);   // production passes the tick's known list
  sub.resetCache();
  const selfFetched = sub.checkMachine();      // fallback self-fetch
  assert.equal(threaded.state, sub.STATE.CONNECTED);
  assert.deepEqual(threaded, selfFetched, 'threading the list must not change the verdict');
});

test('#2130: default file itself connected -> checkMachine CONNECTED (unchanged behaviour)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED);
});

test('#2130: nothing connected anywhere -> checkMachine returns the default verdict unchanged (UNKNOWN), not a per-account string', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, NO_ACCT);        // default: unknown
  writeJSON(acctFile('work'), FREE);         // signed in but not a subscription
  const v = sub.checkMachine();
  assert.equal(v.state, sub.STATE.UNKNOWN);
  // machine-level wording, not the scoped "this account" string:
  assert.match(v.because, /on this computer/);
});

test('#2130: fresh machine, default absent, no dirs -> checkMachine NONE (unchanged)', () => {
  clean();
  // no files at all
  assert.equal(sub.checkMachine().state, sub.STATE.NONE);
});

test('#2130 cache: a subscription change in a NON-default dir invalidates the memo', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, NO_ACCT);
  writeJSON(acctFile('work'), CONNECTED);
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED, 'first read: connected via the non-default dir');
  // Downgrade that dir's account to free; the memo must not keep saying connected.
  // (mtime alone can collide within a tick; rewriting changes size/ino too, and
  //  the key covers this file, so the verdict must change.)
  writeJSON(acctFile('work'), FREE);
  assert.notEqual(sub.checkMachine().state, sub.STATE.CONNECTED,
    'checkMachine cache key must cover non-default account files, so a change there re-reads');
});
