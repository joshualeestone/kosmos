'use strict';
/**
 * kosmos#7748: whether a sign-in service's own tool holds a sign-in on this computer, read from its file and never by
 * asking the service, for `kosmos connections` (server.js connectionsHeld). True means the file names a sign-in, which
 * says nothing about whether the service still accepts it. False means this read found none, which is not proof: a tool
 * can keep its sign-in somewhere else, so the caller keeps saying only a live check can tell.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

function ghDir(env, platform, home) {
  const set = nonEmpty(env.AGENT_WORKFORCE_GH_CONFIG_DIR) || nonEmpty(env.GH_CONFIG_DIR);
  if (set) return set;
  if (platform === 'win32') return path.join(nonEmpty(env.APPDATA) || path.join(home, 'AppData', 'Roaming'), 'GitHub CLI');
  return path.join(nonEmpty(env.XDG_CONFIG_HOME) || path.join(home, '.config'), 'gh');
}

function vercelDir(env, platform, home) {
  const set = nonEmpty(env.AGENT_WORKFORCE_VERCEL_CONFIG_DIR);
  if (set) return set;
  if (platform === 'win32') return path.join(nonEmpty(env.APPDATA) || path.join(home, 'AppData', 'Roaming'), 'com.vercel.cli');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'com.vercel.cli');
  return path.join(nonEmpty(env.XDG_DATA_HOME) || path.join(home, '.local', 'share'), 'com.vercel.cli');
}

function github({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  return /^github\.com:\s*$/m.test(read(path.join(ghDir(env, platform, home), 'hosts.yml')));
}

function vercel({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  try { return Boolean(nonEmpty(JSON.parse(read(path.join(vercelDir(env, platform, home), 'auth.json'))).token)); } catch { return false; }
}

module.exports = { github, vercel };
