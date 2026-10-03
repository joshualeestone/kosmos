'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs (up5158-*), removed when it exits
/* #5158: Codex, Gemini CLI and Grok usage counted once each, in Claude's four buckets, and merged beside Claude's
 * saved days without touching them. Fixture shapes are the ones measured on this fleet 2026-10-03 (numbers only).
 *   node --test engine/usageproviders-5158.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
/* The data root is sandboxed BEFORE anything loads usage.js or store.js (store.ROOT is fixed at require time), so the
   merge test below writes only into this temp folder, never into a real board's usage folder. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'up5158-data-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const { scanProviders } = require('./usageproviders');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'up5158-'));
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function codexHome(rows, name = 'rollout-2026-10-01T10-00-00-aaa.jsonl') {
  const h = tmp();
  const d = path.join(h, 'sessions', '2026', '10', '01');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), jl(rows));
  return h;
}
const tc = (ts, input, cached, output) => ({ timestamp: ts, type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } });

test('Codex: the change in the running total is counted; a repeated event adds nothing', async () => {
  const h = codexHome([
    { timestamp: '2026-10-01T10:00:00Z', type: 'session_meta', payload: { cwd: '/w/roo' } },
    { timestamp: '2026-10-01T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    tc('2026-10-01T10:00:05Z', 20718, 11008, 324),
    tc('2026-10-01T10:00:09Z', 41816, 22016, 496),
    tc('2026-10-01T10:00:10Z', 41816, 22016, 496),   // the repeat measured on this fleet
  ]);
  const r = await scanProviders({ homes: { codex: [h], gemini: [], grok: [] } });
  const b = r.days['2026-10-01']['gpt-5.6-sol'];
  assert.equal(b.input_tokens, 41816 - 22016, 'input excludes the cached reads');
  assert.equal(b.cache_read_input_tokens, 22016);
  assert.equal(b.output_tokens, 496);
  assert.equal(b.rows, 2, 'the repeated event was not counted as a row');
  assert.equal(r.folders['2026-10-01']['/w/roo'].output_tokens, 496, 'kept against the launch folder');
});

test('Codex: a total that goes down starts a new run, counted from its own total', async () => {
  const h = codexHome([
    { timestamp: '2026-10-01T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    tc('2026-10-01T10:00:05Z', 1000, 0, 100),
    tc('2026-10-01T10:00:09Z', 300, 0, 30),
  ]);
  const r = await scanProviders({ homes: { codex: [h], gemini: [], grok: [] } });
  const b = r.days['2026-10-01']['gpt-5.6-sol'];
  assert.equal(b.input_tokens, 1300);
  assert.equal(b.output_tokens, 130);
});

test('Gemini: a reply written twice counts once; thoughts are output, tool is input, cached leaves input', async () => {
  const h = tmp();
  const slug = path.join(h, 'tmp', 'pixel');
  fs.mkdirSync(path.join(slug, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(slug, '.project_root'), '/w/pixel\n');
  const msg = { id: 'm1', timestamp: '2026-10-01T12:00:00Z', type: 'gemini', model: 'gemini-2.5-flash',
    tokens: { input: 17381, cached: 1000, output: 35, thoughts: 193, tool: 7, total: 17616 } };
  fs.writeFileSync(path.join(slug, 'chats', 'session-1.jsonl'), jl([{ sessionId: 's' }, msg, { $set: { messages: [msg] } }]));
  const r = await scanProviders({ homes: { codex: [], gemini: [h], grok: [] } });
  const b = r.days['2026-10-01']['gemini-2.5-flash'];
  assert.equal(b.rows, 1, 'the second copy of the reply was not counted');
  assert.equal(b.input_tokens, 17381 - 1000 + 7);
  assert.equal(b.cache_read_input_tokens, 1000);
  assert.equal(b.output_tokens, 35 + 193);
  assert.equal(r.folders['2026-10-01']['/w/pixel'].rows, 1, 'kept against the project root');
});

test('Grok: each turn once, split per model, input without its cached and cache-write parts', async () => {
  const h = tmp();
  const sd = path.join(h, 'sessions', encodeURIComponent('/w/bix'), 'sess1');
  fs.mkdirSync(sd, { recursive: true });
  const turn = { turnNumber: 1, endedAt: '2026-10-02T09:00:00Z', inputTokens: 298243, cachedReadTokens: 244480,
    cacheCreationTokens: 0, outputTokens: 4255, reasoningTokens: 1816, totalTokens: 302498, primaryModelId: 'grok-4.6-build',
    modelUsage: { 'grok-4.6-build': { inputTokens: 298243, cachedReadTokens: 244480, cacheCreationTokens: 0, outputTokens: 4255 } } };
  fs.writeFileSync(path.join(sd, 'usage.json'), JSON.stringify({ sessionId: 'sess1', turns: [turn, turn] }));
  const r = await scanProviders({ homes: { codex: [], gemini: [], grok: [h] } });
  const b = r.days['2026-10-02']['grok-4.6-build'];
  assert.equal(b.rows, 1, 'the same turn number counted once');
  assert.equal(b.input_tokens, 298243 - 244480);
  assert.equal(b.cache_read_input_tokens, 244480);
  assert.equal(b.output_tokens, 4255, 'reasoning is inside output (total = in + out), not added again');
  assert.equal(r.folders['2026-10-02']['/w/bix'].rows, 1);
});

test('missing homes and unreadable files give an empty result, never a throw', async () => {
  const r = await scanProviders({ homes: { codex: ['/nonexistent-5158'], gemini: ['/nonexistent-5158'], grok: ['/nonexistent-5158'] } });
  assert.deepEqual(r.days, {});
  assert.deepEqual(r.folders, {});
});

test('the merge keeps Claude\'s saved days byte-identical and freezes the providers beside them', async () => {
  const usage = require('./usage');
  assert.ok(usage.USAGE_DIR.startsWith(SANDBOX + path.sep), 'CONTROL: the usage folder is the sandbox, not a real board\'s: ' + usage.USAGE_DIR);
  fs.mkdirSync(usage.USAGE_DIR, { recursive: true });
  const day = '2001-01-02';   // a past day that no real board has saved
  const claudeModel = path.join(usage.USAGE_DIR, `${day}.v2.json`);
  const claudeFolders = path.join(usage.USAGE_DIR, `${day}.folders.v1.json`);
  const before = JSON.stringify({ 'claude-opus-5-5': { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } });
  fs.writeFileSync(claudeModel, before);
  fs.writeFileSync(claudeFolders, '{}');
  const providersFile = usage.frozenProvidersPath(day);
  try {
    const byDay = { [day]: JSON.parse(before) };
    const byFolder = { [day]: {} };
    const scan = async () => ({ days: { [day]: { 'gpt-5.6-sol': { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 3, rows: 1 } } },
      folders: { [day]: { '/w/roo': { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 3, rows: 1 } } } });
    await usage.mergeProviders([day], '2999-01-01', byDay, byFolder, scan);
    assert.equal(fs.readFileSync(claudeModel, 'utf8'), before, 'Claude\'s saved day was not rewritten');
    assert.equal(fs.readFileSync(claudeFolders, 'utf8'), '{}', 'Claude\'s folder split was not rewritten');
    assert.ok(byDay[day]['claude-opus-5-5'] && byDay[day]['gpt-5.6-sol'], 'both providers are in the merged day');
    assert.equal(byFolder[day]['/w/roo'].output_tokens, 2);
    const frozen = JSON.parse(fs.readFileSync(providersFile, 'utf8'));
    assert.equal(frozen.models['gpt-5.6-sol'].output_tokens, 2, 'the providers\' day was frozen in its own file');
    // A second read uses the frozen file: a scan that would now return nothing is not consulted for that day.
    const byDay2 = { [day]: JSON.parse(before) };
    await usage.mergeProviders([day], '2999-01-01', byDay2, {}, async () => ({ days: {}, folders: {} }));
    assert.equal(byDay2[day]['gpt-5.6-sol'].output_tokens, 2, 'the frozen providers file is what a later read uses');
  } finally {
    for (const f of [claudeModel, claudeFolders, providersFile]) fs.rmSync(f, { force: true });
  }
});
