'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5870: the token-only guard reads each config home's files (its settings, its plugin records, each plugin's config
 * files) once per pass, not once per agent. A pass's launchCache holds each read; a new pass reads again.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'homescan-5870-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');   // job files go here, never the real LaunchAgents
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const startcommands = require('./startcommands');
const store = require('./store');

fs.mkdirSync(store.ROOT, { recursive: true });
const HOME = process.env.AGENT_WORKFORCE_HOME;
const MANAGED = path.join(SANDBOX, 'managed');
const LAUNCH_PIN = { panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [] };
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), managedDir: MANAGED, managedPrefsDir: null, ...LAUNCH_PIN,
  env: {}, userShellDirs: [], homebrewPrefixes: [], tmpDir: path.join(SANDBOX, 'tmp-fixed') };
fs.mkdirSync(DEPS.tmpDir, { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });

function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function writeJson(file, j) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2)); }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }

// Another agent's config home outside ~/.claude*, with an installed plugin whose hook runs a script outside it.
const OTHER = path.join(SANDBOX, 'other-home');
const PLUGIN = path.join(SANDBOX, 'plugin-p');
const RECORD = path.join(OTHER, 'plugins', 'installed_plugins.json');
writeJson(RECORD, { plugins: { 'p@m': [{ installPath: PLUGIN }] } });
writeJson(path.join(PLUGIN, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `bash ${path.join(SANDBOX, 'scripts', 'p-start.sh')}` }] }] } });

/* Counts fs.readFileSync calls on one file while `fn` runs. */
function readsOf(file, fn) {
  const orig = fs.readFileSync;
  let n = 0;
  fs.readFileSync = function (p, ...rest) { if (path.resolve(String(p)) === path.resolve(file)) n++; return orig.call(this, p, ...rest); };
  try { fn(); } finally { fs.readFileSync = orig; }
  return n;
}
const pass = (cache, ...names) => { for (const n of names) setup.guardTokenOnlyFolder(agentDir(n), n, { ...DEPS, agentConfigDirs: [OTHER], ...(cache ? { launchCache: cache } : {}) }); };

test('#5870: one pass over two agents reads the other home\'s plugin record once; without a shared cache, once per agent (the control)', () => {
  const shared = readsOf(RECORD, () => pass(new Map(), 'pilot-a', 'pilot-b'));
  assert.equal(shared, 1, `one read per pass, got ${shared}`);
  const unshared = readsOf(RECORD, () => pass(null, 'pilot-c', 'pilot-d'));
  assert.equal(unshared, 2, `the control must see each agent read it, got ${unshared}`);
  // The plugin's own config file too, and the hook it names is still denied for BOTH agents of the shared pass.
  const hooks = path.join(PLUGIN, 'hooks', 'hooks.json');
  assert.equal(readsOf(hooks, () => pass(new Map(), 'pilot-e', 'pilot-f')), 1, 'a plugin config file is read once per pass');
  for (const n of ['pilot-e', 'pilot-f']) {
    const deny = readSettings(agentDir(n)).permissions.deny;
    assert.ok(deny.some((r) => r.includes('p-start.sh')), `${n}: the plugin hook's script is denied`);
  }
});

test('#5870: a change to the home between passes is seen (a new pass is a new cache)', () => {
  const settings = path.join(OTHER, 'settings.json');
  const cache1 = new Map();
  pass(cache1, 'pilot-g');
  assert.ok(!readSettings(agentDir('pilot-g')).permissions.deny.some((r) => r.includes('later-hook.sh')), 'not there yet');
  writeJson(settings, { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `bash ${path.join(SANDBOX, 'scripts', 'later-hook.sh')}` }] }] } });
  try {
    // Control: the SAME pass's cache still holds the old read (the cache is per pass, by design).
    pass(cache1, 'pilot-h');
    assert.ok(!readSettings(agentDir('pilot-h')).permissions.deny.some((r) => r.includes('later-hook.sh')), 'within one pass the read is reused');
    pass(new Map(), 'pilot-g');
    assert.ok(readSettings(agentDir('pilot-g')).permissions.deny.some((r) => r.includes('later-hook.sh')), 'the next pass sees the new hook');
  } finally { fs.rmSync(settings, { force: true }); }
});

test('#5870: a cached read is frozen, so a reader that changed it would throw rather than change it for every agent after', () => {
  const read = startcommands.cachedReaders(new Map());
  const r = read.json(RECORD);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.json) && Object.isFrozen(r.json.plugins['p@m'][0]), 'deep-frozen');
  assert.throws(() => { r.json.plugins.extra = 1; }, TypeError);
  assert.strictEqual(read.json(RECORD), r, 'the same object from the same pass');
  // Without a cache, reads are fresh and not frozen (nothing is shared).
  const plain = startcommands.cachedReaders(null).json(RECORD);
  assert.ok(!Object.isFrozen(plain.json), 'an uncached read is not frozen');
});
