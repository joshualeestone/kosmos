'use strict';
/*
 * kosmos#2129, the UPDATE-case wedge (the fresh-install createIfAbsent fix was not
 * enough). A DEFAULT-account agent launches with NO CLAUDE_CONFIG_DIR, so Claude
 * Code reads ~/.claude.json. But the Kosmos board inherits the app's launch env,
 * which on a USED machine can carry CLAUDE_CONFIG_DIR -- and CONFIG(null) honoured
 * it, so the default-account trust write landed in the ENGINE's account config
 * while the agent read ~/.claude.json. Trust written, agent still stopped on the
 * prompt. Root-caused by reproduction: it is a clean-env-vs-used-env split, which
 * is why the fresh Mac Mini worked and an updated used machine did not.
 *
 * The fix: for an agent that will run on the DEFAULT account, the trust and the
 * bypass writes target what a no-CLAUDE_CONFIG_DIR agent reads, IGNORING the
 * engine's own CLAUDE_CONFIG_DIR. The AGENT_WORKFORCE_* seams stay honoured so a
 * sandbox redirects both the write and the simulated read together.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trust-2129b-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;   // so the home fallback resolves to the sandbox, never real ~/.claude
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const trust = require('./trust');

// Save/restore every env var the resolvers read, so no test leaks into another
// and nothing touches the operator's real ~/.claude.json.
const ENVKEYS = ['CLAUDE_CONFIG_DIR', 'AGENT_WORKFORCE_CLAUDE_CONFIG', 'AGENT_WORKFORCE_CLAUDE_SETTINGS'];
let saved;
test.beforeEach(() => { saved = {}; for (const k of ENVKEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => { for (const k of ENVKEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test('defaultAgentConfig SKIPS the engine CLAUDE_CONFIG_DIR (the update wedge)', () => {
  process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'engine-account-d');
  const got = trust.defaultAgentConfig();
  assert.equal(got, path.join(SANDBOX, '.claude.json'),
    'a default-account agent reads ~/.claude.json, so the write must target it, not the engine CLAUDE_CONFIG_DIR');
  assert.doesNotMatch(got, /engine-account-d/, 'the write must NOT follow the engine account config -- that is the wedge');
});

test('defaultAgentConfig honours the AGENT_WORKFORCE_CLAUDE_CONFIG sandbox seam', () => {
  const sandboxCfg = path.join(SANDBOX, 'seam', '.claude.json');
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = sandboxCfg;
  process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'engine-account-d');
  assert.equal(trust.defaultAgentConfig(), sandboxCfg,
    'the sandbox seam wins so a test redirects both the write and the simulated read together');
});

test('defaultAgentSettings SKIPS the engine CLAUDE_CONFIG_DIR too (the bypass half)', () => {
  process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'engine-account-d');
  const got = trust.defaultAgentSettings();
  assert.equal(got, path.join(SANDBOX, '.claude', 'settings.json'));
  assert.doesNotMatch(got, /engine-account-d/, 'the bypass write must not follow the engine account settings either');
});

test('defaultAgentSettings honours the AGENT_WORKFORCE_CLAUDE_SETTINGS sandbox seam', () => {
  const s = path.join(SANDBOX, 'seam', 'settings.json');
  process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = s;
  process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'engine-account-d');
  assert.equal(trust.defaultAgentSettings(), s);
});

test('trustFolder(agentDefaultAccount) lands in the AGENT home config, NOT the engine CLAUDE_CONFIG_DIR -- with a control that proves the flag discriminates', () => {
  // 🔑 DISCRIMINATING on purpose. Do NOT set AGENT_WORKFORCE_CLAUDE_CONFIG here:
  // CONFIG(null) honours it FIRST, identically to defaultAgentConfig(), so with the
  // seam set the flag changes nothing and this assertion could never fail (a removed
  // or inverted ternary in trustFolder would stay green). Instead the engine carries
  // CLAUDE_CONFIG_DIR (the used-machine state) and the agent home is AGENT_WORKFORCE_HOME
  // (= SANDBOX). So the FIXED path resolves to SANDBOX/.claude.json while CONFIG(null)
  // resolves to engineDir/.claude.json -- the two genuinely differ.
  const engineDir = path.join(SANDBOX, 'engine-cfgdir-a');
  fs.mkdirSync(engineDir, { recursive: true });
  fs.writeFileSync(path.join(engineDir, '.claude.json'), JSON.stringify({ projects: {} }));
  process.env.CLAUDE_CONFIG_DIR = engineDir;

  const folder = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX, 'w-')));
  const r = trust.trustFolder(folder, { configDir: null, createIfAbsent: true, agentDefaultAccount: true });
  assert.equal(r.ok, true, `write failed: ${r.because}`);
  const agentData = JSON.parse(fs.readFileSync(path.join(SANDBOX, '.claude.json'), 'utf8'));
  assert.equal(agentData.projects[folder][trust.KEY], true, 'the trust lands in the config the default agent reads (SANDBOX/.claude.json)');
  const engineData = JSON.parse(fs.readFileSync(path.join(engineDir, '.claude.json'), 'utf8'));
  assert.equal(engineData.projects[folder], undefined,
    'the trust must NOT land in the engine CLAUDE_CONFIG_DIR config, even though it points somewhere real');

  // CONTROL: the SAME write WITHOUT the flag follows CONFIG(null) into the engine dir,
  // so this test can fail -- the flag (the fix) is what moves the write.
  const folder2 = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX, 'w2-')));
  trust.trustFolder(folder2, { configDir: null, createIfAbsent: true });
  const engineData2 = JSON.parse(fs.readFileSync(path.join(engineDir, '.claude.json'), 'utf8'));
  assert.equal(engineData2.projects[folder2][trust.KEY], true,
    'CONTROL: without agentDefaultAccount the write DOES follow the engine CLAUDE_CONFIG_DIR');
});

test('preacceptBypass(agentDefaultAccount) lands in the default agent settings, NOT the engine account settings', () => {
  const agentSettings = path.join(SANDBOX, 'home2', 'settings.json');
  fs.mkdirSync(path.dirname(agentSettings), { recursive: true });
  process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = agentSettings;
  const engineDir = path.join(SANDBOX, 'engine-account-e');
  fs.mkdirSync(engineDir, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = engineDir;

  const r = trust.preacceptBypass(null, true);
  assert.equal(r.ok, true, `bypass write failed: ${r.because}`);
  const data = JSON.parse(fs.readFileSync(agentSettings, 'utf8'));
  assert.equal(data[trust.BYPASS_KEY], true, 'the bypass consent lands in the settings the default agent reads');
  assert.equal(fs.existsSync(path.join(engineDir, 'settings.json')), false,
    'the bypass consent must NOT be written to the engine account settings');
});
