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
/* 🛑 AND `CODEX_HOME`, WHICH IS A SECOND ROOT AND WAS THE HOLE. `defaultHome()`
   reads `AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME || AGENT_WORKFORCE_HOME/.codex`,
   so an ambient CODEX_HOME walks straight through a sandbox that seals the other
   two. Measured: with one pointed at a signed-in home, `choiceOf` reads 3 rather
   than 2 and this file goes red on a correct build.
   ⇒ It fails LOUD rather than green, so it is machine-dependent flakiness rather
   than a false pass, and that is exactly the class the seal above exists for.
   Sealing one root of two is the half-seal defect, one directory over. */
delete process.env.CODEX_HOME;

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
const store = require('./store');
/**
 * An agent seeded DIRECTLY: its launch job and its profile, which is all
 * `setProvider` reads.
 *
 * 🛑 NOT `createAgent`, AND NOT BECAUSE IT IS SLOWER. `createAgent`'s
 * name-collision check calls the REAL `/bin/launchctl` (engine/create.js:2041),
 * so a first run of this file LOADED THREE LIVE launchd services on the
 * developer's machine and every later run then failed with "already set to
 * start on this computer". I measured all three loaded and booted them out.
 * ⚠️ AND `AGENT_WORKFORCE_DRY_RUN=1` IS NOT THE FIX HERE, though it is what the
 * browser checks use: `setProvider` guards the whole account block with
 * `runner === 'codex' && !DRY_RUN`, so under dry run no account is chosen at
 * all and every assertion in this file would pass against a world where the
 * feature never ran.
 * ⇒ Seeding the two things setProvider actually reads keeps launchctl out of it
 * AND keeps the code under test live. Same seam docs/browser-checks uses.
 */
function born(name) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  /* The fixture's own control: if the seed is not readable as a job, every
     REFUSED below would be right for the wrong reason. */
  assert.equal(store.readProfile(name).provider, 'anthropic');
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
  const picked = create.setProvider(b, 'openai', { ...BINS, accountDir: other, pickedByPerson: true });
  assert.equal(picked.outcome, create.OUTCOME.CREATED, picked.because);
  assert.equal(picked.openaiAccount.dir, other, 'the switch ignored the account the person picked');
  assert.equal(picked.openaiAccount.chosen, true);
  assert.equal(codexHomeOf(b), other,
    'the picked account was reported but never reached CODEX_HOME, so the agent starts on the wrong sign-in');
  assert.notEqual(codexHomeOf(b), codexHomeOf(a),
    'both agents landed on the same home, so the pick changed nothing');

  /* 🛑 ARM 3, AND IT IS THE ONE A WRONG-ACCOUNT BUG LIVES IN. WHICH account and
     WHETHER a person chose it are separate facts now. The page sends the visible
     account whenever the menu is showing, because re-selecting the option a
     <select> already holds fires no `change` (and with exactly one account it can
     never fire at all), so requiring the flag meant the row ON SCREEN was not the
     row that got used.
     ⇒ A named account with no claim of a pick must STILL be honoured, and must
     still be reported honestly as not chosen. Both halves, or the fix is half a
     fix in either direction. */
  const c = born('switch-1373-seen-not-picked');
  const shown = create.setProvider(c, 'openai', { ...BINS, accountDir: other });
  assert.equal(shown.outcome, create.OUTCOME.CREATED, shown.because);
  assert.equal(codexHomeOf(c), other,
    'the account on screen was not the account used, which is the wrong-account bug this split exists to prevent');
  assert.equal(shown.openaiAccount.chosen, false,
    'a named account was reported as a personal pick, which is the invention the route refuses');
});

/* 🛑 THE OVERRIDE ARM HAD NO TEST ON ANY LAYER, and it is the only place the two
   reasons a named account is missing are told apart. The file deletes
   AGENT_WORKFORCE_CODEX_HOME at the top precisely so the rest of the suite sees a
   real list, so this arm has to set it back for its own duration and put it back
   after, or every other test in the file changes meaning. */
test('#1373: with an override home in force, the refusal says THAT, not "it is gone"', () => {
  const d = born('switch-1373-override');
  process.env.AGENT_WORKFORCE_CODEX_HOME = ALPHA;
  try {
    /* BETA genuinely exists on this machine. It is excluded by the override, not
       missing, and telling the person it is gone would be false. */
    const out = create.setProvider(d, 'openai', { ...BINS, accountDir: BETA, pickedByPerson: true });
    assert.equal(out.outcome, create.OUTCOME.REFUSED, out.because);
    assert.match(out.because, /one particular OpenAI sign-in/,
      'the override refusal fell through to the account-is-gone sentence, which is false here');
    assert.doesNotMatch(out.because, /not on this computer any more/);
    /* Both refusals must agree that nothing happened, or one of them is a
       different promise about the same event. */
    assert.match(out.because, /nothing was changed/);
    /* 🔑 AND THE SAME OVERRIDE WRITTEN NON-CANONICALLY MUST STILL MATCH ITSELF.
       Without `path.resolve` on this branch, an override with a trailing slash or a
       `..` segment fails to equal its own resolved form, and a person picking THE
       VERY ACCOUNT THE OVERRIDE NAMES is refused. Nothing else covers that line. */
    process.env.AGENT_WORKFORCE_CODEX_HOME = nodePath.join(ALPHA, '..', nodePath.basename(ALPHA)) + '/';
    const f = born('switch-1373-override-messy');
    const messy = create.setProvider(f, 'openai', { ...BINS, accountDir: ALPHA, pickedByPerson: true });
    assert.equal(messy.outcome, create.OUTCOME.CREATED,
      'a non-canonical override refused the very account it names: ' + messy.because);
    assert.equal(codexHomeOf(f), ALPHA);
  } finally {
    delete process.env.AGENT_WORKFORCE_CODEX_HOME;
  }
  /* THE CONTROL: with the override gone, the SAME call must now succeed, or the
     assertions above would pass for a machine where BETA simply does not work. */
  const e = born('switch-1373-override-control');
  const ok = create.setProvider(e, 'openai', { ...BINS, accountDir: BETA });
  assert.equal(ok.outcome, create.OUTCOME.CREATED, ok.because);
  assert.equal(codexHomeOf(e), BETA);
});

/* 🛑 THE REGRESSION GUARD. This branch made the page send the visible row on
   EVERY switch, and that could REFUSE a switch that used to succeed: on an
   override machine the engine's list is one home, the page's menu is built from
   the unfiltered rows minus any whose live check said `none`, so the preselect
   can be an account the engine will not accept, and a person WHO TOUCHED NOTHING
   got a refusal.
   ⇒ Nobody chose, so there is nothing to refuse. An unpicked account is the page
   reporting what it was showing, not a request. It falls back to the engine's own
   list, which is exactly the pre-branch behaviour for that person.
   ⚠️ Both halves, or the fix is half a fix: unpicked must SUCCEED, and picked must
   still REFUSE, or the refusal has been quietly deleted. */
test('#1373: an unpicked account the engine cannot use falls back instead of refusing', () => {
  const g = born('switch-1373-unpicked-ghost');
  const ghost = nodePath.join(HOME, '.codex-not-here-at-all');
  assert.ok(!fs.existsSync(ghost), 'the ghost must genuinely not exist');
  const out = create.setProvider(g, 'openai', { ...BINS, accountDir: ghost });
  assert.equal(out.outcome, create.OUTCOME.CREATED,
    'a person who touched nothing was refused, which is the regression this guards: ' + out.because);
  assert.equal(out.openaiAccount.chosen, false, 'a fallback must not be reported as a pick');
  assert.ok(codexHomeOf(g), 'the fallback wrote no codex home at all');
  /* THE OTHER HALF: the same directory, PICKED, must still be refused. Without
     this the test above is satisfied by an engine that never refuses anything. */
  const h = born('switch-1373-picked-ghost');
  const still = create.setProvider(h, 'openai', { ...BINS, accountDir: ghost, pickedByPerson: true });
  assert.equal(still.outcome, create.OUTCOME.REFUSED,
    'the refusal was deleted along with the regression, so a real pick of a dead account now passes silently');
});

/* 🛑 THE PAIR THE COMMENT PROMISED AND NOTHING PINNED (iteration 13).
   `engine/create.js` accepts a real divergence on purpose: the confirm dialog has
   already said "it runs on the sign-in shown above", and the unpicked fallback can
   then land on a DIFFERENT row (a ghost after removal, or an override home). That
   trade is right, because refusing there was iteration 11's regression.
   ⚠️ But the whole defence of it is one sentence in a comment: "NOT SILENT, because
   the route names the account it actually landed on." Nothing tested that sentence,
   so a later edit could stop naming it and every test would stay green, turning an
   ACCEPTED divergence into a SILENT one. That is the difference between a documented
   trade-off and a wrong-account bug.
   ⭐ The load-bearing assertion is the last one: what the answer SAYS must equal what
   the launch job actually GOT. Pinning the answer alone would pass on an engine that
   names one account and starts another. */
test('#1373: when the unpicked fallback lands elsewhere, the answer NAMES where it landed', () => {
  const g = born('switch-1373-fallback-names-it');
  const ghost = nodePath.join(HOME, '.codex-gone-and-unpicked');
  assert.ok(!fs.existsSync(ghost), 'the ghost must genuinely not exist');
  const out = create.setProvider(g, 'openai', { ...BINS, accountDir: ghost });
  assert.equal(out.outcome, create.OUTCOME.CREATED,
    'the unpicked fallback refused, which is iteration 11\'s regression: ' + out.because);
  assert.equal(out.openaiAccount.chosen, false, 'a fallback must not be reported as a pick');
  assert.notEqual(out.openaiAccount.dir, ghost,
    'the answer claims the account that was asked for, which is not the one it could use');
  assert.ok(out.openaiAccount.dir,
    'the answer names NO account at all, so the person cannot tell which sign-in they got');
  assert.equal(codexHomeOf(g), out.openaiAccount.dir,
    'the answer names one account and the launch job got another, so the divergence is now SILENT');
});

test('#1373: an account that is not on this computer is REFUSED, not silently replaced', () => {
  const c = born('switch-1373-ghost');
  const ghost = nodePath.join(HOME, '.codex-removed-by-1372');
  assert.ok(!fs.existsSync(ghost), 'the ghost account must genuinely not exist');
  const out = create.setProvider(c, 'openai', { ...BINS, accountDir: ghost, pickedByPerson: true });
  assert.equal(out.outcome, create.OUTCOME.REFUSED,
    'a stale account directory fell back to the first account, which starts the agent on one nobody chose');
  assert.match(out.because, /not on this computer/);
  /* NOTHING WAS WRITTEN. A refusal that already rewrote the job is not one. */
  /* 🔑 A MISSING CODEX_HOME IS NOT EVIDENCE ON ITS OWN: a Claude plist carries no
     CODEX_HOME key either, so the old form could not tell "the refusal wrote
     nothing" from "the refusal wrote a Claude job". Assert what the plist DOES
     say, and the arm means something. */
  assert.equal(codexHomeOf(c), null, 'the refusal still wrote a codex home');
  assert.match(fs.readFileSync(create.plistPath(c), 'utf8'), new RegExp(CLAUDE_BIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the refusal rewrote the job onto a different runner');
  assert.equal(store.readProfile(c).provider, 'anthropic',
    'the refusal still moved the agent off Claude');
});
