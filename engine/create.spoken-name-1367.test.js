'use strict';

/**
 * #1367. User-facing sentences addressed an agent by its internal identifier.
 *
 * 🛑 JOSH SAW BOTH NAMES FOR ONE AGENT IN ONE FLOW. The dialog title said
 * "Switch Miles to OpenAI" and the refusal one screen later said "so RESEARCHER
 * would start on it". His note: "we might want to put his actual username in
 * there, not his title or whatever."
 *
 * ⭐ THE RULE IS ALREADY IN `create.js`, at the bottom of `made()`: "act on the
 * machine name, speak the display name, and never make a caller derive either
 * one for itself." Eleven sentences filled their name slot from the function's
 * own argument, which is the machine name.
 *
 * 🔑 AND THE CLASS GUARD BELOW IS THE POINT OF THIS FILE, not the behaviour arm.
 * Fixing only the sentence Josh screenshotted would close the card and leave the
 * class - which is the failure this codebase has hit repeatedly. The guard fails
 * if ANY sentence in `create.js` goes back to speaking the machine name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, because the module resolves its roots at load.
// Same order and same variables as engine/create.test.js; a missing one here
// writes into the operator's real fleet, which #1411 measured happening.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'spoken-1367-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');
const status = require('./status');

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };

test('#1367: a refusal speaks the display name, not the machine name', () => {
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);

  /* Through the REAL create path, so the two names are produced the way the
     product produces them rather than asserted into place. */
  const made = create.createAgent({ ...BINS, name: 'Miles Researcher', role: 'pm' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because || '');

  /* 🔑 THE PRECONDITION, AND WITHOUT IT EVERY ASSERTION BELOW IS VACUOUS. If the
     two names were the same string, a sentence speaking either one would pass
     and this file would prove nothing. */
  const machine = 'miles-researcher';
  const shown = status.readIdentity(machine).displayName;
  assert.equal(shown, 'Miles Researcher', 'the fixture did not produce a display name');
  assert.notEqual(shown, machine, 'the two names are identical, so this test cannot distinguish them');

  /* No OpenAI account exists in the sandbox, so this takes the refusal that
     carries Josh's exact sentence. */
  const r = create.setProvider(machine, 'openai');
  assert.equal(r.outcome, create.OUTCOME.REFUSED, 'expected a refusal to read the sentence from');
  assert.ok(r.because, 'the refusal carried no sentence');

  assert.match(r.because, /Miles Researcher/,
    'the refusal did not speak the display name: ' + r.because);
  assert.doesNotMatch(r.because, /miles-researcher/,
    'the refusal spoke the MACHINE name, which is the defect: ' + r.because);
});

test('#1367: an agent whose two names agree is still named, and one that was never created is too', () => {
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  const made = create.createAgent({ ...BINS, name: 'plainbot', role: 'pm' });
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because || '');

  const r = create.setProvider('plainbot', 'openai');
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /plainbot/,
    'the sentence stopped naming the agent when the two names agree: ' + r.because);

  /* An agent with no record at all takes a different refusal, and must still be
     named in it. */
  const ghost = create.setProvider('ghostbot', 'openai');
  assert.equal(ghost.outcome, create.OUTCOME.REFUSED);
  assert.match(ghost.because, /ghostbot/,
    'a name with no record was not spoken at all: ' + ghost.because);

  /* 🛑 WHAT THIS TEST DOES *NOT* COVER, AND I FIRST CLAIMED IT DID.
     `spokenName`'s `|| clean` fallback is UNREACHABLE. Measured: `readIdentity`
     DEFAULTS `displayName` to the session name, returning 'plainbot' above and
     'ghostbot' here, so it has no falsy path and the fallback never fires.

     ⇒ My mutation arm for it stayed GREEN when I made the fallback return an
     empty string, which is how I found out. Both assertions above pass through
     the `displayName` branch, not the fallback.

     The fallback is unreachable, therefore untested, and asserting on it here
     would only be asserting on a stub of my own. */
  assert.equal(status.readIdentity('ghostbot').displayName, 'ghostbot',
    'readIdentity no longer defaults displayName to the session name, so spokenName\'s fallback is now REACHABLE and needs a real arm');
});

/**
 * 🛑 WHAT THIS GUARD IS AND IS NOT (Angel, cross-review of #1451).
 *
 * She broke it three ways: `${ clean }` with spaces, an interpolation wrapped
 * across two lines, and a differently-named binding. **All three evade it.**
 *
 * ⚠️ AND BOTH FIXES SHE TRIED WERE WORSE THAN THE GAP, which is why this is a
 * stated limit rather than a cleverer pattern. One of them false-positived on a
 * CORRECT launchctl label - the machine name belongs in that string - and the
 * other was so loose it matched nothing. **A guard that reddens correct code is
 * the one people allowlist, and this file's own siblings document allowlisting
 * as the way a guard stops guarding.**
 *
 * ⇒ SO, PLAINLY: this catches a REVERT OF THIS DEFECT IN THE SHAPE IT HAD -
 * eleven `${clean}` interpolations, which is what a revert or a careless merge
 * produces. **It is a regression guard, not a proof about the class**, and an
 * author who reintroduces the defect in a new shape will not be caught by it.
 *
 * 📌 Nothing below substitutes for that. The behaviour arms above test two
 * sentences out of eleven; the other nine are covered by this guard's shape
 * check and by nothing else.
 */
test('#1367: no sentence in create.js speaks the machine name (the class, not the instance)', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');

  /* 🔑 A POPULATION FLOOR. If the read or the pattern broke, "no offenders" is
     what a broken instrument reports, and it is indistinguishable from a fix. */
  const spoken = (src.match(/\$\{spoken\}/g) || []).length;
  assert.ok(spoken >= 10,
    `only ${spoken} sentences use the spoken name; the fix looks reverted or this test is reading the wrong file`);

  /* THE GUARD. Every sentence must speak the display name. `${clean}` is the
     machine name, and its presence in a template literal means a sentence has
     gone back to the slug. */
  const offenders = src.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\$\{clean\}/.test(l));
  assert.deepEqual(offenders.map(([n]) => n), [],
    'these lines speak the MACHINE name in a sentence, which is #1367:\n'
    + offenders.map(([n, l]) => `  create.js:${n}  ${l.trim()}`).join('\n')
    + '\nUse `spoken` (from `spokenName(clean)`) in anything a person reads.');

  /* 🔑 AND THE GUARD MUST BE ABLE TO SAY NO. Two arms that both report "clean"
     because neither read anything is the same green as two that read correctly. */
  const salted = src.replace('${spoken} would start on it', '${clean} would start on it');
  assert.notEqual(salted, src, 'the anchor for the negative arm did not match, so it proves nothing');
  assert.ok(/\$\{clean\}/.test(salted),
    'the detector cannot see a reintroduced machine name, so its empty result above means nothing');
});
