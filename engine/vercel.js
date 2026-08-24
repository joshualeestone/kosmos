'use strict';
/**
 * Vercel, connected (#529): the spec behind the door. See devicedoor.js.
 * Probed 2026-08-24 with vercel 50.25.6: `vercel whoami` prints the account
 * (exit 1 when signed out); `vercel login` prints
 * "Visit https://vercel.com/oauth/device?user_code=XXXX-XXXX" and waits;
 * `--global-config <dir>` moves its sign-in so a sandbox never touches the
 * operator's. The token lives in Vercel's own auth.json under that dir.
 */
const { makeDoor, PHASE } = require('./devicedoor');
module.exports = Object.assign(makeDoor({
  serviceName: 'Vercel',
  toolName: 'the Vercel tool (vercel)',
  binEnv: 'AGENT_WORKFORCE_VERCEL_BIN',
  candidates: ['/opt/homebrew/bin/vercel', '/usr/local/bin/vercel'],
  configEnv: 'AGENT_WORKFORCE_VERCEL_CONFIG_DIR', configVar: null, configArg: '--global-config',
  statusArgs: ['whoami'],
  loginRe: /^\s*([A-Za-z0-9._-]+)\s*$/m,
  loginArgs: ['login'],
  codeRe: /user_code=([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/vercel\.com\/oauth\/device\?user_code=\S+)/,
  deviceUrl: 'https://vercel.com/oauth/device',
}), { PHASE });
