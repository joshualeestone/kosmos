'use strict';

/* #2456: an AUTOMATIC waiting state (the PermissionRequest hook's
   "asking permission to use <tool>" needs_you) must not behave like a
   DELIBERATE one. Two defects Sub-Zero measured on 0.6.54, both fixed in
   selfreport.record()'s #900/#1949 guard by keying on standing.by:
     - NO-CLEAR: the auto idle/working that follows once the prompt resolves
       must clear the auto needs_you (it was refused over it, so it stuck).
     - CLOBBER: an auto needs_you must not overwrite a DELIBERATE waiting state
       and its real question.
   The #900/#1949 protection of a DELIBERATE wait is preserved unchanged; those
   arms live in selfreport.test.js and are re-asserted here in-context so this
   file states both directions of the discriminator together. */

// Sandbox the store BEFORE requiring anything (store.js resolves its root at
// module load), the same rule the sibling suite states at its own top.
require('../test-support/tmpscope'); // kosmos#5334: this process's temp folders, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-selfreport-2456-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');

/* The exact report the PermissionRequest hook writes (kosmos-report-hook.js
   reportFor): state needs_you, auto:true, the tool/command as the reason. */
function permissionPrompt(cmd) {
  return { state: 'needs_you', because: 'asking permission to use Bash: ' + cmd, auto: true };
}

/* ---- NO-CLEAR (defect 2): an auto idle/working clears an AUTO needs_you ---- */

test('#2456: an automatic working CLEARS an automatic (permission-prompt) needs_you', () => {
  const who = 'perm-then-work';
  // The permission hook fires needs_you (auto) when the prompt appears.
  assert.equal(selfreport.record(who, permissionPrompt('git push')).recorded, true);
  assert.equal(selfreport.read(who).by, 'auto', 'the permission prompt is machine-written');
  // The prompt is answered, the tool runs, PreToolUse fires working (auto).
  const resume = selfreport.record(who, { state: 'working', because: 'running Bash', auto: true });
  assert.equal(resume.recorded, true, 'the auto working was refused, so the permission needs_you never clears');
  assert.equal(selfreport.read(who).state, 'working', 'the board still reads needs_you after the prompt resolved');
});

test('#2456: an automatic idle (turn-end Stop) CLEARS an automatic needs_you', () => {
  const who = 'perm-then-idle';
  assert.equal(selfreport.record(who, permissionPrompt('rm -rf build')).recorded, true);
  const stop = selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(stop.recorded, true, 'the turn-end idle was refused, so the permission needs_you sticks past the turn');
  assert.equal(selfreport.read(who).state, 'idle');
});

/* ---- CLOBBER (defect 1): an auto needs_you does not overwrite a DELIBERATE wait ---- */

test('#2456: an automatic needs_you does NOT clobber a deliberate needs_you or its reason', () => {
  const who = 'asked-then-perm';
  const realQuestion = 'Which git identity should I commit as, joshualeestone or the machine user?';
  assert.equal(selfreport.record(who, { state: 'needs_you', because: realQuestion }).recorded, true);
  assert.equal(selfreport.read(who).by, 'agent', 'the agent authored this needs_you');
  // The permission hook then fires its own needs_you.
  const perm = selfreport.record(who, permissionPrompt('git commit'));
  assert.equal(perm.recorded, false, 'the auto permission needs_you overwrote the agent-authored one');
  assert.equal(perm.skipped, 'waiting');
  const back = selfreport.read(who);
  assert.equal(back.state, 'needs_you');
  assert.equal(back.because, realQuestion, 'the real question was replaced by the shell command text');
});

test('#2456: an automatic needs_you does NOT clobber a deliberate blocked', () => {
  const who = 'blocked-then-perm';
  assert.equal(selfreport.record(who, { state: 'blocked', because: 'waiting on a signing key', owner: 'Josh' }).recorded, true);
  const perm = selfreport.record(who, permissionPrompt('cargo build'));
  assert.equal(perm.recorded, false);
  assert.equal(selfreport.read(who).state, 'blocked');
  assert.equal(selfreport.read(who).because, 'waiting on a signing key');
});

/* ---- The narrowness that keeps the fix from over-refusing ---- */

test('#2456: a newer automatic needs_you REPLACES an older automatic needs_you', () => {
  // Two permission prompts in a row: the second is the current one and must land,
  // or the board would show a stale prompt. Neither is deliberate.
  const who = 'perm-then-perm';
  assert.equal(selfreport.record(who, permissionPrompt('ls')).recorded, true);
  assert.equal(selfreport.record(who, permissionPrompt('cat secrets')).recorded, true,
    'a fresh permission prompt was refused over a stale one');
  assert.match(selfreport.read(who).because, /cat secrets/);
});

test('#2456: a permission prompt with nothing waiting still shows (no standing wait to protect)', () => {
  const who = 'fresh-perm';
  assert.equal(selfreport.record(who, { state: 'working', because: 'reading', auto: true }).recorded, true);
  assert.equal(selfreport.record(who, permissionPrompt('git status')).recorded, true);
  assert.equal(selfreport.read(who).state, 'needs_you');
});

/* ---- #900/#1949 PRESERVED: a DELIBERATE wait is still protected ---- */

test('#2456 CONTROL: an automatic working STILL does not clear a DELIBERATE needs_you', () => {
  const who = 'deliberate-guarded';
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'which venue?' }).recorded, true);
  const autoWork = selfreport.record(who, { state: 'working', because: 'running a command', auto: true });
  assert.equal(autoWork.recorded, false, 'the fix loosened the guard on a DELIBERATE wait (regressed #1949)');
  assert.equal(autoWork.skipped, 'waiting');
  assert.equal(selfreport.read(who).state, 'needs_you');
});

test('#2456 CONTROL: an AGENT working still clears its own needs_you (a real resume)', () => {
  const who = 'agent-resume';
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'which venue?' }).recorded, true);
  assert.equal(selfreport.record(who, { state: 'working', because: 'got it, back at it' }).recorded, true);
  assert.equal(selfreport.read(who).state, 'working');
});

/* ---- The regression the fix must NOT introduce: an AUTO blocked stays protected ---- */

test('#2456: an automatic working does NOT clear a standing AUTO blocked (StopFailure provider outage)', () => {
  // The StopFailure hook writes blocked (auto) on a provider API outage. An auto working
  // (mid-turn) must not clear it; #6209: the Stop idle of a turn that ended normally does.
  // Keying the guard on `by` alone would have dropped this protection.
  const who = 'auto-blocked-outage';
  assert.equal(selfreport.record(who, { state: 'blocked', on: 'provider api (rate_limit)', owner: 'provider', auto: true }).recorded, true);
  assert.equal(selfreport.read(who).by, 'auto', 'the StopFailure block is machine-written');
  const heartbeat = selfreport.record(who, { state: 'working', because: 'running Bash', auto: true });
  assert.equal(heartbeat.recorded, false, 'an auto working cleared a still-unresolved provider outage');
  assert.equal(heartbeat.skipped, 'waiting');
  assert.equal(selfreport.read(who).state, 'blocked');
});

test('#2456 / #6209: an automatic idle (a turn that ended normally) DOES clear a standing AUTO provider blocked', () => {
  // #6209: a user's agent read blocked for six days after a brief provider error. StopFailure fires instead of Stop for a
  // failed turn, so a later Stop (auto idle) proves a turn succeeded: the provider block is over.
  const who = 'auto-blocked-idle';
  assert.equal(selfreport.record(who, { state: 'blocked', on: 'provider api (500)', owner: 'provider', auto: true }).recorded, true);
  assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true }).recorded, true, 'a normal turn end did not clear the provider block');
  assert.equal(selfreport.read(who).state, 'idle');
});

test('#6209: an automatic idle still does NOT clear a DELIBERATE blocked, nor an auto block not about the provider', () => {
  const mine = 'deliberate-blocked-6209';
  assert.equal(selfreport.record(mine, { state: 'blocked', on: 'provider api (500)', because: 'the provider keeps failing', owner: 'provider' }).recorded, true);
  assert.notEqual(selfreport.read(mine).by, 'auto', 'fixture: the agent wrote this block itself');
  assert.equal(selfreport.record(mine, { state: 'idle', because: 'finished responding', auto: true }).recorded, false, 'an auto idle erased the agent\'s own block');
  assert.equal(selfreport.read(mine).state, 'blocked');
  // CONTROL: the agent's own idle still clears its own block, as before.
  assert.equal(selfreport.record(mine, { state: 'idle', because: 'back at it' }).recorded, true);
  assert.equal(selfreport.read(mine).state, 'idle');
  // An auto blocked not about the provider (no "provider api (" on it) is not this rule.
  const other = 'auto-blocked-other-6209';
  assert.equal(selfreport.record(other, { state: 'blocked', on: 'something else', owner: 'someone', auto: true }).recorded, true);
  assert.equal(selfreport.record(other, { state: 'idle', because: 'finished responding', auto: true }).recorded, false);
});

test('#2456: an automatic needs_you does NOT clobber a standing AUTO blocked', () => {
  const who = 'auto-blocked-then-perm';
  assert.equal(selfreport.record(who, { state: 'blocked', on: 'provider api (timeout)', owner: 'provider', auto: true }).recorded, true);
  assert.equal(selfreport.record(who, permissionPrompt('git push')).recorded, false, 'a permission prompt overwrote a provider outage');
  assert.equal(selfreport.read(who).state, 'blocked');
});

/* ---- Legacy provenance: a wait with NO mark (by:null) is protected as before ---- */

test('#2456: a legacy standing needs_you with no `by` mark is treated as DELIBERATE (protected)', () => {
  // Lines written before #1453 carry no `by` and read as null. The fix must not
  // start clearing those on the theory that "not auto == deliberate"; unknown
  // provenance stays protected exactly as the pre-fix code protected it.
  const who = 'legacy-null-by';
  const file = selfreport.fileFor(who);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({
    v: 1, state: 'needs_you', because: 'a real pre-1453 question', at: new Date().toISOString(),
  }) + '\n');
  assert.equal(selfreport.read(who).by, null, 'a pre-#1453 line reads as unknown provenance');
  const autoWork = selfreport.record(who, { state: 'working', because: 'running', auto: true });
  assert.equal(autoWork.recorded, false, 'an auto working cleared a legacy (unknown-provenance) wait');
  assert.equal(selfreport.read(who).state, 'needs_you');
});

test('#6209 review 1: a provider error over a deliberate question, then a normal turn end, keeps the question red (not idle)', () => {
  const who = 'question-then-outage-6209';
  const asked = selfreport.record(who, { state: 'needs_you', because: 'which domain should I use?', instance: 'run-old' });
  assert.equal(asked.recorded, true);
  assert.equal(selfreport.record(who, { state: 'blocked', on: 'provider api (server_error)', owner: 'provider', auto: true }).recorded, true);
  const end = selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(end.recorded, false, 'a normal turn end erased the block AND the question under it');
  assert.notEqual(selfreport.read(who).state, 'idle', 'the card read idle with a question still unanswered');
  // Review 3: the question comes back (its own words and writer), instead of staying hidden behind a stale block.
  const shown = selfreport.read(who);
  assert.equal(shown.state, 'needs_you', 'the question was not shown again once the provider answered');
  assert.equal(shown.because, 'which domain should I use?');
  assert.equal(shown.by, 'agent', 'the restored question was not kept as the agent\'s own');
  assert.equal(end.restored, true);
  // Review 4: not re-dated (its age, the reminder's clock and a person's notice stay), and no old run's fields.
  assert.equal(shown.askedAt, asked.at, 'the restored question was re-dated');
  assert.ok(!shown.instance, 'the restored line carried the old run\'s instance');
  // CONTROL: the same sequence with a permission prompt (an auto needs_you) under the block does clear.
  const perm = 'perm-then-outage-6209';
  assert.equal(selfreport.record(perm, { state: 'needs_you', because: 'asking permission to use Bash: ls', auto: true }).recorded, true);
  assert.equal(selfreport.record(perm, { state: 'blocked', on: 'provider api (server_error)', owner: 'provider', auto: true }).recorded, true);
  assert.equal(selfreport.record(perm, { state: 'idle', because: 'finished responding', auto: true }).recorded, true);
});

test('#6209 review 1: a legacy unmarked provider block (no `by`) is not cleared by an automatic idle', () => {
  const who = 'legacy-provider-6209';
  const file = selfreport.fileFor(who);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ v: 1, state: 'blocked', on: 'provider api (500)', owner: 'provider', at: new Date().toISOString() }) + '\n');
  assert.equal(selfreport.read(who).state, 'blocked', 'fixture: the legacy line reads');
  assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true }).recorded, false, 'an unmarked block was cleared');
});

test('#6209 review 2: several provider blocks in a row over a question still keep it; a started line between clears', () => {
  const who = 'question-then-outages-6209';
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'which domain should I use?' }).recorded, true);
  for (const kind of ['server_error', 'timeout', 'server_error']) {
    assert.equal(selfreport.record(who, { state: 'blocked', on: 'provider api (' + kind + ')', owner: 'provider', auto: true }).recorded, true);
  }
  assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true }).recorded, false, 'a run of blocks hid the question from the check');
  assert.equal(selfreport.read(who).state, 'needs_you', 'the question under a run of blocks was not shown again');
  // A new run (started) between the question and the block: nothing deliberate is under the block, so it clears.
  const fresh = 'started-then-outage-6209';
  assert.equal(selfreport.record(fresh, { state: 'needs_you', because: 'an old question' }).recorded, true);
  assert.equal(selfreport.record(fresh, { state: 'started' }).recorded, true);
  // Several blocks in a row over the start: the whole run is skipped to find what is under it, so this still clears.
  for (const kind of ['server_error', 'timeout']) {
    assert.equal(selfreport.record(fresh, { state: 'blocked', on: 'provider api (' + kind + ')', owner: 'provider', auto: true }).recorded, true);
  }
  assert.equal(selfreport.record(fresh, { state: 'idle', because: 'finished responding', auto: true }).recorded, true, 'a run of blocks was read as a wait under itself');
});

test('#6209 review 2: when the run of blocks reaches the front of the tail read, what is under it is unknown and the block stays', () => {
  const who = 'long-outage-6209';
  const file = selfreport.fileFor(who);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const at = new Date().toISOString();
  const block = JSON.stringify({ v: 1, state: 'blocked', on: 'provider api (server_error)', owner: 'provider', by: 'auto', at }) + '\n';
  let text = JSON.stringify({ v: 1, state: 'needs_you', because: 'a question far back', by: 'agent', at }) + '\n';
  while (text.length < selfreport.TAIL_BYTES + 4 * block.length) text += block;
  fs.writeFileSync(file, text);
  assert.equal(selfreport.read(who).state, 'blocked', 'fixture: the standing line is the block');
  assert.equal(selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true }).recorded, false, 'an unknown line under the block was taken as nothing');
});

test('#6209 review 4: a days-old question re-shown after a provider block keeps its original asking time', () => {
  const who = 'old-question-6209';
  const file = selfreport.fileFor(who);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  fs.appendFileSync(file, JSON.stringify({ v: 1, state: 'needs_you', because: 'which domain?', by: 'agent', instance: 'run-old', at: old }) + '\n');
  assert.equal(selfreport.read(who).askedAt, old, 'fixture: the question reads two days old');
  assert.equal(selfreport.record(who, { state: 'blocked', on: 'provider api (server_error)', owner: 'provider', auto: true }).recorded, true);
  const end = selfreport.record(who, { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(end.restored, true);
  const shown = selfreport.read(who);
  assert.equal(shown.state, 'needs_you');
  assert.equal(shown.askedAt, old, 'the re-shown question was re-dated to now');
  assert.ok(!shown.instance, 'the re-shown line carried the old run\'s instance');
});
