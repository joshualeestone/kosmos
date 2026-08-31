'use strict';
/** GitHub, connected (#529): the spec behind the door. See devicedoor.js. */
const { makeDoor, PHASE } = require('./devicedoor');

/* THE gh ROAD, SINGLE SOURCE. This comment block used to live in githubdevice.js
   saying "mirrors github.js's spec candidates", and the mirroring was a verbatim
   second literal that nothing compared. `githubdevice` now requires THIS array, so
   the authority the comment claimed is expressed in code rather than asserted.
   ⚠️ It does NOT make AGENT_WORKFORCE_GH_CANDIDATES global: this door takes its
   candidates as a spec parameter at load, so the override still reaches only
   `ghPresent`. Unifying removes the DRIFT, not the asymmetry. */
const GH_CANDIDATES = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);

module.exports = Object.assign(makeDoor({
  serviceName: 'GitHub',
  toolName: 'the GitHub tool (gh)',
  binEnv: 'AGENT_WORKFORCE_GH_BIN',
  candidates: GH_CANDIDATES,
  configEnv: 'AGENT_WORKFORCE_GH_CONFIG_DIR', configVar: 'GH_CONFIG_DIR', configArg: null,
  statusArgs: ['auth', 'status', '--hostname', 'github.com'],
  loginRe: /Logged in to github\.com account (\S+)/,
  loginArgs: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
  codeRe: /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/github\.com\/login\/device\S*)/,
  deviceUrl: 'https://github.com/login/device',
}), { PHASE, GH_CANDIDATES });
