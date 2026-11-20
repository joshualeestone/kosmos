'use strict';
/**
 * kosmos#8735: Claude Code warns above every new agent's prompt when its CLAUDE.md is over 40,000 characters ("CLAUDE.md is
 * over the 40.0k-char limit ... /memory to free up context"). On a person's first agent that warning is the first thing
 * they see. This makes a REAL agent of every built-in role (dry-run off, every root in this file's sandbox, the community
 * section on as it is by default) and fails when any brief is at or over CEILING (below), so no addition to the
 * working rules can make a brief bigger unnoticed.
 *
 * Counted in characters (code points), not bytes. Claude Code's exact unit is not measured here; at these sizes, with
 * almost no characters outside the basic plane, code points and UTF-16 units differ by a handful.
 *
 * HEADROOM: a brief grows after birth (each project an agent joins adds a line block), so the GOAL is below the limit,
 * not at it: NEW_AGENT_GOAL. Until #8735 reaches it, the guard is a RATCHET: CEILING is the largest brief measured after
 * the last slice (rounded up), so no change can make a brief bigger, and each slice lowers it. Never raise CEILING.
 * Measured (pm, this file's sandbox path counted as one word): 58,458 on main before #8735; 51,670 after slice 1
 * (the community routine moved to `kosmos community --how`, the quoting, title and Kosmos-security rules kept in the
 * brief as safety text); 48,843 after slice 2 (the task commands for one situation each moved to `kosmos task --how`,
 * with the three per-run rules kept in the brief; measured with the kosmos command path also counted as one fixed path,
 * below); 47,580 after slice 3 item 3 (the Project Manager's daily feedback routine left to the board's daily ask,
 * kosmos#7374); 46,912 after slice 3 item 1 (the person section's answering repeats); 46,305 after the working rules'
 * files section kept only what the Files block does not say; 45,919 after the claim cases moved to `kosmos claim --how`;
 * 45,761 after two cuts in "You do not stop"; 45,382 after cuts in the formatting and reporting sections;
 * 45,017 after the render list and the stop history.
 * Every platform counts a brief as its Mac form (PLATFORM_DELTA, below), so one ceiling holds
 * everywhere, Linux CI and Windows included.
 *
 *   node --test engine/create.brief-size-8735.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'brief-size-8735-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'systemd-user');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'config-root');   // as create.switchwords-7445 does
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const roles = require('./roles');
const status = require('./status');
const cb = require('./communityblock');
const projects = require('./projects');
require('../test-support/catalogue-fixture').install(SANDBOX);

const winBin = (posix, exe) => (process.platform === 'win32'
  ? nodePath.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe) : posix);
const BINS = { claudeBin: winBin('/bin/echo', 'where.exe'), tmuxBin: winBin('/bin/echo', 'where.exe') };

const CLAUDE_CODE_LIMIT = 40000;
const NEW_AGENT_GOAL = 36000;   // headroom under the limit for the blocks a brief gains after birth (projects, team)
const CEILING = 45100;          // the ratchet (see above): lowered by each slice of #8735 until it reaches NEW_AGENT_GOAL
/* Review 3: a brief names its own folders (the Files folder, twice), and this sandbox's path is as long as the host's
   TMPDIR makes it (tools/run-tests.sh adds a kt<pid> folder), so it is counted as one fixed word, not its length: the
   figure is then the same on every host and under every runner. Both spellings, since macOS can name a temp folder by
   its /private path. A real agent's own paths vary by user name the same way and are not what the guard is about. */
const SANDBOX_SPELLINGS = [...new Set([fs.realpathSync(SANDBOX), SANDBOX])].sort((a, b) => b.length - a.length);
/* kosmos#8735, CI red on PR #8750: the brief also names the kosmos command by the path engine/clipath.js finds, which in
   a source checkout is <repo>/install/kosmos, six times in the pm brief. That path is as long as the checkout's folder
   (13 characters longer on the CI runner than in a worktree here, so every brief was 78 over there and not here). It is
   counted as one fixed path, the installed form under an ordinary home, so the figure is the same in every checkout and
   close to what a real agent's brief carries. Both spellings, as for the sandbox. */
const CLI_STANDIN = '/Users/person/.local/share/kosmos/bin/kosmos';
const CLI = require('./clipath').kosmosCli();
const CLI_SPELLINGS = CLI === 'kosmos' ? [] : [...new Set([fs.realpathSync(CLI), CLI])].sort((a, b) => b.length - a.length);
const chars = (s) => [...CLI_SPELLINGS.reduce((acc, p) => acc.split(p).join(CLI_STANDIN),
  SANDBOX_SPELLINGS.reduce((acc, p) => acc.split(p).join('<root>'), s))].length;
/* Review 7: the working rules and the community quoting rule differ by platform (Linux 487 characters shorter, Windows
   longer), so a Mac-measured ceiling went red on a Mac while Linux CI stayed green on the same change. Each brief is
   counted as its Mac form: this platform's two platform texts swapped for the Mac's by length. So CI and every
   developer judge one figure, and the file can run on Windows too. */
const cg = require('./communityguide');
const defaults = require('./defaults');
const PLATFORM_DELTA = (chars(defaults.blockFor('darwin')) - chars(defaults.blockFor(process.platform)))
  + (chars(cg.quotingRule('darwin')) - chars(cg.quotingRule(process.platform)));

test.beforeEach(() => { status.setPaneSource(() => ''); create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false); });
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

test('#8735: every built-in role makes an agent whose brief is under the size guard, community section included', () => {
  const sizes = [];
  let made = 0;
  for (const [i, role] of roles.ROLES.entries()) {
    if (!role || typeof role.key !== 'string' || role.menu === false) continue;
    const name = 'size-' + i;
    const out = create.createAgent({ ...BINS, name, role: role.key });
    assert.equal(out.outcome, create.OUTCOME.CREATED, role.key + ': ' + out.because);
    const text = fs.readFileSync(create.instructionFile(name), 'utf8');
    /* review 1: a brief without the community section (the switch off, a policy, a test-seat name) is about 3,800
       characters smaller, so a guard measuring one would pass while every real agent is over. */
    const section = projects.findBlock(text, cb.START, cb.END);
    assert.ok(section && !cb.isStoppedSection(text), role.key + ': the brief measured has no community section, so it is not what a new agent gets');
    assert.ok(text.includes(defaults.blockFor(process.platform)), role.key + ': the brief does not carry the working rules of this platform, so the platform swap is wrong');
    sizes.push([role.key, chars(text) + PLATFORM_DELTA]);
    made++;
  }
  assert.ok(made > 100, 'only ' + made + ' roles were made, so this guard covered almost nothing');
  sizes.sort((a, b) => b[1] - a[1]);
  // Every run says what it measured, so a CI log on another platform records a real figure (review 2).
  console.log('#8735 brief sizes on ' + process.platform + ' (as their Mac form, delta ' + PLATFORM_DELTA + '), largest five: ' + JSON.stringify(sizes.slice(0, 5)));
  const over = sizes.filter(([, n]) => n >= CEILING);
  assert.deepEqual(over, [], 'new agents\' briefs at or over ' + CEILING + ' characters (the goal is ' + NEW_AGENT_GOAL + '; Claude Code warns at '
    + CLAUDE_CODE_LIMIT + '); largest five: ' + JSON.stringify(sizes.slice(0, 5)));
});
