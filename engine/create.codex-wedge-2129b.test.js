'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/*
 * kosmos#2129, the UPDATE-case wedge, CODEX arm ("same for a new OpenAI/Codex agent").
 * A DEFAULT-account OpenAI agent launches with NO CODEX_HOME, so codex reads ~/.codex.
 * But codexHomeDir()/defaultHome() honours the ENGINE's CODEX_HOME, which the board
 * inherits from the app's launch env -- so on a used machine the default-account codex
 * trust write landed where the engine's codex reads, not the agent's. Same divergence
 * as the Claude arm. Fix: a default-account codex write targets the codex home a
 * no-CODEX_HOME agent reads, skipping the engine's CODEX_HOME.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// .native, as create.js resolves a folder: on Windows it expands an 8.3 temp name (RUNNER~1) the JS form keeps (kosmos#8378).
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-2129b-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
/* kosmos#8378: the [projects."<folder>"] header as create.js renders it. A POSIX path is the double-quoted form;
   a Windows backslash path is a TOML literal string ('...'), because raw backslashes are not valid in a basic string (#3439). */
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const projectHeader = (dir) => new RegExp(reEsc(`[projects.${create.tomlProjectKeyString(dir)}]`));

const ENVKEYS = ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME'];
let saved;
test.beforeEach(() => { saved = {}; for (const k of ENVKEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => { for (const k of ENVKEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test('defaultAgentCodexHome SKIPS the engine CODEX_HOME (the codex update wedge)', () => {
  process.env.CODEX_HOME = path.join(SANDBOX, 'engine-codex-account');
  const got = create.defaultAgentCodexHome();
  assert.equal(got, path.join(SANDBOX, '.codex'),
    'a default-account codex agent reads <home>/.codex, so the trust must target it, not the engine CODEX_HOME');
  assert.doesNotMatch(got, /engine-codex-account/, 'the codex write must NOT follow the engine CODEX_HOME');
});

test('defaultAgentCodexHome honours the AGENT_WORKFORCE_CODEX_HOME sandbox seam', () => {
  const seam = path.join(SANDBOX, 'seam-codex');
  process.env.AGENT_WORKFORCE_CODEX_HOME = seam;
  process.env.CODEX_HOME = path.join(SANDBOX, 'engine-codex-account');
  assert.equal(create.defaultAgentCodexHome(), seam);
});

test('trustCodexFolder(agentDefaultAccount) writes into the agent home ~/.codex, NOT the engine CODEX_HOME -- with a control', () => {
  // 🔑 DISCRIMINATING. Do NOT set AGENT_WORKFORCE_CODEX_HOME: defaultHome() (the unfixed
  // path) honours it FIRST, identically to defaultAgentCodexHome(), so the seam would make
  // the flag a no-op. The engine carries CODEX_HOME; the agent home is AGENT_WORKFORCE_HOME
  // (= SANDBOX). So the FIXED path resolves to SANDBOX/.codex while codexHomeDir()/defaultHome()
  // resolves to engineCodex -- they genuinely differ.
  const agentCodex = path.join(SANDBOX, '.codex');   // AGENT_WORKFORCE_HOME/.codex
  const engineCodex = path.join(SANDBOX, 'engine-codex-account');
  fs.mkdirSync(engineCodex, { recursive: true });
  process.env.CODEX_HOME = engineCodex;

  const folder = path.join(SANDBOX, 'w-openai');
  create.trustCodexFolder(folder, null, true);

  const agentToml = fs.readFileSync(path.join(agentCodex, 'config.toml'), 'utf8');
  assert.match(agentToml, projectHeader(folder),
    'the codex trust lands in the home the default agent reads (AGENT_WORKFORCE_HOME/.codex)');
  assert.match(agentToml, /trust_level = "trusted"/);
  assert.equal(fs.existsSync(path.join(engineCodex, 'config.toml')), false,
    'the codex trust must NOT be written to the engine CODEX_HOME -- that is the wedge');

  // CONTROL: the SAME write WITHOUT the flag follows codexHomeDir() into the engine home.
  const folder2 = path.join(SANDBOX, 'w-openai-ctrl');
  create.trustCodexFolder(folder2, null);
  assert.match(fs.readFileSync(path.join(engineCodex, 'config.toml'), 'utf8'),
    projectHeader(folder2),
    'CONTROL: without agentDefaultAccount the codex trust DOES follow the engine CODEX_HOME');
});

test('forgetCodexFolder(agentDefaultAccount) removes from the same default-account home', () => {
  const agentCodex = path.join(SANDBOX, '.codex');
  const engineCodex = path.join(SANDBOX, 'engine-codex-account-2');
  fs.mkdirSync(engineCodex, { recursive: true });
  process.env.CODEX_HOME = engineCodex;
  const folder = path.join(SANDBOX, 'w-openai-2');
  create.trustCodexFolder(folder, null, true);
  assert.match(fs.readFileSync(path.join(agentCodex, 'config.toml'), 'utf8'), /trust_level = "trusted"/);
  const got = create.forgetCodexFolder(folder, null, true);
  assert.equal(got.removed, true, 'the untrust must find and remove the entry the trust wrote (same home, create/remove symmetric)');
  assert.doesNotMatch(fs.readFileSync(path.join(agentCodex, 'config.toml'), 'utf8'),
    new RegExp(folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the entry is gone from the same home the trust used');
});
