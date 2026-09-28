'use strict';
/**
 * #4416 (Josh, 2026-09-28 15:17 and 15:18): every agent shows its ACTUAL model in plain language, not a raw
 * lowercase id ("gemini-3.8-flash") and not just the provider ("Grok"), read from what Kosmos can see, never
 * by asking the agent.
 *
 *   node --test engine/modelname-4416.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-4416-'));
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SANDBOX, '.codex');
const codex = require('./codexsession');
const status = require('./status');
const create = require('./create');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('#4416: an id the table does not know is read in plain language', () => {
  const rows = [
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],   // Josh's screenshot
    ['gemini-3.8-pro', 'Gemini 3.8 Pro'],
    ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'],
    ['grok-4.6', 'Grok 4.6'],                   // Josh 15:18
    ['grok-code-fast-1', 'Grok Code Fast 1'],
    ['gpt-5.6-sol', 'GPT 5.6 Sol'],             // a real codex rollout on this Mac
    ['claude-opus-6', 'Claude Opus 6'],         // a future Claude with a one-part version reads too
  ];
  for (const [id, want] of rows) assert.equal(status.modelDisplayName(id), want, id);
});

test('#4416: an id whose reading could mis-say its version stays raw (the reason the table exists)', () => {
  assert.equal(status.modelDisplayName('claude-haiku-4-5'), 'Claude Haiku 4.5', 'control: the table still names a dashed version it knows');
  assert.equal(status.modelDisplayName('claude-opus-6-1'), 'claude-opus-6-1', 'a dashed version would read "Opus 6 1"');
  assert.equal(status.modelDisplayName('gpt-4o-mini-2024-07-18'), 'gpt-4o-mini-2024-07-18', 'a date would read as a version');
  assert.equal(status.modelDisplayName('claude-sonnet-5-20251001'), 'Claude Sonnet 5', 'control: a dated id the table knows still drops its date');
  assert.equal(status.modelDisplayName('weird_id!'), 'weird_id!', 'something that is not words and numbers is shown as it is');
  assert.equal(status.modelDisplayName(''), null);
});

test('#4416: a Codex rollout names the model it runs, from its last turn_context', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-4416-wd-'));
  const dir = path.join(SANDBOX, '.codex', 'sessions', '2026', '09', '28');
  fs.mkdirSync(dir, { recursive: true });
  const meta = { timestamp: '2026-09-28T20:00:00.000Z', type: 'session_meta', payload: { session_id: 's1', cwd: wd, cli_version: '0.150.0', model_provider: 'openai' } };
  const ctx = (m) => ({ timestamp: '2026-09-28T20:00:01.000Z', type: 'turn_context', payload: { turn_id: 't', cwd: wd, model: m } });
  const file = path.join(dir, 'rollout-2026-09-28T20-00-00-model.jsonl');
  fs.writeFileSync(file, [meta, ctx('gpt-5.5'), ctx('gpt-5.6-sol')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = codex.read(wd);
  assert.equal(r.found, true, r.because);
  assert.equal(r.model, 'gpt-5.6-sol', 'the model switched to mid-session is the one it runs now');
  fs.writeFileSync(file, [meta].map((r2) => JSON.stringify(r2)).join('\n') + '\n');
  assert.equal(codex.read(wd).model, null, 'no turn yet: null, never a guess');
});

test('#4416: the card takes each runner\'s model from that runner\'s own record', () => {
  const src = read('engine/status.js');
  const at = src.indexOf('const sessModel = (x) =>');
  assert.notEqual(at, -1, 'the per-runner model choice is gone');
  const block = src.slice(at, src.indexOf('readModel(pane.name, pane.session);', at) + 40);
  for (const [runner, sess] of [['isAgyPane', 'agySess'], ['isGeminiPane', 'geminiSess'], ['isGrokPane', 'grokSess'], ['isCodexPane', 'codexSess']]) {
    assert.match(block, new RegExp(runner + ' \\? \\{ model: sessModel\\(' + sess + '\\) \\}'), runner + ' does not read its own record');
  }
  assert.match(block, /isMusePane \? \{ model: null \}/, 'a Muse pane was sent to the Claude transcript lookup');
  assert.match(block, /!tied \? \{ model: null \}/, 'an untied pane reports the real agent\'s model');
});

test('#4416: a Gemini or Grok job with no model names the one the supervisor pins, marked (default)', () => {
  const sh = read('bin/agent-supervisor.sh');
  assert.ok(sh.includes('GEMINI_MODEL="${MODEL:-' + create.LAUNCH_DEFAULT_MODEL.gemini + '}"'), 'the supervisor pins a different Gemini default than the board names');
  assert.ok(sh.includes('GROK_MODEL="${MODEL:-' + create.LAUNCH_DEFAULT_MODEL.grok + '}"'), 'the supervisor pins a different Grok default than the board names');
  const server = read('server.js');
  assert.match(server, /return pinned \? modelDisplayName\(pinned\) \+ ' \(default\)' : null;/);
  assert.equal(status.modelDisplayName(create.LAUNCH_DEFAULT_MODEL.grok) + ' (default)', 'Grok 4.6 (default)');
});

test('#4416: Codex names its model; the OpenAI picker keys on the RAW id, not the readable name', () => {
  const page = read('web/index.html');
  const at = page.indexOf('\nfunction modelLine(a) {');
  const fn = page.slice(at, page.indexOf('\n}\n', at));
  assert.match(fn, /if \(a\.runner === 'codex'\) return name \|\| 'OpenAI Codex';/, 'a Codex agent still says only the provider');
  assert.ok(fn.indexOf('const name =') < fn.indexOf("a.runner === 'codex'"), 'the Codex line runs before its model is known');
  assert.match(page, /const currentKey = \(a && typeof a\.plannedModelId === 'string'\) \? a\.plannedModelId : '';/,
    'the picker matches "GPT 5.6 Sol" against option values that are ids, and pre-selects nothing');
  const server = read('server.js');
  assert.match(server, /plannedModelId: \(a\.isNamedOurs && a\.runner === 'codex'\) \? create\.plannedModelArg\(a\.sessionName\) : null,/);
  assert.match(server, /plannedModelId: create\.plannedModelArg\(k\.name\),/);
});
