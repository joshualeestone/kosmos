'use strict';
/** GitHub, connected (#529): the spec behind the door. See devicedoor.js. */
const { makeDoor, PHASE } = require('./devicedoor');

/* THE gh ROAD, SINGLE SOURCE. This comment block used to live in githubdevice.js
   saying "mirrors github.js's spec candidates", and the mirroring was a verbatim
   second literal that nothing compared. `githubdevice` now requires THIS array, so
   the authority the comment claimed is expressed in code rather than asserted.
   ⚠️ THIS PARAGRAPH USED TO SAY the unification "does NOT make
   AGENT_WORKFORCE_GH_CANDIDATES global" and that the override "still reaches only
   ghPresent". BOTH ARE NOW FALSE: the getter below makes this door honour it too,
   so the two readings cannot disagree. Corrected here rather than left standing
   fourteen lines above the change that falsified it. */
/* ⚠️ GH-ONLY, DELIBERATELY. `AGENT_WORKFORCE_*_BIN` is a per-door convention that
   every door has; `AGENT_WORKFORCE_GH_CANDIDATES` is this door alone. The sibling
   door in `engine/vercel.js` keeps a bare literal, so a reader who learns the switch
   here will assume it exists there and be wrong. Not generalised in this branch:
   that is a second product surface and belongs to whoever wants it, not to a card
   about one definition of runnability. Named here rather than left to be inferred. */
const GH_CANDIDATES = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);

/* 📌 HISTORY, NOT A RULE. An earlier revision gave '' two opposite meanings by
   arrival path and needed a `|| undefined` on the default parameter to do it. That
   is gone: the one rule below replaced it, and ':' is how a caller asks for no
   candidates. The measurements that forced each step are in
   .claude/plans/runnable-dir-1592-20260830.md and on kosmos#1606. Kept as a
   pointer rather than as prose, because the prose asserted code that no longer
   exists and a reader met it BEFORE the docblock that corrects it. */
/** Where gh lives. EXPORTED, and there is ONE rule: anything that is not a
 * non-empty string means "unset" and yields the defaults.
 *
 *    ghCandidateList()            unset  -> the 3 defaults
 *    AGENT_WORKFORCE_GH_CANDIDATES=''    -> the 3 defaults   ('' is unset, both ways)
 *    ghCandidateList('')                 -> the 3 defaults
 *    ghCandidateList(':')                -> []               ask for NONE explicitly
 *    ghCandidateList('/a:/b')            -> ['/a','/b']
 *
 * 🛑 IT USED TO GIVE '' TWO OPPOSITE MEANINGS: [] as an argument, defaults from the
 * env. Both halves were justified and the split was AVOIDABLE. The natural call for
 * an exported function, `ghCandidateList(process.env.AGENT_WORKFORCE_GH_CANDIDATES)`,
 * then returned the OPPOSITE of what production does with the same value. Measured:
 * production 3 paths, that call [].
 * ⇒ `':'` already yields [] through `.split(':').filter(Boolean)`, so a caller can
 * ask for "no candidates" without overloading ''. Collapsing removed the double
 * meaning, the `|| undefined` on the default, and the two arms needed to pin the
 * two halves. */
function ghCandidateList(override = process.env.AGENT_WORKFORCE_GH_CANDIDATES) {
  /* One rule. '' is unset whichever way it arrives, which is what `export FOO=$UNSET`
     produces and what a caller passing the env value expects. */
  if (typeof override !== 'string' || override === '') return GH_CANDIDATES;
  return override.split(':').filter(Boolean);
}

module.exports = Object.assign(makeDoor({
  serviceName: 'GitHub',
  toolName: 'the GitHub tool (gh)',
  binEnv: 'AGENT_WORKFORCE_GH_BIN',
  /* 🛑 A GETTER, SO THE DOOR AND `ghPresent` CANNOT DISAGREE ABOUT WHERE gh IS.
     `makeDoor` reads `spec.candidates` at CALL time (devicedoor.js, inside `ghBin`),
     so this is re-evaluated per call and honours AGENT_WORKFORCE_GH_CANDIDATES
     exactly as `githubdevice.ghPresent` does.
     ⚠️ IT USED TO BE THE BARE ARRAY, and that shipped a HALF-SCOPED SWITCH: setting
     the override made `state().gh` say `missing` while this door still resolved and
     could exec a real gh. Three independent reviewers flagged it.
     ✅ AND IT CALLS A LOCAL FUNCTION, NOT `require('./githubdevice')`. The lazy-require
     form gave `door.state()` a reject path, because `devicedoor.status()` calls
     `ghBin()` inside the promise executor and `devicedoor's state() docblock` promises "Never
     rejects". A local call cannot fail to load. */
  get candidates() { return ghCandidateList(); },
  configEnv: 'AGENT_WORKFORCE_GH_CONFIG_DIR', configVar: 'GH_CONFIG_DIR', configArg: null,
  statusArgs: ['auth', 'status', '--hostname', 'github.com'],
  loginRe: /Logged in to github\.com account (\S+)/,
  loginArgs: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
  codeRe: /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/github\.com\/login\/device\S*)/,
  deviceUrl: 'https://github.com/login/device',
}), { PHASE, ghCandidateList });
/* 📌 `GH_CANDIDATES` is deliberately NOT exported. It had zero consumers outside
   this file, and `githubdevice.js` named that export as the residual divergence
   hazard the branch had chosen not to close ("separately referenceable, so
   somebody could scan it a second way"). Removing the identifier closes it at zero
   cost, which is better than the documented caveat it replaces. */
