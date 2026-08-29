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
 * than lazy. `path.join` on a Mac emitted `/`; on Windows the same call emits `\`.
 * A test pinning the exact string would have passed here and failed on the one
 * platform it is about.
 *
 * 🛑 THAT REASONING WAS CORRECT AND IS NOW OBSOLETE (#1510). It described the
 * AMBIENT `path`, and `dataRootFor` no longer uses one: it joins with the joiner
 * for the platform it was ASKED ABOUT, so `dataRootFor('win32', ...)` returns
 * backslashes on a Mac and on Windows alike. The exact string is now the same
 * everywhere, so it can be pinned, and every assertion below pins one.
 *
 * ⚠️ LEAVING THE OLD PARAGRAPH WOULD HAVE TOLD THE NEXT PERSON NOT TO DO WHAT WAS
 * JUST DONE. A justification that outlives its premise is a live instruction.
 *
 * ⭐ AND WHY IT HAD TO CHANGE, WHICH IS THE POINT OF THE CARD: 14 of the 15
 * assertions here were substring matchers, and A SUBSTRING MATCHER CANNOT
 * DISTINGUISH THE RIGHT ANSWER FROM A NEARBY WRONG ONE. Measured: this file
 * passed 6/6 against a resolver that returned
 * `C:\Users\jo/AppData/Roaming/AgentWorkforce`, which Windows never produces, and
 * it passes 6/6 against the fixed one. A test insensitive to the defect it names
 * is not coverage.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');

const APP = 'AgentWorkforce';

test('on Windows the store goes under APPDATA, not under a Mac path', () => {
  const got = store.dataRootFor('win32', 'C:\\Users\\jo', { APPDATA: 'C:\\Users\\jo\\AppData\\Roaming' });
  assert.equal(got, 'C:\\Users\\jo\\AppData\\Roaming\\' + APP,
    'Windows does not get the Windows path, which is the whole defect: it does not fail, it just puts '
    + "somebody's data where nothing on their computer will look for it");
  /* The separator arm, which is what 14 substring matchers could not see. */
  assert.ok(!got.includes('/'), `a forward slash survived in a Windows path: ${got}`);
});

test('roaming, not local, and the fallback is the documented location', () => {
  /* APPDATA is set on every supported Windows. The fallback exists so a
     stripped environment does not silently land the store in the wrong place
     AGAIN, one layer down. */
  const got = store.dataRootFor('win32', 'C:\\Users\\jo', {});
  assert.equal(got, 'C:\\Users\\jo\\AppData\\Roaming\\' + APP,
    'the stripped-environment fallback is not the documented Roaming location');
  assert.ok(!got.includes('/'), `a forward slash survived in the fallback: ${got}`);
});

test('the Mac is unchanged, which is the arm that must not move', () => {
  const got = store.dataRootFor('darwin', '/Users/jo', {});
  assert.equal(got, '/Users/jo/Library/Application Support/' + APP,
    'the Mac answer moved, and this is the arm that must not');
  assert.ok(!got.includes('\\'), `a backslash appeared in a Mac path: ${got}`);
});

test('the sandbox override still wins, on every platform', () => {
  /* 17 files honour AGENT_WORKFORCE_DATA and the whole test suite sandboxes
     through it. If the platform branch could beat it, every fixture on a
     Windows machine would write to the real store. */
  /* ⚠️ THE OVERRIDE PATH IS PER-PLATFORM ON PURPOSE, and my first version of this
     was wrong in a way worth recording. I gave all three branches `/tmp/sandbox`
     and expected `/tmp/sandbox\\AgentWorkforce` on win32. It returns
     `\\tmp\\sandbox\\AgentWorkforce`, because `path.win32.join` NORMALISES a
     forward slash to a backslash. That is genuine Windows behaviour, so the code
     was right and my expectation was wrong; asserting the normalised oddity would
     have pinned an artefact of the fixture rather than the rule under test. A
     Windows user sets a Windows path, so the fixture gives each branch one. */
  const cases = [
    ['win32', 'D:\\sandbox', 'D:\\sandbox\\' + APP],
    ['darwin', '/tmp/sandbox', '/tmp/sandbox/' + APP],
    ['linux', '/tmp/sandbox', '/tmp/sandbox/' + APP],
  ];
  for (const [p, dir, want] of cases) {
    const got = store.dataRootFor(p, '/x', { AGENT_WORKFORCE_DATA: dir, APPDATA: 'C:\\a' });
    assert.equal(got, want, 'the override lost to the ' + p + ' branch, or changed separator');
  }
});

test('📌 linux is KNOWINGLY unhandled, and this records it rather than hiding it', () => {
  /* It falls through to the Mac path, exactly as it did before this change. XDG
     says `$XDG_DATA_HOME` or `~/.local/share`, so this is wrong; it is not a
     REGRESSION, and this card is Windows.
     ⚠️ THIS TEST EXISTS TO BE DELETED. Whoever adds the XDG branch should change
     it rather than work around it, and will find this sentence when they do. */
  const got = store.dataRootFor('linux', '/home/jo', {});
  assert.equal(got, '/home/jo/Library/Application Support/' + APP,
    'linux now has its own branch, which is good: replace this test with one asserting XDG');
});

test('CONTROL: the live ROOT is built by the same function', () => {
  /* Without this, dataRootFor could be a correct function nothing calls, which
     is a defect I shipped twice this week. */
  assert.equal(store.ROOT, store.dataRootFor(process.platform, require('node:os').homedir(), process.env),
    'ROOT is derived some other way, so every assertion above is about a function the product does not use');
});
