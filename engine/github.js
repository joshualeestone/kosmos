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
const GH_CANDIDATES = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);

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
     could exec a real gh. Three independent reviewers flagged it and the first two
     answers were to document it, at three sites and in the plan. That volume of
     documentation was the signal it should be fixed: a reader takes the variable for
     a machine-wide "where is gh", and now it is one.
     📌 The require is LAZY and inside the getter on purpose: `githubdevice` requires
     THIS module at load for the default list, so a load-time require here would be a
     cycle. At call time both modules are fully evaluated. */
  get candidates() { return require('./githubdevice').ghCandidateList(); },
  configEnv: 'AGENT_WORKFORCE_GH_CONFIG_DIR', configVar: 'GH_CONFIG_DIR', configArg: null,
  statusArgs: ['auth', 'status', '--hostname', 'github.com'],
  loginRe: /Logged in to github\.com account (\S+)/,
  loginArgs: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
  codeRe: /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/github\.com\/login\/device\S*)/,
  deviceUrl: 'https://github.com/login/device',
}), { PHASE, GH_CANDIDATES });
