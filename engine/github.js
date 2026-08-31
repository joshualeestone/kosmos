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

function ghCandidateList(override = process.env.AGENT_WORKFORCE_GH_CANDIDATES) {
  /* 🛑 THE RULE AS SHIPPED: anything that is not a STRING means unset.
     `''` IS a string, so it is honoured and means "no candidates", yielding [].
     Measured, four arms: '' -> [], ':::' -> [], null -> the three defaults,
     undefined -> the three defaults.

     WHY NOT TRUTHINESS: on truthiness an empty string would mean "unset", so a test
     setting AGENT_WORKFORCE_GH_CANDIDATES='' to mean "no candidates" would silently
     scan /opt/homebrew/bin/gh and the other REAL paths on the operator's machine.
     Same leak class as an unsandboxed store, which this branch already had once.

     WHY `typeof` RATHER THAN `=== undefined`: as exported API this can be handed a
     null or a number, which `.split` would throw on, and that throw would escape
     `ghPresent` into `state()`, whose contract says it never rejects. `=== undefined`
     is still the distinction being drawn; `typeof` just draws it safely.

     📌 THE OVERRIDE IS A PARAMETER SO THE ARM IS NOT MACHINE LUCK. Its only guard
     used to read the env and could therefore only tell the fixed and broken shapes
     apart on a machine that HAS gh at a default path; on CI, which is the environment
     that gates merges, it skipped and the fix shipped unguarded. Taking the value as
     an argument lets a test drive THIS function directly with '' and with undefined.
     Production still calls `ghCandidateList()` and reads the env, so the test
     exercises production's own branch rather than a substitute.

     ⚠️ ASYMMETRY, STATED HERE BECAUSE IT IS ONLY OBVIOUS FROM ONE SIDE: this
     override treats '' as "no candidates", while AGENT_WORKFORCE_GH_BIN below treats
     '' as "unset" (plain truthiness). `export FOO=$UNSET` produces an empty string
     routinely. The directions differ and both are safe: here '' yields an empty scan,
     there '' falls through to the candidate list. Noted at both sites.

     📌 HISTORY, non-operative. This was headlined "`=== undefined`, NOT TRUTHINESS"
     with a SECOND block below it correcting the rule to `typeof`. The headline
     described a superseded implementation, and a reader takes the first sentence.
     That is the stale-comment class this branch exists to fix, and `becomeStuck` was
     reordered on exactly this reasoning ("the prominent one should be the true one")
     less than an hour before this block was written the wrong way round. Folded so
     there is one block whose first sentence is the shipped rule. */
  if (typeof override !== 'string') return GH_CANDIDATES;
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
     `ghBin()` inside the promise executor and `devicedoor.js:99` promises "Never
     rejects". A local call cannot fail to load. */
  get candidates() { return ghCandidateList(); },
  configEnv: 'AGENT_WORKFORCE_GH_CONFIG_DIR', configVar: 'GH_CONFIG_DIR', configArg: null,
  statusArgs: ['auth', 'status', '--hostname', 'github.com'],
  loginRe: /Logged in to github\.com account (\S+)/,
  loginArgs: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
  codeRe: /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/github\.com\/login\/device\S*)/,
  deviceUrl: 'https://github.com/login/device',
}), { PHASE, GH_CANDIDATES, ghCandidateList });
