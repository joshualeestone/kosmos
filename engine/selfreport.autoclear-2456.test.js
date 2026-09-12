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
