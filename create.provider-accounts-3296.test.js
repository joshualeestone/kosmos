'use strict';
/**
 * #3296/#3391 accounts slice: the create.js + accountenv wiring that lets a gemini
 * or grok agent run on a NAMED account. Covers the pieces the account modules'
 * own tests (engine/geminiaccounts.test.js, engine/grokaccounts.test.js) do not:
 *  - accountenv.accountEnvVar's gemini/grok arms
 *  - create.geminiStorageHome (the ONE place the Gemini `.gemini`-subdir quirk lives)
 *  - the plist ROUND-TRIP: plistFor writes GEMINI_CLI_HOME/GROK_HOME = the account
 *    dir, and readJob (readPlistJob) reads it back -- the regex this slice extended,
 *    without which a per-account gemini/grok plist round-trips to a null configDir
 *  - createAgentInner's google/xai account arms: a known account resolves, an
 *    unknown one is REFUSED (not silently ignored, as the pre-slice arm did)
 *
 *   node --test create.provider-accounts-3296.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-create-provaccts-3296-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-cpa-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-cpa-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-cpa-launch-');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
// This suite calls createAgent(), so sandbox Claude Code's own config file too, or a
// create would write into the operator's real ~/.claude.json (fixture-discipline rule).
// (We also run DRY_RUN, so nothing is written -- this satisfies the static guard AND
// is correct belt-and-suspenders.)
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, '.claude.json');

const create = require('./engine/create');
const accountenv = require('./engine/accountenv');
const geminiAccounts = require('./engine/geminiaccounts');
const grokAccounts = require('./engine/grokaccounts');

// DRY_RUN for the whole file: createAgent must never spawn a real agent here. The
// engine refuses to leave dry-run without an injected runner (setDryRun(false)
// throws), so we set it ON once and never turn it off -- exactly the guard's intent.
create.setDryRun(true);

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('accountenv.accountEnvVar: gemini -> GEMINI_CLI_HOME, grok -> GROK_HOME, codex -> CODEX_HOME, else CLAUDE_CONFIG_DIR', () => {
  assert.equal(accountenv.accountEnvVar('gemini'), 'GEMINI_CLI_HOME');
  assert.equal(accountenv.accountEnvVar('grok'), 'GROK_HOME');
  assert.equal(accountenv.accountEnvVar('codex'), 'CODEX_HOME');
  assert.equal(accountenv.accountEnvVar('claude'), 'CLAUDE_CONFIG_DIR');
  assert.equal(accountenv.accountEnvVar('anything-else'), 'CLAUDE_CONFIG_DIR');
});

test('geminiStorageHome: a per-account dir gets .gemini appended; the default (null) stays ~/.gemini', () => {
  const acct = nodePath.join(SANDBOX, '.gemini-work');
  assert.equal(create.geminiStorageHome(acct), nodePath.join(acct, '.gemini'), 'the CLI writes into a .gemini subdir below GEMINI_CLI_HOME');
  assert.equal(create.geminiStorageHome(null), create.defaultAgentGeminiHome(), 'the default account keeps ~/.gemini directly');
});

test('plist round-trip (gemini): plistFor writes GEMINI_CLI_HOME = account dir VERBATIM, readJob reads it back', () => {
  const acct = nodePath.join(SANDBOX, '.gemini-rt');
  const xml = create.plistFor('grt', '/bin/gemini', '/bin/tmux', 'gemini-2.5-flash', acct, 'gemini');
  assert.match(xml, new RegExp('<key>GEMINI_CLI_HOME</key><string>' + acct.replace(/[.]/g, '\\.') + '</string>'), 'GEMINI_CLI_HOME is the account dir with NO .gemini transform in the plist');
  const pp = create.plistPath('grt');
  fs.mkdirSync(nodePath.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, xml);
  const job = create.readJob('grt');
  assert.ok(job, 'readJob returned a job');
  assert.equal(job.runner, 'gemini', 'the runner round-trips');
  assert.equal(job.configDir, acct, 'configDir round-trips = the account dir (NOT null: the readPlistJob regex must know GEMINI_CLI_HOME)');
  // and the reader resolves storage one .gemini level below
  assert.equal(create.geminiStorageHome(job.configDir), nodePath.join(acct, '.gemini'));
});

test('plist round-trip (grok): GROK_HOME = account dir verbatim, readJob reads it back', () => {
  const acct = nodePath.join(SANDBOX, '.grok-rt');
  const xml = create.plistFor('xrt', '/bin/grok', '/bin/tmux', 'grok-4.6', acct, 'grok');
  assert.match(xml, new RegExp('<key>GROK_HOME</key><string>' + acct.replace(/[.]/g, '\\.') + '</string>'));
  const pp = create.plistPath('xrt');
  fs.mkdirSync(nodePath.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, xml);
  const job = create.readJob('xrt');
  assert.equal(job.runner, 'grok');
  assert.equal(job.configDir, acct, 'grok configDir round-trips verbatim (GROK_HOME is read verbatim)');
});

test('a DEFAULT-account gemini/grok agent writes NO account-env line (absent means the default)', () => {
  const g = create.plistFor('gd', '/bin/gemini', '/bin/tmux', 'gemini-2.5-flash', null, 'gemini');
  assert.ok(!g.includes('GEMINI_CLI_HOME'), 'a default gemini agent carries no GEMINI_CLI_HOME');
  const x = create.plistFor('xd', '/bin/grok', '/bin/tmux', 'grok-4.6', null, 'grok');
  assert.ok(!x.includes('GROK_HOME'), 'a default grok agent carries no GROK_HOME');
});

test('createAgentInner google arm: an UNKNOWN account dir is REFUSED (not silently ignored)', () => {
    const out = create.createAgent({
      name: 'gem-unknown', provider: 'google', role: 'pm', account: nodePath.join(SANDBOX, '.gemini-nope'),
      geminiBin: '/bin/gemini', tmux: '/bin/tmux',
    });
    assert.equal(out.outcome, 'refused');
    assert.match(out.because, /do not know that Gemini account/);
});

test('createAgentInner xai arm: an UNKNOWN account dir is REFUSED', () => {
    const out = create.createAgent({
      name: 'grok-unknown', provider: 'xai', role: 'pm', account: nodePath.join(SANDBOX, '.grok-nope'),
      grokBin: '/bin/grok', tmux: '/bin/tmux',
    });
    assert.equal(out.outcome, 'refused');
    assert.match(out.because, /do not know that Grok account/);
});

test('createAgentInner google arm: a KNOWN named account is recognized (not refused for being unknown)', () => {
  const { dir } = geminiAccounts.dirForLabel('known');
  geminiAccounts.storeKey(dir, 'AIza-known-key-1234');
    const out = create.createAgent({
      name: 'gem-known', provider: 'google', role: 'pm', account: dir,
      geminiBin: '/bin/gemini', tmux: '/bin/tmux',
    });
    // Under DRY_RUN nothing is written, but the account arm ran: the "unknown account"
    // refusal is precisely what a recognized account must NOT produce.
    assert.notEqual(out.because && /do not know that Gemini account/.test(out.because), true, 'a stored account is not "unknown"');
});

test('createAgentInner xai arm: a KNOWN named account is recognized', () => {
  const { dir } = grokAccounts.dirForLabel('known');
  grokAccounts.storeKey(dir, 'xai-known-key-5678');
    const out = create.createAgent({
      name: 'grok-known', provider: 'xai', role: 'pm', account: dir,
      grokBin: '/bin/grok', tmux: '/bin/tmux',
    });
    assert.notEqual(out.because && /do not know that Grok account/.test(out.because), true);
});
