'use strict';
/**
 * #4416 (Josh, 2026-09-28 15:17 and 15:18): every agent shows its ACTUAL model in plain language, not a raw
 * lowercase id ("gemini-3.8-flash") and not just the provider ("Grok"), read from what Kosmos can see, never
 * by asking the agent.
 *
 *   node --test engine/modelname-4416.test.js
 */
require('../test-support/tmpscope');   // the #4273 leak gate: its temp dirs stay in this process's own
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-4416-'));
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SANDBOX, '.codex');
const codex = require('./codexsession');
const status = require('./status');
const keyed = require('./win32keyed');
const page = require('../test-support/page');

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

test('#4416: a Gemini or Grok job with no model names the one the launcher pins, marked (default)', () => {
  /* ONE table (win32keyed.DEFAULT_MODEL) is what both the Windows launcher and the board read; the Mac supervisor
     is a shell script, so its copy is held equal here, because two copies of one fact drift. */
  const sh = read('bin/agent-supervisor.sh');
  assert.ok(sh.includes('GEMINI_MODEL="${MODEL:-' + keyed.DEFAULT_MODEL.gemini + '}"'), 'the supervisor pins a different Gemini default than the board names');
  assert.ok(sh.includes('GROK_MODEL="${MODEL:-' + keyed.DEFAULT_MODEL.grok + '}"'), 'the supervisor pins a different Grok default than the board names');
  /* plannedFor lives inside the request handler's closure, so its wiring is pinned by source; the value it
     produces is pinned behaviourally on the next line. */
  const server = read('server.js');
  assert.match(server, /if \(job && job\.model\) return modelDisplayName\(job\.model\);/, 'a Windows job\'s own model is ignored for the pinned default');
  assert.match(server, /return pinned \? modelDisplayName\(pinned\) \+ ' \(default\)' : null;/);
  assert.equal(status.modelDisplayName(keyed.DEFAULT_MODEL.grok) + ' (default)', 'Grok 4.6 (default)');
});

/* The shipped page functions, lifted with their real dependencies (the #2140 check does the same). */
function pageFns() {
  const script = page.scriptOf(read('web/index.html'));
  /* page.liftConst stops at the first ';', and CARD_ST's comments carry some, so the object is walked by its
     braces (server.test.js pageConstSource does the same for the same const). */
  const at = script.indexOf('const CARD_ST = {');
  assert.notEqual(at, -1, 'CARD_ST vanished from the page');
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', at); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  const prelude = script.slice(at, end) + ';\n' + page.liftAll(script, ['cardStOf', 'modelLine', 'runsOnLine']);
  // eslint-disable-next-line no-new-func
  return new Function(prelude + '\nreturn { modelLine, runsOnLine };')();
}

test('#4416: every runner shows its own model, never "Claude <another vendor\'s model>"', () => {
  const { modelLine } = pageFns();
  assert.equal(modelLine({ runner: 'codex', modelName: 'GPT 5.6 Sol', state: 'working' }), 'GPT 5.6 Sol');
  assert.equal(modelLine({ runner: 'codex', state: 'working' }), 'OpenAI Codex', 'no turn yet: the provider');
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.8 Flash', state: 'working' }), 'Gemini 3.8 Flash');
  assert.equal(modelLine({ runner: 'grok', plannedModelName: 'Grok 4.6 (default)', state: 'stopped' }), 'Grok 4.6 (default)');
  assert.equal(modelLine({ modelName: 'Sonnet 5', state: 'working' }), 'Claude Sonnet 5', 'control: a Claude agent is still prefixed');
});

test('#4416: a STOPPED non-Claude agent\'s "Will start on" keeps its runner', () => {
  const { runsOnLine } = pageFns();
  const rows = [
    ['gemini', 'Gemini 2.5 Flash (default)'],
    ['grok', 'Grok 4.6 (default)'],
    ['codex', 'GPT 5.6 Sol'],
    ['antigravity', 'Gemini 3.8 Pro'],
  ];
  for (const [runner, planned] of rows) {
    assert.deepEqual(runsOnLine({ runner, plannedModelName: planned, modelName: 'something it ran as', state: 'stopped' }),
      { lead: 'Will start on ', name: planned }, runner + ' read as a Claude model');
  }
  assert.deepEqual(runsOnLine({ plannedModelName: 'Opus 5', state: 'stopped' }), { lead: 'Will start on ', name: 'Claude Opus 5' },
    'control: a stopped Claude agent is still prefixed');
});

test('#4416: the OpenAI picker keys on the RAW id, on either platform', () => {
  /* The picker's own pre-selection is exercised end to end by web.detail-openai-model-2140.test.js; this pins
     that both server sites fill plannedModelId from the reader that also covers a Windows job. */
  const server = read('server.js');
  assert.match(server, /plannedModelId: \(a\.isNamedOurs && a\.runner === 'codex'\) \? create\.plannedModelId\(a\.sessionName\) : null,/);
  assert.match(server, /plannedModelId: create\.plannedModelId\(k\.name\),/);
  assert.equal(require('./create').plannedModelId('../escape'), null, 'an unvalidated name reads nothing');
});
