'use strict';

/**
 * #2811: `setProvider` performs THREE writes, not one, and the assertion lives
 * here because a sentence could not hold the fact still.
 *
 * 🛑 WHAT THIS EXISTS TO STOP. `setProvider`'s own header said the mechanism was
 * "a plist rewrite through the one writer (`plistFor`) and nothing else: no
 * record is copied, moved, or stamped". Every clause was false, and `git log -S`
 * says the `store.writeProfile` call landed in the SAME COMMIT as that sentence
 * (8fe044b8, 2026-08-24) - it was never true, and the brief rename (a98e282e,
 * #2245) later widened an error that already existed. The sentence was then
 * quoted into #2811 and survived 22 challenge rounds across THREE files, because
 * the CONCLUSION it supported is correct: nothing that moves leaves
 * `workerDir(clean)` and the agent's NAME never changes, so every lookup keyed on
 * the name or the workdir still resolves. A premise is not checked by the truth
 * of what it concludes.
 *
 * 📌 AND THE THIRD WRITE IS LOAD-BEARING FOR THIS CARD. The profile `provider` is
 * the SOLE rung that names the runner on Windows (`engine/runningas.js`: there is
 * no tmux, the win32 roster emits a row only for sessions `claude agents --json`
 * lists and it has no codex arm, and `readJob` reads macOS launchd). "Nothing
 * else" denied the existence of the mechanism the product depends on.
 *
 *   node --test engine/create.setprovider-writes-2811.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sealed BEFORE ./create is required, and BOTH codex roots deleted, for the
   reasons create.switch-account-1373.test.js documents at length: an ambient
   CODEX_HOME walks straight through a sandbox that seals only the other two. */
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

test('#2811: setProvider writes THREE things, not one: the plist, the BRIEF NAME, and the PROFILE PROVIDER', () => {
  const name = born('setprov-2811-three');
  const dir = create.workerDir(name);

  /* THE FIXTURE'S OWN CONTROL, and it is what makes each assertion below able to
     return the dangerous answer: every one of the three is at its PRE state, so
     a setProvider that did nothing at all would red all three rather than pass. */
  assert.equal(store.readProfile(name).provider, 'anthropic', 'CONTROL: the profile starts anthropic');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'CONTROL: the brief starts as CLAUDE.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), false, 'CONTROL: there is no AGENTS.md yet');
  assert.equal(create.readJob(name).runner, 'claude', 'CONTROL: the launch job starts on claude');

  const sw = create.setProvider(name, 'openai', { ...BINS, codexBin: CODEX_BIN });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);

  // WRITE 1: the plist. The only one the old header admitted to.
  assert.equal(create.readJob(name).runner, 'codex', 'write 1: the launch job now names codex');

  // WRITE 2: a record is MOVED. The header said none was.
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), true, 'write 2: the brief was renamed to AGENTS.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), false, 'write 2: the old CLAUDE.md is gone');

  // WRITE 3: a record is STAMPED. The header said none was, and this is the rung
  // that names the provider on Windows.
  assert.equal(store.readProfile(name).provider, 'openai', 'write 3: the profile provider was stamped');

  /* ⇒ AND THE PROPERTY THE CALLERS ACTUALLY NEED, which is what the false
     premise was standing in for: everything that moved stayed INSIDE
     workerDir(name), and the name did not change. That is why a lookup keyed on
     the workdir (a Claude transcript, via byWorkdir) still resolves afterwards -
     the real reason #2811's stale-model guard is necessary rather than moot. */
  assert.equal(create.workerDir(name), dir, 'the worker directory is unchanged, so a workdir-keyed lookup still resolves');
  assert.equal(nodePath.dirname(nodePath.join(dir, 'AGENTS.md')), dir, 'the rename stayed inside the worker directory');
});
