'use strict';
/**
 * kosmos#8784 (Josh, 2026-11-19 20:39: "we need to be able to support apostrophes in agent names"): a new user's first
 * agent, named in the possessive ("<Name>'s Coach"), was refused at create with "use letters, numbers, hyphens and
 * underscores", although spaces were already allowed. The display name keeps the apostrophe; the machine name (folder,
 * session, launch script) drops it, so "Taylor's Coach" is `taylors-coach`. Every spelling lands on one machine name,
 * so a second spelling is refused as taken, by name, never filed in silence beside the first.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'apostrophe-8784-'));
// Each root by name (fixture-discipline.test.js reads these lines as text: a loop that builds the names hides them).
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'systemd-user');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'config-root');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const status = require('./status');
require('../test-support/catalogue-fixture').install(SANDBOX);

const STRAIGHT = "Taylor's Coach";
const CURLY = 'Taylor\u2019s Coach';
const OPENING = 'Taylor\u2018s Coach';

const winBin = (posix, exe) => (process.platform === 'win32'
  ? nodePath.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe) : posix);
const BINS = { claudeBin: winBin('/bin/echo', 'where.exe'), tmuxBin: winBin('/bin/echo', 'where.exe') };

/* On a Windows host createAgent takes the win32 arm, which create.setRunner does not guard: without these seams it would
   register a real Scheduled Task and /Run it. The same block as engine/create.test.js (see its #570 7c-2 note): the /Run
   arm writes the ownership row a real supervisor writes before it spawns, so the create completes as CREATED. */
if (process.platform === 'win32') {
  const win32job = require('./win32job');
  const win32create = require('./win32create');
  const win32sessions = require('./win32sessions');
  let seq = 0;
  win32create.setPark(() => {});
  win32job.setAnchorer(() => ({ ok: true, node: 'C:\\Anchor\\node.exe', boot: 'C:\\Anchor\\supervisor-boot.js' }));
  win32job.setRunner((args) => {
    if (args && args[0] === '/Query') return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    if (args && args[0] === '/Run') {
      const name = String(args[2] || '').replace(/^.*\\agent-/, '');
      if (name) win32sessions.record('ap-session-' + (++seq), { name, runner: 'claude' });
    }
    return { ok: true, out: '' };
  });
}

test.beforeEach(() => { status.setPaneSource(() => ''); create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false); });
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

test('#8784: an apostrophe, straight or curly, is dropped from the machine name and kept in the display name', () => {
  for (const n of [STRAIGHT, CURLY, OPENING, 'Taylor\u02BCs Coach', 'Taylor\uFF07s Coach']) {
    assert.equal(create.slugFor(n), 'taylors-coach', n);
    assert.equal(create.nameProblem(n), null, n + ': refused');
  }
  // Only the apostrophe goes: the period and the space keep their #2605 and #740 folds, and nothing else is stripped.
  assert.equal(create.slugFor("Dr. O'Neil"), 'dr-oneil');
  assert.equal(create.slugFor('Ca.sey'), 'ca-sey', 'a period is still a hyphen, never removed');
  assert.equal(create.slugFor('Hawai\u02BBi Guide'), 'hawaii-guide', 'the okina is an apostrophe here too');
  // Look-alikes that are NOT apostrophes stay refused: the backtick runs in a shell, the prime and acute are not typed as one.
  for (const n of ['Taylor`s Coach', 'Taylor\u2032s Coach', 'Taylor\u00B4s Coach']) {
    assert.match(String(create.nameProblem(n)), /use letters, numbers, spaces, periods, apostrophes/, n + ' was accepted');
  }
  assert.match(create.nameProblem('Taylor!s Coach'), /use letters, numbers, spaces, periods, apostrophes, hyphens and underscores/,
    'any other punctuation is still refused, by the sentence that names what a name may hold');
  // A name starts with a letter or number in the file an agent boots from, so a LEADING apostrophe is refused (as a
  // leading period is, #2605), though the machine name without it would pass.
  for (const lead of ["'Til Done", '\u2019Til Done', '\u02BCTil Done']) {
    assert.match(create.nameProblem(lead), /starting with a letter or number/, lead + ' was accepted');
  }
  // A name that is only apostrophes and a letter is too short, said as such, not as a character rule.
  assert.match(create.nameProblem("'a'"), /at least two characters/);
});

test('#8784: an agent named with an apostrophe is created, and its apostrophe reaches no file the machinery reads as a name', () => {
  const out = create.createAgent({ ...BINS, name: STRAIGHT, role: 'personal' });
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  // The iPhone app takes the session from `name` and checks it is a session name (PushBridge.isAgentSession: a-z, 0-9,
  // - and _), then shows `shownAs`; the board route acts on `name` too. So `name` is the machine name, `shownAs` the typed.
  assert.equal(out.name, 'taylors-coach');
  assert.match(out.name, /^[a-z0-9][a-z0-9_-]*$/, 'the iPhone app would read this result as unknown');
  assert.equal(out.shownAs, STRAIGHT);
  const file = create.instructionFile('taylors-coach');
  assert.ok(file && fs.existsSync(file), 'the agent folder is not the dropped-apostrophe machine name');
  assert.match(fs.readFileSync(file, 'utf8'), /You are \*\*Taylor's Coach\*\*/, 'the agent is not told its name as typed');
  // Every file the create wrote: the typed name may be in JSON records and the agent's own instructions, nowhere else
  // (a launch script, a plist, a systemd unit, a PowerShell file: the places a quote would break a shell).
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(nodePath.join(d, e.name)) : [nodePath.join(d, e.name)]));
  const carrying = walk(SANDBOX).filter((f) => fs.readFileSync(f, 'utf8').includes(STRAIGHT));
  assert.ok(carrying.length > 0, 'control: the typed name was written somewhere');
  const unsafe = carrying.filter((f) => !f.endsWith('.json') && !f.endsWith('.jsonl') && !f.endsWith('CLAUDE.md') && !f.endsWith('AGENTS.md') && !f.endsWith('GEMINI.md'));
  assert.deepEqual(unsafe.map((f) => nodePath.relative(SANDBOX, f)), [], 'the typed name, apostrophe and all, reached a file a shell may read');
});

test('#8784: a second spelling of the same name is refused as taken, by name, never filed beside the first', () => {
  // Its own first agent (review 1: it leaned on the test above), under another name so the two tests never collide.
  const first = create.createAgent({ ...BINS, name: "Mom's Helper", role: 'personal' });
  assert.equal(first.outcome, create.OUTCOME.CREATED, first.because);
  for (const n of ['Mom\u2019s Helper', 'Moms Helper', 'moms helper']) {
    const out = create.createAgent({ ...BINS, name: n, role: 'personal' });
    assert.equal(out.outcome, create.OUTCOME.REFUSED, n + ' was not refused');
    // The refusal names the agent that exists, as the board shows it, not the spelling just typed (review 1).
    assert.match(out.because, /there is already an agent called Mom's Helper\./, n + ': ' + out.because);
  }
});
