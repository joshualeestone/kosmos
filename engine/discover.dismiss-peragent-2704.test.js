'use strict';
// #2704: "Dismiss forever" was a GLOBAL flag -- once pressed, EVERY agent found
// afterwards (Josh's Liu Kang) was hidden forever. Dismiss is now a SNAPSHOT of
// what was on offer, and `dismissed()` re-shows the block the moment a folder that
// was NOT in that snapshot turns up. These tests pin that behaviour and the trap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dismiss-2704-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
// Keep the dismiss/decline files inside the sandbox, not the operator's real data.
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function clearFlag() {
  try { fs.unlinkSync(discover.DISMISS_FILE); } catch { /* already gone */ }
}
function writeRaw(obj) {
  fs.mkdirSync(path.dirname(discover.DISMISS_FILE), { recursive: true });
  fs.writeFileSync(discover.DISMISS_FILE, JSON.stringify(obj) + '\n');
}

test('a new agent re-shows the block that dismiss hid -- the Liu Kang trap, fixed', () => {
  clearFlag();
  const offer = ['/x/liukang', '/x/mona'];
  discover.dismiss(offer);
  // Everything on offer at dismiss time stays hidden.
  assert.equal(discover.dismissed(offer), true, 'the dismissed offer must stay hidden');
  // A genuinely NEW folder was NOT in the snapshot -> the block returns.
  assert.equal(
    discover.dismissed(['/x/liukang', '/x/mona', '/x/NEWAGENT']), false,
    'a folder that was not in the dismissed snapshot must re-show the block',
  );
});

test('dismiss keeps the file in the sandbox, and an empty current offer stays hidden', () => {
  clearFlag();
  discover.dismiss(['/x/a', '/x/b']);
  assert.ok(discover.DISMISS_FILE.startsWith(SB), `flag would land outside the sandbox: ${discover.DISMISS_FILE}`);
  assert.ok(fs.existsSync(discover.DISMISS_FILE));
  // Nothing on offer right now -> still dismissed (there is nothing new to show).
  assert.equal(discover.dismissed([]), true);
});

test('no file is the only "not dismissed"', () => {
  clearFlag();
  assert.equal(discover.dismissed(['/x/a']), false);
  assert.equal(discover.dismissed([]), false);
});

test('an OLD-FORMAT flag (no dirs) reads as an empty snapshot, so a dismissed machine re-shows once', () => {
  clearFlag();
  // Pre-#2704 dismiss wrote only a timestamp. Treated as an empty snapshot: any
  // current offer is "new", which un-traps a machine dismissed under the old code.
  writeRaw({ dismissedAt: new Date().toISOString() });
  assert.equal(discover.dismissed(['/x/a']), false, 'an old-format flag must re-show a current agent');
  assert.equal(discover.dismissed([]), true, 'an old-format flag with nothing on offer stays hidden');
});

test('a corrupt flag keeps the person\'s answer -- a read blip must not flash a dismissed block', () => {
  clearFlag();
  fs.mkdirSync(path.dirname(discover.DISMISS_FILE), { recursive: true });
  fs.writeFileSync(discover.DISMISS_FILE, 'not json at all');
  assert.equal(discover.dismissed(['/x/a']), true);
});

test('dismissed() defends against a non-array snapshot and non-array current dirs', () => {
  clearFlag();
  writeRaw({ dismissedAt: 'x', dirs: 'not an array' });
  // A bad dirs field reads as an empty snapshot (safe direction: offer, do not hide).
  assert.equal(discover.dismissed(['/x/a']), false);
  // A bad currentDirs argument reads as no current offer -> stays hidden.
  writeRaw({ dirs: ['/x/a'] });
  assert.equal(discover.dismissed(undefined), true);
  assert.equal(discover.dismissed('nope'), true);
});

test('candidateDirs draws every identity a response would SHOW, and excludes already-in agents', () => {
  const ids = discover.candidateDirs({
    agents: [
      { dir: '/a', already: true },   // already under Kosmos -> never offered
      { dir: '/b' },                  // a found agent not yet added -> offered
      { dir: '/dup' },
      { name: 'no dir' },             // malformed row -> skipped
    ],
    adoptable: [{ dir: '/c' }],
    candidates: [{ dir: '/d' }, { dir: '/dup' }],           // dup collapses
    // Real importable rows are looseRow's {file,...} with NO dir (discover.js
    // looseRow), so their identity is the FILE path -- a {dir:...} fixture here
    // would certify coverage the production shape does not have (#2704 review).
    importable: [{ file: '/loose/x.md' }, { dir: '/ignored' }],
  });
  assert.deepEqual(ids.sort(), ['/b', '/c', '/d', '/dup', '/loose/x.md']);
  // A shape with nothing offerable is an empty array, never a throw.
  assert.deepEqual(discover.candidateDirs({}), []);
  assert.deepEqual(discover.candidateDirs(null), []);
});

test('a dismissed loose importable file re-shows only when a NEW loose file appears', () => {
  clearFlag();
  // The import-panel population is dismissed-gated too; a loose file is identified
  // by its file path, so the Liu Kang re-show must hold for imports as well.
  discover.dismiss(['/loose/one.md', '/loose/two.md']);
  assert.equal(discover.dismissed(discover.candidateDirs({ importable: [{ file: '/loose/one.md' }] })), true);
  assert.equal(
    discover.dismissed(discover.candidateDirs({ importable: [{ file: '/loose/one.md' }, { file: '/loose/NEW.md' }] })),
    false,
    'a new loose importable file must re-show the import offer',
  );
});

test('dismiss(currentDismissSnapshot()) round-trips: what was on offer stays hidden', () => {
  clearFlag();
  // currentDismissSnapshot walks found()+scan() over the (empty) sandbox and must
  // never throw; the resulting dismiss keeps the no-agent state hidden.
  const snap = discover.currentDismissSnapshot();
  assert.ok(Array.isArray(snap));
  discover.dismiss(snap);
  assert.equal(discover.dismissed(snap), true);
});
