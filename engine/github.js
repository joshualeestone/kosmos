'use strict';
/** GitHub, connected (#529): the spec behind the door. See devicedoor.js. */
const { makeDoor, PHASE } = require('./devicedoor');
module.exports = Object.assign(makeDoor({
  serviceName: 'GitHub',
  toolName: 'the GitHub tool (gh)',
  binEnv: 'AGENT_WORKFORCE_GH_BIN',
  candidates: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'],
  configEnv: 'AGENT_WORKFORCE_GH_CONFIG_DIR', configVar: 'GH_CONFIG_DIR', configArg: null,
  statusArgs: ['auth', 'status', '--hostname', 'github.com'],
  loginRe: /Logged in to github\.com account (\S+)/,
  loginArgs: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
  codeRe: /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/github\.com\/login\/device\S*)/,
  deviceUrl: 'https://github.com/login/device',
}), { PHASE });
