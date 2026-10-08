'use strict';
/**
 * kosmos#5532: usage scoped to THIS Kosmos's own agents. The computer-wide reader counts every Claude session on the
 * computer; the scoped one counts only sessions launched from one of the given agent folders, per day and model.
 * Real transcripts in a sandboxed config root; the other providers are stood in where noted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-world-5532-')));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME']) delete process.env[v];
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');
const TODAY = new Date().toISOString().slice(0, 10);
const AGENT = path.join(SANDBOX, 'workers', 'leo');
const PERSONAL = path.join(SANDBOX, 'home', 'my-own-project');
const SUB = path.join(AGENT, 'a-subfolder');
for (const d of [AGENT, PERSONAL, SUB]) fs.mkdirSync(d, { recursive: true });

function session(name, cwd, id, model, input) {
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', name, 's.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd, timestamp: TODAY + 'T01:00:00.000Z' }),
    JSON.stringify({ timestamp: TODAY + 'T02:00:00.000Z', cwd, message: { id, model, usage: { input_tokens: input, output_tokens: 1 } } }),
  ].join('\n') + '\n');
}
session('agent', AGENT, 'm-agent', 'claude-opus-5-5', 100);
session('personal', PERSONAL, 'm-personal', 'claude-personal-model', 7000);
session('sub', SUB, 'm-sub', 'claude-sub-model', 300);

test('#5532: only sessions launched from this Kosmos\'s own agent folders count, per model; a subfolder is not claimed', async () => {
  // CONTROL: the computer-wide scan sees all three sessions, so what the scoped reader leaves out is real.
  const all = await usage.scanUsage({ sinceDay: TODAY, untilDay: TODAY });
  assert.deepEqual(Object.keys(all.days[TODAY]).sort(), ['claude-opus-5-5', 'claude-personal-model', 'claude-sub-model']);
  const w = await usage.worldUsageByModel(1, [AGENT], { scanProviders: async () => ({ folderModels: {}, complete: true }) });
  assert.deepEqual(Object.keys(w.byDay[TODAY] || {}), ['claude-opus-5-5'], 'usage from outside this Kosmos\'s agents was counted: ' + JSON.stringify(w.byDay));
  assert.equal(w.byDay[TODAY]['claude-opus-5-5'].input_tokens, 100);
  assert.equal(w.complete, true);
  const none = await usage.worldUsageByModel(1, [], { scanProviders: async () => ({ folderModels: {}, complete: true }) });
  assert.deepEqual(none.byDay, {}, 'a Kosmos with no agents counted usage');
});

test('#5532: other providers are scoped the same way, and a partly read provider says complete: false', async () => {
  const providers = async () => ({
    complete: false,
    folderModels: { [TODAY]: { [AGENT]: { 'gpt-5.1': { input_tokens: 40, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } },
      [PERSONAL]: { 'gemini-2.5-flash': { input_tokens: 9, output_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } } } },
  });
  const w = await usage.worldUsageByModel(1, [AGENT], { scanProviders: providers });
  assert.deepEqual(Object.keys(w.byDay[TODAY]).sort(), ['claude-opus-5-5', 'gpt-5.1']);
  assert.equal(w.complete, false, 'a partly read provider was reported as the whole count');
  const thrown = await usage.worldUsageByModel(1, [AGENT], { scanProviders: async () => { throw new Error('no homes'); } });
  assert.equal(thrown.complete, false);
});

test('#5532: an agent folder reached through a link matches its real folder', async () => {
  const link = path.join(SANDBOX, 'link-to-leo');
  fs.symlinkSync(AGENT, link);
  const w = await usage.worldUsageByModel(1, [link], { scanProviders: async () => ({ folderModels: {}, complete: true }) });
  assert.deepEqual(Object.keys(w.byDay[TODAY] || {}), ['claude-opus-5-5'], 'a linked agent folder did not match');
});

test('#5532: a session launched through a link to an agent\'s folder counts for that agent', async () => {
  const link = path.join(SANDBOX, 'another-link-to-leo');
  fs.symlinkSync(AGENT, link);
  session('via-link', link, 'm-link', 'claude-via-link', 55);
  const w = await usage.worldUsageByModel(1, [AGENT], { scanProviders: async () => ({ folderModels: {}, complete: true }) });
  assert.equal((w.byDay[TODAY] || {})['claude-via-link'] && w.byDay[TODAY]['claude-via-link'].input_tokens, 55, 'a session recorded under a link to the agent\'s folder was not counted: ' + JSON.stringify(w.byDay));
});
