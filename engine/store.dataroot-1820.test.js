'use strict';

/**
 * #1820: `dataRootFor` refuses a non-absolute data root, the same posture #1798
 * took shell-side on the uninstall (DELETE) path, here on the READ/WRITE path.
 *
 *   node --test engine/store.dataroot-1820.test.js
 *
 * 🛑 THE DEFECT DOES NOT CRASH ON MAIN, WHICH IS WHY IT NEEDED FINDING. A
 * relative data root does not throw: `path.join('', 'Library', 'Application
 * Support', 'AgentWorkforce')` is a perfectly good RELATIVE path, and Node then
 * reads and writes it under whatever the process cwd happens to be that run.
 * Profiles, avatars and settings land somewhere different every invocation, and
 * nothing warns.
 *
 * ⭐ THE GUARD IS ON THE RESULT, NOT EACH BRANCH (#1798's "the refusals are on
 * the result"). Three inputs produce a relative root; one check on the final
 * answer catches all three, and the next branch someone adds too:
 *   1. a relative `AGENT_WORKFORCE_DATA` (any platform)
 *   2. an empty `home` on the Mac branch
 *   3. an empty `home` on the win32 branch when `APPDATA` is also unset
 *
 * 🔑 EACH REFUSE ARM HAS A POSITIVE CONTROL PROVING THE SAME BRANCH STILL
 * RETURNS FOR A GOOD INPUT. Without it, a function that threw on everything
 * would pass every refuse assertion while being useless. The absolute-override,
 * absolute-home and APPDATA controls are those.
 *
 * 🛑 BOTH ARMS ARE VERIFIED OFF-TEST: every `assert.throws` below returns (does
 * NOT throw) against origin/main's unguarded `dataRootFor`, so this file reds on
 * main and greens on the fix. A refuse test that also passes on the unfixed code
 * is not coverage.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const store = require('./store');

const APP = 'AgentWorkforce';

/* ---- HOLE 1: a relative AGENT_WORKFORCE_DATA override, any platform ---- */

test('a relative AGENT_WORKFORCE_DATA is refused (mac)', () => {
  assert.throws(
    () => store.dataRootFor('darwin', '/Users/jo', { AGENT_WORKFORCE_DATA: 'rel/x' }),
    /non-absolute/,
    'a relative override yielded a cwd-relative store instead of being refused');
});

test('a relative AGENT_WORKFORCE_DATA is refused (win32)', () => {
  assert.throws(
    () => store.dataRootFor('win32', 'C:\\Users\\jo', { AGENT_WORKFORCE_DATA: 'rel\\x' }),
    /non-absolute/,
    'a relative override yielded a cwd-relative store instead of being refused');
});

test('CONTROL: an absolute AGENT_WORKFORCE_DATA override still returns, unchanged', () => {
  /* The override arm must still work for the absolute value every fixture uses;
     a guard that refused this too would pass the arms above by being useless. */
  assert.equal(
    store.dataRootFor('darwin', '/Users/jo', { AGENT_WORKFORCE_DATA: '/tmp/sandbox' }),
    '/tmp/sandbox/' + APP,
    'the absolute override arm changed or was wrongly refused');
  assert.equal(
    store.dataRootFor('win32', 'C:\\Users\\jo', { AGENT_WORKFORCE_DATA: 'D:\\sandbox' }),
    'D:\\sandbox\\' + APP,
    'the absolute override arm changed or was wrongly refused on win32');
});

/* ---- HOLE 2: an empty home falling through to a relative platform path ---- */

test('an empty home is refused on the Mac branch', () => {
  /* set -u does not catch an empty string; `home===''` makes the Mac branch
     `Library/Application Support/AgentWorkforce`, relative to the cwd. */
  assert.throws(
    () => store.dataRootFor('darwin', '', {}),
    /non-absolute/,
    "an empty home produced a cwd-relative Mac store instead of being refused");
});

test('an empty home with no APPDATA is refused on the win32 branch', () => {
  /* `p.join('', 'AppData', 'Roaming', APP)` is `AppData\\Roaming\\AgentWorkforce`
     -- relative, no drive. This is the second empty-home hole, one branch over. */
  assert.throws(
    () => store.dataRootFor('win32', '', {}),
    /non-absolute/,
    "an empty home + no APPDATA produced a cwd-relative win32 store instead of being refused");
});

test('CONTROL: an empty home on win32 is fine when APPDATA is absolute', () => {
  /* APPDATA wins over the empty-home fallback, so this must NOT be refused: the
     guard is about the RESULT being relative, not about home being empty. */
  assert.equal(
    store.dataRootFor('win32', '', { APPDATA: 'C:\\Users\\jo\\AppData\\Roaming' }),
    'C:\\Users\\jo\\AppData\\Roaming\\' + APP,
    'an absolute APPDATA with empty home was wrongly refused');
});

/* ---- CONTROLS: the good answers #570 pins must not move ---- */

test('CONTROL: the normal Mac and win32 answers are unchanged', () => {
  assert.equal(
    store.dataRootFor('darwin', '/Users/jo', {}),
    '/Users/jo/Library/Application Support/' + APP,
    'the Mac answer moved');
  assert.equal(
    store.dataRootFor('win32', 'C:\\Users\\jo', { APPDATA: 'C:\\Users\\jo\\AppData\\Roaming' }),
    'C:\\Users\\jo\\AppData\\Roaming\\' + APP,
    'the win32 answer moved');
});

test('CONTROL: the live ROOT is built by the guarded function and does not throw', () => {
  /* Proves the guard is inside the function the product actually calls (ROOT is
     a getter over root() -> dataRootFor), and that normal operation -- an
     absolute homedir -- never trips the refusal. */
  let live;
  assert.doesNotThrow(() => { live = store.ROOT; },
    'store.ROOT threw under a normal absolute home; the guard is too eager');
  assert.equal(
    live,
    store.dataRootFor(process.platform, process.env.AGENT_WORKFORCE_HOME || os.homedir(), process.env),
    'ROOT is derived some other way, so the guard above is not on the path the product uses');
});
