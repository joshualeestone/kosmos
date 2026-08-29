'use strict';

/**
 * #570: where a person's Kosmos data lives, per platform.
 *
 *   node --test engine/store.dataroot-570.test.js
 *
 * 🛑 THE DEFECT THIS PINS DOES NOT CRASH, WHICH IS WHY IT NEEDED FINDING RATHER
 * THAN WAITING FOR IT. `path.join(homedir(), 'Library', 'Application Support')`
 * on Windows creates `C:\Users\x\Library\Application Support\AgentWorkforce`
 * quite happily. Nothing throws, nothing warns. The person's agents, profiles
 * and avatars just live somewhere Windows does not consider application data.
 *
 * ⚠️ AND IT GETS MORE EXPENSIVE EVERY DAY IT SHIPS. Once one person's store is
 * at the wrong path, fixing this becomes a data migration on a machine we cannot
 * see. That is the argument for doing it before the first Windows install, not
 * after the first complaint.
 *
 * 🔑 IT ASSERTS COMPONENTS, NOT A WHOLE STRING, and that is deliberate rather
 * than lazy. `path.join` on a Mac emits `/`; on Windows the same call emits `\`.
 * A test pinning the exact string would pass here and fail on the one platform
 * it is about, which is the same shape of untestable that let the bug live.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');

const APP = 'AgentWorkforce';

test('on Windows the store goes under APPDATA, not under a Mac path', () => {
  const got = store.dataRootFor('win32', 'C:\\Users\\jo', { APPDATA: 'C:\\Users\\jo\\AppData\\Roaming' });
  assert.match(got, /AppData/, 'the Windows store is not under AppData');
  assert.match(got, /Roaming/, 'the Windows store is not roaming, so it does not follow the person');
  assert.match(got, new RegExp(APP + '$'), 'the app folder is not the last component');
  assert.doesNotMatch(got, /Library/,
    'Windows still gets the macOS path, which is the whole defect: it does not fail, it just puts '
    + 'somebody data where nothing on their computer will look for it');
});

test('roaming, not local, and the fallback is the documented location', () => {
  /* APPDATA is set on every supported Windows. The fallback exists so a
     stripped environment does not silently land the store in the wrong place
     AGAIN, one layer down. */
  const got = store.dataRootFor('win32', 'C:\\Users\\jo', {});
  assert.match(got, /AppData/, 'with no APPDATA the fallback is not AppData');
  assert.match(got, /Roaming/, 'the fallback is Local rather than Roaming');
  assert.doesNotMatch(got, /Local/, 'the fallback landed in Local, which does not follow the person');
});

test('the Mac is unchanged, which is the arm that must not move', () => {
  const got = store.dataRootFor('darwin', '/Users/jo', {});
  assert.match(got, /Library/);
  assert.match(got, /Application Support/);
  assert.match(got, new RegExp(APP + '$'));
  assert.doesNotMatch(got, /AppData/, 'the Mac path now has Windows in it');
});

test('the sandbox override still wins, on every platform', () => {
  /* 17 files honour AGENT_WORKFORCE_DATA and the whole test suite sandboxes
     through it. If the platform branch could beat it, every fixture on a
     Windows machine would write to the real store. */
  for (const p of ['win32', 'darwin', 'linux']) {
    const got = store.dataRootFor(p, '/x', { AGENT_WORKFORCE_DATA: '/tmp/sandbox', APPDATA: 'C:\\a' });
    assert.match(got, /sandbox/, 'the override lost to the ' + p + ' branch');
    assert.doesNotMatch(got, /AppData|Library/, 'the ' + p + ' branch leaked into a sandboxed path');
  }
});

test('📌 linux is KNOWINGLY unhandled, and this records it rather than hiding it', () => {
  /* It falls through to the Mac path, exactly as it did before this change. XDG
     says `$XDG_DATA_HOME` or `~/.local/share`, so this is wrong; it is not a
     REGRESSION, and this card is Windows.
     ⚠️ THIS TEST EXISTS TO BE DELETED. Whoever adds the XDG branch should change
     it rather than work around it, and will find this sentence when they do. */
  const got = store.dataRootFor('linux', '/home/jo', {});
  assert.match(got, /Library/,
    'linux now has its own branch, which is good: replace this test with one asserting XDG');
});

test('CONTROL: the live ROOT is built by the same function', () => {
  /* Without this, dataRootFor could be a correct function nothing calls, which
     is a defect I shipped twice this week. */
  assert.equal(store.ROOT, store.dataRootFor(process.platform, require('node:os').homedir(), process.env),
    'ROOT is derived some other way, so every assertion above is about a function the product does not use');
});
