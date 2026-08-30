'use strict';
/**
 * "THIS ISN'T AN AGENT": ONE FOLDER, SAID NO TO ONCE, AND IT HAS TO PERSIST (#1531).
 *
 * 🛑 SEPARATE FROM `dismiss`, WHICH IS THE WHOLE BLOCK. Josh's word for that one was
 * "forever" and it hides every offer. This hides one folder. Conflating them would
 * make a single decline switch off the entire feature, which is the opposite of what
 * the person pressed.
 *
 * ⭐ IT PERSISTS BECAUSE THE COPY SAYS IT DOES. The screen reads "Not an agent, got
 * it. We won't ask about this folder again." A session-only hide would make that
 * sentence untrue on the next load, and a button that lies about what it did is worse
 * than one that does less. The last arm below reloads the module to prove it.
 *
 * ⚠️ AN UNREADABLE LIST READS AS EMPTY, NOT AS EVERYTHING. The failure that matters is
 * a corrupt file hiding folders nobody declined, so the safe direction is to offer a
 * folder twice rather than never, and the arm for that is deliberate.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-decline-1531-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const discover = require('./discover');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function bareFolder(key, name) {
  const cwd = path.join(SB, 'work', name);
  fs.mkdirSync(cwd, { recursive: true });
  const proj = path.join(SB, 'claude', 'projects', key);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.jsonl'), `{"type":"user"}\n{"cwd":${JSON.stringify(cwd)}}\n`);
  return cwd;
}

const A = bareFolder('-Users-x-one', 'one');
const B = bareFolder('-Users-x-two', 'two');

const offered = () => (discover.found().adoptable || []).map((a) => a.dir).sort();

test('#1531: a declined folder stops being offered, and only that one', () => {
  /* CONTROL FIRST: both must be offered, or "one disappeared" proves nothing. */
  assert.deepEqual(offered(), [A, B].sort(), 'the fixture did not offer both folders');

  assert.equal(discover.decline(A).ok, true);
  assert.deepEqual(offered(), [B],
    'declining one folder changed which OTHER folders are offered');
});

test('#1531: it is written to disk, so the copy stays true on the next load', () => {
  /* The screen says "we won't ask about this folder again". Asserting the file exists
     is weaker than asserting a FRESH read agrees, so this does the second. */
  assert.equal(fs.existsSync(discover.DECLINED_FILE), true, 'nothing was written');
  const raw = JSON.parse(fs.readFileSync(discover.DECLINED_FILE, 'utf8'));
  assert.deepEqual(raw.dirs, [A]);
  assert.deepEqual(discover.declined(), [A], 'a fresh read disagrees with what was written');
});

test('#1531: Undo puts it back, because the screen offers one', () => {
  assert.equal(discover.undecline(A).ok, true);
  assert.deepEqual(offered(), [A, B].sort(), 'Undo did not restore the folder');
  assert.deepEqual(discover.declined(), [], 'the list still names it after an undo');
});

test('#1531: declining twice is not an error and does not duplicate the entry', () => {
  assert.equal(discover.decline(B).ok, true);
  assert.equal(discover.decline(B).ok, true, 'a second decline of the same folder failed');
  assert.deepEqual(discover.declined(), [B], 'the folder was recorded twice');
  discover.undecline(B);
});

test('#1531: a relative path is refused, so the list cannot fill with junk', () => {
  const r = discover.decline('not/absolute');
  assert.equal(r.ok, false);
  assert.match(r.because, /not a folder on this computer/);
  assert.deepEqual(discover.declined(), [], 'a refused decline still wrote something');
});

test('#1531: an unreadable list reads as EMPTY, so nothing is hidden by a corrupt file', () => {
  /* The direction is deliberate. Reading a broken file as "everything is declined"
     would hide folders nobody said no to, and the person would never learn why. */
  fs.writeFileSync(discover.DECLINED_FILE, 'not json at all');
  assert.deepEqual(discover.declined(), [], 'a corrupt file did not read as empty');
  assert.deepEqual(offered(), [A, B].sort(), 'a corrupt file hid folders nobody declined');
  fs.rmSync(discover.DECLINED_FILE, { force: true });
});

test('#1531 CONTROL: dismiss is still the whole block and is untouched by all this', () => {
  /* If declining had been implemented as a dismiss, this would be true after the
     arms above and the feature would be silently switched off. */
  assert.equal(discover.dismissed(), false,
    'a per-folder decline set the whole-block dismiss flag');
});
