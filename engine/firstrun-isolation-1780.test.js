'use strict';

/**
 * #1780: the first-run About-you write must be isolatable with ONE env var, so a
 * QA walk (or a test) cannot reconfigure the live fleet.
 *
 * The seam is the EXISTING general one, `AGENT_WORKFORCE_HOME` (accounts.js,
 * openaiaccounts.js, runners.js and others already honour it). #1780's bug was that
 * two write-chain roots ignored it and fell through to `os.homedir()`:
 *   - create.js  homeDir()  -> the workers root (create.workerDir)
 *   - store.js   root()     -> the data store (store.ROOT), where profiles/you.json live
 *
 * This test proves ONE var isolates the whole write, by the REAL files, not by a unit
 * assertion that the variable is read (the card's requirement: "assert the real files
 * are byte-identical", "perturb it: unset the redirect and confirm the check goes red").
 *
 * SAFETY, and it is the first assertion below: `HOME` is redirected to a throwaway dir so
 * `os.homedir()` itself points there. Any path that leaks past the seam lands in THAT
 * throwaway "pretend real machine", never the operator's actual home. If the HOME override
 * did not take (a platform where os.homedir ignores $HOME), the guard fails LOUD before a
 * single write, rather than letting the leak reach the real files.
 *
 * Deliberately sets NEITHER AGENT_WORKFORCE_DATA NOR AGENT_WORKFORCE_WORKERS: the whole
 * point is that AGENT_WORKFORCE_HOME ALONE is enough. Sets AGENT_WORKFORCE_TMUX_BIN to a
 * nonexistent path so nothing can reach a real pane either (sandbox every root together).
 *
 *   node --test engine/firstrun-isolation-1780.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The disposable home the redirect points at, and the throwaway that stands in for the
// real machine. Set BEFORE any require, so the frozen-at-require derivations (you.js BASE)
// capture the sandboxed store rather than the operator's.
const DISPOSABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1780-disposable-'));
const PRETEND_REAL = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1780-pretend-real-'));
process.env.AGENT_WORKFORCE_HOME = DISPOSABLE;
process.env.HOME = PRETEND_REAL;
process.env.AGENT_WORKFORCE_TMUX_BIN = '/nonexistent-tmux-1780';
delete process.env.AGENT_WORKFORCE_DATA;
delete process.env.AGENT_WORKFORCE_WORKERS;

// 🛑 The load-bearing safety guard. If os.homedir() does not honour $HOME on this
// platform, a leak would reach the operator's REAL home, so refuse to run at all.
assert.equal(os.homedir(), PRETEND_REAL,
  'os.homedir() must resolve to the throwaway HOME, or a leak could reach the real machine; refusing to run');

const store = require('./store');
const create = require('./create');
const you = require('./you');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

const GOOD = { name: 'Test Person', does: 'Walks first-run to see it', know: 'No em dashes.' };
const BOOT = 'You are **Mara**.\n\nDo the work well, and say what you did.\n';
const WHO = 'Who you work for'; // a phrase the About-you block contains once written

function workersFile(homeRoot, name) { return path.join(homeRoot, 'work', 'workers', name, 'CLAUDE.md'); }
function plantAt(homeRoot, name, text) {
  fs.mkdirSync(path.join(homeRoot, 'work', 'workers', name), { recursive: true });
  fs.writeFileSync(workersFile(homeRoot, name), text, 'utf8');
}
function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

test('AGENT_WORKFORCE_HOME alone redirects BOTH the store and the workers root off the real home', () => {
  // With the seam set, both write-chain roots resolve under the disposable home.
  assert.ok(store.ROOT.startsWith(DISPOSABLE),
    'store.ROOT must sit under the disposable home, not ' + store.ROOT);
  assert.ok(!store.ROOT.startsWith(PRETEND_REAL), 'store.ROOT leaked to the real home: ' + store.ROOT);
  const wd = create.workerDir('mara');
  assert.ok(wd.startsWith(DISPOSABLE), 'create.workerDir must sit under the disposable home, not ' + wd);
  assert.ok(!wd.startsWith(PRETEND_REAL), 'create.workerDir leaked to the real home: ' + wd);

  // Positive control (the other arm): with the seam UNSET, both resolve under os.homedir()
  // (the pretend-real home). Both roots resolve per call, so no re-require is needed.
  delete process.env.AGENT_WORKFORCE_HOME;
  try {
    assert.ok(store.ROOT.startsWith(PRETEND_REAL),
      'control: with the seam unset store.ROOT must fall to os.homedir(): ' + store.ROOT);
    assert.ok(create.workerDir('mara').startsWith(PRETEND_REAL),
      'control: with the seam unset create.workerDir must fall to os.homedir(): ' + create.workerDir('mara'));
  } finally {
    process.env.AGENT_WORKFORCE_HOME = DISPOSABLE;
  }
});

test('first-run About-you writes into the disposable home and leaves the real files byte-identical', () => {
  you.save(GOOD);

  // The agent file the write will update lives under the disposable home (where the seam
  // points). A byte-identical SENTINEL sits at the same relative path under the pretend-real
  // home: it is what a leak would clobber.
  plantAt(DISPOSABLE, 'mara', BOOT);
  plantAt(PRETEND_REAL, 'mara', BOOT);
  const sentinelBefore = sha(workersFile(PRETEND_REAL, 'mara'));

  const roster = fleet.install([fleet.agent('mara', { state: 'idle' })]).agents;
  try {
    const told = you.syncEveryone(roster);
    assert.ok(told.every((t) => t.state === projects.TOLD.TOLD), 'the write did not report told: ' + JSON.stringify(told));

    // The write landed in the disposable home.
    assert.ok(fs.readFileSync(workersFile(DISPOSABLE, 'mara'), 'utf8').includes(WHO),
      'the About-you block was not written under the disposable home');
    // The real (pretend-real) file is untouched.
    assert.equal(sha(workersFile(PRETEND_REAL, 'mara')), sentinelBefore,
      'the write leaked to the real home despite the seam being set');

    // PERTURB: with the seam unset, the SAME write resolves to os.homedir() and clobbers the
    // sentinel. This proves the seam is load-bearing, not decorative -- unset it and the real
    // file changes, which is exactly the incident #1780 exists to prevent.
    delete process.env.AGENT_WORKFORCE_HOME;
    try {
      you.syncEveryone(roster);
      assert.notEqual(sha(workersFile(PRETEND_REAL, 'mara')), sentinelBefore,
        'with the seam unset the write should have reached the pretend-real file; if it did not, the check cannot tell a working seam from an absent one');
      assert.ok(fs.readFileSync(workersFile(PRETEND_REAL, 'mara'), 'utf8').includes(WHO),
        'perturbation: the unset-seam write should carry the About-you block into the pretend-real file');
    } finally {
      process.env.AGENT_WORKFORCE_HOME = DISPOSABLE;
    }
  } finally {
    fleet.restore();
  }
});
