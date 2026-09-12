'use strict';

/**
 * #2811: what `setProvider` actually writes, ENUMERATED BY MEASUREMENT rather
 * than by anybody's reading of the function.
 *
 * 🛑 THE HISTORY, BECAUSE THE COUNT HAS BEEN WRONG THREE TIMES AND EACH VERSION
 * WAS WRITTEN BY SOMEONE LOOKING STRAIGHT AT THE CODE:
 *   "one"   - `setProvider`'s own header (8fe044b8, 2026-08-24): "a plist rewrite
 *             through the one writer (`plistFor`) and nothing else: no record is
 *             copied, moved, or stamped". The `store.writeProfile` call it denies
 *             landed in that SAME COMMIT. It was never true.
 *   "three" - my round-23 correction, which enumerated the two statements a
 *             reviewer had pointed at and inferred the set was closed.
 *   "four"  - measured: the trust write (`trustCodexFolder`, create.js) appends
 *             `[projects."<workerDir>"] trust_level = "trusted"` to
 *             `<codexHome>/config.toml`, and it is the FIRST to execute.
 *
 * ⭐ AND THE PROPERTY I ASSERTED ALONGSIDE "three" WAS FALSE IN THREE WAYS, of
 * which a reviewer caught one. I wrote "everything that moved stayed INSIDE
 * workerDir(name)". Measured, the plist and the profile are outside it as well,
 * and always were. A sentence about a directory, written while looking at the one
 * write that happens to be in it.
 *
 * ⇒ SO THIS FILE DOES NOT COUNT WRITES. It snapshots every path under the
 * sandbox and hashes it, runs `setProvider`, and asserts the EXACT SET of paths
 * that changed. A fifth write added later cannot pass: it reds here, naming the
 * path. That is the only form of this claim nobody can restate wrongly, because
 * nobody restates it at all - the machine enumerates it each run.
 *
 *   node --test engine/create.setprovider-writes-2811.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const nodePath = require('node:path');

/* Sealed BEFORE ./create is required, and BOTH codex roots deleted, for the
   reasons create.switch-account-1373.test.js documents at length: an ambient
   CODEX_HOME walks straight through a sandbox that seals only the other two.
   🔑 HERE IT FAILS LOUD RATHER THAN GREEN, which is the same thing
   create.switch-account-1373.test.js says about its own seal. MEASURED, with the
   seal removed and an external signed-in CODEX_HOME: the trust entry really does
   land outside the sandbox, AND this file REDS, naming the missing path, because
   the expected list is built from the fixed SIGNIN constant so a trust write that
   goes elsewhere always subtracts an expected element.
   🛑 "THE ASSERTION WOULD PASS WHILE MISSING IT" IS WHAT THIS SAID, and it is
   backwards. It described the PREVIOUS version of this file, which asserted
   nothing about the trust write at all - so the justification outlived the thing
   it justified by exactly one rewrite, mine. ⭐ When you replace a mechanism,
   re-derive its rationale instead of carrying it across: a rationale reads as
   checked because it was, once. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'setprovider-writes-2811-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const BINS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN };

/* One real OpenAI sign-in, so the switch has an account to land on. */
const SIGNIN = nodePath.join(HOME, '.codex');
fs.mkdirSync(SIGNIN, { recursive: true });
fs.writeFileSync(nodePath.join(SIGNIN, 'auth.json'),
  JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtesttesttest2811' }), 'utf8');

const create = require('./create');
const store = require('./store');

/* Seeded DIRECTLY rather than through `createAgent`, which calls the REAL
   /bin/launchctl and loads live services on the developer's Mac. Same seam as
   create.switch-account-1373.test.js, and for the same measured reason. */
function born(name) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief\n', 'utf8');
  return name;
}

/* 🛑 BUILT FROM THE PUBLIC GETTER, because `store.profilePath` is DELIBERATELY
   not exported and store.js says why at length: a path helper whose only
   justification is symmetry is one somebody eventually uses for the deletion that
   feature exists not to do. `PROFILES` is a getter answering the CURRENT
   environment (not a string frozen at require time, which this branch measured
   and got wrong once), so it resolves inside the sandbox sealed above. */
const PROFILE_FILE = (name) => nodePath.join(store.PROFILES, store.safeKey(name) + '.json');

/** Every file under the sandbox, by content hash. Directories are not listed:
    a directory created on the way to a file is not an independent write. */
function snapshot(dir, acc = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = nodePath.join(dir, e.name);
    if (e.isDirectory()) snapshot(f, acc);
    else acc.set(f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  }
  return acc;
}

/** created / modified / deleted, as `<VERB> <path-relative-to-sandbox>` lines. */
function changesBetween(before, after, root) {
  const out = [];
  for (const f of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(f);
    const a = after.get(f);
    if (b === a) continue;
    out.push(`${b === undefined ? 'CREATED' : a === undefined ? 'DELETED' : 'MODIFIED'} ${f.slice(root.length)}`);
  }
  return out.sort();
}

test('#2811: the EXACT SET of paths setProvider writes, enumerated by measurement', () => {
  const name = born('setprov-2811-set');
  const dir = create.workerDir(name);
  const rel = (p) => p.slice(SANDBOX.length);

  /* THE FIXTURE'S OWN CONTROLS: the PRE state of each thing asserted below, so a
     setProvider that did nothing would red rather than pass. */
  assert.equal(store.readProfile(name).provider, 'anthropic', 'CONTROL: the profile starts anthropic');
  assert.equal(create.readJob(name).runner, 'claude', 'CONTROL: the launch job starts on claude');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'CONTROL: the brief starts as CLAUDE.md');
  assert.equal(fs.existsSync(nodePath.join(SIGNIN, 'config.toml')), false, 'CONTROL: no trust entry exists yet');

  const before = snapshot(SANDBOX);
  const sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  const changed = changesBetween(before, snapshot(SANDBOX), SANDBOX);

  /* 🛑 THE WHOLE POINT OF THIS FILE. Not "at least these" and not a count: the
     EXACT set. A fifth write cannot slip past a reader here, because no reader is
     involved - a new path appears in `changed` and this assertion names it. */
  assert.deepEqual(changed, [
    `CREATED ${rel(nodePath.join(SIGNIN, 'config.toml'))}`,
    `CREATED ${rel(nodePath.join(dir, 'AGENTS.md'))}`,
    `DELETED ${rel(nodePath.join(dir, 'CLAUDE.md'))}`,
    `MODIFIED ${rel(create.plistPath(name))}`,
    `MODIFIED ${rel(PROFILE_FILE(name))}`,
  ].sort(), 'setProvider wrote a different set of paths than this test documents');

  /* And what each one MEANS, so the set above is a contract rather than a list of
     filenames somebody can update to match a regression. */
  /* 🔑 FIRST, AND THE ORDER IS THE POINT. A mutant that leaves the plist at the
     same path but unreadable (an empty runner bin, say) makes `readJob` return
     null. Below the `.runner` read this assertion is unreachable - that read
     throws a TypeError first and the arm dies with a stack trace instead of a
     sentence. MEASURED: it did exactly that until this line moved up here. An
     assertion shielded by a crash is not a guard, it is a comment. */
  assert.ok(create.readJob(name),
    'the launch job is no longer readable under the ORIGINAL name, so a name-keyed lookup no longer resolves');
  assert.equal(create.readJob(name).runner, 'codex', 'the plist now names codex');
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), true, 'the brief was renamed to AGENTS.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), false, 'the old CLAUDE.md is gone');
  assert.equal(store.readProfile(name).provider, 'openai', 'the profile provider was stamped');
  assert.match(fs.readFileSync(nodePath.join(SIGNIN, 'config.toml'), 'utf8'), /trust_level\s*=\s*"trusted"/,
    'the trust entry was written, so the OpenAI runner may work in the folder');

  /* ⇒ AND THE PROPERTY THE OLD FALSE PREMISE WAS STANDING IN FOR, stated so it is
     true. It is NOT "everything stays inside workerDir": THREE of the five paths
     above are outside it, and the plist and profile always were. What actually
     holds, and what a workdir-keyed Claude transcript lookup depends on, is that
     the worker directory is not MOVED and the agent's NAME does not change -- so
     every lookup keyed on either resolves the same directory afterwards, which is
     why #2811's stale-model guard is necessary rather than moot. */
  /* 📌 THREE OF THE FIVE PATHS ABOVE ARE OUTSIDE `dir`, and that is recorded here
     as a COMMENT rather than an assertion on purpose. The deepEqual already pins
     the exact set, so any count derived from it cannot fail independently: an
     `assert.equal(outside.length, 3)` here would be decoration wearing the
     costume of a guard. This file's whole point is that the enumeration is
     measured, and a restatement of a measured thing is the failure mode again.

     ⚠️ I wrote that vacuous count, and a worse one beside it, in the same session
     that removed two others: `assert.equal(create.readJob(name).name || name,
     name, 'the agent name is unchanged')`. `readJob` returns NO `name` key
     (claude, tmux, model, configDir, runner), so it read `undefined || name`
     against `name` - a literal tautology, carrying a message about a product
     property. Both are gone. What replaces them can fail: */
  assert.equal(create.workerDir(name), dir,
    'the worker directory MOVED, so a workdir-keyed transcript lookup no longer resolves');
});

test('#2811: WHICH of the four writes can abort the switch, asserted rather than described', () => {
  /* 🛑 THE CLAIM THIS REPLACES SAID THE TRUST WRITE IS "THE ONLY ONE THAT IS NOT
     BEST-EFFORT". False: inside `setProvider` TWO of the four return REFUSED (the
     trust write and the plist write) and two swallow (the brief rename and the
     profile write).
     ⚠️ AND GATING IS A PROPERTY OF THE CALL SITE, NOT OF `trustCodexFolder`, so
     this arm asserts `setProvider` and says nothing about the other three callers.
     It used to name them and was wrong about all three, including calling the
     create path non-gating when a throw there rolls the whole creation back. The
     cause was a NAME COLLISION: `trustFolder` (Claude) and `trustCodexFolder` are
     different functions, and the "non-gating" comment I cited is about the former.
     ⭐ That paragraph existed to FIX a measuring-one-path-and-pronouncing-on-the-
     space error and committed the same error in its own sentence. The repair is
     not a better enumeration; it is asserting one site and enumerating none.
     📌 The mechanism is a REAL failure, not an injected one: `config.toml` is made
     read-only, so `trustCodexFolder`'s `appendFileSync` throws EACCES.
     ⚠️ THE FILE, NOT THE DIRECTORY, AND I GOT THAT WRONG FIRST. Chmodding SIGNIN
     to 0o500 changed nothing: directory write permission governs CREATING and
     removing entries, not appending to a file that already exists -- and the arm
     above has already created `config.toml` in this shared sandbox. The test said
     so immediately (`setProvider reported created`), which is the arm working. */
  if (process.getuid && process.getuid() === 0) return; // root ignores the mode bits

  const name = born('setprov-2811-gate');
  const dir = create.workerDir(name);
  const cfg = nodePath.join(SIGNIN, 'config.toml');
  /* The arm above runs first and creates it; do not depend on that ordering. */
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '', 'utf8');
  const before = snapshot(SANDBOX);

  fs.chmodSync(cfg, 0o400); // readable, NOT writable
  let sw;
  try { sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN }); }
  finally { fs.chmodSync(cfg, 0o600); }

  assert.equal(sw.outcome, create.OUTCOME.REFUSED,
    'a failing TRUST write no longer aborts the switch: setProvider reported ' + sw.outcome);
  assert.match(String(sw.because), /work in its folder/,
    'the refusal no longer names the trust write as the reason');

  /* ⇒ AND "nothing was changed" IS PART OF THAT REFUSAL'S OWN SENTENCE, so it is
     asserted rather than assumed: the gate fires FIRST, before any other write. */
  assert.deepEqual(changesBetween(before, snapshot(SANDBOX), SANDBOX), [],
    'the refusal says "nothing was changed" but paths were written before the gate fired');
  assert.equal(create.readJob(name).runner, 'claude', 'the launch job was switched despite the refusal');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'the brief was renamed despite the refusal');
});

test('#2811: the PLIST write is the second gate, and the trust write has already landed when it fires', () => {
  /* 🛑 WHY THIS ARM EXISTS. The header names TWO gates and round 25 converted only
     ONE of them, so "the plist rewrite ... Also gating" was a true sentence with
     nothing holding it. Measured before writing this: no test anywhere drove
     `setProvider`'s plist-REFUSED branch (`grep -rn "startup file"` over
     engine/*.test.js and server.test.js found only setModel, remove and whoami
     arms), while the same grep DOES find the wording elsewhere, so the zero was a
     real absence and not a silent instrument.
     📌 Again a REAL failure rather than an injected one: the plist is made
     read-only, so the write throws EACCES. */
  if (process.getuid && process.getuid() === 0) return; // root ignores the mode bits

  const name = born('setprov-2811-plistgate');
  const dir = create.workerDir(name);
  const cfg = nodePath.join(SIGNIN, 'config.toml');
  /* 🛑 SEED IT, DO NOT INHERIT IT FROM THE ARM ABOVE. The expectation below names
     the verb MODIFIED, which is only true if this file already exists when the
     snapshot is taken. Without this line the arm passes in file order and FAILS
     under `--test-name-pattern`, a shard, or any reorder -- and its red reads as
     "setProvider wrote the wrong set", pointing the reader at the product. The
     sibling arm above carries this exact guard; I wrote it there and then omitted
     it here one round later. */
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '', 'utf8');
  const before = snapshot(SANDBOX);

  fs.chmodSync(create.plistPath(name), 0o400);
  let sw;
  try { sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN }); }
  finally { fs.chmodSync(create.plistPath(name), 0o600); }

  assert.equal(sw.outcome, create.OUTCOME.REFUSED,
    'a failing PLIST write no longer aborts the switch: setProvider reported ' + sw.outcome);
  assert.match(String(sw.because), /startup file/,
    'the refusal no longer names the startup file as the reason');

  /* ⇒ AND THE ORDER IS PINNED BY THE SAME MEASUREMENT, which is why this asserts a
     set rather than a count: the ONLY thing written is the trust append, so the
     trust write had already landed when the plist gate fired, and nothing after
     the plist write ran at all. */
  assert.deepEqual(changesBetween(before, snapshot(SANDBOX), SANDBOX),
    [`MODIFIED ${cfg.slice(SANDBOX.length)}`],
    'the plist gate fired with a different set of writes already done');
  assert.equal(create.readJob(name).runner, 'claude', 'the launch job changed despite the refusal');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'the brief was renamed after the plist gate refused');
  assert.equal(store.readProfile(name).provider, 'anthropic', 'the profile was stamped after the plist gate refused');
});


test('#2811: the brief RENAME is best-effort, so a failing rename does not abort the switch', () => {
  /* 🛑 WHY: the header calls writes 3 and 4 "best-effort: its catch swallows", and
     round 27 measured that NO test in the repo reaches either catch. Both were
     replaced with a throw and every file that exercises `setProvider` was run: no
     throw surfaced. So "swallows" and "gates" were indistinguishable for these two,
     while the header said the four-way split "is now an ASSERTION". These two arms
     make that sentence true.
     📌 Real EACCES again: the worker directory is made non-writable, so the
     same-directory rename throws. Read and execute stay on, so the two
     `existsSync` checks above the rename still behave normally and the rename is
     genuinely reached. */
  if (process.getuid && process.getuid() === 0) return;

  const name = born('setprov-2811-renameswallow');
  const dir = create.workerDir(name);
  const cfg = nodePath.join(SIGNIN, 'config.toml');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '', 'utf8');

  fs.chmodSync(dir, 0o500); // readable and listable, NOT writable
  let sw;
  try { sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN }); }
  finally { fs.chmodSync(dir, 0o700); }

  assert.equal(sw.outcome, create.OUTCOME.CREATED,
    'a failing BRIEF RENAME aborted the switch, so it is a gate and not best-effort: ' + sw.because);
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'the rename did not actually fail, so this arm proves nothing');
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), false, 'the rename did not actually fail, so this arm proves nothing');

  /* ⇒ AND THE WRITES AFTER IT STILL HAPPENED, which is the whole content of
     "best-effort": the switch completed around the failure. */
  assert.equal(create.readJob(name).runner, 'codex', 'the plist write did not happen, so the rename did gate it');
  assert.equal(store.readProfile(name).provider, 'openai', 'the profile write did not happen, so the rename did gate it');
});

test('#2811: the PROFILE write is best-effort, so a failing profile write does not abort the switch', () => {
  /* The pair of the arm above, for write 4. Real EACCES: the profiles directory is
     made non-writable, and `store.writeProfile` writes a temp file beside the
     target and renames it, so both steps need directory write permission. */
  if (process.getuid && process.getuid() === 0) return;

  const name = born('setprov-2811-profileswallow');
  const dir = create.workerDir(name);
  const cfg = nodePath.join(SIGNIN, 'config.toml');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '', 'utf8');
  const profiles = store.PROFILES;

  fs.chmodSync(profiles, 0o500);
  let sw;
  try { sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN }); }
  finally { fs.chmodSync(profiles, 0o700); }

  assert.equal(sw.outcome, create.OUTCOME.CREATED,
    'a failing PROFILE write aborted the switch, so it is a gate and not best-effort: ' + sw.because);
  assert.equal(store.readProfile(name).provider, 'anthropic',
    'the profile write did not actually fail, so this arm proves nothing');

  /* ⇒ And everything else still landed. */
  assert.equal(create.readJob(name).runner, 'codex', 'the plist write did not happen, so the profile write did gate it');
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), true, 'the brief rename did not happen, so the profile write did gate it');
});
