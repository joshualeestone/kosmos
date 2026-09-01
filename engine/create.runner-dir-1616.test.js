'use strict';

/**
 * #1616: A DIRECTORY AT THE RUNNER PATH PASSED THE GATES THAT LAUNCH AN AGENT.
 *
 * Every runner gate on the creation path asked `fs.existsSync(bin)`, which says yes
 * to a folder and to a file with no exec bit. The first-run screen asked
 * `runners.isRunnable` (#1592) and said no. So the same machine was refused on the
 * screen that only REPORTS and accepted by the path that SPAWNS, which then failed
 * later with a worse message. Measured on the card:
 *
 *     a DIRECTORY at the bin path:  existsSync true   isRunnable false
 *     a real executable:            existsSync true   isRunnable true
 *
 * These arms drive the real code with a real directory and a real 0644 file at
 * each of the five gates the card names, plus the OpenAI alternative that hangs off
 * the claude gate. Each arm was measured in BOTH directions: green with the fix,
 * and red BY NAME with that one site reverted to existsSync (the plan holds the
 * table). An arm that stays green under the revert proves nothing, and three of
 * the arms this author wrote on a sibling branch did exactly that.
 *
 * ⚠️ WHAT THESE ARMS DO NOT PROVE: that the refusal SENTENCE is right for a
 * present-but-not-executable file. "could not find" is kept, because it is the
 * word the first-run screen already uses for the same state and the UI matches on
 * it; a second sentence would be a second definition. Decided on the card.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* SANDBOX BEFORE REQUIRING, for the same reasons create.test.js lists: the module
   under test makes directories, writes instruction files and launchd jobs, and
   resolves its roots at load. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-dir-1616-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SANDBOX, 'codex-home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_CODEX_HOME, { recursive: true });
delete process.env.AGENT_WORKFORCE_DRY_RUN;
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');
const openai = require('./openaiaccounts');
const runners = require('./runners');
/* A recording runner, so a CONTROL creation can complete instead of being taken
   back as partial by the #1598 live-execution gate. DRY_RUN must be FALSE or every
   gate below is skipped (`!DRY_RUN && !runnerPresent(...)`) and the arms pass
   vacuously; setDryRun(false) throws without a runner, which is the point. */
create.setRunner(() => ({ ok: true, stdout: '' }));
create.setDryRun(false);

/** A directory named like a binary, a 0644 file named like one, and a real 0755 stub. */
const BIN = path.join(SANDBOX, 'bin');
fs.mkdirSync(BIN, { recursive: true });
const asDir = path.join(BIN, 'as-directory');
fs.mkdirSync(asDir);
const noExec = path.join(BIN, 'no-exec');
fs.writeFileSync(noExec, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
const realBin = path.join(BIN, 'real');
fs.writeFileSync(realBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
/* tmux for the creation paths that reach a spawn: the same stand-in
   create.test.js uses, so a control creation can actually complete. */
const TMUX = '/bin/echo';

test('the fixture argues with something real: existsSync says yes where isRunnable says no', () => {
  for (const p of [asDir, noExec]) {
    assert.equal(fs.existsSync(p), true, p + ' does not even exist; the arms below would pass vacuously');
    assert.equal(runners.isRunnable(p), false, p + ' is runnable, so no gate could tell it from the control');
  }
  assert.equal(runners.isRunnable(realBin), true, 'the control binary is not runnable, so no control below can pass');
});

/* The two wrong shapes, named so a failure says which one slipped through. */
const WRONG = [['a DIRECTORY', asDir], ['a file with NO EXEC BIT', noExec]];

test('#1616 createAgent on Claude refuses a directory or a stripped file at the claude path, and a real one passes the gate', () => {
  for (const [label, bad] of WRONG) {
    const r = create.createAgent({ claudeBin: bad, tmuxBin: TMUX, codexBin: '/nonexistent-codex', name: 'rd-claude', role: 'pm' });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, label + ' at the claude path was not refused');
    assert.match(r.because, /could not find Claude Code/, label + ' at the claude path got the wrong refusal: ' + r.because);
    assert.equal(fs.existsSync(create.workerDir('rd-claude')), false, label + ': a refused creation left a worker folder behind');
  }
  const ok = create.createAgent({ claudeBin: realBin, tmuxBin: TMUX, codexBin: '/nonexistent-codex', name: 'rd-claude-ok', role: 'pm' });
  assert.ok(!/could not find Claude Code/.test(String(ok.because || '')),
    'a real executable was refused as missing, so the arms above cannot tell the gate from a wall: ' + ok.because);
});

test('#1616 createAgent on Claude refuses a directory at the TMUX path too: the loop is one gate for every binary it spawns', () => {
  const r = create.createAgent({ claudeBin: realBin, tmuxBin: asDir, codexBin: '/nonexistent-codex', name: 'rd-tmux', role: 'pm' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'a DIRECTORY at the tmux path was not refused');
  assert.match(r.because, /could not find tmux/, 'wrong refusal for a directory at the tmux path: ' + r.because);
});

test('#1616 the OpenAI alternative is NOT offered when the codex runner is a directory, even with a sign-in on the machine', () => {
  /* The #548 rule: an alternative that dead-ends is a dead click in words. A signed-in
     account beside a FOLDER at the codex path is exactly that dead end. */
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_CODEX_HOME, 'auth.json'), '{"OPENAI_API_KEY":"x"}');
  try {
    for (const [label, bad] of WRONG) {
      const r = create.createAgent({ claudeBin: asDir, tmuxBin: TMUX, codexBin: bad, name: 'rd-alt', role: 'pm' });
      assert.equal(r.outcome, create.OUTCOME.REFUSED);
      assert.equal(r.alternative.offered, false, label + ' at the codex path still had OpenAI offered as the way out');
      assert.ok(!/OpenAI instead/.test(r.because), label + ': the dead-end alternative was said in words: ' + r.because);
      assert.match(String(r.alternative.because), /codex runner/, label + ': the engine blamed the wrong condition: ' + r.alternative.because);
    }
    const real = create.createAgent({ claudeBin: asDir, tmuxBin: TMUX, codexBin: realBin, name: 'rd-alt-ok', role: 'pm' });
    assert.equal(real.alternative.offered, true,
      'with a REAL codex runner and a sign-in the alternative was withheld, so the arm above proves nothing: ' + real.alternative.because);
  } finally {
    fs.rmSync(path.join(process.env.AGENT_WORKFORCE_CODEX_HOME, 'auth.json'), { force: true });
  }
});

test('#1616 createAgent on OpenAI refuses a directory or a stripped file at the codex path', () => {
  for (const [label, bad] of WRONG) {
    const r = create.createAgent({ claudeBin: realBin, tmuxBin: TMUX, codexBin: bad, name: 'rd-openai', role: 'pm', provider: 'openai' });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, label + ' at the codex path was not refused');
    assert.match(r.because, /could not find the OpenAI runner/, label + ' at the codex path got the wrong refusal: ' + r.because);
  }
  const ok = create.createAgent({ claudeBin: realBin, tmuxBin: TMUX, codexBin: realBin, name: 'rd-openai-ok', role: 'pm', provider: 'openai' });
  assert.ok(!/could not find the OpenAI runner/.test(String(ok.because || '')),
    'a real codex executable was refused as missing: ' + ok.because);
});

test('#1616 setProvider refuses to switch an agent onto a runner that is a directory or a stripped file', () => {
  const name = 'rd-switch';
  const made = create.createAgent({ claudeBin: realBin, tmuxBin: TMUX, codexBin: realBin, name, role: 'pm' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, 'the agent to switch was not created: ' + made.because);
  for (const [label, bad] of WRONG) {
    const sw = create.setProvider(name, 'openai', { claudeBin: realBin, tmuxBin: TMUX, codexBin: bad });
    assert.equal(sw.outcome, create.OUTCOME.REFUSED, label + ' at the codex path did not refuse the switch');
    assert.match(sw.because, /could not find the OpenAI runner/, label + ': wrong refusal on switch: ' + sw.because);
  }
  const real = create.setProvider(name, 'openai', { claudeBin: realBin, tmuxBin: TMUX, codexBin: realBin });
  assert.ok(!/could not find the OpenAI runner/.test(String(real.because || '')),
    'a real codex executable was refused as missing on switch, so the arm above cannot tell the gate from a wall: ' + real.because);
});

test('#1616 installJob refuses a directory or a stripped file at the runner path, and a real one reaches the job', () => {
  const name = 'rd-job';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  for (const [label, bad] of WRONG) {
    try { fs.rmSync(create.plistPath(name), { force: true }); } catch { /* none yet */ }
    const r = create.installJob(name, { claudeBin: bad, tmuxBin: realBin, codexBin: '/nonexistent-codex' });
    assert.equal(r.ok, false, label + ' at the claude path did not refuse the job');
    assert.match(r.because, /could not find Claude on this computer, so a job made now would never start/,
      label + ': wrong refusal from installJob: ' + r.because);
  }
  const ok = create.installJob(name, { claudeBin: realBin, tmuxBin: realBin, codexBin: '/nonexistent-codex' });
  assert.ok(!/could not find Claude/.test(String(ok.because || '')),
    'a real executable was refused by installJob as missing: ' + ok.because);
});

test('#1616 addWithKey refuses a directory or a stripped file at the codex path with the shared sentence', () => {
  for (const [label, bad] of WRONG) {
    const r = openai.addWithKey({ key: 'sk-proj-fineleng-thkeyhereeeee', codexBin: bad });
    assert.equal(r.ok, false, label + ' at the codex path was accepted for a key sign-in');
    assert.equal(r.because, openai.MISSING_RUNNER_SENTENCE, label + ': wrong refusal from addWithKey: ' + r.because);
  }
  const ok = openai.addWithKey({ key: 'sk-proj-fineleng-thkeyhereeeee', codexBin: realBin });
  assert.notEqual(ok.because, openai.MISSING_RUNNER_SENTENCE, 'a real codex executable was refused as missing by addWithKey');
});

/* The early OpenAI gate and the late loop gate refuse a directory with the SAME
   sentence, so the arm above cannot tell which one fired: measured, reverting the
   early gate to existsSync left that arm GREEN and only the source sweep went red.
   The observable that differs is ORDER. The early gate sits before nameProblem, so
   with a directory at the codex path AND no name, the runner refusal must win. With
   the early gate reverted, the name refusal wins instead. */
test('#1616 the early OpenAI runner gate refuses a directory BEFORE the name is judged, which is what separates it from the loop gate', () => {
  for (const [label, bad] of WRONG) {
    const r = create.createAgent({ claudeBin: realBin, tmuxBin: TMUX, codexBin: bad, name: '', role: 'pm', provider: 'openai' });
    assert.equal(r.outcome, create.OUTCOME.REFUSED);
    assert.match(r.because, /could not find the OpenAI runner/,
      label + ' at the codex path was judged AFTER the name, so the early gate let it through: ' + r.because);
  }
  const named = create.createAgent({ claudeBin: realBin, tmuxBin: TMUX, codexBin: realBin, name: '', role: 'pm', provider: 'openai' });
  assert.match(String(named.because), /give the agent a name/,
    'with a REAL runner the name refusal should be what fires, or the ordering above proves nothing: ' + named.because);
});
