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

/* Every place Vercel's tool may keep its folder here. Windows has two: the tool's data path sits under xdg.data there. */
function vercelDirs(env, platform, home) {
  const set = nonEmpty(env.AGENT_WORKFORCE_VERCEL_CONFIG_DIR);
  if (set) return [set];
  if (platform === 'win32') {
    const roaming = nonEmpty(env.APPDATA) || path.join(home, 'AppData', 'Roaming');
    return [path.join(roaming, 'xdg.data', 'com.vercel.cli'), path.join(roaming, 'com.vercel.cli')];
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'com.vercel.cli')];
  return [path.join(nonEmpty(env.XDG_DATA_HOME) || path.join(home, '.local', 'share'), 'com.vercel.cli')];
}

/* A `github.com:` key alone is not a sign-in: `gh config set --host` writes one with no account under it. */
function hostHoldsAccount(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^github\.com:\s*$/.test(l));
  if (at === -1) return false;
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) return false;
    if (/^\s+(user|users|oauth_token):/.test(l)) return true;
  }
  return false;
}

function github({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  return hostHoldsAccount(read(path.join(ghDir(env, platform, home), 'hosts.yml')));
}

function vercel({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  return vercelDirs(env, platform, home).some((d) => {
    try { return Boolean(nonEmpty(JSON.parse(read(path.join(d, 'auth.json'))).token)); } catch { return false; }
  });
}

module.exports = { github, vercel };
