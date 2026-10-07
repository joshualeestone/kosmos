'use strict';
/**
 * Undoing an add.
 *
 * 🔑 THE TEST THAT MATTERS IS THE REFUSAL. Undo and delete are the same machine
 * operation, and the only thing separating them is whether the agent's folder
 * was recorded by a connect. Every other assertion here is about leaving the
 * machine in the state it was in before the press.
 *
 * 🛑 NOT DRY RUN, AND THAT IS DELIBERATE. Under dry run neither engine writes a
 * job file, so `hasJob` is false before the undo as well as after -- the
 * assertions all pass and the undo could be doing nothing at all. Instead the
 * launchctl SEAM is injected and every file operation is real, inside a sandbox
 * that holds all four roots this code writes to. What is being tested here is
 * which files survive, and a mode that writes no files cannot test it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-disconnect-'));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
// #5432: on Linux the agent's job is a systemd user unit, kept in this sandbox too (a sandboxed board without it refuses
// every systemd call, so a create ends partial on a Linux runner). macOS and Windows never read it.
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = require('node:path').join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
/* 🛑 THE FOURTH ROOT. Creating an agent registers it with Claude Code, and a
   suite that leaves this unset writes into the operator's real config -- the
   sandbox-everything rule this repo enforces in `fixture-discipline`, which
   caught exactly this file. */
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SB, 'claude.json');
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
/* Real files, because `installJob` refuses a Claude it cannot find -- and that
   refusal is the one thing that would make every case here pass for the wrong
   reason. They are never executed: the runner below intercepts. */
const BIN = path.join(SB, 'bin');
fs.mkdirSync(BIN, { recursive: true });
for (const b of ['claude', 'tmux']) fs.writeFileSync(path.join(BIN, b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(BIN, 'claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(BIN, 'tmux');

const create = require('./create');
const removal = require('./remove');
/* ⚠️ The seam is launchctl and tmux, nothing else. Every command answers the way
   a working machine answers; the files these engines write are real. */
const RAN = [];
const runner = (file, args) => { RAN.push([file, ...args].join(' ')); return { ok: true, stdout: '' }; };
create.setRunner(runner); create.setDryRun(false);
removal.setRunner(runner); removal.setDryRun(false);
const discover = require('./discover');
const store = require('./store');
const status = require('./status');

/* 🛑 THE BOARD IS STUBBED TO VOUCH FOR THESE NAMES. `remove` asks
   `status.paneRoster()` whether a running session under this name is ours and
   refuses when it cannot tell -- correctly, and it fails CLOSED, so a suite that
   left it real would have every case here refuse for a reason that has nothing
   to do with what is being tested. Empty roster: nothing is running, which is
   the ordinary state on the machine of somebody who just pressed Add. */
const realRoster = status.paneRoster;
status.paneRoster = () => [];
test.after(() => { status.paneRoster = realRoster; fs.rmSync(SB, { recursive: true, force: true }); });

function theirAgent(name, body) {
  const dir = path.join(SB, 'theirs', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body || `You are **${name}**, a copywriter.\n`);
  return dir;
}

test('undoing an add puts the machine back: no job, no folder record, no removed row', () => {
  const dir = theirAgent('mike');
  const added = discover.connect(dir);
  assert.equal(added.ok, true, added.because);
  /* ⚠️ ASSERT THE PRECONDITION BEFORE ASSERTING ITS ABSENCE. "There is no job"
     proves nothing unless there was one a line earlier. */
  assert.equal(create.hasJob('mike'), true, 'the add did not install a job, so the undo has nothing to undo');
  assert.equal(store.readProfile('mike').dir, dir);

  const out = discover.disconnect('mike');
  assert.equal(out.ok, true, out.because);
  assert.equal(out.partial, false, out.because);
  assert.equal(create.hasJob('mike'), false, 'the job file survived the undo, so the row cannot be added again');
  assert.equal(store.readProfile('mike').dir, null);
  assert.equal(removal.isRemoved('mike'), false,
    'the undone agent is still on the removed list, so the board will hide it when it comes back');

  /* 🛑 AND THEIR FILES ARE UNTOUCHED. This is the whole promise of connect. */
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'the undo deleted their instructions');
});

test('an agent Kosmos made itself is refused, and keeps its job', () => {
  /* The control. A mis-aimed undo here would dismantle something somebody built,
     and nothing on the screen can tell the two rows apart. */
  const made = create.createAgent({ name: 'ours', role: 'writer', instructions: 'You are **Ours**, a writer.' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  assert.equal(create.hasJob('ours'), true);
  assert.equal(store.readProfile('ours').dir, undefined, 'a Kosmos-made agent recorded a folder, so the guard cannot see the difference');

  const out = discover.disconnect('ours');
  assert.equal(out.ok, false);
  assert.match(out.because, /made in Kosmos/i);
  assert.equal(create.hasJob('ours'), true, 'the refusal still took the job away');
  assert.equal(removal.isRemoved('ours'), false, 'the refusal still filed it as removed');
});

test('after an undo the same agent can be added again', () => {
  /* The state this is really testing is the removed record: without clearing it
     the re-add succeeds at every step and the agent never appears. */
  const dir = theirAgent('nina');
  assert.equal(discover.connect(dir).ok, true);
  assert.equal(discover.disconnect('nina').ok, true);

  const again = discover.connect(dir);
  assert.equal(again.ok, true, again.because);
  assert.equal(removal.isRemoved('nina'), false, 'the re-added agent is filed as removed, so the board hides it');
  assert.equal(store.readProfile('nina').dir, dir);
});

test('a name that was never connected is refused, and is not called a Kosmos agent', () => {
  const out = discover.disconnect('stranger');
  assert.equal(out.ok, false);
  /* ⚠️ NOT the "made in Kosmos" sentence. That refusal sends somebody to a page
     this agent does not have, and it asserts something about where their agent
     came from that nothing here checked. */
  assert.match(out.because, /no record of adding/i);
});

test('an agent whose folder is not called what the agent is called can still be undone', () => {
  /**
   * 🛑 THE DEFECT THIS EXISTS FOR, SHIPPED IN 0.3.8. The row shows the name out
   * of the agent's own instructions; Kosmos files the agent under its FOLDER.
   * For most real agents those differ -- a folder called `claude-bot` holding an
   * agent that calls itself Splinter -- and Undo, addressed to the displayed
   * name, refused every one of them.
   *
   * 🔑 EVERY FIXTURE HAD THEM EQUAL, which is why nothing saw it: `theirAgent`
   * writes a folder named for the agent. This one deliberately does not.
   */
  const dir = theirAgent('claude-bot', 'You are **Splinter**, the project manager.\n');
  const added = discover.connect(dir);
  assert.equal(added.ok, true, added.because);
  assert.equal(added.name, 'claude-bot', 'the registered name is no longer the folder');
  assert.equal(added.displayName, 'Splinter', 'the display name is no longer read from the instructions');

  /* The name the row DISPLAYS cannot address it, and must not claim it can. */
  const wrong = discover.disconnect(added.displayName);
  assert.equal(wrong.ok, false);

  /* The name the connect ANSWERED with is the one that works, which is why the
     page stores that rather than what it drew. */
  const right = discover.disconnect(added.name);
  assert.equal(right.ok, true, right.because);
  assert.equal(create.hasJob('claude-bot'), false);
});

test('a name that could escape its own folder is refused', () => {
  for (const bad of ['../elsewhere', 'a/b', '', '.']) {
    const out = discover.disconnect(bad);
    assert.equal(out.ok, false, `${JSON.stringify(bad)} was accepted`);
  }
});

/* #5432: on Linux the agent's job is a systemd user unit (job.unit, job.plist null), and the undo used to leave it, so
   the row could not be added again. This runs on every platform: remove's teardown and create's systemd seam are stubbed,
   so what is measured is disconnect's own rule (the unit goes only after the teardown fully landed, and systemd is told). */
test('#5432 an undo on Linux removes the agent\'s systemd unit, only after the teardown landed', () => {
  const discover = require('./discover');
  const removal = require('./remove');
  const create = require('./create');
  const store = require('./store');
  const name = 'unitundo';
  const folder = path.join(SB, 'unitundo-folder');
  const unit = path.join(process.env.AGENT_WORKFORCE_SYSTEMD_DIR, 'kosmos-agent-unitundo.service');
  const saved = { jobFor: removal.jobFor, remove: removal.remove, forget: removal.forget, linuxRun: create.linuxRun };
  let reloads = 0;
  let outcome;
  try {
    removal.jobFor = () => ({ label: 'kosmos-agent-unitundo.service', unit, plist: null, ours: true });
    removal.remove = () => ({ outcome });
    removal.forget = () => true;
    create.linuxRun = () => { reloads += 1; };
    const undo = (o) => {
      outcome = o;
      fs.mkdirSync(folder, { recursive: true });
      fs.mkdirSync(path.dirname(unit), { recursive: true });
      fs.writeFileSync(unit, '[Service]\n');
      store.writeProfile(name, { dir: folder });
      return discover.disconnect(name);
    };

    // CONTROL: a teardown that did not fully land keeps the unit (deleting it under a live job is worse).
    assert.equal(undo(removal.OUTCOME.PARTIAL).ok, true);
    assert.ok(fs.existsSync(unit), 'a partial teardown deleted the unit');
    assert.equal(reloads, 0, 'systemd was told about a unit that is still there');

    assert.equal(undo(removal.OUTCOME.REMOVED).ok, true);
    assert.ok(!fs.existsSync(unit), 'the undo left the systemd unit, so the row cannot be added again');
    assert.equal(reloads, 1, 'systemd was not told the unit is gone');

    // A test that forgot its systemd seam fails loudly here, not silently (#5445).
    create.linuxRun = () => { const e = new Error('refused'); e.code = 'LIVE_EXECUTION_REFUSED'; throw e; };
    assert.throws(() => undo(removal.OUTCOME.REMOVED), { code: 'LIVE_EXECUTION_REFUSED' });
  } finally {
    Object.assign(removal, { jobFor: saved.jobFor, remove: saved.remove, forget: saved.forget });
    create.linuxRun = saved.linuxRun;
  }
});
