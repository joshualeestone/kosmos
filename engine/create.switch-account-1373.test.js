'use strict';

/**
 * #1373: the switch to OpenAI can be TOLD which sign-in, instead of stating a
 * default.
 *
 * 🛑 WHY THE PLIST IS THE ASSERTION AND THE RETURN VALUE IS NOT. `setProvider`
 * reporting the account it chose proves only that it chose one. The thing that
 * decides which sign-in the agent actually starts on is `CODEX_HOME` in the
 * launch job, and those are two different facts: an earlier defect on this
 * exact path (#1313) had the engine reading one directory while the add path
 * wrote another, and every sentence involved was honest.
 *
 * ⚠️ THE REFUSAL ARM IS THE ONE THAT MATTERS MOST, and #1372 is what made it
 * reachable: now that an OpenAI account can be removed, a page that has not
 * repainted can name a directory that is gone. Falling back to the first
 * account would start the agent on one the person did not pick, silently,
 * which is the failure this card exists to end.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sealed BEFORE ./create is required: openaiaccounts resolves homeDir() lazily
   but create's own dir helpers are read per call, and the suite's own rule is
   to seal the environment first rather than rely on which is which. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'switch-acct-1373-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
/* 🛑 MUST STAY UNSET. When AGENT_WORKFORCE_CODEX_HOME names a home the engine
   takes that home ALONE (#1211's ruling, deliberately kept), so the list would
   hold exactly one account and there would be no choice to test. Setting it
   would leave every assertion below passing against a one-account world. */
delete process.env.AGENT_WORKFORCE_CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const BINS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN };

/** Two real OpenAI sign-ins, so "which one" is a question with two answers. */
function signIn(label, tail) {
  const dir = nodePath.join(HOME, `.codex-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: `sk-proj-testtesttesttest${tail}` }), 'utf8');
  return dir;
}
const ALPHA = signIn('alpha', 'ALFA');
const BETA = signIn('beta', 'BETA');

const create = require('./create');

const codexHomeOf = (name) => {
  const text = fs.readFileSync(create.plistPath(name), 'utf8');
  const m = text.match(/<key>CODEX_HOME<\/key><string>([\s\S]*?)<\/string>/);
  return m ? m[1] : null;
};
function born(name) {
  const out = create.createAgent({ ...BINS, name, role: 'pm', model: 'opus' });
  assert.equal(out.outcome, create.OUTCOME.CREATED, out.because);
  return name;
}

test('#1373: the engine offers a real choice, and the choice reaches the launch job', () => {
  /* THE FIXTURE'S OWN CONTROL. If both accounts are not visible, every
     assertion below is about a one-account world and proves nothing. */
  const seen = require('./openaiaccounts').list().map((a) => a.dir);
  assert.ok(seen.includes(ALPHA) && seen.includes(BETA),
    `the fixture must offer two accounts to choose between, saw ${JSON.stringify(seen)}`);

  // ARM 1, the UNCHANGED path: nothing named, so a default is stated and named.
  const a = born('switch-1373-default');
  const first = create.setProvider(a, 'openai', { ...BINS });
  assert.equal(first.outcome, create.OUTCOME.CREATED, first.because);
  assert.equal(first.openaiAccount.chosen, false, 'nobody picked, so it must not claim they did');
  assert.equal(first.openaiAccount.choiceOf, 2);
  assert.equal(codexHomeOf(a), first.openaiAccount.dir,
    'the stated default must be the home the agent actually starts in');

  /* ARM 2, THE CARD: name the OTHER account and it is the one that lands.
     🔑 It must be the account arm 1 did NOT pick, or "the choice was honoured"
     and "the default happened to be right" are the same pass. */
  const other = first.openaiAccount.dir === ALPHA ? BETA : ALPHA;
  const b = born('switch-1373-chosen');
  const picked = create.setProvider(b, 'openai', { ...BINS, accountDir: other });
  assert.equal(picked.outcome, create.OUTCOME.CREATED, picked.because);
  assert.equal(picked.openaiAccount.dir, other, 'the switch ignored the account the person picked');
  assert.equal(picked.openaiAccount.chosen, true);
  assert.equal(codexHomeOf(b), other,
    'the picked account was reported but never reached CODEX_HOME, so the agent starts on the wrong sign-in');
  assert.notEqual(codexHomeOf(b), codexHomeOf(a),
    'both agents landed on the same home, so the pick changed nothing');
});

test('#1373: an account that is not on this computer is REFUSED, not silently replaced', () => {
  const c = born('switch-1373-ghost');
  const ghost = nodePath.join(HOME, '.codex-removed-by-1372');
  assert.ok(!fs.existsSync(ghost), 'the ghost account must genuinely not exist');
  const out = create.setProvider(c, 'openai', { ...BINS, accountDir: ghost });
  assert.equal(out.outcome, create.OUTCOME.REFUSED,
    'a stale account directory fell back to the first account, which starts the agent on one nobody chose');
  assert.match(out.because, /not on this computer/);
  /* NOTHING WAS WRITTEN. A refusal that already rewrote the job is not one. */
  assert.equal(fs.existsSync(create.plistPath(c)) ? codexHomeOf(c) : null, null,
    'the refusal still wrote a codex home');
  assert.equal(require('./store').readProfile(c).provider, 'anthropic',
    'the refusal still moved the agent off Claude');
});
