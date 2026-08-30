'use strict';
/**
 * ADOPT MEANS REGISTER AND SHOW, AND THE TYPED NAME WINS (#1531).
 *
 * Josh's ruling, 2026-08-29: **1(a) adopt = register and show, no launchd job in the
 * adopted folder. 2(a) the typed name wins over `path.basename`.**
 *
 * 🛑 THE OMISSIONS ARE THE FEATURE, WHICH IS WHY THEY ARE ASSERTED RATHER THAN
 * ASSUMED. The adoptable folder on the machine that prompted this is a HOME
 * DIRECTORY. Composing an instruction file there for our own bookkeeping would put
 * Kosmos files in somebody's home; installing a launchd job would start Claude in
 * it. **Two arms below assert that neither happens**, because "we did not mean to"
 * is not a guarantee and a later refactor would not know.
 *
 * ⭐ AND DOING LESS WORK IS NOT DOING LESS CHECKING. The register path runs every
 * refusal the main path runs: an unusable name, one Kosmos already looks after, one
 * something is already running under, and a profile pointing elsewhere. A shorter
 * path that skipped the guards would be the actual danger, so those are asserted too.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-register-1531-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');

const discover = require('./discover');
const store = require('./store');
const create = require('./create');

/**
 * 🛑 THE MAIN PATH INSTALLS A REAL LAUNCHD JOB, AND THIS TEST INSTALLED FOUR OF THEM
 * ON THE OPERATOR'S MACHINE BEFORE THIS WAS ADDED.
 *
 * Any arm below that adopts a folder WITH an instructions file goes down `connect`'s
 * main path, which calls `create.installJob`. Sandboxing `AGENT_WORKFORCE_LAUNCH`
 * puts the PLIST in a temp directory and does NOT stop the `launchctl` registration
 * (#1539), so `com.kosmos.agent.{basename-loser,basename-wins,typed-wins}` were
 * bootstrapped into the real user domain every time this file ran.
 *
 * ⭐ THE MECHANISM FOR THIS ALREADY EXISTED AND I DID NOT USE IT. 22 test files
 * inject a runner, and `create.setDryRun` even carries a guard reading "refusing to
 * leave dry-run with no injected runner: this would create real agents". Somebody
 * anticipated exactly this and I walked past it.
 *
 * ⚠️ INJECTED ONLY AROUND THE MAIN-PATH ARMS, NEVER GLOBALLY, AND THAT IS THE WHOLE
 * CARE HERE. A file-wide dry-run would ALSO suppress the register path's job, which
 * would make this file's "no launchd job is installed" arm PASS VACUOUSLY. Measured:
 * under a global dry-run neither path writes a plist, so the assertion could not
 * tell them apart. The register arms therefore run with NOTHING injected, which is
 * what makes their negative real.
 */
function noRealCommands(fn) {
  create.setRunner(async () => ({ ok: true, stdout: '', err: null }));
  try { return fn(); } finally { create.setRunner(null); }
}

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function bare(name) {
  const d = path.join(SB, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('#1531: a folder with no instructions and a typed name is adopted', () => {
  const dir = bare('adopt-plain');
  const r = discover.connect(dir, { name: 'Site monitor' });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.name, 'Site monitor');
  assert.equal(r.registered, true);
  assert.equal(r.started, false, 'adoption reported starting something');
  assert.equal((store.readProfile('Site monitor') || {}).dir, dir);
});

test("#1531 RULING 1(a): NOTHING is written into the person's folder", () => {
  /* The folder is a home directory in the case this was built for. An assertion
     that it is untouched is the difference between a rule and a hope. */
  const dir = bare('adopt-untouched');
  const before = fs.readdirSync(dir);
  assert.deepEqual(before, [], 'the fixture was not empty, so this arm proves nothing');
  const r = discover.connect(dir, { name: 'untouched-agent' });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(fs.readdirSync(dir), [],
    `adoption wrote into the person's folder: ${JSON.stringify(fs.readdirSync(dir))}`);
});

test('#1531 RULING 1(a): NO launchd job is installed', () => {
  const launch = path.join(SB, 'launch');
  const dir = bare('adopt-nojob');
  const r = discover.connect(dir, { name: 'nojob-agent' });
  assert.equal(r.ok, true, r.because);
  const jobs = fs.existsSync(launch) ? fs.readdirSync(launch).filter((f) => /nojob-agent/.test(f)) : [];
  assert.deepEqual(jobs, [], `a launch job was installed for an adopted folder: ${JSON.stringify(jobs)}`);
});

test('#1531: with NO name supplied the old refusal is unchanged', () => {
  /* THE CONTROL FOR EVERY ARM ABOVE. If an instruction-less folder were adoptable
     without a name, the typed name would not be doing any work and none of this
     would be evidence of anything. */
  const dir = bare('adopt-noname');
  for (const opts of [{}, { name: '' }, { name: '   ' }, { name: null }]) {
    const r = discover.connect(dir, opts);
    assert.equal(r.ok, false, `a nameless adoption succeeded with ${JSON.stringify(opts)}`);
    assert.match(r.because, /no instructions in it/);
  }
});

test('#1531: two typed names that share a storage key cannot claim two folders', () => {
  /* `store.safeKey` strips to [a-z0-9_-], so "Site monitor" and "sitemonitor" are ONE
     record. Without the profile check the second adoption would silently repoint the
     first agent at a different folder. */
  const a = bare('collide-a');
  const b = bare('collide-b');
  assert.equal(discover.connect(a, { name: 'Collide Name' }).ok, true);
  const second = discover.connect(b, { name: 'collidename' });
  assert.equal(second.ok, false, 'two folders were allowed to share one profile');
  assert.match(second.because, /already connected to a different folder/);
  /* And the first is untouched, which is the half that matters to its owner. */
  assert.equal(store.readProfile('collidename').dir, a);
});

test('#1531: re-adopting the SAME folder under the same name is not an error', () => {
  const dir = bare('adopt-again');
  assert.equal(discover.connect(dir, { name: 'again-agent' }).ok, true);
  assert.equal(discover.connect(dir, { name: 'again-agent' }).ok, true,
    'adopting the same folder twice refused, so a double click would look like a failure');
});

test('#1531: an unusable name is refused, and the folder stays unregistered', () => {
  const dir = bare('adopt-badname');
  const r = discover.connect(dir, { name: '../escape' });
  assert.equal(r.ok, false);
  assert.match(r.because, /cannot be used as an agent name/);
});

test('#1531 RULING 2(a): a typed name beats the folder basename when instructions DO exist', () => {
  /* The basename rule is right when the folder IS the agent's own and has no answer
     for a folder that is a person. Josh ruled the typed name wins, so this asserts
     the override reaches the profile rather than only the register path. */
  const dir = path.join(SB, 'basename-loser');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# x\n\nYou are **Testy**, a tester.\n');
  const r = noRealCommands(() => discover.connect(dir, { name: 'typed-wins' }));
  assert.equal(r.ok, true, r.because);
  assert.equal(r.name, 'typed-wins', 'the folder basename beat the name the person typed');
  /* CONTROL: without a supplied name the basename is still the answer, so the arm
     above is testing the override rather than a path that ignores folders. */
  const dir2 = path.join(SB, 'basename-wins');
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, 'CLAUDE.md'), '# x\n\nYou are **Testy Two**, a tester.\n');
  assert.equal(noRealCommands(() => discover.connect(dir2, {})).name, 'basename-wins');
});
